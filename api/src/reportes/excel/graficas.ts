/**
 * Gráficas nativas de Excel (DrawingML). Ninguna librería libre de Node las escribe,
 * así que se arman aquí: barras horizontales, columnas y líneas, que es lo que usa el
 * análisis de ventas.
 *
 * Cada serie lleva la referencia a sus celdas (para que la gráfica siga a la hoja al
 * recalcular) y una copia de los valores, para que se vea aunque quien abre el
 * archivo no recalcule.
 */
import { escaparXml } from './texto.js';

export interface Serie {
  readonly nombre: string;
  /** `'Resumen'!$G$7:$G$15` */
  readonly ref: string;
  readonly datos: readonly (number | null)[];
  /** RRGGBB */
  readonly color?: string;
}

export interface Grafica {
  readonly tipo: 'barras' | 'columnas' | 'lineas';
  readonly titulo: string;
  /** Texto alternativo: lo que la gráfica dice, para lectores de pantalla. */
  readonly descripcion: string;
  readonly categorias: { readonly ref: string; readonly datos: readonly string[] };
  readonly series: readonly Serie[];
  /** Si las categorías son fechas, su formato: `d mmm`, `mmm yyyy`. */
  readonly formatoCategorias?: string;
  /** Formato de los números del eje y de las etiquetas: `0%`, `#,##0`… */
  readonly formato?: string;
  readonly minimo?: number;
  readonly maximo?: number;
  /** Muestra el valor junto a cada barra o punto. */
  readonly etiquetas?: boolean;
  /** Celdas (base 0) de la esquina superior izquierda y de la inferior derecha. */
  readonly desde: { readonly col: number; readonly fila: number };
  readonly hasta: { readonly col: number; readonly fila: number };
}

/** Colores de las series: de la marca, y distinguibles entre sí. */
export const COLORES = ['5B0021', 'DA2C65', 'B07A1E', '2E6F95', '4C7A34'] as const;

const NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const EJE_CATEGORIAS = 500_001;
const EJE_VALORES = 500_002;

function texto(contenido: string, tamano: number, negrita: boolean): string {
  const b = negrita ? ' b="1"' : '';
  return (
    `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${tamano}"${b}/></a:pPr>` +
    `<a:r><a:rPr lang="es-MX" sz="${tamano}"${b}/><a:t>${escaparXml(contenido)}</a:t></a:r></a:p></c:rich></c:tx>`
  );
}

function cacheDeTexto(datos: readonly string[]): string {
  return (
    `<c:strCache><c:ptCount val="${datos.length}"/>` +
    datos.map((d, i) => `<c:pt idx="${i}"><c:v>${escaparXml(d)}</c:v></c:pt>`).join('') +
    `</c:strCache>`
  );
}

function cacheDeNumeros(datos: readonly (number | null)[], formato: string): string {
  return (
    `<c:numCache><c:formatCode>${escaparXml(formato)}</c:formatCode><c:ptCount val="${datos.length}"/>` +
    datos.map((d, i) => (d === null ? '' : `<c:pt idx="${i}"><c:v>${d}</c:v></c:pt>`)).join('') +
    `</c:numCache>`
  );
}

function etiquetasDeDatos(formato: string): string {
  return (
    `<c:dLbls><c:numFmt formatCode="${escaparXml(formato)}" sourceLinked="0"/>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
    `<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>` +
    `<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
  );
}

