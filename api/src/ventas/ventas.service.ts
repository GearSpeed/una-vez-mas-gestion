import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  comisionDeCobro,
  comisionDevuelta,
  comparar,
  descuentoValido,
  type DevolucionResumen,
  fechaDeHoy,
  type FiltroVentas,
  type ListaVentas,
  METODOS_PAGO,
  type MetodoPago,
  type NuevaDevolucion,
  type NuevaVenta,
  reembolsoDeLinea,
  restar,
  sumar,
  totalVenta,
  type VentaDetalle,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { conCostos } from '../comun/costos.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { comisionNetaDeVenta, reembolsadoDeVenta } from '../db/consultas.js';
import {
  devolucionDetalle,
  devoluciones,
  productos,
  ubicaciones,
  usuarios,
  ventaDetalle,
  ventaLineasNetas,
  ventas,
} from '../db/esquema.js';
import { MovimientosService } from '../inventario/movimientos.service.js';
import { ComisionesService } from './comisiones.service.js';

const POR_PAGINA = 30;
const vendedor = alias(usuarios, 'vendedor');
const canceladoPor = alias(usuarios, 'cancelado_por');

/**
 * Una venta se registra al entregar: descuenta en ese momento de la ubicación
 * del vendedor, al precio de lista del producto, y guarda el costo promedio del
 * momento para que su utilidad no cambie después. Con tarjeta, guarda también lo
 * que retiene Mercado Pago (la comisión la absorbe el negocio).
 */
