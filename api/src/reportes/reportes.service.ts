import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ComisionVendedor,
  type Corte,
  type EstadoResultados,
  ETIQUETAS_CANAL,
  ETIQUETAS_METODO_PAGO,
  type CanalVenta,
  dividir,
  fechaDeHoy,
  type FilaReporteCompras,
  type FilaReporteVentas,
  type FilaUtilidad,
  type FiltroCorte,
  type FiltroReporteVentas,
  diasEntre,
  inicioDeMes,
  inicioDeSemana,
  METODOS_PAGO,
  type MetodoPago,
  type Periodo,
  redondear,
  restar,
  sumar,
  type Tablero,
} from '@uvm/compartido';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
  type SQL,
  sum,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { comisionNetaDeVenta, formaDePagoDeVenta, reembolsadoDeVenta } from '../db/consultas.js';
import {
  compras,
  devolucionPagos,
  gastoCategorias,
  gastos,
  devoluciones,
  existencias,
  movimientos,
  movimientosCapital,
  productos,
  proveedores,
  ubicaciones,
  usuarios,
  ventaLineasNetas,
  ventaPagos,
  ventas,
} from '../db/esquema.js';

const vendedor = alias(usuarios, 'vendedor');

/** Suma de las cantidades de ciertos tipos de movimiento (con su signo). */
function suma(tipos: readonly string[]) {
  return sql<number>`coalesce(sum(${movimientos.cantidad}) filter (where ${movimientos.tipo}::text in (${sql.join(
    tipos.map((t) => sql`${t}`),
    sql`, `,
  )})), 0)::int`;
}

/**
 * Lo más ancho que se puede pedir de una vez. Un reporte recorre todas las líneas
 * de venta del rango: sin tope, una sola petición puede costar lo que cuesta un año
 * entero, y se puede repetir 300 veces por minuto. Un año y un día cubre cualquier
 * comparación contra el mismo mes del año pasado; para más, se piden por tramos.
 */
const DIAS_MAXIMOS = 366;

/** Sin fechas, los reportes cubren el mes en curso. */
function periodo(
  filtro: Periodo,
  porOmision: 'mes' | 'hoy' = 'mes',
): { desde: string; hasta: string } {
  const hoy = fechaDeHoy();
  const hasta = filtro.hasta ?? hoy;
  const desde = filtro.desde ?? (porOmision === 'mes' ? inicioDeMes(hasta) : hasta);
  if (desde > hasta) {
    throw new UnprocessableEntityException({
      mensaje: 'La fecha inicial es posterior a la final.',
      campos: { desde: 'Debe ser anterior a "hasta"' },
    });
  }
  if (diasEntre(desde, hasta) > DIAS_MAXIMOS) {
    throw new UnprocessableEntityException({
      mensaje: `El periodo no puede pasar de ${DIAS_MAXIMOS} días. Pídelo por tramos.`,
      campos: { desde: `Como mucho ${DIAS_MAXIMOS} días antes de "hasta"` },
    });
  }
  return { desde, hasta };
}

/** Agrupa por vendedor las filas que traen su id, dejando fuera las que no lo traen. */
function porId<T extends { vendedorId: number | null }>(filas: readonly T[]): Map<number, T> {
  return new Map(
    filas.flatMap((fila) => (fila.vendedorId === null ? [] : [[fila.vendedorId, fila] as const])),
  );
}

@Injectable()
export class ReportesService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async tablero(usuario: UsuarioSesion): Promise<Tablero> {
    const hoy = fechaDeHoy();
    const ventasDesde = async (desde: string) => {
      const [fila] = await this.db
        .select({
          cobrado: sql<string>`coalesce(sum(${ventas.total}), 0)`,
          reembolsado: sql<string>`coalesce(sum(${reembolsadoDeVenta}), 0)`,
          ventas: count(),
        })
        .from(ventas)
        .where(and(eq(ventas.estado, 'vigente'), gte(ventas.fecha, desde), lte(ventas.fecha, hoy)));
      return {
        importe: restar(fila?.cobrado ?? '0', fila?.reembolsado ?? '0'),
        ventas: fila?.ventas ?? 0,
      };
    };

