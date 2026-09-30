import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  calcularCompra,
  type CompraDetalle,
  type CompraResumen,
  type FiltroCompras,
  fechaDeHoy,
  litrosDelViaje,
  multiplicar,
  type NuevaCompra,
  type Paginado,
  type Viaje,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, min, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB, type Transaccion } from '../db/conexion.js';
import {
  compraDetalle,
  compras,
  movimientos,
  productos,
  proveedores,
  ubicaciones,
  usuarios,
  vehiculos,
} from '../db/esquema.js';
import { MovimientosService } from '../inventario/movimientos.service.js';

const POR_PAGINA = 30;
const canceladoPor = alias(usuarios, 'cancelado_por');

/**
 * Una compra es un viaje a un proveedor: lo que se le pagó más la gasolina,
 * repartida por pieza. Todas las cuentas salen de `calcularCompra`, la misma
 * función que usa el front para mostrar el cálculo mientras se captura.
 */
@Injectable()
export class ComprasService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly inventario: MovimientosService,
  ) {}

  async registrar(usuario: UsuarioSesion, datos: NuevaCompra): Promise<CompraDetalle> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      () => this.porClave(datos.claveIdempotencia, usuario.id),
      async () => {
        const id = await this.db.transaction(async (tx) => {
          const [proveedor] = await tx
            .select()
            .from(proveedores)
            .where(eq(proveedores.id, datos.proveedorId));
          if (!proveedor?.activo) {
            throw campoInvalido('proveedorId', 'El proveedor no existe o está dado de baja.');
          }

          let viaje: Viaje | null = null;
          if (datos.vehiculoId !== null) {
            const [vehiculo] = await tx
              .select()
              .from(vehiculos)
              .where(eq(vehiculos.id, datos.vehiculoId));
            if (!vehiculo?.activo)
              throw campoInvalido('vehiculoId', 'El vehículo no existe o está dado de baja.');
            viaje = {
              distanciaKm: datos.distanciaKm ?? proveedor.distanciaKm,
              rendimientoKmL: vehiculo.rendimientoKmL,
              precioGasolina: datos.precioGasolina ?? '0',
            };
          }

          const ubicacionId = await this.destino(tx, datos.ubicacionId);
          const porProducto = await this.inventario.bloquearProductos(
            tx,
            datos.lineas.map((l) => l.productoId),
          );
          datos.lineas.forEach((linea, i) => {
            if (!porProducto.get(linea.productoId)?.activo) {
              throw campoInvalido(`lineas.${i}.productoId`, 'Ese producto está dado de baja.');
            }
          });

          const calculo = calcularCompra(viaje, datos.lineas);
          const [compra] = await tx
            .insert(compras)
            .values({
              fecha,
              proveedorId: proveedor.id,
              vehiculoId: datos.vehiculoId,
              ubicacionId,
              metodoPago: datos.metodoPago,
              precioGasolina: viaje?.precioGasolina ?? null,
              distanciaKm: viaje?.distanciaKm ?? null,
              rendimientoKmL: viaje?.rendimientoKmL ?? null,
              costoTraslado: calculo.costoTraslado,
              subtotalMercancia: calculo.subtotalMercancia,
              total: calculo.total,
              piezas: calculo.piezas,
              notas: datos.notas,
              usuarioId: usuario.id,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: compras.id });
          if (!compra) throw new Error('No se registró la compra');

          await tx.insert(compraDetalle).values(
            datos.lineas.map((linea, i) => ({
              compraId: compra.id,
              productoId: linea.productoId,
              cantidad: linea.cantidad,
              costoProveedor: linea.costoProveedor,
              costoTrasladoUnitario: calculo.lineas[i]?.costoTrasladoUnitario ?? '0',
              costoUnitario: calculo.lineas[i]?.costoUnitario ?? linea.costoProveedor,
            })),
          );
          await this.inventario.aplicar(
            tx,
            datos.lineas.map((linea, i) => ({
              productoId: linea.productoId,
              ubicacionId,
              cantidad: linea.cantidad,
              tipo: 'compra' as const,
              costo: calculo.lineas[i]?.costoUnitario,
            })),
            { referencia: { compraId: compra.id }, usuarioId: usuario.id, fecha },
          );
          return compra.id;
        });
        return this.detalle(id);
      },
    );
  }

  /**
   * Cancelar solo se puede si no ha salido ninguna pieza de esos productos
   * desde la compra (en ninguna ubicación): así el costo promedio vuelve exacto
   * a como estaba. Si ya hubo salidas, la corrección es un ajuste.
   */
  async cancelar(usuario: UsuarioSesion, id: number, motivo: string): Promise<CompraDetalle> {
    await this.db.transaction(async (tx) => {
      const [compra] = await tx.select().from(compras).where(eq(compras.id, id)).for('update');
      if (!compra) throw new NotFoundException('La compra no existe.');
      if (compra.estado === 'cancelado')
        throw new ConflictException('La compra ya estaba cancelada.');

      const lineas = await tx.select().from(compraDetalle).where(eq(compraDetalle.compraId, id));
      const productoIds = lineas.map((l) => l.productoId);
      await this.inventario.bloquearProductos(tx, productoIds);

      const [primero] = await tx
        .select({ id: min(movimientos.id) })
        .from(movimientos)
        .where(and(eq(movimientos.compraId, id), eq(movimientos.tipo, 'compra')));
      const [salida] = await tx
        .select({ producto: productos.nombre })
        .from(movimientos)
        .innerJoin(productos, eq(productos.id, movimientos.productoId))
        .where(
          and(
            inArray(movimientos.productoId, productoIds),
            gt(movimientos.id, primero?.id ?? 0),
            lt(movimientos.cantidad, 0),
            inArray(movimientos.tipo, ['venta', 'ajuste', 'cancelacion_compra']),
          ),
        )
        .limit(1);
      if (salida) {
        throw new ConflictException(
          `Ya salieron piezas de ${salida.producto} después de esta compra, así que no se puede cancelar. Corrígela con un ajuste.`,
        );
      }

      await tx
        .update(compras)
        .set({
          estado: 'cancelado',
          canceladoEn: new Date(),
          canceladoPor: usuario.id,
          motivoCancelacion: motivo,
        })
        .where(eq(compras.id, id));
      await this.inventario.aplicar(
        tx,
        lineas.map((linea) => ({
          productoId: linea.productoId,
          ubicacionId: compra.ubicacionId,
          cantidad: -linea.cantidad,
          tipo: 'cancelacion_compra' as const,
          costo: linea.costoUnitario,
        })),
        { referencia: { compraId: id }, usuarioId: usuario.id, fecha: fechaDeHoy() },
      );
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cancelar',
        entidad: 'compra',
        entidadId: id,
        datos: { motivo, folio: compra.folio, total: compra.total },
      });
    });
    return this.detalle(id);
  }

  async listar(filtro: FiltroCompras): Promise<Paginado<CompraResumen>> {
    const condiciones: SQL[] = [];
    if (filtro.desde) condiciones.push(gte(compras.fecha, filtro.desde));
    if (filtro.hasta) condiciones.push(lte(compras.fecha, filtro.hasta));
    if (filtro.proveedorId) condiciones.push(eq(compras.proveedorId, filtro.proveedorId));
    if (filtro.estado) condiciones.push(eq(compras.estado, filtro.estado));
    const donde = and(...condiciones);

    const [filas, [conteo]] = await Promise.all([
      this.resumen()
        .where(donde)
        .orderBy(desc(compras.fecha), desc(compras.id))
        .limit(POR_PAGINA)
        .offset((filtro.pagina - 1) * POR_PAGINA),
      this.db.select({ total: count() }).from(compras).where(donde),
    ]);
    return { filas, total: conteo?.total ?? 0, pagina: filtro.pagina, porPagina: POR_PAGINA };
  }

  async detalle(id: number): Promise<CompraDetalle> {
    const [compra] = await this.db
      .select({
        id: compras.id,
        folio: compras.folio,
        fecha: compras.fecha,
        proveedorId: compras.proveedorId,
        proveedor: proveedores.nombre,
        vehiculoId: compras.vehiculoId,
        vehiculo: vehiculos.nombre,
        ubicacionId: compras.ubicacionId,
        ubicacion: ubicaciones.nombre,
        metodoPago: compras.metodoPago,
        precioGasolina: compras.precioGasolina,
        distanciaKm: compras.distanciaKm,
        rendimientoKmL: compras.rendimientoKmL,
        costoTraslado: compras.costoTraslado,
        subtotalMercancia: compras.subtotalMercancia,
        total: compras.total,
        piezas: compras.piezas,
        estado: compras.estado,
        notas: compras.notas,
        registradaPor: usuarios.nombre,
        registradoEn: compras.registradoEn,
        canceladoEn: compras.canceladoEn,
        canceladoPor: canceladoPor.nombre,
        motivoCancelacion: compras.motivoCancelacion,
      })
      .from(compras)
      .innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
      .leftJoin(vehiculos, eq(vehiculos.id, compras.vehiculoId))
      .innerJoin(ubicaciones, eq(ubicaciones.id, compras.ubicacionId))
      .innerJoin(usuarios, eq(usuarios.id, compras.usuarioId))
      .leftJoin(canceladoPor, eq(canceladoPor.id, compras.canceladoPor))
      .where(eq(compras.id, id));
    if (!compra) throw new NotFoundException('La compra no existe.');

    const lineas = await this.db
      .select({
        productoId: compraDetalle.productoId,
        producto: productos.nombre,
        cantidad: compraDetalle.cantidad,
        costoProveedor: compraDetalle.costoProveedor,
        costoTrasladoUnitario: compraDetalle.costoTrasladoUnitario,
        costoUnitario: compraDetalle.costoUnitario,
      })
      .from(compraDetalle)
      .innerJoin(productos, eq(productos.id, compraDetalle.productoId))
      .where(eq(compraDetalle.compraId, id))
      .orderBy(asc(compraDetalle.id));

    const { canceladoEn, canceladoPor: por, motivoCancelacion, registradoEn, ...resto } = compra;
    const viaje =
      resto.distanciaKm && resto.rendimientoKmL && resto.precioGasolina
        ? {
            distanciaKm: resto.distanciaKm,
            rendimientoKmL: resto.rendimientoKmL,
            precioGasolina: resto.precioGasolina,
          }
        : null;
    return {
      ...resto,
      litros: viaje ? litrosDelViaje(viaje) : null,
      trasladoPorPieza: lineas[0]?.costoTrasladoUnitario ?? '0',
      registradoEn: registradoEn.toISOString(),
      cancelacion: canceladoEn
        ? { en: canceladoEn.toISOString(), por: por ?? '', motivo: motivoCancelacion ?? '' }
        : null,
      lineas: lineas.map((linea) => ({
        ...linea,
        importe: multiplicar(linea.cantidad, linea.costoUnitario),
      })),
    };
  }

  /* ---- internos ---- */

  private resumen() {
    return this.db
      .select({
        id: compras.id,
        folio: compras.folio,
        fecha: compras.fecha,
        proveedor: proveedores.nombre,
        vehiculo: vehiculos.nombre,
        ubicacion: ubicaciones.nombre,
        piezas: compras.piezas,
        costoTraslado: compras.costoTraslado,
        total: compras.total,
        estado: compras.estado,
        registradaPor: usuarios.nombre,
      })
      .from(compras)
      .innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
      .leftJoin(vehiculos, eq(vehiculos.id, compras.vehiculoId))
      .innerJoin(ubicaciones, eq(ubicaciones.id, compras.ubicacionId))
      .innerJoin(usuarios, eq(usuarios.id, compras.usuarioId))
      .$dynamic();
  }

  /** Sin ubicación elegida, la mercancía entra al primer almacén activo. */
  private async destino(tx: Transaccion, ubicacionId: number | null): Promise<number> {
    const condicion =
      ubicacionId === null
        ? and(eq(ubicaciones.tipo, 'almacen'), eq(ubicaciones.activa, true))
        : and(eq(ubicaciones.id, ubicacionId), eq(ubicaciones.activa, true));
    const [ubicacion] = await tx
      .select({ id: ubicaciones.id })
      .from(ubicaciones)
      .where(condicion)
      .orderBy(asc(ubicaciones.id))
      .limit(1);
    if (!ubicacion)
      throw campoInvalido('ubicacionId', 'No hay un almacén activo al cual entre la mercancía.');
    return ubicacion.id;
  }

  private async porClave(
    claveIdempotencia: string,
    usuarioId: number,
  ): Promise<CompraDetalle | null> {
    const [fila] = await this.db
      .select({ id: compras.id })
      .from(compras)
      .where(
        and(eq(compras.claveIdempotencia, claveIdempotencia), eq(compras.usuarioId, usuarioId)),
      );
    return fila ? this.detalle(fila.id) : null;
  }
}

function campoInvalido(campo: string, mensaje: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ mensaje, campos: { [campo]: mensaje } });
}
