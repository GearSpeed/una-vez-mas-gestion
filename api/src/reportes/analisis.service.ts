import { Inject, Injectable } from '@nestjs/common';
import {
  type AnalisisVentas,
  type Decimal,
  diasDelRango,
  diasEntre,
  type FilaAgotamiento,
  type FilaAnalisisProducto,
  type FiltroAnalisis,
  type MatrizPiezas,
  mesesDelRango,
  redondear,
  restar,
  sumar,
  sumarMeses,
  ZONA_HORARIA,
} from '@uvm/compartido';
import { and, asc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import {
  categorias,
  compraDetalle,
  compras,
  existencias,
  movimientos,
  productos,
  ventaLineasNetas,
  ventas,
} from '../db/esquema.js';
import { periodo } from './periodo.js';

type Unidad = 'day' | 'month' | 'year';

/** Un periodo como su primer día, en texto: así viaja y así se compara. */
const PERIODO_DE: Record<Unidad, SQL<string>> = {
  day: sql<string>`${ventas.fecha}::text`,
  month: sql<string>`to_char(date_trunc('month', ${ventas.fecha}), 'YYYY-MM-DD')`,
  year: sql<string>`to_char(date_trunc('year', ${ventas.fecha}), 'YYYY-MM-DD')`,
};

/** Los traspasos solo cambian la mercancía de lugar: para toda la empresa no cuentan. */
const SIN_TRASPASOS = sql`${movimientos.tipo}::text not in ('traspaso_salida', 'traspaso_entrada')`;

export interface LineaVentaDelLibro {
  readonly fecha: string;
  readonly folio: string;
  readonly productoId: number;
  readonly producto: string;
  readonly categoria: string;
  readonly piezas: number;
  readonly importe: Decimal;
  readonly costos?: { readonly costo: Decimal; readonly comision: Decimal };
}

export interface LineaCompraDelLibro {
  readonly fecha: string;
  readonly folio: string;
  readonly productoId: number;
  readonly producto: string;
  readonly categoria: string;
  readonly piezas: number;
  readonly costos?: { readonly costoUnitario: Decimal };
}

export interface DatosDelLibro {
  readonly ventas: readonly LineaVentaDelLibro[];
  readonly compras: readonly LineaCompraDelLibro[];
}

interface Producto {
  readonly productoId: number;
  readonly producto: string;
  readonly categoria: string;
}

type FilaAgotadoBd = {
  readonly producto_id: number;
  readonly agotado_en: string;
  readonly entro_el: string | null;
  readonly compradas: number;
  readonly resurtido: boolean;
};

/**
 * El análisis de ventas de Inicio: ranking por producto, el orden en que se fueron
 * acabando y las piezas por día, mes y año.
 */
@Injectable()
export class AnalisisService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async analisis(usuario: UsuarioSesion, filtro: FiltroAnalisis): Promise<AnalisisVentas> {
    const { desde, hasta } = periodo(filtro, '30dias');
    const inicioMensual = sumarMeses(hasta, -11);

    const [catalogo, vendidas, compradas, iniciales, actuales, [primera], agotadosBd] =
      await Promise.all([
        this.catalogo(),
        this.vendidasPorProducto(desde, hasta),
        this.compradasPorProducto(desde, hasta),
        this.inicialesPorProducto(desde),
        this.existenciasPorProducto(),
        this.db
          .select({ fecha: sql<string | null>`min(${ventas.fecha})` })
          .from(ventas)
          .where(eq(ventas.estado, 'vigente')),
        this.agotados(desde, hasta),
      ]);
    const [diario, mensual, anual] = await Promise.all([
      this.matriz('day', catalogo, diasDelRango(desde, hasta), desde, hasta),
      this.matriz('month', catalogo, mesesDelRango(inicioMensual, hasta), inicioMensual, hasta),
      this.matrizAnual(catalogo),
    ]);

    const agotados = conNombres(agotadosBd, catalogo);
    const primeraVenta = primera?.fecha ?? null;
    const inicioEfectivo =
      primeraVenta !== null && primeraVenta > desde && primeraVenta <= hasta ? primeraVenta : desde;

    const agotadoEn = new Map(agotados.map((a) => [a.productoId, a.agotadoEn]));
    const filas = [...catalogo.values()]
      .map((p) => {
        const venta = vendidas.get(p.productoId);
        return {
          ...p,
          inicial: iniciales.get(p.productoId) ?? 0,
          compradas: compradas.get(p.productoId) ?? 0,
          vendidas: venta?.piezas ?? 0,
          importe: redondear(venta?.importe ?? '0'),
          existencia: actuales.get(p.productoId) ?? 0,
          agotadoEn: agotadoEn.get(p.productoId) ?? null,
          utilidad: venta?.utilidad ?? '0.00',
        };
      })
      .filter((f) => f.inicial + f.compradas + f.vendidas > 0 || f.existencia > 0)
      .toSorted(
        (a, b) =>
          b.vendidas - a.vendidas ||
          Number(b.importe) - Number(a.importe) ||
          a.producto.localeCompare(b.producto, 'es'),
      );

    const productosDelAnalisis: FilaAnalisisProducto[] = filas.map(({ utilidad, ...fila }) =>
      conCostos(usuario, fila, () => ({ utilidad })),
    );
    const base = {
      desde,
      hasta,
      primeraVenta,
      inicioEfectivo,
      dias: diasEntre(inicioEfectivo, hasta) + 1,
      piezas: filas.reduce((total, f) => total + f.vendidas, 0),
      importe: sumar(filas.map((f) => f.importe)),
      productos: productosDelAnalisis,
      agotados,
      mensual,
      anual,
      diario,
    };
    return conCostos(usuario, base, () => ({ utilidad: sumar(filas.map((f) => f.utilidad)) }));
  }

  /**
   * Las líneas de venta y de compra de las que salen las fórmulas del Excel. Cubren el
   * periodo y los 12 meses de la hoja Mensual. Costos solo con `costos.ver`.
   */
  async datosDelLibro(
    usuario: UsuarioSesion,
    desde: string,
    hasta: string,
  ): Promise<DatosDelLibro> {
    const inicio = [desde, sumarMeses(hasta, -11)].toSorted()[0] ?? desde;
    const [catalogo, lineasVenta, lineasCompra] = await Promise.all([
      this.catalogo(),
      this.db
        .select({
          fecha: ventas.fecha,
          folio: ventas.folio,
          productoId: ventaLineasNetas.productoId,
          piezas: ventaLineasNetas.piezasNetas,
          importe: ventaLineasNetas.importeNeto,
          costo: ventaLineasNetas.costoNeto,
          comision: ventaLineasNetas.comision,
        })
        .from(ventaLineasNetas)
        .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
        .where(
          and(eq(ventas.estado, 'vigente'), gte(ventas.fecha, inicio), lte(ventas.fecha, hasta)),
        )
        .orderBy(asc(ventas.fecha), asc(ventas.id), asc(ventaLineasNetas.id)),
      this.db
        .select({
          fecha: compras.fecha,
          folio: compras.folio,
          productoId: compraDetalle.productoId,
          piezas: compraDetalle.cantidad,
          costoUnitario: compraDetalle.costoUnitario,
        })
        .from(compraDetalle)
        .innerJoin(compras, eq(compras.id, compraDetalle.compraId))
        .where(
          and(eq(compras.estado, 'vigente'), gte(compras.fecha, inicio), lte(compras.fecha, hasta)),
        )
        .orderBy(asc(compras.fecha), asc(compras.id), asc(compraDetalle.id)),
    ]);
    const nombres = (productoId: number) => ({
      producto: catalogo.get(productoId)?.producto ?? '',
      categoria: catalogo.get(productoId)?.categoria ?? '',
    });
    return {
      ventas: lineasVenta.map(({ costo, comision, ...linea }) =>
        conCostos(
          usuario,
          { ...linea, importe: redondear(linea.importe), ...nombres(linea.productoId) },
          () => ({
            costo: redondear(costo),
            comision: redondear(comision),
          }),
        ),
      ),
      compras: lineasCompra.map(({ costoUnitario, ...linea }) =>
        conCostos(usuario, { ...linea, ...nombres(linea.productoId) }, () => ({ costoUnitario })),
      ),
    };
  }

  /** Nombre y categoría de cada producto, activo o no: lo vendido antes cuenta igual. */
  private async catalogo(): Promise<Map<number, Producto>> {
    const filas = await this.db
      .select({
        productoId: productos.id,
        producto: productos.nombre,
        categoria: categorias.nombre,
      })
      .from(productos)
      .innerJoin(categorias, eq(categorias.id, productos.categoriaId))
      .orderBy(asc(productos.nombre));
    return new Map(filas.map((f) => [f.productoId, f]));
  }

  /** Piezas, importe y utilidad netos de devoluciones, de las ventas vigentes del rango. */
  private async vendidasPorProducto(desde: string, hasta: string) {
    const filas = await this.db
      .select({
        productoId: ventaLineasNetas.productoId,
        piezas: sql<number>`coalesce(sum(${ventaLineasNetas.piezasNetas}), 0)::int`,
        importe: sql<string>`coalesce(sum(${ventaLineasNetas.importeNeto}), 0)`,
        costo: sql<string>`coalesce(sum(${ventaLineasNetas.costoNeto}), 0)`,
        comision: sql<string>`coalesce(sum(${ventaLineasNetas.comision}), 0)`,
      })
      .from(ventaLineasNetas)
      .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
      .where(and(eq(ventas.estado, 'vigente'), gte(ventas.fecha, desde), lte(ventas.fecha, hasta)))
      .groupBy(ventaLineasNetas.productoId);
    return new Map(
      filas.map((f) => [
        f.productoId,
        {
          piezas: f.piezas,
          importe: f.importe,
          utilidad: restar(restar(f.importe, f.costo), f.comision),
        },
      ]),
    );
  }

  private async compradasPorProducto(desde: string, hasta: string): Promise<Map<number, number>> {
    const filas = await this.db
      .select({
        productoId: compraDetalle.productoId,
        piezas: sql<number>`coalesce(sum(${compraDetalle.cantidad}), 0)::int`,
      })
      .from(compraDetalle)
      .innerJoin(compras, eq(compras.id, compraDetalle.compraId))
      .where(
        and(eq(compras.estado, 'vigente'), gte(compras.fecha, desde), lte(compras.fecha, hasta)),
      )
      .groupBy(compraDetalle.productoId);
    return new Map(filas.map((f) => [f.productoId, f.piezas]));
  }

  /**
   * La existencia de toda la empresa al empezar el periodo, sumando el kardex anterior.
   * Una cancelación suma de vuelta lo que su documento restó, así que el saldo ya sale
   * neto sin filtrarlas.
   */
  private async inicialesPorProducto(desde: string): Promise<Map<number, number>> {
    const filas = await this.db
      .select({
        productoId: movimientos.productoId,
        piezas: sql<number>`coalesce(sum(${movimientos.cantidad}), 0)::int`,
      })
      .from(movimientos)
      .where(and(lt(movimientos.fecha, desde), SIN_TRASPASOS))
      .groupBy(movimientos.productoId);
    return new Map(filas.map((f) => [f.productoId, f.piezas]));
  }

  private async existenciasPorProducto(): Promise<Map<number, number>> {
    const filas = await this.db
      .select({
        productoId: existencias.productoId,
        piezas: sql<number>`coalesce(sum(${existencias.cantidad}), 0)::int`,
      })
      .from(existencias)
      .groupBy(existencias.productoId);
    return new Map(filas.map((f) => [f.productoId, f.piezas]));
  }

  /**
   * El orden en que se fueron acabando los productos dentro del periodo.
   *
   * Recorre el kardex de cada producto en el orden en que se registró (por `id`: la
   * `fecha` de un documento puede ser atrasada) llevando el saldo de toda la empresa.
   * Fuera quedan los traspasos, que solo mueven mercancía de lugar, y los dos
   * movimientos de cada venta o compra cancelada, que se anulan entre sí: si no, una
   * venta que luego se canceló podría marcar un agotado que nunca pasó.
   *
   * Se agota cuando una venta o un ajuste deja el saldo en cero (o menos). El momento
   * es el de su registro. Por producto cuenta la primera vez dentro del periodo.
   */
  private async agotados(desde: string, hasta: string): Promise<FilaAgotadoBd[]> {
    const zona = sql.raw(`'${ZONA_HORARIA}'`);
    const resultado = await this.db.execute<FilaAgotadoBd>(sql`
      with kardex as (
        select m.id, m.producto_id, m.tipo::text as tipo, m.cantidad, m.registrado_en,
               sum(m.cantidad) over (partition by m.producto_id order by m.id) as saldo
        from ${movimientos} m
        left join ${ventas} v on v.id = m.venta_id
        left join ${compras} c on c.id = m.compra_id
        where m.tipo::text not in ('traspaso_salida', 'traspaso_entrada')
          and (v.estado is null or v.estado <> 'cancelado')
          and (c.estado is null or c.estado <> 'cancelado')
      ),
      -- Cada «ciclo» empieza con la entrada que llega cuando ya no había nada.
      ciclos as (
        select k.*,
               max(case when k.cantidad > 0 and k.saldo - k.cantidad <= 0 then k.id end)
                 over (partition by k.producto_id order by k.id) as inicio_id
        from kardex k
      ),
      eventos as (
        select e.*, row_number() over (partition by e.producto_id order by e.id) as n
        from ciclos e
        where e.tipo in ('venta', 'ajuste')
          and e.saldo <= 0
          and e.saldo - e.cantidad > 0
          and (e.registrado_en at time zone ${zona})::date between ${desde}::date and ${hasta}::date
      )
      select e.producto_id,
             to_char(e.registrado_en at time zone ${zona}, 'YYYY-MM-DD"T"HH24:MI:SS') as agotado_en,
             inicio.fecha::text as entro_el,
             (select coalesce(sum(compra.cantidad), 0)
                from ciclos compra
               where compra.producto_id = e.producto_id
                 and compra.tipo = 'compra'
                 and compra.id >= e.inicio_id
                 and compra.id < e.id)::int as compradas,
             exists (select 1
                       from ciclos despues
                      where despues.producto_id = e.producto_id
                        and despues.tipo = 'compra'
                        and despues.id > e.id) as resurtido
      from eventos e
      left join ${movimientos} inicio on inicio.id = e.inicio_id
      where e.n = 1
      order by e.registrado_en, e.id
    `);
    return resultado.rows;
  }

  /** Piezas netas por producto y periodo, de las ventas vigentes. */
  private piezasPor(unidad: Unidad, desde?: string, hasta?: string) {
    const periodoDeVenta = PERIODO_DE[unidad];
    const condiciones = [eq(ventas.estado, 'vigente')];
    if (desde) condiciones.push(gte(ventas.fecha, desde));
    if (hasta) condiciones.push(lte(ventas.fecha, hasta));
    return this.db
      .select({
        productoId: ventaLineasNetas.productoId,
        periodo: periodoDeVenta,
        piezas: sql<number>`coalesce(sum(${ventaLineasNetas.piezasNetas}), 0)::int`,
      })
      .from(ventaLineasNetas)
      .innerJoin(ventas, eq(ventas.id, ventaLineasNetas.ventaId))
      .where(and(...condiciones))
      .groupBy(ventaLineasNetas.productoId, periodoDeVenta);
  }

  private async matriz(
    unidad: Unidad,
    catalogo: Map<number, Producto>,
    periodos: readonly string[],
    desde?: string,
    hasta?: string,
  ): Promise<MatrizPiezas> {
    return armarMatriz(periodos, await this.piezasPor(unidad, desde, hasta), catalogo);
  }

  /**
   * Todos los años, a propósito sin el tope de 366 días: es una sola agregación por año
   * y producto, y su resultado crece con los años, no con las ventas.
   */
  private async matrizAnual(catalogo: Map<number, Producto>): Promise<MatrizPiezas> {
    const filas = await this.piezasPor('year');
    const anios = [...new Set(filas.map((f) => f.periodo))].toSorted();
    return armarMatriz(anios, filas, catalogo);
  }
}