    const existenciaTotal = sql<number>`coalesce(sum(${existencias.cantidad}), 0)::int`;
    const [delDia, deLaSemana, delMes, bajoMinimo, porUbicacion] = await Promise.all([
      ventasDesde(hoy),
      ventasDesde(inicioDeSemana(hoy)),
      ventasDesde(inicioDeMes(hoy)),
      this.db
        .select({
          productoId: productos.id,
          producto: productos.nombre,
          existencia: existenciaTotal,
          stockMinimo: productos.stockMinimo,
        })
        .from(productos)
        .leftJoin(existencias, eq(existencias.productoId, productos.id))
        .where(and(eq(productos.activo, true), sql`${productos.stockMinimo} > 0`))
        .groupBy(productos.id)
        .having(sql`coalesce(sum(${existencias.cantidad}), 0) <= ${productos.stockMinimo}`)
        .orderBy(asc(productos.nombre)),
      this.db
        .select({ ubicacion: ubicaciones.nombre, piezas: existenciaTotal })
        .from(ubicaciones)
        .leftJoin(existencias, eq(existencias.ubicacionId, ubicaciones.id))
        .where(eq(ubicaciones.activa, true))
        .groupBy(ubicaciones.id)
        .orderBy(asc(ubicaciones.tipo), asc(ubicaciones.nombre)),
    ]);

    const base = {
      hoy,
      ventas: { hoy: delDia, semana: deLaSemana, mes: delMes },
      bajoMinimo,
      porUbicacion,
    };
    if (!usuario.puede('costos.ver')) return base;

