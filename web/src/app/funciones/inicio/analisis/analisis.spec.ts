import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeEsMx from '@angular/common/locales/es-MX';
import { DEFAULT_CURRENCY_CODE, LOCALE_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type AnalisisVentas, fechaDeHoy, sumarDias } from '@uvm/compartido';
import { DescargasService } from '../../../core/descargas';
import { AnalisisVentasSeccion } from './analisis';

registerLocaleData(localeEsMx);

/** 7 vendidas en 5 días y 2 en mano; datos de prueba, no reales. */
const ANALISIS: AnalisisVentas = {
  desde: '2026-09-10',
  hasta: '2026-10-09',
  primeraVenta: '2026-10-05',
  inicioEfectivo: '2026-10-05',
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
      producto: 'Alegrías de Prueba',
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
    periodos: ['2026-10-01'],
    filas: [{ productoId: 10, producto: 'Galletas de Prueba', piezas: [7], total: 7 }],
    totales: [7],
  },
  anual: {
    periodos: ['2026-01-01'],
    filas: [{ productoId: 10, producto: 'Galletas de Prueba', piezas: [7], total: 7 }],
    totales: [7],
  },
  diario: {
    periodos: ['2026-10-08', '2026-10-09'],
    filas: [{ productoId: 10, producto: 'Galletas de Prueba', piezas: [3, 4], total: 7 }],
    totales: [3, 4],
  },
};

describe('AnalisisVentasSeccion', () => {
  let fixture: ComponentFixture<AnalisisVentasSeccion>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;
  const descargar = vi.fn(() => Promise.resolve());

  const hoy = fechaDeHoy();
  const urlDe = (desde: string) => `/api/reportes/analisis?desde=${desde}&hasta=${hoy}`;

  async function cargar(analisis: AnalisisVentas): Promise<void> {
    http.expectOne(urlDe(sumarDias(hoy, -29))).flush(analisis);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** La columna «Sugerido llevar» de cada producto, en orden. */
  const sugeridos = () =>
    [...pantalla.querySelectorAll('.tabla-simple tbody tr')].map((fila) =>
      fila.querySelector('td.sugerido')?.textContent?.trim(),
    );

  beforeEach(async () => {
    descargar.mockClear();
    await TestBed.configureTestingModule({
      imports: [AnalisisVentasSeccion],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LOCALE_ID, useValue: 'es-MX' },
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'MXN' },
        { provide: DescargasService, useValue: { descargar } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AnalisisVentasSeccion);
    http = TestBed.inject(HttpTestingController);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('pide los últimos 30 días y arma el resumen con sus pestañas', async () => {
    await cargar(ANALISIS);
    const pestanas = [...pantalla.querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent?.trim(),
    );
    expect(pestanas).toEqual(['Resumen', 'Orden de agotamiento', 'Por mes', 'Por año', 'Por día']);
    expect(pantalla.textContent).toContain('Utilidad bruta');
    expect(pantalla.textContent).toMatch(/Se agotó el\s+8 oct/);
    // 7 en 5 días para 7 días: ⌈9.8⌉ = 10; 2 en 5 días: ⌈2.8⌉ = 3, con 18 en mano no hace falta.
    expect(sugeridos()).toEqual(['10', '0']);
  });

  it('el sugerido cambia con los días a surtir, sin volver a pedir nada', async () => {
    await cargar(ANALISIS);
    const dias = pantalla.querySelector<HTMLInputElement>('input[type="number"]');
    if (!dias) throw new Error('Falta el campo de días');
    dias.value = '14';
    dias.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // 7 × 14 ÷ 5 = 19.6 → 20.
    expect(sugeridos()).toEqual(['20', '0']);
    // Un valor fuera de rango no lo mueve.
    dias.value = '0';
    dias.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(sugeridos()).toEqual(['20', '0']);
  });

  it('sin permiso de costos no muestra la utilidad', async () => {
    const { costos: _, ...sinCostos } = ANALISIS;
    await cargar({
      ...sinCostos,
      productos: ANALISIS.productos.map(({ costos: __, ...p }) => p),
    });
    expect(pantalla.textContent).not.toMatch(/Utilidad/);
  });

  it('sin ventas lo dice y no ofrece el Excel', async () => {
    await cargar({ ...ANALISIS, productos: [], agotados: [] });
    expect(pantalla.textContent).toContain('Todavía no hay ventas');
    expect(pantalla.textContent).not.toContain('Descargar Excel');
  });

  it('descarga el Excel del mismo periodo y con los días a surtir', async () => {
    await cargar(ANALISIS);
    const boton = [...pantalla.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Descargar Excel'),
    );
    boton?.click();
    await fixture.whenStable();
    const desde = sumarDias(hoy, -29);
    expect(descargar).toHaveBeenCalledWith(
      `/api/reportes/analisis/excel?desde=${desde}&hasta=${hoy}&diasALlevar=7`,
      `analisis-ventas-${desde}-a-${hoy}.xlsx`,
    );
  });
});
