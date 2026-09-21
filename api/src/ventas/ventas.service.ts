import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  comparar,
  descuentoValido,
  fechaDeHoy,
  type FiltroVentas,
  type ListaVentas,
  METODOS_PAGO,
  type MetodoPago,
  multiplicar,
  type NuevaVenta,
  restar,
  sumar,
  totalVenta,
  type VentaDetalle,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gte, lte, type SQL, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { conCostos } from '../comun/costos.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { productos, ubicaciones, usuarios, ventaDetalle, ventas } from '../db/esquema.js';
import { MovimientosService } from '../inventario/movimientos.service.js';

const POR_PAGINA = 30;
const vendedor = alias(usuarios, 'vendedor');
const canceladoPor = alias(usuarios, 'cancelado_por');

/**
 * Una venta se registra al entregar: descuenta en ese momento de la ubicación
 * del vendedor, al precio de lista del producto, y guarda el costo promedio del
 * momento para que su utilidad no cambie después.
 */
@Injectable()
export class VentasService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly movimientos: MovimientosService,
  ) {}

  async registrar(usuario: UsuarioSesion, datos: NuevaVenta): Promise<VentaDetalle> {
    const fecha = fechaDelDocumento(datos.fecha);
    const ubicacionId = this.ubicacionDeVenta(usuario, datos.ubicacionId);
    if (
      datos.lineas.some((l) => comparar(l.descuento, '0') > 0) &&
      !usuario.puede('ventas.descontar')
    ) {
      throw new ForbiddenException('No tienes permiso para dar descuentos.');
    }

    return conIdempotencia(
      () => this.porClave(usuario, datos.claveIdempotencia),
      async () => {
        const id = await this.db.transaction(async (tx) => {
          const porProducto = await this.movimientos.bloquearProductos(
            tx,
            datos.lineas.map((l) => l.productoId),
          );
          const lineas = datos.lineas.map((linea, i) => {
            const producto = porProducto.get(linea.productoId);
            if (!producto?.activo)
              throw campoInvalido(`lineas.${i}.productoId`, 'Ese producto está dado de baja.');
            if (producto.precioVenta === null) {
              throw campoInvalido(
                `lineas.${i}.productoId`,
                `${producto.nombre} todavía no tiene precio de venta.`,
              );
            }
            const conPrecio = {
              cantidad: linea.cantidad,
              precioUnitario: producto.precioVenta,
              descuento: linea.descuento,
            };
            if (!descuentoValido(conPrecio)) {
              throw campoInvalido(
                `lineas.${i}.descuento`,
                'El descuento no puede ser mayor que la línea.',
              );
            }
            return { productoId: linea.productoId, ...conPrecio };
          });

          const [venta] = await tx
            .insert(ventas)
            .values({
              fecha,
              ubicacionId,
              vendedorId: usuario.id,
              canal: datos.canal,
              metodoPago: datos.metodoPago,
              piezas: lineas.reduce((suma, l) => suma + l.cantidad, 0),
              total: totalVenta(lineas),
              notas: datos.notas,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: ventas.id });
          if (!venta) throw new Error('No se registró la venta');

          const aplicados = await this.movimientos.aplicar(
            tx,
            lineas.map((linea) => ({
              productoId: linea.productoId,
              ubicacionId,
              cantidad: -linea.cantidad,
              tipo: 'venta' as const,
            })),
            { referencia: { ventaId: venta.id }, usuarioId: usuario.id, fecha },
          );
          await tx.insert(ventaDetalle).values(
            lineas.map((linea, i) => ({
              ventaId: venta.id,
              productoId: linea.productoId,
              cantidad: linea.cantidad,
              precioUnitario: linea.precioUnitario,
              descuento: linea.descuento,
              costoUnitario: aplicados[i]?.costoUnitario ?? '0',
            })),
          );
          return venta.id;
        });
        return this.detalle(usuario, id);
      },
    );
  }

  /** La mercancía regresa a su ubicación con el costo que quedó guardado en la venta. */
  async cancelar(usuario: UsuarioSesion, id: number, motivo: string): Promise<VentaDetalle> {
    await this.db.transaction(async (tx) => {
      const [venta] = await tx.select().from(ventas).where(eq(ventas.id, id)).for('update');
      if (!venta) throw new NotFoundException('La venta no existe.');
      if (venta.estado === 'cancelado')
        throw new ConflictException('La venta ya estaba cancelada.');

      const lineas = await tx.select().from(ventaDetalle).where(eq(ventaDetalle.ventaId, id));
      await tx
        .update(ventas)
        .set({
          estado: 'cancelado',
          canceladoEn: new Date(),
          canceladoPor: usuario.id,
          motivoCancelacion: motivo,
        })
        .where(eq(ventas.id, id));
      await this.movimientos.aplicar(
        tx,
        lineas.map((linea) => ({
          productoId: linea.productoId,
          ubicacionId: venta.ubicacionId,
          cantidad: linea.cantidad,
          tipo: 'cancelacion_venta' as const,
          costo: linea.costoUnitario,
        })),
        { referencia: { ventaId: id }, usuarioId: usuario.id, fecha: fechaDeHoy() },
      );
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cancelar',
        entidad: 'venta',
        entidadId: id,
        datos: { motivo, folio: venta.folio, total: venta.total },
      });
    });
    return this.detalle(usuario, id);
  }

  /** Sin `ventas.ver_todas`, cada quien ve solo sus ventas. */
  async listar(usuario: UsuarioSesion, filtro: FiltroVentas): Promise<ListaVentas> {
    const condiciones: SQL[] = [];
    if (!usuario.puede('ventas.ver_todas')) condiciones.push(eq(ventas.vendedorId, usuario.id));
    else if (filtro.vendedorId) condiciones.push(eq(ventas.vendedorId, filtro.vendedorId));
    if (filtro.ubicacionId) condiciones.push(eq(ventas.ubicacionId, filtro.ubicacionId));
    if (filtro.desde) condiciones.push(gte(ventas.fecha, filtro.desde));
    if (filtro.hasta) condiciones.push(lte(ventas.fecha, filtro.hasta));
    if (filtro.estado) condiciones.push(eq(ventas.estado, filtro.estado));
    const donde = and(...condiciones);
    const vigentes = and(donde, eq(ventas.estado, 'vigente'));

    const [filas, [conteo], porMetodo] = await Promise.all([
      this.db
        .select({
          id: ventas.id,
          folio: ventas.folio,
          fecha: ventas.fecha,
          ubicacion: ubicaciones.nombre,
          vendedor: vendedor.nombre,
          canal: ventas.canal,
          metodoPago: ventas.metodoPago,
          piezas: ventas.piezas,
          total: ventas.total,
          estado: ventas.estado,
        })
        .from(ventas)
        .innerJoin(ubicaciones, eq(ubicaciones.id, ventas.ubicacionId))
        .innerJoin(vendedor, eq(vendedor.id, ventas.vendedorId))
        .where(donde)
        .orderBy(desc(ventas.fecha), desc(ventas.id))
        .limit(POR_PAGINA)
        .offset((filtro.pagina - 1) * POR_PAGINA),
      this.db.select({ total: count() }).from(ventas).where(donde),
      this.db
        .select({ metodo: ventas.metodoPago, importe: sum(ventas.total), ventas: count() })
        .from(ventas)
        .where(vigentes)
        .groupBy(ventas.metodoPago),
    ]);

    const importes = Object.fromEntries(METODOS_PAGO.map((m) => [m, '0.00'])) as Record<
      MetodoPago,
      string
    >;
    for (const fila of porMetodo) importes[fila.metodo] = sumar([fila.importe ?? '0']);

    return {
      filas,
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
      resumen: {
        importe: sumar(Object.values(importes)),
        ventas: porMetodo.reduce((suma, fila) => suma + fila.ventas, 0),
        porMetodo: importes,
      },
    };
  }

  async detalle(usuario: UsuarioSesion, id: number): Promise<VentaDetalle> {
    const [venta] = await this.db
      .select({
        id: ventas.id,
        folio: ventas.folio,
        fecha: ventas.fecha,
        ubicacionId: ventas.ubicacionId,
        ubicacion: ubicaciones.nombre,
        vendedorId: ventas.vendedorId,
        vendedor: vendedor.nombre,
        canal: ventas.canal,
        metodoPago: ventas.metodoPago,
        piezas: ventas.piezas,
        total: ventas.total,
        estado: ventas.estado,
        notas: ventas.notas,
        registradoEn: ventas.registradoEn,
        canceladoEn: ventas.canceladoEn,
        canceladoPor: canceladoPor.nombre,
        motivoCancelacion: ventas.motivoCancelacion,
      })
      .from(ventas)
      .innerJoin(ubicaciones, eq(ubicaciones.id, ventas.ubicacionId))
      .innerJoin(vendedor, eq(vendedor.id, ventas.vendedorId))
      .leftJoin(canceladoPor, eq(canceladoPor.id, ventas.canceladoPor))
      .where(eq(ventas.id, id));
    // Una venta ajena responde igual que una que no existe.
    if (!venta || (!usuario.puede('ventas.ver_todas') && venta.vendedorId !== usuario.id)) {
      throw new NotFoundException('La venta no existe.');
    }

    const lineas = await this.db
      .select({
        productoId: ventaDetalle.productoId,
        producto: productos.nombre,
        cantidad: ventaDetalle.cantidad,
        precioUnitario: ventaDetalle.precioUnitario,
        descuento: ventaDetalle.descuento,
        importe: ventaDetalle.importe,
        costoUnitario: ventaDetalle.costoUnitario,
      })
      .from(ventaDetalle)
      .innerJoin(productos, eq(productos.id, ventaDetalle.productoId))
      .where(eq(ventaDetalle.ventaId, id))
      .orderBy(asc(ventaDetalle.id));

    const { canceladoEn, canceladoPor: por, motivoCancelacion, registradoEn, ...resto } = venta;
    const costoTotal = sumar(lineas.map((l) => multiplicar(l.cantidad, l.costoUnitario)));
    return conCostos(
      usuario,
      {
        ...resto,
        registradoEn: registradoEn.toISOString(),
        cancelacion: canceladoEn
          ? { en: canceladoEn.toISOString(), por: por ?? '', motivo: motivoCancelacion ?? '' }
          : null,
        lineas: lineas.map(({ costoUnitario, ...linea }) =>
          conCostos(usuario, linea, () => ({ costoUnitario })),
        ),
      },
      () => ({ costoTotal, utilidad: restar(venta.total, costoTotal) }),
    );
  }

  /**
   * El vendedor vende solo de su ubicación. Quien tiene
   * `ventas.cualquier_ubicacion` elige (o usa la suya si tiene).
   */
  private ubicacionDeVenta(usuario: UsuarioSesion, pedida: number | undefined): number {
    if (usuario.puede('ventas.cualquier_ubicacion')) {
      const id = pedida ?? usuario.ubicacion?.id;
      if (id === undefined)
        throw campoInvalido('ubicacionId', 'Elige desde qué ubicación se vende.');
      return id;
    }
    if (!usuario.ubicacion)
      throw new ForbiddenException('No tienes una ubicación asignada para vender.');
    if (pedida !== undefined && pedida !== usuario.ubicacion.id) {
      throw new ForbiddenException('Solo puedes vender la mercancía que traes tú.');
    }
    return usuario.ubicacion.id;
  }

  private async porClave(
    usuario: UsuarioSesion,
    claveIdempotencia: string,
  ): Promise<VentaDetalle | null> {
    const [fila] = await this.db
      .select({ id: ventas.id })
      .from(ventas)
      .where(
        and(eq(ventas.claveIdempotencia, claveIdempotencia), eq(ventas.vendedorId, usuario.id)),
      );
    return fila ? this.detalle(usuario, fila.id) : null;
  }
}

function campoInvalido(campo: string, mensaje: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ mensaje, campos: { [campo]: mensaje } });
}
