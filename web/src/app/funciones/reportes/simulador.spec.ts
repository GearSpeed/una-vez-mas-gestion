import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeEsMx from '@angular/common/locales/es-MX';
import { DEFAULT_CURRENCY_CODE, LOCALE_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { ComisionPago, ExistenciasRespuesta, Permiso, Usuario } from '@uvm/compartido';
import { SesionService } from '../../core/sesion';
import { Simulador } from './simulador';

registerLocaleData(localeEsMx);

const EXISTENCIAS: ExistenciasRespuesta = {
  ubicacion: null,
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
      costos: { costoPromedio: '17.00', valor: '51.00' },
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
      costos: { costoPromedio: '17.00', valor: '170.00' },
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
      costos: { costoPromedio: '15.00', valor: '75.00' },
    },
  ],
};

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

const TARIFAS: ComisionPago[] = [
  { metodoPago: 'tarjeta', tasa: '0.0350', iva: '0.1600', tasaEfectiva: '0.0406' },
];

const USUARIOS: Usuario[] = [
  {
    id: 15,
    correo: 'omar.ventas@demo.local',
    nombre: 'Omar Ventas',
    activo: true,
    roles: ['vendedor'],
    ubicacion: null,
    comisionVenta: '0.1500',
    ultimoAcceso: null,
  },
  {
    id: 16,
    correo: 'beto.baja@demo.local',
    nombre: 'Beto de Baja',
    activo: false,
    roles: ['vendedor'],
    ubicacion: null,
    comisionVenta: '0.1000',
    ultimoAcceso: null,
  },
];

describe('Simulador', () => {
  let fixture: ComponentFixture<Simulador>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Simulador],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LOCALE_ID, useValue: 'es-MX' },
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'MXN' },
        {
          provide: SesionService,
          useValue: {
            sesion: signal(null),
            puede: (...permisos: Permiso[]) => permisos.includes('usuarios.gestionar'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Simulador);
    http = TestBed.inject(HttpTestingController);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    http.expectOne('/api/inventario/existencias').flush(EXISTENCIAS);
    http.expectOne('/api/categorias').flush(CATEGORIAS);
    http.expectOne('/api/usuarios').flush(USUARIOS);
    http.expectOne('/api/comisiones').flush(TARIFAS);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('solo ofrece lo que tiene precio', () => {
    // El nombre es el primer nodo de texto del <th>; la categoría va en un <span> aparte.
    const nombres = [...pantalla.querySelectorAll('tbody th')].map((e) =>
      e.childNodes[0]?.textContent?.trim(),
    );
    expect(nombres).toEqual(['Galletas de Mermelada de Tejocote', 'Galletas de Nuez']);
  });

  it('sin cantidades no hay desglose todavía', () => {
    expect(pantalla.querySelector('.resultado')).toBeNull();
    expect(pantalla.textContent).toContain('Agrega piezas');
  });

  const campoCantidad = (producto: string) =>
    pantalla.querySelector<HTMLInputElement>(`input[aria-label="Piezas a simular de ${producto}"]`);

  const escribirCantidad = (producto: string, cantidad: number) => {
    const input = campoCantidad(producto);
    input!.value = String(cantidad);
    input!.dispatchEvent(new Event('input'));
  };

  const boton = (texto: string) =>
    [...pantalla.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === texto,
    );

  it('«Usar mi inventario actual» llena cada cantidad con la existencia', async () => {
    boton('Usar mi inventario actual')?.click();
    await fixture.whenStable();

    expect(campoCantidad('Galletas de Mermelada de Tejocote')?.value).toBe('3');
    expect(campoCantidad('Galletas de Nuez')?.value).toBe('10');
    expect(pantalla.querySelector('.resultado')?.textContent).toContain('13'); // 3 + 10 piezas

    boton('Vaciar')?.click();
    await fixture.whenStable();
    expect(pantalla.querySelector('.resultado')).toBeNull();
  });

  it('el descuento por volumen entra solo, sumando las piezas de la categoría', async () => {
    escribirCantidad('Galletas de Mermelada de Tejocote', 3);
    escribirCantidad('Galletas de Nuez', 3);
    await fixture.whenStable();
    // Seis galletas entre las dos líneas: entra el 5 %.
    const resultado = pantalla.querySelector('.resultado')?.textContent ?? '';
    expect(resultado).toContain('Descuento por volumen');
    expect(resultado).toContain('−$9.00'); // 5 % de $180.00
    expect(resultado).toContain('$171.00'); // venta neta
  });

  it('sin vendedor elegido ni tasa escrita, la comisión es cero', async () => {
    escribirCantidad('Galletas de Mermelada de Tejocote', 1);
    await fixture.whenStable();
    expect(pantalla.querySelector('.resultado')?.textContent).toContain('−$0.00');
  });

  // Elegir un vendedor del selector (overlay de Material) se cubre en el e2e, que corre
  // en un navegador real: aquí no hay un patrón confiable para accionar un mat-select.
  it('la tasa escrita a mano calcula la comisión', async () => {
    escribirCantidad('Galletas de Mermelada de Tejocote', 1);
    await fixture.whenStable();
    const manual = pantalla.querySelector<HTMLInputElement>('input[type="number"][max="100"]');
    manual!.value = '20';
    manual!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // Sobre la utilidad, no sobre la venta: ($30.00 − $17.00 de costo) × 20 % = $2.60.
    expect(pantalla.querySelector('.resultado')?.textContent).toContain('−$2.60');
  });
});