function serie(grafica: Grafica, s: Serie, i: number): string {
  const formato = grafica.formato ?? 'General';
  const color = s.color ?? COLORES[i % COLORES.length] ?? COLORES[0];
  const lineas = grafica.tipo === 'lineas';
  const relleno = lineas
    ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
      `<a:prstDash val="${['solid', 'dash', 'sysDot', 'lgDash', 'dashDot'][i % 5]}"/></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="${['circle', 'square', 'triangle', 'diamond', 'x'][i % 5]}"/>` +
      `<c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>`
    : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${escaparXml(s.nombre)}</c:v></c:tx>` +
    relleno +
    (grafica.etiquetas ? etiquetasDeDatos(formato) : '') +
    `<c:cat><c:strRef><c:f>${escaparXml(grafica.categorias.ref)}</c:f>${cacheDeTexto(grafica.categorias.datos)}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${escaparXml(s.ref)}</c:f>${cacheDeNumeros(s.datos, formato)}</c:numRef></c:val>` +
    (lineas ? '<c:smooth val="0"/>' : '') +
    `</c:ser>`
  );
}

function ejes(grafica: Grafica): string {
  const horizontal = grafica.tipo === 'barras';
  const escala = [
    `<c:orientation val="minMax"/>`,
    grafica.maximo === undefined ? '' : `<c:max val="${grafica.maximo}"/>`,
    grafica.minimo === undefined ? '' : `<c:min val="${grafica.minimo}"/>`,
  ].join('');
  const comun = (pos: string) =>
    `<c:delete val="0"/><c:axPos val="${pos}"/>` +
    (pos === (horizontal ? 'b' : 'l') ? '<c:majorGridlines/>' : '');
  return (
    `<c:catAx><c:axId val="${EJE_CATEGORIAS}"/>` +
    // En barras horizontales, el primero del ranking arriba.
    `<c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling>` +
    comun(horizontal ? 'l' : 'b') +
    `<c:numFmt formatCode="${escaparXml(grafica.formatoCategorias ?? 'General')}" ` +
    `sourceLinked="${grafica.formatoCategorias ? 0 : 1}"/><c:majorTickMark val="none"/>` +
    `<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${EJE_VALORES}"/><c:crosses val="autoZero"/><c:auto val="1"/>` +
    `<c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${EJE_VALORES}"/><c:scaling>${escala}</c:scaling>` +
    comun(horizontal ? 'b' : 'l') +
    `<c:numFmt formatCode="${escaparXml(grafica.formato ?? 'General')}" sourceLinked="0"/>` +
    `<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${EJE_CATEGORIAS}"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/>` +
    `<c:crossBetween val="between"/></c:valAx>`
  );
}

export function graficaXml(grafica: Grafica): string {
  const series = grafica.series.map((s, i) => serie(grafica, s, i)).join('');
  const ids = `<c:axId val="${EJE_CATEGORIAS}"/><c:axId val="${EJE_VALORES}"/>`;
  const trazo =
    grafica.tipo === 'lineas'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${ids}</c:lineChart>`
      : `<c:barChart><c:barDir val="${grafica.tipo === 'barras' ? 'bar' : 'col'}"/>` +
        `<c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="60"/>${ids}</c:barChart>`;
  const leyenda =
    grafica.series.length > 1
      ? '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>'
      : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${NS}>` +
    `<c:roundedCorners val="0"/><c:chart>` +
    `<c:title>${texto(grafica.titulo, 1200, true)}<c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${trazo}${ejes(grafica)}</c:plotArea>` +
    `${leyenda}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="es-MX"/></a:p></c:txPr>` +
    `</c:chartSpace>`
  );
}

const celdaAncla = (c: { col: number; fila: number }) =>
  `<xdr:col>${c.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.fila}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;

/** El dibujo de una hoja: dónde va cada gráfica. `rId1` es la primera gráfica. */
export function dibujoXml(graficas: readonly Grafica[]): string {
  const anclas = graficas
    .map((g, i) => {
      return (
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${celdaAncla(g.desde)}</xdr:from><xdr:to>${celdaAncla(g.hasta)}</xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr>` +
        `<xdr:cNvPr id="${i + 2}" name="${escaparXml(g.titulo)}" descr="${escaparXml(g.descripcion)}"/>` +
        `<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/>` +
        `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anclas}</xdr:wsDr>`
  );
}
