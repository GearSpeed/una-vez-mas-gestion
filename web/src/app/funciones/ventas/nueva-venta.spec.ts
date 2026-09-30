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
      categoriaId: 1,
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
      categoriaId: 1,
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
      categoriaId: 1,
      presentacion: '6 pzas',
      precioVenta: '28.00',
      activo: true,
      cantidad: 0,
      stockMinimo: 0,
    },
    {
      productoId: 4,
      slug: 'galletas-nuez',
      producto: 'Galletas de Nuez',
      categoria: 'Galletas',
      categoriaId: 1,
      presentacion: '6 pzas',
      precioVenta: '30.00',
      activo: true,
      cantidad: 10,
      stockMinimo: 0,
    },
  ],
};

const TARIFAS: ComisionPago[] = [
  { metodoPago: 'tarjeta', tasa: '0.0350', iva: '0.1600', tasaEfectiva: '0.0406' },
];

/** Deja correr las promesas pendientes y los efectos (la recarga de existencias). */
/** Galletas con los escalones capturados: 5 % desde 6 piezas y 10 % desde 11. */
const CATEGORIAS = [
  {
    id: 1,
    nombre: 'Galletas',
    orden: 1,
    activa: true,
    titulo: '',
    insignia: '',
    insigniaIcono: '',
    descripcion: '',
    cta: '',
    imagen: null,
    imagenAlt: '',
    saleEnPortada: false,
    descuentoDesde1: 6,
    descuentoTasa1: '0.0500',
    descuentoDesde2: 11,
    descuentoTasa2: '0.1000',
  },
];

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
    http.expectOne('/api/categorias').flush(CATEGORIAS);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const boton = (etiqueta: string) =>
    pantalla.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`) ?? undefined;

  it('solo ofrece lo que tiene precio y piezas', () => {
    const productos = [...pantalla.querySelectorAll('.producto .nombre')].map((e) =>
      e.textContent?.trim(),
    );
    expect(productos).toEqual(['Galletas de Mermelada de Tejocote', 'Galletas de Nuez']);
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

  it('el descuento por volumen entra solo, sumando las piezas de la categoría', async () => {
    // Tres de tejocote y tres de nuez son seis galletas: ninguno llega a seis por su
    // cuenta, y aun así entra el 5 % en las dos líneas.
    const tejocote = boton('Agregar una pieza de Galletas de Mermelada de Tejocote');
    const nuez = boton('Agregar una pieza de Galletas de Nuez');
    for (let i = 0; i < 3; i++) {
      tejocote?.click();
      await fixture.whenStable();
    }
    // Con cinco piezas todavía no hay descuento.
    nuez?.click();
    nuez?.click();
    await fixture.whenStable();
    expect(pantalla.textContent).not.toContain('por volumen');

    nuez?.click();
    await fixture.whenStable();
    const avisos = [...pantalla.querySelectorAll('tbody .estado')].map((e) =>
      e.textContent?.trim(),
    );
    expect(avisos).toEqual(['−$4.50 por volumen', '−$4.50 por volumen']);

    // Y el total dice de dónde sale: sin eso, un precio más bajo del esperado se lee
    // como un error de la aplicación.
    const desglose = [...pantalla.querySelectorAll('.desglose dt, .desglose dd')].map((e) =>
      e.textContent?.trim(),
    );
    expect(desglose).toEqual(['Venta', '$180.00', 'Descuento (5%)', '−$9.00']);
    expect(pantalla.querySelector('.total')?.textContent).toContain('$171.00');

    // Y lo que se cobra ya viene con el descuento: 180 − 9 = 171.
    pantalla.querySelector<HTMLButtonElement>('button.registrar')?.click();
    const peticion = http.expectOne('/api/ventas');
    expect(peticion.request.body.pagos).toEqual([{ metodoPago: 'efectivo', importe: '171.00' }]);
    peticion.flush({ folio: 'V-000003', total: '171.00' });
    await asentar();
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
    await fixture.whenStable();
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
      pagos: [{ metodoPago: 'efectivo', importe: '60.00' }],
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

  it('divide el cobro entre dos formas de pago y no deja registrar hasta que cuadre', async () => {
    boton('Agregar una pieza de Galletas de Mermelada de Tejocote')?.click();
    boton('Agregar una pieza de Galletas de Mermelada de Tejocote')?.click();
    await fixture.whenStable();

    const dividir = [...pantalla.querySelectorAll<HTMLButtonElement>('button.dividir')][0];
    dividir?.click();
    await fixture.whenStable();
    // Arranca con todo en efectivo: ya cuadra.
    expect(pantalla.querySelector('.falta')?.textContent).toContain('cuadra');

    const importe = (etiqueta: string) =>
      [...pantalla.querySelectorAll<HTMLElement>('.reparto mat-form-field')]
        .find((campo) => campo.textContent?.includes(etiqueta))
        ?.querySelector('input');
    const efectivo = importe('Efectivo');
    efectivo!.value = '40';
    efectivo!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // Faltan $20 y el botón no deja registrar.
    expect(pantalla.querySelector('.falta')?.textContent).toContain('$20.00');
    expect(pantalla.querySelector<HTMLButtonElement>('button.registrar')?.disabled).toBe(true);

    const tarjeta = importe('Tarjeta');
    tarjeta!.value = '20';
    tarjeta!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(pantalla.querySelector('.falta')?.textContent).toContain('cuadra');
    // La comisión se cobra solo sobre los $20 de la tarjeta: $0.70 + IVA = $0.81.
    expect(pantalla.querySelector('.comision')?.textContent).toContain('$0.81');

    pantalla.querySelector<HTMLButtonElement>('button.registrar')?.click();
    const peticion = http.expectOne('/api/ventas');
    expect(peticion.request.body.pagos).toEqual([
      { metodoPago: 'efectivo', importe: '40.00' },
      { metodoPago: 'tarjeta', importe: '20.00' },
    ]);
    peticion.flush({ folio: 'V-000002', total: '60.00' });
    await asentar();
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
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
