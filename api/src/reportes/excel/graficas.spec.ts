import { describe, expect, it } from 'vitest';
import { type Grafica, graficaXml } from './graficas.js';

const base: Grafica = {
  tipo: 'barras',
  titulo: 'Piezas vendidas por producto',
  descripcion: 'Piezas por producto',
  categorias: { ref: "'Resumen'!$C$12:$C$14", datos: ['Tejocote', 'Fresa & crema', 'Avena'] },
  series: [{ nombre: 'Vendidas', ref: "'Resumen'!$G$12:$G$14", datos: [7, 7, null] }],
  etiquetas: true,
  formato: '#,##0',
  desde: { col: 15, fila: 2 },
  hasta: { col: 23, fila: 20 },
};

describe('gráficas de Excel', () => {
  it('las barras horizontales ponen el primero del ranking arriba', () => {
    const xml = graficaXml(base);
    expect(xml).toContain('<c:barDir val="bar"/>');
    expect(xml).toContain('<c:scaling><c:orientation val="maxMin"/></c:scaling>');
  });

  it('referencia sus celdas y guarda una copia de los valores', () => {
    const xml = graficaXml(base);
    expect(xml).toContain('<c:f>&apos;Resumen&apos;!$G$12:$G$14</c:f>');
    expect(xml).toContain('<c:ptCount val="3"/><c:pt idx="0"><c:v>7</c:v></c:pt>');
    // Un valor que falta queda como hueco, no como cero.
    expect(xml).toContain('<c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache>');
    expect(xml).toContain('<c:v>Fresa &amp; crema</c:v>');
    expect(xml).toContain('<c:showVal val="1"/>');
  });

  it('las líneas distinguen cada serie también por trazo y marcador, y llevan leyenda', () => {
    const xml = graficaXml({
      ...base,
      tipo: 'lineas',
      series: [...base.series, ...base.series.map((s) => ({ ...s, nombre: 'Otra' }))],
    });
    expect(xml).toContain('<c:lineChart>');
    expect(xml).toContain('<a:prstDash val="solid"/>');
    expect(xml).toContain('<a:prstDash val="dash"/>');
    expect(xml).toContain('<c:symbol val="square"/>');
    expect(xml).toContain('<c:legend>');
    expect(xml).toContain('<c:smooth val="0"/>');
  });

  it('las columnas van verticales y sin leyenda si hay una sola serie', () => {
    const xml = graficaXml({ ...base, tipo: 'columnas' });
    expect(xml).toContain('<c:barDir val="col"/>');
    expect(xml).not.toContain('<c:legend>');
  });
});
