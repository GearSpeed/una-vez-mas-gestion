import type { AnalisisVentas } from '@uvm/compartido';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { DatosDelLibro } from '../analisis.service.js';
import { libroDeAnalisis } from './libro-analisis.js';
import { escribirXlsx } from './xlsx.js';

/** Un periodo de 5 días con dos productos; nada de esto son datos reales. */
const ANALISIS: AnalisisVentas = {
  desde: '2026-10-04',
  hasta: '2026-10-08',
  primeraVenta: '2026-10-04',
  inicioEfectivo: '2026-10-04',
  dias: 5,
  piezas: 9,
  importe: '255.00',
  costos: { utilidad: '120.00' },
  productos: [
    {
      productoId: 10,
      producto: 'Galletas de Prueba',
      categoria: 'Galletas',
      inicial: 0,
      compradas: 7,
      vendidas: 7,
      importe: '210.00',
      existencia: 0,
      agotadoEn: '2026-10-08T09:13:50',
      costos: { utilidad: '100.00' },
    },
    {
      productoId: 11,
      producto: '*promo* =1+1',
      categoria: 'Alegrías',
      inicial: 0,
      compradas: 20,
      vendidas: 2,
      importe: '45.00',
      existencia: 18,
      agotadoEn: null,
      costos: { utilidad: '20.00' },
    },
  ],
  agotados: [
    {
      lugar: 1,
      productoId: 10,
      producto: 'Galletas de Prueba',
      categoria: 'Galletas',
      entroEl: '2026-10-03',
      agotadoEn: '2026-10-08T09:13:50',
      diasEnAgotarse: 5,
      piezasCompradas: 7,
      resurtido: false,
    },
  ],
  mensual: {
    periodos: ['2026-09-01', '2026-10-01'],
    filas: [
      { productoId: 10, producto: 'Galletas de Prueba', piezas: [0, 7], total: 7 },
      { productoId: 11, producto: '*promo* =1+1', piezas: [0, 2], total: 2 },
    ],
    totales: [0, 9],
  },
  anual: {
    periodos: ['2026-01-01'],
    filas: [
      { productoId: 10, producto: 'Galletas de Prueba', piezas: [7], total: 7 },
      { productoId: 11, producto: '*promo* =1+1', piezas: [2], total: 2 },
    ],
    totales: [9],
  },
  diario: {
    periodos: ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
    filas: [
      { productoId: 10, producto: 'Galletas de Prueba', piezas: [1, 3, 1, 1, 1], total: 7 },
      { productoId: 11, producto: '*promo* =1+1', piezas: [0, 2, 0, 0, 0], total: 2 },
    ],
    totales: [1, 5, 1, 1, 1],
  },
};

const DATOS: DatosDelLibro = {
  ventas: [
    {
      fecha: '2026-10-05',
      folio: 'V-000001',
      productoId: 10,
      producto: 'Galletas de Prueba',
      categoria: 'Galletas',
      piezas: 7,
      importe: '210.00',
      costos: { costo: '110.00', comision: '0.00' },
    },
  ],
  compras: [
    {
      fecha: '2026-10-03',
      folio: 'C-000001',
      productoId: 10,
      producto: 'Galletas de Prueba',
      categoria: 'Galletas',
      piezas: 7,
      costos: { costoUnitario: '15.714286' },
    },
  ],
};

const abrir = (analisis: AnalisisVentas, datos: DatosDelLibro = DATOS) =>
  Object.fromEntries(
    Object.entries(
      unzipSync(
        escribirXlsx(
          libroDeAnalisis(analisis, datos, { diasALlevar: 7, generado: '2026-10-09 a las 17:00' }),
        ),
      ),
    ).map(([ruta, b]) => [ruta, strFromU8(b)]),
  );

