/**
 * El Excel del análisis de ventas: las mismas hojas y gráficas que se ven en Inicio.
 *
 * Las cifras de Resumen, Mensual y Diario son fórmulas sobre las hojas Ventas y
 * Compras, así que el libro se recalcula si se cambian las celdas amarillas (Desde,
 * Hasta, Días a llevar). Se buscan por **Id** de producto, nunca por nombre: un nombre
 * con `*` o `?` sería un comodín para SUMIFS.
 *
 * Cada fórmula lleva su resultado ya calculado con las funciones de `compartido`, para
 * que se vea bien aunque quien lo abre no recalcule.
 */
import {
  type AnalisisVentas,
  type MatrizPiezas,
  porcentajeVendido,
  sugeridoLlevar,
  sumar,
  ventasPorDia,
} from '@uvm/compartido';
import type { DatosDelLibro } from '../analisis.service.js';
import { ESTILO, type Estilo } from './estilos.js';
import { COLORES, type Grafica } from './graficas.js';
import { type Celda, columna, type Hoja, type Libro, ref } from './xlsx.js';

export interface OpcionesDelLibro {
  readonly diasALlevar: number;
  /** Fecha y hora en que se generó, para la nota del encabezado. */
  readonly generado: string;
}

const RESUMEN = 'Resumen';
const AGOTAMIENTO = 'Orden de agotamiento';
const MENSUAL = 'Mensual';
const ANUAL = 'Anual';
const DIARIO = 'Diario';
const VENTAS = 'Ventas';
const COMPRAS = 'Compras';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (fecha: string) =>
  `${Number(fecha.slice(8, 10))} ${MESES[Number(fecha.slice(5, 7)) - 1]}`;
const mesCorto = (fecha: string) => `${MESES[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}`;
const fechaLarga = (fecha: string) => `${fechaCorta(fecha)} ${fecha.slice(0, 4)}`;

const texto = (valor: string, estilo: Estilo = ESTILO.texto): Celda => ({ texto: valor, estilo });
const numero = (valor: number | string, estilo: Estilo = ESTILO.entero): Celda => ({
  numero: valor,
  estilo,
});
const formula = (f: string, valor: number | string, estilo: Estilo = ESTILO.entero): Celda => ({
  formula: f,
  valor,
  estilo,
});
const encabezados = (titulos: readonly string[]): Celda[] =>
  titulos.map((t) => texto(t, ESTILO.encabezado));

/** Alto de una gráfica de barras horizontales según cuántas barras lleva. */
const altoDeBarras = (barras: number) => Math.max(14, Math.ceil(barras * 1.4) + 5);

export function libroDeAnalisis(
  a: AnalisisVentas,
  datos: DatosDelLibro,
  opciones: OpcionesDelLibro,
): Libro {
  const conCostos = a.costos !== undefined;
  const hojaVentas = hojaDeVentas(datos, conCostos);
  const hojaCompras = hojaDeCompras(datos, conCostos);
  const v = rangosDeVentas(datos.ventas.length, conCostos);
  const c = rangosDeCompras(datos.compras.length);
  return {
    hojas: [
      hojaResumen(a, opciones, v, c),
      hojaAgotamiento(a),
      hojaMatriz(MENSUAL, 'Ventas por mes', a.mensual, 'mes', v),
      hojaMatriz(ANUAL, 'Ventas por año', a.anual, 'anio', v),
      hojaMatriz(DIARIO, 'Ventas por día', a.diario, 'dia', v),
      hojaVentas,
      hojaCompras,
    ],
    nombres: [
      { nombre: 'Desde', ref: ref(RESUMEN, 2, 4) },
      { nombre: 'Hasta', ref: ref(RESUMEN, 2, 5) },
      { nombre: 'PrimeraVenta', ref: ref(RESUMEN, 2, 6) },
      { nombre: 'DiasDelPeriodo', ref: ref(RESUMEN, 2, 7) },
      { nombre: 'DiasALlevar', ref: ref(RESUMEN, 2, 9) },
    ],
  };
}

/* -----------------------------------------------------------------------------
   Datos crudos
   -------------------------------------------------------------------------- */

interface RangosVentas {
  readonly fecha: string;
  readonly id: string;
  readonly piezas: string;
  readonly importe: string;
  readonly utilidad: string | null;
}

