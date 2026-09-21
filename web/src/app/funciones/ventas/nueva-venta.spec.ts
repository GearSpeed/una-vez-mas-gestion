import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeEsMx from '@angular/common/locales/es-MX';
import { DEFAULT_CURRENCY_CODE, LOCALE_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ComisionPago, ExistenciasRespuesta, Permiso, Sesion } from '@uvm/compartido';
import { SesionService } from '../../core/sesion';
import { NuevaVenta } from './nueva-venta';

registerLocaleData(localeEsMx);

const ANA: Sesion = {
  id: 3,
  correo: 'ana@demo.local',
  nombre: 'Ana',
  roles: [],
  permisos: ['catalogo.ver', 'ventas.registrar'],
  ubicacion: { id: 2, nombre: 'Ana', tipo: 'vendedor' },
  modoDesarrollo: false,
};

const EXISTENCIAS: ExistenciasRespuesta = {
  ubicacion: ANA.ubicacion,
  filas: [
    {
      productoId: 10,
      slug: 'galletas-mermelada-tejocote',
      producto: 'Galletas de Mermelada de Tejocote',
      categoria: 'Galletas',
      presentacion: '6 pzas',
      precioVenta: '30.00',
      activo: true,
      cantidad: 3,
      stockMinimo: 0,
    },
    {
      productoId: 1,
      slug: 'galletas-avena',
      producto: 'Galletas de Avena',
      categoria: 'Galletas',
      presentacion: '6 pzas',
      precioVenta: null,
      activo: true,
      cantidad: 5,
      stockMinimo: 0,
    },
    {
      productoId: 3,
      slug: 'galletas-coco',
      producto: 'Galletas de Coco',
      categoria: 'Galletas',
      presentacion: '6 pzas',
      precioVenta: '28.00',
      activo: true,
      cantidad: 0,
      stockMinimo: 0,
    },
  ],
};

const TARIFAS: ComisionPago[] = [
  { metodoPago: 'tarjeta', tasa: '0.0350', iva: '0.1600', tasaEfectiva: '0.0406' },
];

/** Deja correr las promesas pendientes y los efectos (la recarga de existencias). */
async function asentar(): Promise<void> {
  await new Promise((listo) => setTimeout(listo, 0));
  TestBed.tick();
}

describe('NuevaVenta', () => {
  let fixture: ComponentFixture<NuevaVenta>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;

  beforeEach(async () => {
    const sesion = signal<Sesion | null>(ANA);
    await TestBed.configureTestingModule({
      imports: [NuevaVenta],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LOCALE_ID, useValue: 'es-MX' },
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'MXN' },
        {
          provide: SesionService,
          useValue: {
            sesion,
            puede: (...permisos: Permiso[]) => permisos.some((p) => ANA.permisos.includes(p)),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NuevaVenta);
    http = TestBed.inject(HttpTestingController);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
    http.expectOne('/api/comisiones').flush(TARIFAS);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const boton = (etiqueta: string) =>
    pantalla.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`) ?? undefined;

  it('solo ofrece lo que tiene precio y piezas', () => {
    const productos = [...pantalla.querySelectorAll('.producto .nombre')].map((e) =>
      e.textContent?.trim(),
    );
    expect(productos).toEqual(['Galletas de Mermelada de Tejocote']);
  });

  it('no deja agregar más de lo que trae', async () => {
    const agregar = boton('Agregar una pieza de Galletas de Mermelada de Tejocote');
    for (let i = 0; i < 3; i++) {
      agregar?.click();
      await fixture.whenStable();
    }
    expect(agregar?.disabled).toBe(true);
    expect(pantalla.querySelector('.total')?.textContent).toContain('$90.00');
  });

  it('con tarjeta avisa cuánto retiene Mercado Pago', async () => {
    const agregar = boton('Agregar una pieza de Galletas de Mermelada de Tejocote');
    agregar?.click();
    agregar?.click();
    await fixture.whenStable();
    expect(pantalla.querySelector('.comision')).toBeNull();

    const tarjeta = [
      ...pantalla.querySelectorAll<HTMLButtonElement>('mat-button-toggle button'),
    ].find((b) => b.textContent?.trim() === 'Tarjeta');
    tarjeta?.click();
    await fixture.whenStable();
    // $60 × 3.50 % = $2.10, más 16 % de IVA ($0.34): retiene $2.44 y llegan $57.56.
    const aviso = pantalla.querySelector('.comision')?.textContent ?? '';
    expect(aviso).toContain('$2.44');
    expect(aviso).toContain('4.06');
    expect(aviso).toContain('$57.56');
  });

  it('registra la venta con lo elegido y limpia el carrito', async () => {
    boton('Agregar una pieza de Galletas de Mermelada de Tejocote')?.click();
    boton('Agregar una pieza de Galletas de Mermelada de Tejocote')?.click();
    await fixture.whenStable();
    expect(pantalla.querySelector('.total')?.textContent).toContain('2 piezas');

    pantalla.querySelector<HTMLButtonElement>('button.registrar')?.click();
    const peticion = http.expectOne('/api/ventas');
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toMatchObject({
      canal: 'whatsapp',
      metodoPago: 'efectivo',
      ubicacionId: undefined,
      lineas: [{ productoId: 10, cantidad: 2, descuento: '0' }],
    });
    expect(peticion.request.body.claveIdempotencia).toMatch(/^[0-9a-f-]{36}$/);

    peticion.flush({ folio: 'V-000001', total: '60.00' });
    await asentar();
    // Después de vender se vuelve a leer la existencia y el carrito queda vacío.
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
    await fixture.whenStable();
    expect(pantalla.querySelector('.total')?.textContent).toContain('0 piezas');
  });

  it('si la API la rechaza, muestra el motivo', async () => {
    boton('Agregar una pieza de Galletas de Mermelada de Tejocote')?.click();
    await fixture.whenStable();
    pantalla.querySelector<HTMLButtonElement>('button.registrar')?.click();
    http
      .expectOne('/api/ventas')
      .flush(
        { mensaje: 'Solo hay 0 de Galletas de Mermelada de Tejocote en Ana.' },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar();
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
    await fixture.whenStable();

    expect(pantalla.querySelector('[role="alert"]')?.textContent).toContain('Solo hay 0');
  });
});
