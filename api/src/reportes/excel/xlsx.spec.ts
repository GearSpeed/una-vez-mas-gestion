import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ESTILO } from './estilos.js';
import { escaparXml } from './texto.js';
import { columna, escribirXlsx, ref, serialDeFecha, serialDeFechaHora } from './xlsx.js';

const abrir = (bytes: Uint8Array) =>
  Object.fromEntries(Object.entries(unzipSync(bytes)).map(([ruta, b]) => [ruta, strFromU8(b)]));

describe('escritor de xlsx', () => {
  it('nombra las columnas como Excel', () => {
    expect([1, 26, 27, 52, 703].map(columna)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
  });

  it('cita el nombre de la hoja en las referencias', () => {
    expect(ref('Orden de agotamiento', 2, 5)).toBe("'Orden de agotamiento'!$B$5");
    expect(ref("D'Ami", 1, 2, { col: 3, fila: 9 })).toBe("'D''Ami'!$A$2:$C$9");
  });

  it('convierte fechas al número de serie de Excel', () => {
    expect(serialDeFecha('1900-03-01')).toBe(61);
    expect(serialDeFecha('2026-10-04')).toBe(46_299);
    expect(serialDeFechaHora('2026-10-04T18:00:00')).toBe(46_299.75);
  });

  it('escapa el XML y quita los caracteres que lo romperían', () => {
    expect(escaparXml('A & B <c> "d" \'e\'\u0007')).toBe(
      'A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;',
    );
  });

  it('arma un paquete completo, con el texto siempre como texto', () => {
    const archivos = abrir(
      escribirXlsx({
        hojas: [
          {
            nombre: 'Resumen',
            congelar: 'A2',
            filas: [
              [{ texto: '=HYPERLINK("x")' }, { numero: '17.909375', estilo: ESTILO.moneda }],
              [
                { formula: 'B1*2', valor: '35.82' },
                { formula: 'IF(B1>0,"sí","no")', valor: 'sí' },
              ],
            ],
            validaciones: [{ ref: 'B1', minimo: 1, maximo: 90, mensaje: 'De 1 a 90' }],
          },
        ],
        nombres: [{ nombre: 'Precio', ref: ref('Resumen', 2, 1) }],
      }),
    );
    const hoja = archivos['xl/worksheets/sheet1.xml'] ?? '';
    expect(hoja).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t></is></c>',
    );
    // El decimal va tal cual: sin pasar por punto flotante.
    expect(hoja).toContain(`<c r="B1" s="${ESTILO.moneda}"><v>17.909375</v></c>`);
    expect(hoja).toContain('<c r="A2"><f>B1*2</f><v>35.82</v></c>');
    expect(hoja).toContain(
      '<c r="B2" t="str"><f>IF(B1&gt;0,&quot;sí&quot;,&quot;no&quot;)</f><v>sí</v></c>',
    );
    expect(hoja).toContain('state="frozen"');
    // El orden que exige el estándar; si no, Excel ofrece «reparar».
    const orden = ['<sheetViews>', '<sheetData>', '<dataValidations', '<pageMargins'].map((e) =>
      hoja.indexOf(e),
    );
    expect(orden).toEqual(orden.toSorted((a, b) => a - b));
    expect(archivos['xl/workbook.xml']).toContain(
      '<definedName name="Precio">&apos;Resumen&apos;!$B$1</definedName>',
    );
    expect(archivos['xl/workbook.xml']).toContain('fullCalcOnLoad="1"');
    expect(Object.keys(archivos)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'docProps/core.xml',
      ]),
    );
  });

  it('liga cada gráfica a su dibujo y a su hoja', () => {
    const grafica = {
      tipo: 'barras' as const,
      titulo: 'Piezas',
      descripcion: 'Piezas por producto',
      categorias: { ref: ref('Resumen', 1, 1, { col: 1, fila: 2 }), datos: ['A', 'B'] },
      series: [{ nombre: 'Piezas', ref: ref('Resumen', 2, 1, { col: 2, fila: 2 }), datos: [3, 4] }],
      desde: { col: 4, fila: 0 },
      hasta: { col: 10, fila: 12 },
    };
    const archivos = abrir(
      escribirXlsx({
        hojas: [
          { nombre: 'Sin gráficas', filas: [] },
          { nombre: 'Resumen', filas: [], graficas: [grafica, { ...grafica, tipo: 'lineas' }] },
        ],
      }),
    );
    expect(archivos['xl/worksheets/sheet2.xml']).toContain('<drawing r:id="rId1"/>');
    expect(archivos['xl/worksheets/_rels/sheet2.xml.rels']).toContain('../drawings/drawing1.xml');
    expect(archivos['xl/drawings/_rels/drawing1.xml.rels']).toContain('../charts/chart2.xml');
    expect(archivos['xl/drawings/drawing1.xml']).toContain('descr="Piezas por producto"');
    expect(archivos['[Content_Types].xml']).toContain('/xl/charts/chart2.xml');
    expect(archivos['xl/worksheets/sheet1.xml']).not.toContain('<drawing');
  });

  it('rechaza un nombre de hoja que Excel no acepta', () => {
    expect(() => escribirXlsx({ hojas: [{ nombre: 'Ventas/Compras', filas: [] }] })).toThrow(
      /Nombre de hoja/,
    );
  });
});
