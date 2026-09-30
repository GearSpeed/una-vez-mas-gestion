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
  type Decimal,
  descuentoPorVolumen,
  descuentoValido,
  type EscalonesCategoria,
  type DevolucionResumen,
  fechaDeHoy,
  type FiltroVentas,
  type ListaVentas,
  METODOS_PAGO,
  type MetodoPago,
  type NuevaDevolucion,
  importeLinea,
  multiplicar,
  type NuevaVenta,
  type PagoDeVenta,
  redondear,
  reembolsoDeLinea,
  repartirProporcional,
  restar,
  sumar,
  totalVenta,
  type VentaDetalle,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import type { ProductoBloqueado } from '../inventario/movimientos.service.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { conCostos } from '../comun/costos.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB, type Ejecutor } from '../db/conexion.js';
import { comisionNetaDeVenta, reembolsadoDeVenta } from '../db/consultas.js';
import {
  categorias,
  devolucionDetalle,
  devolucionPagos,
  devoluciones,
  productos,
  ubicaciones,
  usuarios,
  ventaDetalle,
  ventaLineasNetas,
  ventaPagos,
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
          const conPrecio = datos.lineas.map((linea, i) => {
            const producto = porProducto.get(linea.productoId);
            if (!producto?.activo)
              throw campoInvalido(`lineas.${i}.productoId`, 'Ese producto está dado de baja.');
            if (producto.precioVenta === null) {
              throw campoInvalido(
                `lineas.${i}.productoId`,
                `${producto.nombre} todavía no tiene precio de venta.`,
              );
            }
            return {
              productoId: linea.productoId,
              categoriaId: producto.categoriaId,
              cantidad: linea.cantidad,
              precioUnitario: producto.precioVenta,
              descuentoManual: linea.descuento,
            };
          });

          // El descuento por volumen lo calcula el servidor aunque la pantalla ya lo
          // haya mostrado: la línea viaja desde el navegador, y aquí es donde se decide
          // lo que se cobra.
          const porVolumen = descuentoPorVolumen(
            conPrecio,
            await this.escalonesDeCategorias(tx, conPrecio),
          );

          const lineas = conPrecio.map((linea, i) => {
            const volumen = porVolumen.get(linea.productoId) ?? '0';
            // Quien compra nunca recibe menos de lo que le toca por volumen, y quien
            // tiene el permiso puede dar más.
            const descuento =
              comparar(linea.descuentoManual, volumen) > 0 ? linea.descuentoManual : volumen;
            const conDescuento = {
              cantidad: linea.cantidad,
              precioUnitario: linea.precioUnitario,
              descuento,
            };
            if (!descuentoValido(conDescuento)) {
              throw campoInvalido(
                `lineas.${i}.descuento`,
                'El descuento no puede ser mayor que la línea.',
              );
            }
            const producto = porProducto.get(linea.productoId);
            this.noVenderBajoCosto(i, producto, conDescuento);
            return {
              productoId: linea.productoId,
              descuentoVolumen: volumen,
              ...conDescuento,
            };
          });

          const total = totalVenta(lineas);
          // Lo que se cobró tiene que ser exactamente lo que cuesta: ni un peso de
          // más (no somos caja de ahorro) ni de menos (no se fía).
          const cobrado = sumar(datos.pagos.map((pago) => pago.importe));
          if (comparar(cobrado, total) !== 0) {
            throw campoInvalido('pagos', `La venta es de $${total} y los pagos suman $${cobrado}.`);
          }
          // Cada parte paga la comisión de su método: si pagó mitad con tarjeta,
          // Mercado Pago solo retiene sobre esa mitad.
          const pagos: { metodoPago: MetodoPago; importe: string; comision: string }[] = [];
          for (const pago of datos.pagos) {
            const tasa = await this.comisiones.tasaDe(tx, pago.metodoPago);
            pagos.push({
              ...pago,
              comision: tasa ? comisionDeCobro(pago.importe, tasa).total : '0',
            });
          }

          // La tasa de comisión se congela aquí: cambiarla mañana no reescribe lo
          // vendido hoy, igual que el costo y la tarifa de la tarjeta.
          const [quienVende] = await tx
            .select({ comisionVenta: usuarios.comisionVenta })
            .from(usuarios)
            .where(eq(usuarios.id, usuario.id));

          const [venta] = await tx
            .insert(ventas)
            .values({
              fecha,
              ubicacionId,
              vendedorId: usuario.id,
              canal: datos.canal,
              comisionVendedorTasa: quienVende?.comisionVenta ?? '0',
              piezas: lineas.reduce((suma, l) => suma + l.cantidad, 0),
              total,
              comision: sumar(pagos.map((pago) => pago.comision)),
              notas: datos.notas,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: ventas.id });
          if (!venta) throw new Error('No se registró la venta');
          await tx.insert(ventaPagos).values(pagos.map((pago) => ({ ...pago, ventaId: venta.id })));

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
              descuentoVolumen: linea.descuentoVolumen,
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

          // El dinero regresa en la misma proporción en que se pagó.
          const comoPago = await tx
            .select({ metodoPago: ventaPagos.metodoPago, importe: ventaPagos.importe })
            .from(ventaPagos)
            .where(eq(ventaPagos.ventaId, ventaId))
            .orderBy(asc(ventaPagos.id));
          const partes = repartirProporcional(
            reembolso,
            comoPago.map((pago) => pago.importe),
          );
          const regreso = comoPago
            .map((pago, i) => ({
              devolucionId: devolucion.id,
              metodoPago: pago.metodoPago,
              importe: partes[i] ?? '0',
            }))
            .filter((fila) => comparar(fila.importe, '0') > 0);
          if (regreso.length > 0) await tx.insert(devolucionPagos).values(regreso);

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
      // Una venta ajena responde igual que una que no existe.
      if (!venta || (!usuario.puede('ventas.ver_todas') && venta.vendedorId !== usuario.id)) {
        throw new NotFoundException('La venta no existe.');
      }
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

    const [filas, [conteo], [totales], cobros, regresos] = await Promise.all([
      this.db
        .select({
          id: ventas.id,
          folio: ventas.folio,
          fecha: ventas.fecha,
          ubicacion: ubicaciones.nombre,
          vendedor: vendedor.nombre,
          canal: ventas.canal,
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
          ventas: count(),
          reembolsos: sql<string>`coalesce(sum(${reembolsadoDeVenta}), 0)`,
          comisiones: sql<string>`coalesce(sum(${comisionNetaDeVenta}), 0)`,
        })
        .from(ventas)
        .where(vigentes),
      // El dinero por método sale de los pagos, no de la venta: una venta mixta
      // pone su parte en cada uno.
      this.db
        .select({
          metodo: ventaPagos.metodoPago,
          importe: sql<string>`coalesce(sum(${ventaPagos.importe}), 0)`,
        })
        .from(ventaPagos)
        .innerJoin(ventas, eq(ventas.id, ventaPagos.ventaId))
        .where(vigentes)
        .groupBy(ventaPagos.metodoPago),
      this.db
        .select({
          metodo: devolucionPagos.metodoPago,
          importe: sql<string>`coalesce(sum(${devolucionPagos.importe}), 0)`,
        })
        .from(devolucionPagos)
        .innerJoin(devoluciones, eq(devoluciones.id, devolucionPagos.devolucionId))
        .innerJoin(ventas, eq(ventas.id, devoluciones.ventaId))
        .where(vigentes)
        .groupBy(devolucionPagos.metodoPago),
    ]);

    const importes = porMetodo(cobros);
    const regresado = porMetodo(regresos);
    const pagos = await this.pagosDe(filas.map((fila) => fila.id));

    return {
      filas: filas.map((fila) => ({ ...fila, pagos: pagos.get(fila.id) ?? [] })),
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
      resumen: {
        importe: restar(sumar(Object.values(importes)), sumar(Object.values(regresado))),
        ventas: totales?.ventas ?? 0,
        porMetodo: Object.fromEntries(
          METODOS_PAGO.map((metodo) => [metodo, restar(importes[metodo], regresado[metodo])]),
        ) as Record<MetodoPago, string>,
        reembolsos: redondear(totales?.reembolsos ?? '0'),
        comisiones: redondear(totales?.comisiones ?? '0'),
      },
    };
  }

  /** Los pagos de varias ventas, agrupados por venta. */
  private async pagosDe(ventaIds: readonly number[]): Promise<Map<number, PagoDeVenta[]>> {
    const porVenta = new Map<number, PagoDeVenta[]>();
    if (ventaIds.length === 0) return porVenta;
    const filas = await this.db
      .select({
        ventaId: ventaPagos.ventaId,
        metodoPago: ventaPagos.metodoPago,
        importe: ventaPagos.importe,
        comision: ventaPagos.comision,
      })
      .from(ventaPagos)
      .where(inArray(ventaPagos.ventaId, [...ventaIds]))
      .orderBy(asc(ventaPagos.id));
    for (const { ventaId, ...pago } of filas) {
      porVenta.set(ventaId, [...(porVenta.get(ventaId) ?? []), pago]);
    }
    return porVenta;
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

    const [lineas, devolucionesDeVenta, pagos] = await Promise.all([
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
      this.pagosDe([id]),
    ]);

    const { canceladoEn, canceladoPor: por, motivoCancelacion, registradoEn, ...resto } = venta;
    const reembolsado = sumar(lineas.map((l) => l.reembolsado));
    const costoTotal = sumar(lineas.map((l) => l.costoNeto));
    return conCostos(
      usuario,
      {
        ...resto,
        pagos: pagos.get(id) ?? [],
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
  /** Los escalones de las categorías que aparecen en esta venta, y sólo de esas. */
  private async escalonesDeCategorias(
    tx: Ejecutor,
    lineas: readonly { readonly categoriaId: number }[],
  ): Promise<Map<number, EscalonesCategoria>> {
    const ids = [...new Set(lineas.map((l) => l.categoriaId))];
    if (ids.length === 0) return new Map();
    const filas = await tx
      .select({
        id: categorias.id,
        desde1: categorias.descuentoDesde1,
        tasa1: categorias.descuentoTasa1,
        desde2: categorias.descuentoDesde2,
        tasa2: categorias.descuentoTasa2,
      })
      .from(categorias)
      .where(inArray(categorias.id, ids));
    return new Map(filas.map(({ id, ...escalones }) => [id, escalones]));
  }

  /**
   * Nadie vende por debajo de lo que costó traer la pieza.
   *
   * Es la red que pediste para cuando entren familias nuevas sin costo capturado y un
   * porcentaje se aplique a ciegas. De paso tapa un hueco que ya existía: un producto con
   * precio en cero se podía vender igual.
   */
  private noVenderBajoCosto(
    i: number,
    producto: ProductoBloqueado | undefined,
    linea: { cantidad: number; precioUnitario: Decimal; descuento: Decimal },
  ): void {
    if (!producto) return;
    const cobrado = importeLinea(linea);
    const costo = multiplicar(producto.costoPromedio, String(linea.cantidad));
    if (comparar(cobrado, costo) >= 0) return;
    throw campoInvalido(
      `lineas.${i}.descuento`,
      `${producto.nombre} quedaría en $${cobrado} y traerlo costó $${costo}.`,
    );
  }

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

/** Un importe por método, con todos los métodos presentes aunque no se hayan usado. */
function porMetodo(
  filas: readonly { metodo: MetodoPago; importe: string }[],
): Record<MetodoPago, string> {
  const importes = Object.fromEntries(METODOS_PAGO.map((m) => [m, '0.00'])) as Record<
    MetodoPago,
    string
  >;
  for (const fila of filas) importes[fila.metodo] = redondear(fila.importe);
  return importes;
}
