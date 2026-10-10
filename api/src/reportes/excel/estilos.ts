/**
 * Los estilos de celda del libro: un `styles.xml` fijo y el índice de cada estilo.
 * Colores de la marca (los mismos del sitio) y Arial en todo el libro.
 */

const VINO = 'FF5B0021';
const AMARILLO = 'FFFFFF00';
const BORDE = 'FFD9D9D9';

/** Formatos de número propios (los ids < 164 son los de Excel). */
const FORMATOS = {
  moneda: [164, '"$"#,##0.00'],
  porcentaje: [165, '0.0%'],
  fecha: [166, 'dd/mm/yyyy'],
  fechaHora: [167, 'dd/mm/yyyy hh:mm'],
  mes: [168, 'mmm yyyy'],
  dia: [169, 'd mmm'],
  decimal: [170, '0.00'],
  entero: [171, '#,##0'],
} as const;

/** Índice de cada estilo en `cellXfs`. El orden de `XFS` de abajo manda. */
export const ESTILO = {
  normal: 0,
  encabezado: 1,
  titulo: 2,
  nota: 3,
  texto: 4,
  entero: 5,
  moneda: 6,
  porcentaje: 7,
  decimal: 8,
  fecha: 9,
  fechaHora: 10,
  entrada: 11,
  entradaFecha: 12,
  encabezadoMes: 13,
  encabezadoDia: 14,
  total: 15,
  subtitulo: 16,
  textoNegrita: 17,
  notaAjustada: 18,
} as const;

export type Estilo = (typeof ESTILO)[keyof typeof ESTILO];

// fuente, relleno, borde, formato, alineación
type Xf = readonly [number, number, number, number, string?];
const CENTRADO = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
const XFS: readonly Xf[] = [
  [0, 0, 0, 0],
  [1, 2, 1, 0, CENTRADO],
  [2, 0, 0, 0],
  [3, 0, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 1, FORMATOS.entero[0]],
  [0, 0, 1, FORMATOS.moneda[0]],
  [0, 0, 1, FORMATOS.porcentaje[0]],
  [0, 0, 1, FORMATOS.decimal[0]],
  [0, 0, 1, FORMATOS.fecha[0]],
  [0, 0, 1, FORMATOS.fechaHora[0]],
  [4, 3, 1, FORMATOS.entero[0]],
  [4, 3, 1, FORMATOS.fecha[0]],
  [1, 2, 1, FORMATOS.mes[0], CENTRADO],
  [1, 2, 1, FORMATOS.dia[0], CENTRADO],
  [5, 0, 1, FORMATOS.entero[0]],
  [5, 0, 0, 0],
  [5, 0, 1, 0],
  [3, 0, 0, 0, '<alignment vertical="top" wrapText="1"/>'],
];

const fuente = (extra: string) => `<font>${extra}<sz val="10"/><name val="Arial"/></font>`;

export const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${Object.keys(FORMATOS).length}">${Object.values(FORMATOS)
  .map(
    ([id, codigo]) => `<numFmt numFmtId="${id}" formatCode="${codigo.replaceAll('"', '&quot;')}"/>`,
  )
  .join('')}</numFmts>
<fonts count="6">${[
  fuente(''),
  fuente(`<b/><color rgb="FFFFFFFF"/>`),
  `<font><b/><sz val="16"/><color rgb="${VINO}"/><name val="Arial"/></font>`,
  `<font><i/><sz val="9"/><color rgb="FF595959"/><name val="Arial"/></font>`,
  fuente(`<b/><color rgb="FF0000FF"/>`),
  fuente('<b/>'),
].join('')}</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${VINO}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="${AMARILLO}"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${[
  'left',
  'right',
  'top',
  'bottom',
]
  .map((lado) => `<${lado} style="thin"><color rgb="${BORDE}"/></${lado}>`)
  .join('')}<diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XFS.length}">${XFS.map(([fuenteId, relleno, borde, formato, alineacion]) => {
  const aplica = [
    formato ? ' applyNumberFormat="1"' : '',
    fuenteId ? ' applyFont="1"' : '',
    relleno ? ' applyFill="1"' : '',
    borde ? ' applyBorder="1"' : '',
    alineacion ? ' applyAlignment="1"' : '',
  ].join('');
  const xf = `<xf numFmtId="${formato}" fontId="${fuenteId}" fillId="${relleno}" borderId="${borde}" xfId="0"${aplica}`;
  return alineacion ? `${xf}>${alineacion}</xf>` : `${xf}/>`;
}).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
