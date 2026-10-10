/**
 * Un escritor mínimo de .xlsx (SpreadsheetML): lo justo para el análisis de ventas.
 *
 * Por qué propio y no una librería: ninguna libre escribe gráficas nativas de Excel, y
 * meterlas a mano en el zip de otra obliga a adivinar sus ids y el orden de su XML.
 * Aquí el libro sale completo de una vez y el orden de cada elemento es el que exige
 * el estándar; si no, Excel ofrece «reparar» el archivo.
 *
 * El texto siempre va como cadena en línea (`inlineStr`): Excel nunca lo evalúa, así
 * que un nombre de producto que empiece con `=` se queda como texto.
 */
import { diasEntre } from '@uvm/compartido';
import { strToU8, zipSync } from 'fflate';
import { ESTILO, ESTILOS_XML, type Estilo } from './estilos.js';
import { dibujoXml, type Grafica, graficaXml } from './graficas.js';
import { escaparXml } from './texto.js';

export type Celda =
  | { readonly texto: string; readonly estilo?: Estilo }
  /** Decimal en texto ("17.55") o entero: va tal cual, sin pasar por punto flotante. */
  | { readonly numero: number | string; readonly estilo?: Estilo }
  /** AAAA-MM-DD */
  | { readonly fecha: string; readonly estilo?: Estilo }
  /** AAAA-MM-DDTHH:MM:SS */
  | { readonly fechaHora: string; readonly estilo?: Estilo }
  /** Sin el `=` inicial. `valor` es el resultado ya calculado, para quien no recalcula. */
  | { readonly formula: string; readonly valor?: number | string; readonly estilo?: Estilo };

export interface Validacion {
  /** `B8` */
  readonly ref: string;
  readonly minimo: number;
  readonly maximo: number;
  readonly mensaje: string;
}

export interface Hoja {
  /** Hasta 31 caracteres, sin `[]:*?/\`. */
  readonly nombre: string;
  /** Ancho de cada columna, en caracteres. */
  readonly anchos?: readonly number[];
  /** Filas desde la 1; una celda `undefined` queda vacía. */
  readonly filas: readonly (readonly (Celda | undefined)[] | undefined)[];
  /** Alto de algunas filas (número de fila → puntos). */
  readonly altos?: ReadonlyMap<number, number>;
  /** La primera celda que no se congela: `A2` fija la fila 1, `C5` fija 4 filas y 2 columnas. */
  readonly congelar?: string;
  /** Rangos combinados: `A1:H1`. */
  readonly combinar?: readonly string[];
  readonly validaciones?: readonly Validacion[];
  readonly graficas?: readonly Grafica[];
}