/** Hasta dónde llegan las columnas de Ventas (al menos una fila, aunque esté vacía). */
function rangosDeVentas(lineas: number, conCostos: boolean): RangosVentas {
  const fin = Math.max(2, lineas + 1);
  const r = (col: number) => ref(VENTAS, col, 2, { col, fila: fin });
  return {
    fecha: r(1),
    id: r(3),
    piezas: r(6),
    importe: r(7),
    utilidad: conCostos ? r(10) : null,
  };
}

function rangosDeCompras(lineas: number) {
  const fin = Math.max(2, lineas + 1);
  const r = (col: number) => ref(COMPRAS, col, 2, { col, fila: fin });
  return { fecha: r(1), id: r(3), piezas: r(6) };
}
type RangosCompras = ReturnType<typeof rangosDeCompras>;

function hojaDeVentas(datos: DatosDelLibro, conCostos: boolean): Hoja {
  const titulos = ['Fecha', 'Folio', 'Id', 'Producto', 'Categoría', 'Piezas', 'Importe'];
  if (conCostos) titulos.push('Costo', 'Comisión', 'Utilidad');
  return {
    nombre: VENTAS,
    anchos: [12, 12, 6, 38, 14, 9, 12, 12, 12, 12],
    congelar: 'A2',
    filas: [
      encabezados(titulos),
      ...datos.ventas.map((l, i) => {
        const fila = i + 2;
        const celdas: Celda[] = [
          { fecha: l.fecha, estilo: ESTILO.fecha },
          texto(l.folio),
          numero(l.productoId),
          texto(l.producto),
          texto(l.categoria),
          numero(l.piezas),
          numero(l.importe, ESTILO.moneda),
        ];
        if (conCostos && l.costos) {
          const utilidad = sumar([l.importe, `-${l.costos.costo}`, `-${l.costos.comision}`]);
          celdas.push(
            numero(l.costos.costo, ESTILO.moneda),
            numero(l.costos.comision, ESTILO.moneda),
            formula(`G${fila}-H${fila}-I${fila}`, utilidad, ESTILO.moneda),
          );
        }
        return celdas;
      }),
      [],
      [
        texto(
          'Ventas vigentes, con piezas e importe ya netos de devoluciones. La comisión es la ' +
            'del cobro con tarjeta.',
          ESTILO.nota,
        ),
      ],
    ],
  };
}

function hojaDeCompras(datos: DatosDelLibro, conCostos: boolean): Hoja {
  const titulos = ['Fecha', 'Folio', 'Id', 'Producto', 'Categoría', 'Piezas compradas'];
  if (conCostos) titulos.push('Costo unitario');
  return {
    nombre: COMPRAS,
    anchos: [12, 12, 6, 38, 14, 12, 14],
    congelar: 'A2',
    filas: [
      encabezados(titulos),
      ...datos.compras.map((l) => {
        const celdas: Celda[] = [
          { fecha: l.fecha, estilo: ESTILO.fecha },
          texto(l.folio),
          numero(l.productoId),
          texto(l.producto),
          texto(l.categoria),
          numero(l.piezas),
        ];
        if (conCostos && l.costos) celdas.push(numero(l.costos.costoUnitario, ESTILO.moneda));
        return celdas;
      }),
      [],
      [texto('Compras vigentes. El costo unitario ya incluye la gasolina del viaje.', ESTILO.nota)],
    ],
  };
}

/* -----------------------------------------------------------------------------
   Resumen
   -------------------------------------------------------------------------- */

const FILA_TABLA = 11;
const L = columna;
/** Criterios de SUMIFS para quedarse con lo que cae entre las celdas Desde y Hasta. */
const enPeriodo = (rangoFecha: string) => `${rangoFecha},">="&Desde,${rangoFecha},"<="&Hasta`;