describe('libro del análisis de ventas', () => {
  it('trae las mismas hojas que el análisis de Inicio', () => {
    const libro = abrir(ANALISIS)['xl/workbook.xml'] ?? '';
    const hojas = [...libro.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(hojas).toEqual([
      'Resumen',
      'Orden de agotamiento',
      'Mensual',
      'Anual',
      'Diario',
      'Ventas',
      'Compras',
    ]);
    for (const nombre of ['Desde', 'Hasta', 'PrimeraVenta', 'DiasDelPeriodo', 'DiasALlevar']) {
      expect(libro).toContain(`<definedName name="${nombre}">`);
    }
  });

  it('el sugerido es fórmula, con el mismo resultado que calcula la app', () => {
    const resumen = abrir(ANALISIS)['xl/worksheets/sheet1.xml'] ?? '';
    // 7 vendidas en 5 días, para 7 días: ⌈9.8⌉ = 10, sin existencia.
    expect(resumen).toContain(
      '<f>IF(DiasDelPeriodo&lt;=0,0,MAX(0,ROUNDUP(G12*DiasALlevar/DiasDelPeriodo,0)-K12))</f><v>10</v>',
    );
    // 2 en 5 días para 7: ⌈2.8⌉ = 3, menos 18 en mano → 0.
    expect(resumen).toContain('-K13))</f><v>0</v>');
    expect(resumen).toContain('<f>Hasta-MAX(Desde,PrimeraVenta)+1</f><v>5</v>');
  });

  it('busca por Id y deja como texto un nombre con comodines o signo de igual', () => {
    const resumen = abrir(ANALISIS)['xl/worksheets/sheet1.xml'] ?? '';
    expect(resumen).toContain(
      `<f>SUMIFS(&apos;Ventas&apos;!$F$2:$F$2,&apos;Ventas&apos;!$C$2:$C$2,$B13,`,
    );
    expect(resumen).toContain('<t xml:space="preserve">*promo* =1+1</t>');
  });

  it('lleva las 8 gráficas, cada una con su texto alternativo', () => {
    const archivos = abrir(ANALISIS);
    const graficas = Object.keys(archivos).filter((r) => /^xl\/charts\/chart\d+\.xml$/.test(r));
    expect(graficas).toHaveLength(8);
    const dibujos = Object.entries(archivos)
      .filter(([r]) => r.startsWith('xl/drawings/drawing'))
      .map(([, xml]) => xml)
      .join('');
    expect(dibujos.match(/descr="[^"]+"/g)).toHaveLength(8);
  });

  it('sin permiso de costos no hay utilidad ni costos en ninguna hoja', () => {
    const { costos: _, ...sinCostos } = ANALISIS;
    const archivos = abrir(
      {
        ...sinCostos,
        productos: ANALISIS.productos.map(({ costos: __, ...p }) => p),
      },
      {
        ventas: DATOS.ventas.map(({ costos: _c, ...l }) => l),
        compras: DATOS.compras.map(({ costos: _c, ...l }) => l),
      },
    );
    const todo = Object.values(archivos).join('');
    expect(todo).not.toMatch(/Utilidad|Costo|Comisión/);
    // Y el sugerido se recorre de columna, pero sigue apuntando a Existencia.
    expect(archivos['xl/worksheets/sheet1.xml']).toContain('-J12))</f><v>10</v>');
  });

  it('sin ventas en el periodo, el libro sale igual y sin gráficas vacías', () => {
    const vacio: AnalisisVentas = {
      ...ANALISIS,
      piezas: 0,
      importe: '0.00',
      productos: [],
      agotados: [],
      mensual: { periodos: ['2026-10-01'], filas: [], totales: [0] },
      anual: { periodos: [], filas: [], totales: [] },
      diario: { periodos: ['2026-10-08'], filas: [], totales: [0] },
    };
    const archivos = abrir(vacio, { ventas: [], compras: [] });
    expect(Object.keys(archivos).some((r) => r.startsWith('xl/charts/'))).toBe(false);
    expect(archivos['xl/worksheets/sheet2.xml']).toContain('Ningún producto se agotó');
  });
});