export interface Libro {
  readonly hojas: readonly Hoja[];
  /** Nombres definidos: `DiasALlevar` → `'Resumen'!$E$8`. */
  readonly nombres?: readonly { readonly nombre: string; readonly ref: string }[];
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CABECERA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A, B, …, Z, AA, AB… (desde 1). */
export function columna(n: number): string {
  let resto = n;
  let letras = '';
  while (resto > 0) {
    const m = (resto - 1) % 26;
    letras = String.fromCharCode(65 + m) + letras;
    resto = Math.floor((resto - 1) / 26);
  }
  return letras;
}

const celdaAbsoluta = (c: number, f: number) => `$${columna(c)}$${f}`;

/** Celda o rango con nombre de hoja: `'Resumen'!$B$7` o `'Resumen'!$B$7:$B$20`. */
export function ref(
  hoja: string,
  col: number,
  fila: number,
  hasta?: { readonly col: number; readonly fila: number },
): string {
  const rango = hasta
    ? `${celdaAbsoluta(col, fila)}:${celdaAbsoluta(hasta.col, hasta.fila)}`
    : celdaAbsoluta(col, fila);
  return `'${hoja.replaceAll("'", "''")}'!${rango}`;
}

/** Fecha AAAA-MM-DD como número de serie de Excel (días desde el 30/12/1899). */
export function serialDeFecha(fecha: string): number {
  return diasEntre('1899-12-30', fecha);
}

/** AAAA-MM-DDTHH:MM:SS como número de serie de Excel. */
export function serialDeFechaHora(fechaHora: string): number {
  const [h = 0, m = 0, s = 0] = fechaHora.slice(11).split(':').map(Number);
  return serialDeFecha(fechaHora.slice(0, 10)) + (h * 3600 + m * 60 + s) / 86_400;
}

function celdaXml(c: Celda, direccion: string): string {
  const atributos = (estilo: Estilo | undefined, extra = '') =>
    `r="${direccion}"${estilo ? ` s="${estilo}"` : ''}${extra}`;
  if ('texto' in c) {
    return `<c ${atributos(c.estilo, ' t="inlineStr"')}><is><t xml:space="preserve">${escaparXml(c.texto)}</t></is></c>`;
  }
  if ('numero' in c) return `<c ${atributos(c.estilo)}><v>${c.numero}</v></c>`;
  if ('fecha' in c) {
    return `<c ${atributos(c.estilo ?? ESTILO.fecha)}><v>${serialDeFecha(c.fecha)}</v></c>`;
  }
  if ('fechaHora' in c) {
    return `<c ${atributos(c.estilo ?? ESTILO.fechaHora)}><v>${serialDeFechaHora(c.fechaHora)}</v></c>`;
  }
  const esTexto = typeof c.valor === 'string' && !/^-?\d+(\.\d+)?$/.test(c.valor);
  const valor = c.valor === undefined ? '' : `<v>${esTexto ? escaparXml(c.valor) : c.valor}</v>`;
  return `<c ${atributos(c.estilo, esTexto ? ' t="str"' : '')}><f>${escaparXml(c.formula)}</f>${valor}</c>`;
}

function congelarXml(celda: string): string {
  const [, letras = 'A', numero = '1'] = /^([A-Z]+)(\d+)$/.exec(celda) ?? [];
  let col = 0;
  for (const letra of letras) col = col * 26 + letra.charCodeAt(0) - 64;
  const xSplit = col - 1;
  const ySplit = Number(numero) - 1;
  const panel = xSplit > 0 && ySplit > 0 ? 'bottomRight' : xSplit > 0 ? 'topRight' : 'bottomLeft';
  return (
    `<pane${xSplit > 0 ? ` xSplit="${xSplit}"` : ''}${ySplit > 0 ? ` ySplit="${ySplit}"` : ''} ` +
    `topLeftCell="${celda}" activePane="${panel}" state="frozen"/>` +
    `<selection pane="${panel}" activeCell="${celda}" sqref="${celda}"/>`
  );
}

function hojaXml(hoja: Hoja, primera: boolean): string {
  const vista =
    `<sheetViews><sheetView${primera ? ' tabSelected="1"' : ''} workbookViewId="0">` +
    (hoja.congelar ? congelarXml(hoja.congelar) : '') +
    `</sheetView></sheetViews>`;
  const columnas = hoja.anchos?.length
    ? `<cols>${hoja.anchos
        .map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const filas = hoja.filas
    .map((fila, i) => {
      const numero = i + 1;
      const alto = hoja.altos?.get(numero);
      const celdas = (fila ?? [])
        .map((c, j) => (c ? celdaXml(c, `${columna(j + 1)}${numero}`) : ''))
        .join('');
      if (!celdas && alto === undefined) return '';
      return `<row r="${numero}"${alto === undefined ? '' : ` ht="${alto}" customHeight="1"`}>${celdas}</row>`;
    })
    .join('');
  const combinadas = hoja.combinar?.length
    ? `<mergeCells count="${hoja.combinar.length}">${hoja.combinar
        .map((r) => `<mergeCell ref="${r}"/>`)
        .join('')}</mergeCells>`
    : '';
  const validaciones = hoja.validaciones?.length
    ? `<dataValidations count="${hoja.validaciones.length}">${hoja.validaciones
        .map(
          (v) =>
            `<dataValidation type="whole" operator="between" allowBlank="0" showInputMessage="1" ` +
            `showErrorMessage="1" errorTitle="Valor fuera de rango" error="${escaparXml(v.mensaje)}" ` +
            `promptTitle="Escribe aquí" prompt="${escaparXml(v.mensaje)}" sqref="${v.ref}">` +
            `<formula1>${v.minimo}</formula1><formula2>${v.maximo}</formula2></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : '';
  const dibujo = hoja.graficas?.length ? '<drawing r:id="rId1"/>' : '';
  return (
    `${CABECERA}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
    `${vista}<sheetFormatPr defaultRowHeight="15"/>${columnas}<sheetData>${filas}</sheetData>` +
    `${combinadas}${validaciones}` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `${dibujo}</worksheet>`
  );
}

function relaciones(lista: readonly { id: string; tipo: string; destino: string }[]): string {
  return (
    `${CABECERA}<Relationships xmlns="${PKG_REL}">` +
    lista
      .map((r) => `<Relationship Id="${r.id}" Type="${r.tipo}" Target="${r.destino}"/>`)
      .join('') +
    `</Relationships>`
  );
}

const NOMBRE_INVALIDO = /[[\]:*?/\\]/;

/** El libro completo como bytes de un .xlsx. */
export function escribirXlsx(libro: Libro, creadoEn = new Date()): Uint8Array {
  for (const hoja of libro.hojas) {
    if (hoja.nombre.length > 31 || NOMBRE_INVALIDO.test(hoja.nombre)) {
      throw new Error(`Nombre de hoja inválido para Excel: ${hoja.nombre}`);
    }
  }
  const archivos: Record<string, Uint8Array> = {};
  const poner = (ruta: string, contenido: string) => {
    archivos[ruta] = strToU8(contenido);
  };
  const tipos: string[] = [];

  let numeroDeGrafica = 0;
  let numeroDeDibujo = 0;
  libro.hojas.forEach((hoja, i) => {
    const n = i + 1;
    poner(`xl/worksheets/sheet${n}.xml`, hojaXml(hoja, i === 0));
    tipos.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    if (!hoja.graficas?.length) return;

    numeroDeDibujo += 1;
    const dibujo = numeroDeDibujo;
    poner(
      `xl/worksheets/_rels/sheet${n}.xml.rels`,
      relaciones([
        { id: 'rId1', tipo: `${REL}/drawing`, destino: `../drawings/drawing${dibujo}.xml` },
      ]),
    );
    poner(`xl/drawings/drawing${dibujo}.xml`, dibujoXml(hoja.graficas));
    tipos.push(
      `<Override PartName="/xl/drawings/drawing${dibujo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );
    const deGraficas = hoja.graficas.map((grafica, j) => {
      numeroDeGrafica += 1;
      poner(`xl/charts/chart${numeroDeGrafica}.xml`, graficaXml(grafica));
      tipos.push(
        `<Override PartName="/xl/charts/chart${numeroDeGrafica}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      );
      return {
        id: `rId${j + 1}`,
        tipo: `${REL}/chart`,
        destino: `../charts/chart${numeroDeGrafica}.xml`,
      };
    });
    poner(`xl/drawings/_rels/drawing${dibujo}.xml.rels`, relaciones(deGraficas));
  });

  const nombres = libro.nombres?.length
    ? `<definedNames>${libro.nombres
        .map((n) => `<definedName name="${n.nombre}">${escaparXml(n.ref)}</definedName>`)
        .join('')}</definedNames>`
    : '';
  poner(
    'xl/workbook.xml',
    `${CABECERA}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews>` +
      `<sheets>${libro.hojas
        .map(
          (h, i) => `<sheet name="${escaparXml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('')}</sheets>${nombres}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  poner(
    'xl/_rels/workbook.xml.rels',
    relaciones([
      ...libro.hojas.map((_, i) => ({
        id: `rId${i + 1}`,
        tipo: `${REL}/worksheet`,
        destino: `worksheets/sheet${i + 1}.xml`,
      })),
      { id: `rId${libro.hojas.length + 1}`, tipo: `${REL}/styles`, destino: 'styles.xml' },
    ]),
  );
  poner('xl/styles.xml', ESTILOS_XML);
  poner(
    '_rels/.rels',
    relaciones([
      { id: 'rId1', tipo: `${REL}/officeDocument`, destino: 'xl/workbook.xml' },
      { id: 'rId2', tipo: `${PKG_REL}/metadata/core-properties`, destino: 'docProps/core.xml' },
      { id: 'rId3', tipo: `${REL}/extended-properties`, destino: 'docProps/app.xml' },
    ]),
  );
  const fecha = creadoEn.toISOString().replace(/\.\d{3}Z$/, 'Z');
  poner(
    'docProps/core.xml',
    `${CABECERA}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:creator>Una vez más</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${fecha}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${fecha}</dcterms:modified></cp:coreProperties>`,
  );
  poner(
    'docProps/app.xml',
    `${CABECERA}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
      `<Application>Una vez más</Application></Properties>`,
  );
  poner(
    '[Content_Types].xml',
    `${CABECERA}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `${tipos.join('')}</Types>`,
  );
  return zipSync(archivos, { level: 6 });
}