    const [[utilidad], [inventario]] = await Promise.all([
      this.db
        .select({
          importe: sql<string>`coalesce(sum(${ventaLineasNetas.importeNeto}), 0)`,
          costo: sql<string>`coalesce(sum(${ventaLineasNetas.costoNeto}), 0)`,
          comision: sql<string>`coalesce(sum(${ventaLineasNetas.comision}), 0)`,
        })
        .from(ventaLineasNetas)
        .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
        .where(
          and(
            eq(ventas.estado, 'vigente'),
            gte(ventas.fecha, inicioDeMes(hoy)),
            lte(ventas.fecha, hoy),
          ),
        ),
      this.db
        .select({
          valor: sql<string>`coalesce(sum(${existencias.cantidad} * ${productos.costoPromedio}), 0)`,
        })
        .from(existencias)
        .innerJoin(productos, eq(productos.id, existencias.productoId)),
    ]);
    return conCostos(usuario, base, () => ({
      utilidadMes: restar(
        restar(utilidad?.importe ?? '0', utilidad?.costo ?? '0'),
        utilidad?.comision ?? '0',
      ),
      valorInventario: redondear(inventario?.valor ?? '0'),
    }));
  }

  /** Ventas vigentes agrupadas por día, producto, vendedor, canal o método de pago. */
  async ventas(usuario: UsuarioSesion, filtro: FiltroReporteVentas): Promise<FilaReporteVentas[]> {
    const { desde, hasta } = periodo(filtro);
    const grupo = {
      dia: {
        clave: sql<string>`${ventas.fecha}::text`,
        etiqueta: sql<string>`${ventas.fecha}::text`,
      },
      producto: {
        clave: sql<string>`${productos.id}::text`,
        etiqueta: sql<string>`${productos.nombre}`,
      },
      vendedor: {
        clave: sql<string>`${vendedor.id}::text`,
        etiqueta: sql<string>`${vendedor.nombre}`,
      },
      canal: {
        clave: sql<string>`${ventas.canal}::text`,
        etiqueta: sql<string>`${ventas.canal}::text`,
      },
      metodo: {
        clave: formaDePagoDeVenta,
        etiqueta: formaDePagoDeVenta,
      },
    }[filtro.agrupar];

    const condiciones: SQL[] = [
      eq(ventas.estado, 'vigente'),
      gte(ventas.fecha, desde),
      lte(ventas.fecha, hasta),
    ];
    if (filtro.vendedorId) condiciones.push(eq(ventas.vendedorId, filtro.vendedorId));
    if (filtro.ubicacionId) condiciones.push(eq(ventas.ubicacionId, filtro.ubicacionId));

    const importe = sql<string>`sum(${ventaLineasNetas.importeNeto})`;
    const filas = await this.db
      .select({
        clave: grupo.clave,
        etiqueta: grupo.etiqueta,
        ventas: sql<number>`count(distinct ${ventas.id})::int`,
        piezas: sql<number>`sum(${ventaLineasNetas.piezasNetas})::int`,
        importe,
        costo: sql<string>`sum(${ventaLineasNetas.costoNeto})`,
        comision: sql<string>`sum(${ventaLineasNetas.comision})`,
      })
      .from(ventaLineasNetas)
      .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
      .innerJoin(productos, eq(productos.id, ventaLineasNetas.productoId))
      .innerJoin(vendedor, eq(vendedor.id, ventas.vendedorId))
      .where(and(...condiciones))
      .groupBy(grupo.clave, grupo.etiqueta)
      .orderBy(filtro.agrupar === 'dia' ? asc(grupo.clave) : desc(importe));

    return filas.map((fila) =>
      conCostos(
        usuario,
        {
          clave: fila.clave,
          etiqueta: etiquetaDe(filtro.agrupar, fila.etiqueta),
          ventas: fila.ventas,
          piezas: fila.piezas,
          importe: redondear(fila.importe),
        },
        () => ({
          costo: redondear(fila.costo),
          comision: redondear(fila.comision),
          utilidad: restar(restar(fila.importe, fila.costo), fila.comision),
        }),
      ),
    );
  }

  /**
   * Utilidad bruta por producto: lo cobrado menos lo reembolsado, menos el costo
   * guardado en cada venta (lo que regresó al inventario recupera su costo) y
   * menos la parte de la comisión de tarjeta que le toca.
   */
  async utilidad(filtro: Periodo): Promise<FilaUtilidad[]> {
    const { desde, hasta } = periodo(filtro);
    const ingreso = sql<string>`sum(${ventaLineasNetas.importeNeto})`;
    const costo = sql<string>`sum(${ventaLineasNetas.costoNeto})`;
    const comision = sql<string>`sum(${ventaLineasNetas.comision})`;
    const filas = await this.db
      .select({
        productoId: productos.id,
        producto: productos.nombre,
        piezas: sql<number>`sum(${ventaLineasNetas.piezasNetas})::int`,
        ingreso,
        costo,
        comision,
      })
      .from(ventaLineasNetas)
      .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
      .innerJoin(productos, eq(productos.id, ventaLineasNetas.productoId))
      .where(and(eq(ventas.estado, 'vigente'), gte(ventas.fecha, desde), lte(ventas.fecha, hasta)))
      .groupBy(productos.id)
      .orderBy(desc(sql`${ingreso} - ${costo} - ${comision}`));

    return filas.map((fila) => {
      const utilidad = restar(restar(fila.ingreso, fila.costo), fila.comision);
      return {
        productoId: fila.productoId,
        producto: fila.producto,
        piezas: fila.piezas,
        ingreso: redondear(fila.ingreso),
        costo: redondear(fila.costo),
        comision: redondear(fila.comision),
        utilidad,
        margen: dividir(utilidad, fila.ingreso),
      };
    });
  }

  /**
   * Corte de un vendedor (o de cualquier ubicación): lo que cargó, vendió,
   * devolvió y ajustó en el periodo, lo que trae ahora, y cuánto cobró por
   * método de pago. Sin `reportes.ver`, cada vendedor ve solo el suyo.
   */
  async corte(usuario: UsuarioSesion, filtro: FiltroCorte): Promise<Corte> {
    const { desde, hasta } = periodo(filtro, 'hoy');
    const ubicacion = await this.ubicacionDelCorte(usuario, filtro.ubicacionId);

    const netoPorVenta = this.netoPorVenta();
    const [movidos, actuales, cobros, reembolsos, delVendedor, devueltas] = await Promise.all([
      this.db
        .select({
          productoId: movimientos.productoId,
          cargo: suma(['traspaso_entrada', 'compra', 'cancelacion_compra']),
          vendio: suma(['venta', 'cancelacion_venta', 'devolucion']),
          devolvio: suma(['traspaso_salida']),
          ajustes: suma(['ajuste']),
        })
        .from(movimientos)
        .where(
          and(
            eq(movimientos.ubicacionId, ubicacion.id),
            gte(movimientos.fecha, desde),
            lte(movimientos.fecha, hasta),
          ),
        )
        .groupBy(movimientos.productoId),
      this.db
        .select({ productoId: existencias.productoId, cantidad: existencias.cantidad })
        .from(existencias)
        .where(eq(existencias.ubicacionId, ubicacion.id)),
      // Por método, del pago y no de la venta: una venta mixta deja su efectivo en
      // efectivo y su tarjeta en tarjeta, que es como tiene que cuadrar la caja.
      this.db
        .select({
          metodo: ventaPagos.metodoPago,
          importe: sum(ventaPagos.importe),
          comision: sum(ventaPagos.comision),
        })
        .from(ventaPagos)
        .innerJoin(ventas, eq(ventas.id, ventaPagos.ventaId))
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            eq(ventas.estado, 'vigente'),
            gte(ventas.fecha, desde),
            lte(ventas.fecha, hasta),
          ),
        )
        .groupBy(ventaPagos.metodoPago),
      // El dinero regresado a clientes, y la comisión que regresa la entidad, cuentan el
      // día de la devolución.
      this.db
        .select({
          metodo: devolucionPagos.metodoPago,
          importe: sum(devolucionPagos.importe),
        })
        .from(devolucionPagos)
        .innerJoin(devoluciones, eq(devoluciones.id, devolucionPagos.devolucionId))
        .innerJoin(ventas, eq(ventas.id, devoluciones.ventaId))
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            gte(devoluciones.fecha, desde),
            lte(devoluciones.fecha, hasta),
          ),
        )
        .groupBy(devolucionPagos.metodoPago),
      // Lo que gana quien vendió por estas ventas, con la tasa de cada una.
      this.db
        .with(netoPorVenta)
        .select({
          comision: sql<string>`coalesce(
            sum(round(${netoPorVenta.importe} * ${ventas.comisionVendedorTasa}, 2)), 0
          )`,
        })
        .from(ventas)
        .innerJoin(netoPorVenta, eq(netoPorVenta.ventaId, ventas.id))
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            eq(ventas.estado, 'vigente'),
            gte(ventas.fecha, desde),
            lte(ventas.fecha, hasta),
          ),
        ),
      // La comisión que regresó Mercado Pago va aparte: es de la devolución, no de
      // un método.
      this.db
        .select({ comisionDevuelta: sum(devoluciones.comisionDevuelta) })
        .from(devoluciones)
        .innerJoin(ventas, eq(ventas.id, devoluciones.ventaId))
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            gte(devoluciones.fecha, desde),
            lte(devoluciones.fecha, hasta),
          ),
        ),
    ]);

    const trae = new Map(actuales.map((fila) => [fila.productoId, fila.cantidad]));
    const ids = [
      ...new Set([
        ...movidos.map((m) => m.productoId),
        ...actuales.filter((a) => a.cantidad > 0).map((a) => a.productoId),
      ]),
    ];
    const nombres = ids.length
      ? await this.db
          .select({ id: productos.id, nombre: productos.nombre })
          .from(productos)
          .where(inArray(productos.id, ids))
      : [];
    const nombre = new Map(nombres.map((p) => [p.id, p.nombre]));
    const porProducto = new Map(movidos.map((m) => [m.productoId, m]));

    const importes = Object.fromEntries(METODOS_PAGO.map((m) => [m, '0.00'])) as Record<
      MetodoPago,
      string
    >;
    for (const fila of cobros) importes[fila.metodo] = redondear(fila.importe ?? '0');
    const regresado = Object.fromEntries(METODOS_PAGO.map((m) => [m, '0.00'])) as Record<
      MetodoPago,
      string
    >;
    for (const fila of reembolsos) regresado[fila.metodo] = redondear(fila.importe ?? '0');

    return {
      ubicacion,
      desde,
      hasta,
      productos: ids
        .map((productoId) => {
          const m = porProducto.get(productoId);
          return {
            productoId,
            producto: nombre.get(productoId) ?? '',
            cargo: m?.cargo ?? 0,
            vendio: -(m?.vendio ?? 0),
            devolvio: -(m?.devolvio ?? 0),
            ajustes: m?.ajustes ?? 0,
            trae: trae.get(productoId) ?? 0,
          };
        })
        .toSorted((a, b) => a.producto.localeCompare(b.producto, 'es')),
      cobros: importes,
      reembolsos: regresado,
      comisiones: restar(
        sumar(cobros.map((fila) => fila.comision ?? '0')),
        devueltas[0]?.comisionDevuelta ?? '0',
      ),
      comisionVendedor: redondear(delVendedor[0]?.comision ?? '0'),
      totalVendido: restar(sumar(Object.values(importes)), sumar(Object.values(regresado))),
    };
  }

  /**
   * El resultado del periodo: de lo que se vendió a lo que de verdad quedó.
   *
   * Las ventas netas y su costo salen de `venta_lineas_netas`, que descuenta las
   * devoluciones de la venta aunque hayan ocurrido después: para un corte mensual
   * eso es lo correcto —la venta no fue— aunque el corte diario de la vendedora las
   * cuente el día que se devolvieron.
   */
  async resultado(filtro: Periodo): Promise<EstadoResultados> {
    const { desde, hasta } = periodo(filtro);
    const delPeriodo = and(
      eq(ventas.estado, 'vigente'),
      gte(ventas.fecha, desde),
      lte(ventas.fecha, hasta),
    );
    const netoPorVenta = this.netoPorVenta();

    const [[venta], [tarjeta], porCategoria, comisiones, [inventario], [capital]] =
      await Promise.all([
        this.db
          .select({
            ventasNetas: sql<string>`coalesce(sum(${ventaLineasNetas.importeNeto}), 0)`,
            costo: sql<string>`coalesce(sum(${ventaLineasNetas.costoNeto}), 0)`,
          })
          .from(ventaLineasNetas)
          .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
          .where(delPeriodo),
        this.db
          .select({ comision: sql<string>`coalesce(sum(${comisionNetaDeVenta}), 0)` })
          .from(ventas)
          .where(delPeriodo),
        this.db
          .select({
            categoria: gastoCategorias.nombre,
            importe: sql<string>`coalesce(sum(${gastos.importe}), 0)::numeric(12, 2)`,
          })
          .from(gastos)
          .innerJoin(gastoCategorias, eq(gastoCategorias.id, gastos.categoriaId))
          .where(
            and(eq(gastos.estado, 'vigente'), gte(gastos.fecha, desde), lte(gastos.fecha, hasta)),
          )
          .groupBy(gastoCategorias.nombre)
          .orderBy(desc(sql`sum(${gastos.importe})`)),
        // Cada venta con su propia tasa: la que tenía el día que se hizo.
        this.db
          .with(netoPorVenta)
          .select({
            vendedor: vendedor.nombre,
            tasa: ventas.comisionVendedorTasa,
            ventasNetas: sql<string>`coalesce(sum(${netoPorVenta.importe}), 0)::numeric(12, 2)`,
            comision: sql<string>`coalesce(
            sum(round(${netoPorVenta.importe} * ${ventas.comisionVendedorTasa}, 2)), 0
          )::numeric(12, 2)`,
          })
          .from(ventas)
          .innerJoin(netoPorVenta, eq(netoPorVenta.ventaId, ventas.id))
          .innerJoin(vendedor, eq(vendedor.id, ventas.vendedorId))
          .where(and(delPeriodo, gt(ventas.comisionVendedorTasa, '0')))
          .groupBy(vendedor.nombre, ventas.comisionVendedorTasa)
          // Con tasa estable el orden no cambia entre consultas: primero la más alta.
          .orderBy(asc(vendedor.nombre), desc(ventas.comisionVendedorTasa)),
        this.db
          .select({
            valor: sql<string>`coalesce(sum(${existencias.cantidad} * ${productos.costoPromedio}), 0)`,
          })
          .from(existencias)
          .innerJoin(productos, eq(productos.id, existencias.productoId)),
        // Lo que los socios pusieron o sacaron. Va aparte: no es ganancia de nadie.
        this.db
          .select({
            aportaciones: sql<string>`coalesce(sum(${movimientosCapital.importe})
            filter (where ${movimientosCapital.tipo} = 'aportacion'), 0)::numeric(12, 2)`,
            retiros: sql<string>`coalesce(sum(${movimientosCapital.importe})
            filter (where ${movimientosCapital.tipo} = 'retiro'), 0)::numeric(12, 2)`,
          })
          .from(movimientosCapital)
          .where(
            and(
              eq(movimientosCapital.estado, 'vigente'),
              gte(movimientosCapital.fecha, desde),
              lte(movimientosCapital.fecha, hasta),
            ),
          ),
      ]);

    const ventasNetas = redondear(venta?.ventasNetas ?? '0');
    const costoVendido = redondear(venta?.costo ?? '0');
    const utilidadBruta = restar(ventasNetas, costoVendido);
    const comisionTarjeta = redondear(tarjeta?.comision ?? '0');
    const totalGastos = sumar(porCategoria.map((fila) => fila.importe));
    const aportaciones = capital?.aportaciones ?? '0';
    const retiros = capital?.retiros ?? '0';

    return {
      desde,
      hasta,
      ventasNetas,
      costoVendido,
      utilidadBruta,
      comisionTarjeta,
      gastos: porCategoria,
      totalGastos,
      utilidadOperativa: restar(restar(utilidadBruta, comisionTarjeta), totalGastos),
      comisionesPorPagar: comisiones,
      valorInventario: redondear(inventario?.valor ?? '0'),
      capitalDelPeriodo: { aportaciones, retiros, neto: restar(aportaciones, retiros) },
    };
  }

  /**
   * Lo que se le debe a cada quien por vender: **todo** lo que ha ganado, menos
   * **todo** lo que ya se le pagó. El saldo es de siempre a propósito —una deuda no
   * cambia porque uno mire otro mes—; el periodo solo sirve para explicarlo, con lo
   * generado y los pagos de esos días.
   */
  async comisiones(filtro: Periodo): Promise<ComisionVendedor[]> {
    const { desde, hasta } = periodo(filtro);
    const netoPorVenta = this.netoPorVenta();
    const ganadoPor = (condiciones: SQL | undefined) =>
      this.db
        .with(netoPorVenta)
        .select({
          vendedorId: ventas.vendedorId,
          ganado: sql<string>`coalesce(
            sum(round(${netoPorVenta.importe} * ${ventas.comisionVendedorTasa}, 2)), 0
          )::numeric(12, 2)`,
        })
        .from(ventas)
        .innerJoin(netoPorVenta, eq(netoPorVenta.ventaId, ventas.id))
        .where(and(eq(ventas.estado, 'vigente'), condiciones))
        .groupBy(ventas.vendedorId);

    const [quienesVenden, ganadoTotal, ganadoPeriodo, pagado, pagosDelPeriodo] = await Promise.all([
      // Quien tiene tasa hoy, o quien ya generó comisión alguna vez.
      this.db
        .select({ id: usuarios.id, nombre: usuarios.nombre, tasa: usuarios.comisionVenta })
        .from(usuarios)
        .where(eq(usuarios.activo, true))
        .orderBy(asc(usuarios.nombre)),
      ganadoPor(undefined),
      ganadoPor(and(gte(ventas.fecha, desde), lte(ventas.fecha, hasta))),
      this.db
        .select({
          vendedorId: gastos.vendedorId,
          pagado: sql<string>`coalesce(sum(${gastos.importe}), 0)::numeric(12, 2)`,
        })
        .from(gastos)
        .where(and(eq(gastos.estado, 'vigente'), isNotNull(gastos.vendedorId)))
        .groupBy(gastos.vendedorId),
      this.db
        .select({
          vendedorId: gastos.vendedorId,
          folio: gastos.folio,
          fecha: gastos.fecha,
          importe: gastos.importe,
        })
        .from(gastos)
        .where(
          and(
            eq(gastos.estado, 'vigente'),
            isNotNull(gastos.vendedorId),
            gte(gastos.fecha, desde),
            lte(gastos.fecha, hasta),
          ),
        )
        .orderBy(desc(gastos.fecha), desc(gastos.id)),
    ]);

    const total = porId(ganadoTotal);
    const enPeriodo = porId(ganadoPeriodo);
    const yaPagado = porId(pagado);

    return (
      quienesVenden
        .map((persona) => {
          const ganado = total.get(persona.id)?.ganado ?? '0.00';
          const pagos = yaPagado.get(persona.id)?.pagado ?? '0.00';
          return {
            vendedorId: persona.id,
            vendedor: persona.nombre,
            tasa: persona.tasa,
            ganado: redondear(ganado),
            pagado: redondear(pagos),
            saldo: restar(ganado, pagos),
            ganadoEnPeriodo: redondear(enPeriodo.get(persona.id)?.ganado ?? '0.00'),
            pagosEnPeriodo: pagosDelPeriodo
              .filter((pago) => pago.vendedorId === persona.id)
              .map(({ folio, fecha, importe }) => ({ folio, fecha, importe })),
          };
        })
        // Quien nunca ha ganado ni cobrado nada no aparece: no hay nada que decir de él.
        .filter((fila) => fila.ganado !== '0.00' || fila.pagado !== '0.00' || Number(fila.tasa) > 0)
    );
  }

  /**
   * Lo que quedó neto de cada venta, ya descontadas sus devoluciones. Va como CTE y
   * no como subconsulta correlacionada: dentro de una subconsulta, un `id` suelto
   * se resuelve contra la tabla de adentro y la cuenta sale mal sin avisar.
   */
  private netoPorVenta() {
    return this.db.$with('neto_por_venta').as(
      this.db
        .select({
          ventaId: ventaLineasNetas.ventaId,
          importe: sql<string>`sum(${ventaLineasNetas.importeNeto})`.as('importe'),
        })
        .from(ventaLineasNetas)
        .groupBy(ventaLineasNetas.ventaId),
    );
  }

  async compras(filtro: Periodo): Promise<FilaReporteCompras[]> {
    const { desde, hasta } = periodo(filtro);
    return this.db
      .select({
        id: compras.id,
        folio: compras.folio,
        fecha: compras.fecha,
        proveedor: proveedores.nombre,
        piezas: compras.piezas,
        mercancia: compras.subtotalMercancia,
        gasolina: compras.costoTraslado,
        total: compras.total,
      })
      .from(compras)
      .innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
      .where(
        and(eq(compras.estado, 'vigente'), gte(compras.fecha, desde), lte(compras.fecha, hasta)),
      )
      .orderBy(asc(compras.fecha), asc(compras.id));
  }

  private async ubicacionDelCorte(usuario: UsuarioSesion, ubicacionId: number | undefined) {
    if (!usuario.puede('reportes.ver')) {
      if (!usuario.ubicacion) throw new ForbiddenException('No tienes una ubicación asignada.');
      if (ubicacionId !== undefined && ubicacionId !== usuario.ubicacion.id) {
        throw new ForbiddenException('Solo puedes ver tu propio corte.');
      }
      return usuario.ubicacion;
    }
    const id = ubicacionId ?? usuario.ubicacion?.id;
    if (id === undefined) {
      throw new UnprocessableEntityException({
        mensaje: 'Elige la ubicación del corte.',
        campos: { ubicacionId: 'Elige la ubicación' },
      });
    }
    const [ubicacion] = await this.db
      .select({ id: ubicaciones.id, nombre: ubicaciones.nombre, tipo: ubicaciones.tipo })
      .from(ubicaciones)
      .where(eq(ubicaciones.id, id));
    if (!ubicacion) throw new NotFoundException('La ubicación no existe.');
    return ubicacion;
  }
}

function etiquetaDe(agrupar: FiltroReporteVentas['agrupar'], valor: string): string {
  if (agrupar === 'canal') return ETIQUETAS_CANAL[valor as CanalVenta] ?? valor;
  if (agrupar === 'metodo') return ETIQUETAS_METODO_PAGO[valor as MetodoPago] ?? valor;
  return valor;
}