function hojaResumen(
  a: AnalisisVentas,
  opciones: OpcionesDelLibro,
  v: RangosVentas,
  c: RangosCompras,
): Hoja {
  const conCostos = a.costos !== undefined;
  // Columnas de la tabla (base 1). Sin costos no hay Utilidad y todo se recorre.
  const col = {
    lugar: 1,
    id: 2,
    producto: 3,
    categoria: 4,
    inicial: 5,
    compradas: 6,
    vendidas: 7,
    porcentaje: 8,
    importe: 9,
    utilidad: conCostos ? 10 : 0,
    existencia: conCostos ? 11 : 10,
    porDia: conCostos ? 12 : 11,
    agotado: conCostos ? 13 : 12,
    sugerido: conCostos ? 14 : 13,
  };
  const primeraDato = FILA_TABLA + 1;
  const ultimaDato = FILA_TABLA + Math.max(1, a.productos.length);
  const rango = (n: number) => `${L(n)}${primeraDato}:${L(n)}${ultimaDato}`;

  const titulos = [
    '#',
    'Id',
    'Producto',
    'Categoría',
    'Había al inicio',
    'Compradas',
    'Vendidas',
    '% vendido de lo disponible',
    'Importe',
    ...(conCostos ? ['Utilidad'] : []),
    'Existencia hoy',
    'Ventas por día',
    '¿Se agotó?',
    'Sugerido llevar',
  ];

  const filasTabla = a.productos.map((p, i) => {
    const f = primeraDato + i;
    const porcentaje = porcentajeVendido(p.vendidas, p.inicial + p.compradas);
    const sugerido = sugeridoLlevar({
      vendidas: p.vendidas,
      dias: a.dias,
      diasALlevar: opciones.diasALlevar,
      existencia: p.existencia,
    });
    const celdas: (Celda | undefined)[] = [];
    const poner = (n: number, celda: Celda) => {
      celdas[n - 1] = celda;
    };
    poner(col.lugar, numero(i + 1));
    poner(col.id, numero(p.productoId));
    poner(col.producto, texto(p.producto));
    poner(col.categoria, texto(p.categoria));
    poner(col.inicial, numero(p.inicial));
    poner(
      col.compradas,
      formula(`SUMIFS(${c.piezas},${c.id},$B${f},${enPeriodo(c.fecha)})`, p.compradas),
    );
    poner(
      col.vendidas,
      formula(`SUMIFS(${v.piezas},${v.id},$B${f},${enPeriodo(v.fecha)})`, p.vendidas),
    );
    const disponibles = `${L(col.inicial)}${f}+${L(col.compradas)}${f}`;
    poner(
      col.porcentaje,
      formula(
        `IF(${disponibles}=0,"",${L(col.vendidas)}${f}/(${disponibles}))`,
        porcentaje ?? '',
        ESTILO.porcentaje,
      ),
    );
    poner(
      col.importe,
      formula(
        `SUMIFS(${v.importe},${v.id},$B${f},${enPeriodo(v.fecha)})`,
        p.importe,
        ESTILO.moneda,
      ),
    );
    if (conCostos && v.utilidad) {
      poner(
        col.utilidad,
        formula(
          `SUMIFS(${v.utilidad},${v.id},$B${f},${enPeriodo(v.fecha)})`,
          p.costos?.utilidad ?? '0.00',
          ESTILO.moneda,
        ),
      );
    }
    poner(col.existencia, numero(p.existencia));
    poner(
      col.porDia,
      formula(
        `IF(DiasDelPeriodo<=0,0,${L(col.vendidas)}${f}/DiasDelPeriodo)`,
        ventasPorDia(p.vendidas, a.dias),
        ESTILO.decimal,
      ),
    );
    poner(col.agotado, texto(p.agotadoEn ? 'Sí' : 'No'));
    poner(
      col.sugerido,
      formula(
        `IF(DiasDelPeriodo<=0,0,MAX(0,ROUNDUP(${L(col.vendidas)}${f}*DiasALlevar/DiasDelPeriodo,0)-${L(col.existencia)}${f}))`,
        sugerido,
        ESTILO.total,
      ),
    );
    return celdas;
  });

  const kpis = (fila: number): (Celda | undefined)[] => {
    const lado: Partial<Record<number, [string, Celda]>> = {
      4: ['Piezas vendidas', formula(`SUM(${rango(col.vendidas)})`, a.piezas)],
      5: ['Importe vendido', formula(`SUM(${rango(col.importe)})`, a.importe, ESTILO.moneda)],
      ...(conCostos && a.costos
        ? {
            6: [
              'Utilidad bruta',
              formula(`SUM(${rango(col.utilidad)})`, a.costos.utilidad, ESTILO.moneda),
            ] as [string, Celda],
          }
        : {}),
    };
    const kpi = lado[fila];
    return kpi ? [undefined, undefined, texto(kpi[0], ESTILO.normal), kpi[1]] : [];
  };

  const notas = [
    'Cómo leerlo:',
    '• «Vendidas» engaña sola: de un producto se pueden comprar 2 piezas y de otro 20. Lo que ' +
      'mejor dice qué gustó es «% vendido de lo disponible» y la hoja «Orden de agotamiento».',
    '• Lo que se agotó pudo venderse más: su venta está topada por lo que había. Para esos ' +
      'productos, el sugerido es un mínimo.',
    '• Sugerido llevar = ventas del periodo × días a surtir ÷ días del periodo, redondeado ' +
      'hacia arriba, menos la existencia de hoy.',
    '• Desde, Hasta y Días a llevar recalculan Compradas, Vendidas, Importe y el sugerido. ' +
      '«Había al inicio», «Existencia hoy» y «¿Se agotó?» son del periodo con que se generó.',
  ];
  const filaNotas = ultimaDato + 2;
  const anchoTabla = col.sugerido;

  const filas: (Celda | undefined)[][] = [];
  filas[0] = [texto('Una vez más — ¿Qué se vendió más y qué llevar?', ESTILO.titulo)];
  filas[1] = [
    texto(
      `Generado el ${opciones.generado}. Las celdas amarillas se pueden cambiar y todo se recalcula.`,
      ESTILO.nota,
    ),
  ];
  filas[3] = [
    texto('Desde', ESTILO.normal),
    { fecha: a.desde, estilo: ESTILO.entradaFecha },
    ...kpis(4).slice(2),
  ];
  filas[4] = [
    texto('Hasta', ESTILO.normal),
    { fecha: a.hasta, estilo: ESTILO.entradaFecha },
    ...kpis(5).slice(2),
  ];
  filas[5] = [
    texto('Primera venta', ESTILO.normal),
    { fecha: a.primeraVenta ?? a.desde, estilo: ESTILO.fecha },
    ...kpis(6).slice(2),
  ];
  filas[6] = [
    texto('Días del periodo', ESTILO.normal),
    formula('Hasta-MAX(Desde,PrimeraVenta)+1', a.dias, ESTILO.total),
  ];
  filas[8] = [
    texto('¿Para cuántos días quieres surtir?', ESTILO.subtitulo),
    numero(opciones.diasALlevar, ESTILO.entrada),
    texto('← celda amarilla: cámbiala y se recalcula «Sugerido llevar»', ESTILO.nota),
  ];
  filas[FILA_TABLA - 1] = encabezados(titulos);
  filasTabla.forEach((celdas, i) => {
    filas[primeraDato - 1 + i] = celdas;
  });
  if (a.productos.length === 0) {
    filas[primeraDato - 1] = [texto('No hubo movimiento de productos en el periodo.', ESTILO.nota)];
  }
  notas.forEach((nota, i) => {
    filas[filaNotas - 1 + i] = [texto(nota, i === 0 ? ESTILO.subtitulo : ESTILO.normal)];
  });

  const categorias = {
    ref: ref(RESUMEN, col.producto, primeraDato, { col: col.producto, fila: ultimaDato }),
    datos: a.productos.map((p) => p.producto),
  };
  const xGrafica = anchoTabla + 1;
  const alto = altoDeBarras(a.productos.length);
  const graficas: Grafica[] = a.productos.length
    ? [
        {
          tipo: 'barras',
          titulo: 'Piezas vendidas por producto',
          descripcion: `Piezas vendidas por producto del ${fechaLarga(a.desde)} al ${fechaLarga(a.hasta)}.`,
          categorias,
          series: [
            {
              nombre: 'Vendidas',
              ref: ref(RESUMEN, col.vendidas, primeraDato, { col: col.vendidas, fila: ultimaDato }),
              datos: a.productos.map((p) => p.vendidas),
            },
          ],
          etiquetas: true,
          formato: '#,##0',
          minimo: 0,
          desde: { col: xGrafica, fila: 2 },
          hasta: { col: xGrafica + 8, fila: 2 + alto },
        },
        {
          tipo: 'barras',
          titulo: '% vendido de lo disponible',
          descripcion: 'Qué parte de lo que hubo de cada producto se vendió en el periodo.',
          categorias,
          series: [
            {
              nombre: '% vendido',
              ref: ref(RESUMEN, col.porcentaje, primeraDato, {
                col: col.porcentaje,
                fila: ultimaDato,
              }),
              datos: a.productos.map((p) => {
                const pct = porcentajeVendido(p.vendidas, p.inicial + p.compradas);
                return pct === null ? null : Number(pct);
              }),
              color: COLORES[1],
            },
          ],
          etiquetas: true,
          formato: '0%',
          minimo: 0,
          maximo: 1,
          desde: { col: xGrafica, fila: 3 + alto },
          hasta: { col: xGrafica + 8, fila: 3 + 2 * alto },
        },
      ]
    : [];

  return {
    nombre: RESUMEN,
    anchos: [22, 11, 38, 14, 11, 11, 10, 13, 12, ...(conCostos ? [12] : []), 11, 11, 10, 12],
    congelar: `D${primeraDato}`,
    altos: new Map([[FILA_TABLA, 32]]),
    filas,
    validaciones: [{ ref: 'B9', minimo: 1, maximo: 90, mensaje: 'Escribe de 1 a 90 días.' }],
    graficas,
  };
}