function conNombres(
  filas: readonly FilaAgotadoBd[],
  catalogo: Map<number, Producto>,
): FilaAgotamiento[] {
  return filas.map((fila, i) => {
    const producto = catalogo.get(fila.producto_id);
    return {
      lugar: i + 1,
      productoId: fila.producto_id,
      producto: producto?.producto ?? '',
      categoria: producto?.categoria ?? '',
      entroEl: fila.entro_el,
      agotadoEn: fila.agotado_en,
      diasEnAgotarse:
        fila.entro_el === null ? null : diasEntre(fila.entro_el, fila.agotado_en.slice(0, 10)),
      piezasCompradas: fila.compradas,
      resurtido: fila.resurtido,
    };
  });
}

/**
 * Densa (un valor por periodo aunque sea cero), solo con los productos que vendieron
 * algo, de más a menos piezas.
 */
export function armarMatriz(
  periodos: readonly string[],
  filas: readonly { productoId: number; periodo: string; piezas: number }[],
  catalogo: Map<number, Producto>,
): MatrizPiezas {
  const indice = new Map(periodos.map((p, i) => [p, i]));
  const porProducto = new Map<number, number[]>();
  for (const fila of filas) {
    const i = indice.get(fila.periodo);
    if (i === undefined || fila.piezas === 0) continue;
    const piezas = porProducto.get(fila.productoId) ?? periodos.map(() => 0);
    piezas[i] = (piezas[i] ?? 0) + fila.piezas;
    porProducto.set(fila.productoId, piezas);
  }
  const filasMatriz = [...porProducto.entries()]
    .map(([productoId, piezas]) => ({
      productoId,
      producto: catalogo.get(productoId)?.producto ?? '',
      piezas,
      total: piezas.reduce((a, b) => a + b, 0),
    }))
    .filter((f) => f.total !== 0)
    .toSorted((a, b) => b.total - a.total || a.producto.localeCompare(b.producto, 'es'));
  return {
    periodos,
    filas: filasMatriz,
    totales: periodos.map((_, i) => filasMatriz.reduce((t, f) => t + (f.piezas[i] ?? 0), 0)),
  };
}
