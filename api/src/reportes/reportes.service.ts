import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Corte,
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
import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { reembolsadoDeVenta } from '../db/consultas.js';
import {
  compras,
  devoluciones,
  existencias,
  movimientos,
  productos,
  proveedores,
  ubicaciones,
  usuarios,
  ventaLineasNetas,
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
  return { desde, hasta };
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
        clave: sql<string>`${ventas.metodoPago}::text`,
        etiqueta: sql<string>`${ventas.metodoPago}::text`,
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

    const [movidos, actuales, cobros, reembolsos] = await Promise.all([
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
      this.db
        .select({
          metodo: ventas.metodoPago,
          importe: sum(ventas.total),
          comision: sum(ventas.comision),
        })
        .from(ventas)
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            eq(ventas.estado, 'vigente'),
            gte(ventas.fecha, desde),
            lte(ventas.fecha, hasta),
          ),
        )
        .groupBy(ventas.metodoPago),
      // El dinero regresado a clientes, y la comisión que regresa la entidad, cuentan el
      // día de la devolución.
      this.db
        .select({
          metodo: ventas.metodoPago,
          importe: sum(devoluciones.reembolso),
          comisionDevuelta: sum(devoluciones.comisionDevuelta),
        })
        .from(devoluciones)
        .innerJoin(ventas, eq(ventas.id, devoluciones.ventaId))
        .where(
          and(
            eq(ventas.ubicacionId, ubicacion.id),
            gte(devoluciones.fecha, desde),
            lte(devoluciones.fecha, hasta),
          ),
        )
        .groupBy(ventas.metodoPago),
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
        sumar(reembolsos.map((fila) => fila.comisionDevuelta ?? '0')),
      ),
      totalVendido: restar(sumar(Object.values(importes)), sumar(Object.values(regresado))),
    };
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