/* -----------------------------------------------------------------------------
   Orden de agotamiento
   -------------------------------------------------------------------------- */

function hojaAgotamiento(a: AnalisisVentas): Hoja {
  const filas: (Celda | undefined)[][] = [];
  filas[0] = [texto('¿Qué se acabó primero?', ESTILO.titulo)];
  filas[1] = [
    texto(
      'El momento en que la existencia de toda la empresa llegó a cero, según el kardex. ' +
        'No cuentan los traspasos entre ubicaciones ni las ventas o compras canceladas.',
      ESTILO.nota,
    ),
  ];
  filas[3] = encabezados([
    'Lugar',
    'Producto',
    'Categoría',
    'Entró el',
    'Se agotó el',
    'Días en agotarse',
    'Piezas compradas',
    '¿Ya se resurtió?',
  ]);
  a.agotados.forEach((g, i) => {
    const f = 5 + i;
    filas[f - 1] = [
      numero(g.lugar, g.lugar <= 3 ? ESTILO.total : ESTILO.entero),
      texto(g.producto),
      texto(g.categoria),
      g.entroEl ? { fecha: g.entroEl, estilo: ESTILO.fecha } : texto(''),
      { fechaHora: g.agotadoEn, estilo: ESTILO.fechaHora },
      g.entroEl && g.diasEnAgotarse !== null
        ? formula(`INT(E${f})-D${f}`, g.diasEnAgotarse)
        : texto(''),
      numero(g.piezasCompradas),
      texto(g.resurtido ? 'Sí' : 'No'),
    ];
  });
  const ultima = 4 + Math.max(1, a.agotados.length);
  if (a.agotados.length === 0) {
    filas[4] = [texto('Ningún producto se agotó en el periodo.', ESTILO.nota)];
  }

  const conExistencia = a.productos.filter((p) => p.existencia > 0);
  const filaExistencia = ultima + 2;
  filas[filaExistencia - 1] = [texto('Todavía con existencia', ESTILO.subtitulo)];
  filas[filaExistencia] = encabezados(['', 'Producto', 'Categoría', 'Existencia hoy']);
  conExistencia.forEach((p, i) => {
    filas[filaExistencia + 1 + i] = [
      undefined,
      texto(p.producto),
      texto(p.categoria),
      numero(p.existencia),
    ];
  });
  const filaNota = filaExistencia + 2 + Math.max(1, conExistencia.length);
  filas[filaNota] = [
    texto(
      'Ojo: un producto del que se compraron 1 o 2 piezas se agota rápido aunque no sea el ' +
        'favorito. Compara con «Piezas compradas».',
      ESTILO.nota,
    ),
  ];

  const conDias = a.agotados.filter((g) => g.diasEnAgotarse !== null);
  const graficas: Grafica[] = conDias.length
    ? [
        {
          tipo: 'barras',
          titulo: 'Días que tardó en agotarse',
          descripcion:
            'Días entre la entrada de la mercancía y el momento en que se acabó, en el orden en ' +
            'que se fueron acabando. Menos días: se fue más rápido.',
          categorias: {
            ref: ref(AGOTAMIENTO, 2, 5, { col: 2, fila: ultima }),
            datos: a.agotados.map((g) => g.producto),
          },
          series: [
            {
              nombre: 'Días',
              ref: ref(AGOTAMIENTO, 6, 5, { col: 6, fila: ultima }),
              datos: a.agotados.map((g) => g.diasEnAgotarse),
            },
          ],
          etiquetas: true,
          formato: '0',
          minimo: 0,
          desde: { col: 9, fila: 3 },
          hasta: { col: 17, fila: 3 + altoDeBarras(a.agotados.length) },
        },
      ]
    : [];
  return {
    nombre: AGOTAMIENTO,
    anchos: [8, 38, 14, 12, 17, 11, 11, 12],
    altos: new Map([[4, 32]]),
    filas,
    graficas,
  };
}