@Injectable()
export class VentasService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly movimientos: MovimientosService,
    private readonly comisiones: ComisionesService,
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

          const total = totalVenta(lineas);
          const tasa = await this.comisiones.tasaDe(tx, datos.metodoPago);
          const [venta] = await tx
            .insert(ventas)
            .values({
              fecha,
              ubicacionId,
              vendedorId: usuario.id,
              canal: datos.canal,
              metodoPago: datos.metodoPago,
              piezas: lineas.reduce((suma, l) => suma + l.cantidad, 0),
              total,
              comision: tasa ? comisionDeCobro(total, tasa).total : '0',
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

  /**
   * Devolución de piezas de una venta. Se regresa al cliente la parte proporcional
   * de cada línea (descuento incluido), por el mismo método con que pagó. Lo que
   * vuelve a la venta regresa a la ubicación con el costo guardado en la venta; lo
   * que llegó dañado no suma existencia. La comisión de tarjeta no se recupera.
   */
  async devolver(
    usuario: UsuarioSesion,
    ventaId: number,
    datos: NuevaDevolucion,
  ): Promise<VentaDetalle> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      async () => {
        const [previa] = await this.db
          .select({ ventaId: devoluciones.ventaId })
          .from(devoluciones)
          .where(
            and(
              eq(devoluciones.claveIdempotencia, datos.claveIdempotencia),
              eq(devoluciones.usuarioId, usuario.id),
            ),
          );
        return previa ? this.detalle(usuario, previa.ventaId) : null;
      },
      async () => {
        await this.db.transaction(async (tx) => {
          const [venta] = await tx
            .select()
            .from(ventas)
            .where(eq(ventas.id, ventaId))
            .for('update');
          if (!venta || (!usuario.puede('ventas.ver_todas') && venta.vendedorId !== usuario.id)) {
            throw new NotFoundException('La venta no existe.');
          }
          if (venta.estado === 'cancelado') {
            throw new ConflictException('La venta está cancelada: no tiene nada que devolver.');
          }
          if (fecha < venta.fecha) {
            throw campoInvalido('fecha', 'La devolución no puede ser anterior a la venta.');
          }

          const lineasVenta = await tx
            .select({
              id: ventaLineasNetas.id,
              productoId: ventaLineasNetas.productoId,
              producto: productos.nombre,
              cantidad: ventaLineasNetas.cantidad,
              importe: ventaLineasNetas.importe,
              costoUnitario: ventaLineasNetas.costoUnitario,
              devueltas: ventaLineasNetas.devueltas,
              reembolsado: ventaLineasNetas.reembolsado,
            })
            .from(ventaLineasNetas)
            .innerJoin(productos, eq(productos.id, ventaLineasNetas.productoId))
            .where(eq(ventaLineasNetas.ventaId, ventaId));
          const porProducto = new Map(lineasVenta.map((l) => [l.productoId, l]));

          const lineas = datos.lineas.map((pedida, i) => {
            const linea = porProducto.get(pedida.productoId);
            if (!linea) {
              throw campoInvalido(`lineas.${i}.productoId`, 'Ese producto no está en la venta.');
            }
            const quedan = linea.cantidad - linea.devueltas;
            if (pedida.cantidad > quedan) {
              throw campoInvalido(
                `lineas.${i}.cantidad`,
                quedan === 0
                  ? `Ya se devolvieron todas las piezas de ${linea.producto}.`
                  : `De ${linea.producto} solo quedan ${quedan} por devolver.`,
              );
            }
            return {
              ...pedida,
              linea,
              reembolso: reembolsoDeLinea({
                importe: linea.importe,
                cantidadVendida: linea.cantidad,
                devueltasAntes: linea.devueltas,
                reembolsadoAntes: linea.reembolsado,
                cantidad: pedida.cantidad,
              }),
            };
          });

          const reembolso = sumar(lineas.map((l) => l.reembolso));
          // Devolver desde el cobro original le regresa al negocio la parte de la comisión.
          const [antes] = await tx
            .select({
              reembolsado: sql<string>`coalesce(sum(${devoluciones.reembolso}), 0)`,
              comisionDevuelta: sql<string>`coalesce(sum(${devoluciones.comisionDevuelta}), 0)`,
            })
            .from(devoluciones)
            .where(eq(devoluciones.ventaId, ventaId));
          const comision = comisionDevuelta({
            comision: venta.comision,
            total: venta.total,
            reembolsadoAntes: antes?.reembolsado ?? '0',
            devueltaAntes: antes?.comisionDevuelta ?? '0',
            reembolso,
          });
          const [devolucion] = await tx
            .insert(devoluciones)
            .values({
              fecha,
              ventaId,
              motivo: datos.motivo,
              reembolso,
              comisionDevuelta: comision,
              usuarioId: usuario.id,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: devoluciones.id, folio: devoluciones.folio });
          if (!devolucion) throw new Error('No se registró la devolución');

          await tx.insert(devolucionDetalle).values(
            lineas.map((l) => ({
              devolucionId: devolucion.id,
              ventaDetalleId: l.linea.id,
              productoId: l.productoId,
              cantidad: l.cantidad,
              regresaAInventario: l.regresaAInventario,
              reembolso: l.reembolso,
            })),
          );

          const regresan = lineas.filter((l) => l.regresaAInventario);
          if (regresan.length > 0) {
            await this.movimientos.aplicar(
              tx,
              regresan.map((l) => ({
                productoId: l.productoId,
                ubicacionId: venta.ubicacionId,
                cantidad: l.cantidad,
                tipo: 'devolucion' as const,
                costo: l.linea.costoUnitario,
              })),
              { referencia: { devolucionId: devolucion.id }, usuarioId: usuario.id, fecha },
            );
          }

          await registrarEnBitacora(tx, {
            usuarioId: usuario.id,
            accion: 'devolver',
            entidad: 'venta',
            entidadId: ventaId,
            datos: {
              devolucion: devolucion.folio,
              motivo: datos.motivo,
              reembolso,
              comisionDevuelta: comision,
              lineas: lineas.map((l) => ({
                productoId: l.productoId,
                cantidad: l.cantidad,
                regresaAInventario: l.regresaAInventario,
              })),
            },
          });
        });
        return this.detalle(usuario, ventaId);
      },
    );
  }

  /**
   * La mercancía regresa a su ubicación con el costo que quedó guardado en la venta.
   * Una venta con devoluciones ya no se cancela: lo que falta se devuelve.
   */
  async cancelar(usuario: UsuarioSesion, id: number, motivo: string): Promise<VentaDetalle> {
    await this.db.transaction(async (tx) => {
      const [venta] = await tx.select().from(ventas).where(eq(ventas.id, id)).for('update');
      if (!venta) throw new NotFoundException('La venta no existe.');
      if (venta.estado === 'cancelado')
        throw new ConflictException('La venta ya estaba cancelada.');
      const [conDevolucion] = await tx
        .select({ id: devoluciones.id })
        .from(devoluciones)
        .where(eq(devoluciones.ventaId, id))
        .limit(1);
      if (conDevolucion) {
        throw new ConflictException(
          'La venta ya tiene devoluciones: en lugar de cancelarla, devuelve las piezas que faltan.',
        );
      }

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
          comision: sql<string>`${comisionNetaDeVenta}::numeric(12, 2)`,
          reembolsado: sql<string>`${reembolsadoDeVenta}::numeric(12, 2)`,
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
        .select({
          metodo: ventas.metodoPago,
          cobrado: sql<string>`coalesce(sum(${ventas.total}), 0)`,
          reembolsado: sql<string>`coalesce(sum(${reembolsadoDeVenta}), 0)`,
          comisiones: sql<string>`coalesce(sum(${comisionNetaDeVenta}), 0)`,
          ventas: count(),
        })
        .from(ventas)
        .where(vigentes)
        .groupBy(ventas.metodoPago),
    ]);

    const importes = Object.fromEntries(METODOS_PAGO.map((m) => [m, '0.00'])) as Record<
      MetodoPago,
      string
    >;
    for (const fila of porMetodo) importes[fila.metodo] = restar(fila.cobrado, fila.reembolsado);

    return {
      filas,
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
      resumen: {
        importe: sumar(Object.values(importes)),
        ventas: porMetodo.reduce((suma, fila) => suma + fila.ventas, 0),
        porMetodo: importes,
        reembolsos: sumar(porMetodo.map((f) => f.reembolsado)),
        comisiones: sumar(porMetodo.map((f) => f.comisiones)),
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
        comision: sql<string>`${comisionNetaDeVenta}::numeric(12, 2)`,
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

    const [lineas, devolucionesDeVenta] = await Promise.all([
      this.db
        .select({
          productoId: ventaDetalle.productoId,
          producto: productos.nombre,
          cantidad: ventaDetalle.cantidad,
          precioUnitario: ventaDetalle.precioUnitario,
          descuento: ventaDetalle.descuento,
          importe: ventaDetalle.importe,
          devueltas: ventaLineasNetas.devueltas,
          reembolsado: ventaLineasNetas.reembolsado,
          costoUnitario: ventaDetalle.costoUnitario,
          costoNeto: ventaLineasNetas.costoNeto,
        })
        .from(ventaDetalle)
        .innerJoin(productos, eq(productos.id, ventaDetalle.productoId))
        .innerJoin(ventaLineasNetas, eq(ventaLineasNetas.id, ventaDetalle.id))
        .where(eq(ventaDetalle.ventaId, id))
        .orderBy(asc(ventaDetalle.id)),
      this.devolucionesDe(id),
    ]);

    const { canceladoEn, canceladoPor: por, motivoCancelacion, registradoEn, ...resto } = venta;
    const reembolsado = sumar(lineas.map((l) => l.reembolsado));
    const costoTotal = sumar(lineas.map((l) => l.costoNeto));
    return conCostos(
      usuario,
      {
        ...resto,
        reembolsado,
        registradoEn: registradoEn.toISOString(),
        cancelacion: canceladoEn
          ? { en: canceladoEn.toISOString(), por: por ?? '', motivo: motivoCancelacion ?? '' }
          : null,
        lineas: lineas.map(({ costoUnitario, costoNeto: _costoNeto, ...linea }) =>
          conCostos(usuario, linea, () => ({ costoUnitario })),
        ),
        devoluciones: devolucionesDeVenta,
      },
      () => ({
        costoTotal,
        utilidad: restar(restar(restar(venta.total, reembolsado), venta.comision), costoTotal),
      }),
    );
  }

  private async devolucionesDe(ventaId: number): Promise<DevolucionResumen[]> {
    const encabezados = await this.db
      .select({
        id: devoluciones.id,
        folio: devoluciones.folio,
        fecha: devoluciones.fecha,
        motivo: devoluciones.motivo,
        registradoPor: usuarios.nombre,
        reembolso: devoluciones.reembolso,
        comisionDevuelta: devoluciones.comisionDevuelta,
      })
      .from(devoluciones)
      .innerJoin(usuarios, eq(usuarios.id, devoluciones.usuarioId))
      .where(eq(devoluciones.ventaId, ventaId))
      .orderBy(asc(devoluciones.id));
    if (encabezados.length === 0) return [];

    const detalle = await this.db
      .select({
        devolucionId: devolucionDetalle.devolucionId,
        productoId: devolucionDetalle.productoId,
        producto: productos.nombre,
        cantidad: devolucionDetalle.cantidad,
        regresaAInventario: devolucionDetalle.regresaAInventario,
      })
      .from(devolucionDetalle)
      .innerJoin(productos, eq(productos.id, devolucionDetalle.productoId))
      .where(
        inArray(
          devolucionDetalle.devolucionId,
          encabezados.map((d) => d.id),
        ),
      )
      .orderBy(asc(devolucionDetalle.id));

    return encabezados.map((devolucion) => ({
      ...devolucion,
      lineas: detalle
        .filter((l) => l.devolucionId === devolucion.id)
        .map(({ devolucionId: _id, ...linea }) => linea),
    }));
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