/* -----------------------------------------------------------------------------
   Mensual, Anual y Diario
   -------------------------------------------------------------------------- */

type Unidad = 'mes' | 'anio' | 'dia';

function hojaMatriz(
  nombre: string,
  titulo: string,
  m: MatrizPiezas,
  unidad: Unidad,
  v: RangosVentas,
): Hoja {
  const n = m.periodos.length;
  const colTotal = 3 + n;
  const primera = 5;
  const ultima = primera + Math.max(1, m.filas.length) - 1;
  const filaTotales = ultima + 1;
  const estiloPeriodo = {
    mes: ESTILO.encabezadoMes,
    dia: ESTILO.encabezadoDia,
    anio: ESTILO.encabezado,
  }[unidad];
  const etiqueta = { mes: mesCorto, dia: fechaCorta, anio: (p: string) => p.slice(0, 4) }[unidad];

  const filas: (Celda | undefined)[][] = [];
  filas[0] = [texto(titulo, ESTILO.titulo)];
  filas[1] = [
    texto(
      unidad === 'anio'
        ? 'Piezas vendidas por producto en cada año, con todo el historial (valores calculados por la app).'
        : 'Piezas vendidas por producto en cada periodo (fórmulas sobre la hoja Ventas).',
      ESTILO.nota,
    ),
  ];
  filas[3] = [
    texto('Id', ESTILO.encabezado),
    texto('Producto', ESTILO.encabezado),
    ...m.periodos.map((p): Celda =>
      unidad === 'anio' ? texto(p.slice(0, 4), estiloPeriodo) : { fecha: p, estilo: estiloPeriodo },
    ),
    texto('Total', ESTILO.encabezado),
  ];
  m.filas.forEach((fila, i) => {
    const f = primera + i;
    filas[f - 1] = [
      numero(fila.productoId),
      texto(fila.producto),
      ...fila.piezas.map((piezas, j): Celda => {
        if (unidad === 'anio') return numero(piezas);
        const p = `${columna(3 + j)}$4`;
        const criterio =
          unidad === 'mes'
            ? `${v.fecha},">="&${p},${v.fecha},"<"&EDATE(${p},1)`
            : `${v.fecha},${p}`;
        return formula(`SUMIFS(${v.piezas},${v.id},$A${f},${criterio})`, piezas);
      }),
      formula(`SUM(C${f}:${columna(colTotal - 1)}${f})`, fila.total, ESTILO.total),
    ];
  });
  if (m.filas.length === 0) {
    filas[primera - 1] = [undefined, texto('Sin ventas en estos periodos.', ESTILO.nota)];
  }
  filas[filaTotales - 1] = [
    undefined,
    texto('Total', ESTILO.textoNegrita),
    ...m.totales.map((total, j) =>
      formula(`SUM(${columna(3 + j)}${primera}:${columna(3 + j)}${ultima})`, total, ESTILO.total),
    ),
    formula(
      `SUM(${columna(colTotal)}${primera}:${columna(colTotal)}${ultima})`,
      m.totales.reduce((a, b) => a + b, 0),
      ESTILO.total,
    ),
  ];
  if (n === 1 && unidad !== 'dia') {
    filas[filaTotales + 1] = [
      texto(
        `Hoy solo hay un ${unidad === 'mes' ? 'mes' : 'año'} con ventas: la tendencia se verá conforme pasen los ${unidad === 'mes' ? 'meses' : 'años'}. ` +
          'Mientras, la hoja «Diario» muestra la tendencia dentro del mes.',
        ESTILO.nota,
      ),
    ];
  }

  const periodosRef = ref(nombre, 3, 4, { col: 2 + n, fila: 4 });
  const productosRef = ref(nombre, 2, primera, { col: 2, fila: ultima });
  const etiquetas = m.periodos.map(etiqueta);
  const debajo = filaTotales + 3;
  const graficas: Grafica[] = [];
  if (m.filas.length && n) {
    if (unidad === 'dia') {
      graficas.push(
        {
          tipo: 'lineas',
          titulo: 'Piezas vendidas por día — total',
          descripcion: resumenDeSerie('Piezas por día', etiquetas, m.totales),
          categorias: { ref: periodosRef, datos: etiquetas },
          formatoCategorias: 'd mmm',
          series: [
            {
              nombre: 'Total',
              ref: ref(nombre, 3, filaTotales, { col: 2 + n, fila: filaTotales }),
              datos: m.totales,
            },
          ],
          formato: '#,##0',
          minimo: 0,
          desde: { col: 0, fila: debajo },
          hasta: { col: 8, fila: debajo + 16 },
        },
        {
          tipo: 'lineas',
          titulo: `Piezas por día — ${Math.min(5, m.filas.length)} más vendidos`,
          descripcion: `Piezas por día de ${m.filas
            .slice(0, 5)
            .map((f) => f.producto)
            .join(', ')}.`,
          categorias: { ref: periodosRef, datos: etiquetas },
          formatoCategorias: 'd mmm',
          series: m.filas.slice(0, 5).map((fila, i) => ({
            nombre: fila.producto,
            ref: ref(nombre, 3, primera + i, { col: 2 + n, fila: primera + i }),
            datos: fila.piezas,
          })),
          formato: '#,##0',
          minimo: 0,
          desde: { col: 9, fila: debajo },
          hasta: { col: 19, fila: debajo + 16 },
        },
      );
    } else {
      const conVentas = m.totales.flatMap((total, j) => (total > 0 ? [j] : []));
      const alto = altoDeBarras(m.filas.length * Math.min(conVentas.length, 3));
      graficas.push({
        tipo: 'barras',
        titulo: `Piezas vendidas por producto, por ${unidad === 'mes' ? 'mes' : 'año'}`,
        descripcion: `Piezas vendidas de cada producto en cada ${unidad === 'mes' ? 'mes' : 'año'}.`,
        categorias: { ref: productosRef, datos: m.filas.map((f) => f.producto) },
        // Solo los periodos con ventas: doce series en cero no dicen nada.
        series: conVentas.map((j, k) => ({
          nombre: etiqueta(m.periodos[j] ?? ''),
          ref: ref(nombre, 3 + j, primera, { col: 3 + j, fila: ultima }),
          datos: m.filas.map((f) => f.piezas[j] ?? 0),
          color: COLORES[k % COLORES.length],
        })),
        etiquetas: conVentas.length === 1,
        formato: '#,##0',
        minimo: 0,
        desde: { col: 0, fila: debajo },
        hasta: { col: 9, fila: debajo + alto },
      });
      if (unidad === 'mes') {
        graficas.push({
          tipo: 'lineas',
          titulo: 'Tendencia mensual: piezas totales',
          descripcion: resumenDeSerie('Piezas por mes', etiquetas, m.totales),
          categorias: { ref: periodosRef, datos: etiquetas },
          formatoCategorias: 'mmm yyyy',
          series: [
            {
              nombre: 'Total',
              ref: ref(nombre, 3, filaTotales, { col: 2 + n, fila: filaTotales }),
              datos: m.totales,
            },
          ],
          etiquetas: true,
          formato: '#,##0',
          minimo: 0,
          desde: { col: 10, fila: debajo },
          hasta: { col: 18, fila: debajo + 16 },
        });
      }
    }
  }

  return {
    nombre,
    anchos: [6, 38, ...m.periodos.map(() => (unidad === 'dia' ? 8 : 10)), 9],
    congelar: 'C5',
    altos: new Map([[4, 30]]),
    filas,
    graficas,
  };
}

/** Texto alternativo de una línea: el total, el máximo y el mínimo. */
function resumenDeSerie(que: string, etiquetas: readonly string[], valores: readonly number[]) {
  if (!valores.length) return `${que}: sin datos.`;
  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  return (
    `${que}: ${valores.reduce((a, b) => a + b, 0)} en total; el máximo, ${maximo}, ` +
    `el ${etiquetas[valores.indexOf(maximo)]}; el mínimo, ${minimo}, el ${etiquetas[valores.indexOf(minimo)]}.`
  );
}
