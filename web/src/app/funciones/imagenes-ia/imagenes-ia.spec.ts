import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeEsMx from '@angular/common/locales/es-MX';
import { LOCALE_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { EstadoImagenesIa, ImagenGenerada, ReferenciaImagen } from '@uvm/compartido';
import { ImagenesIa, INTERVALO_CONSULTA } from './imagenes-ia';

registerLocaleData(localeEsMx);

const REFERENCIA: ReferenciaImagen = {
  id: 1,
  nombre: 'Mesa de madera',
  prompt: 'Sobre una mesa de madera clara, luz cálida.',
  actualizadoEn: '2026-10-10T12:00:00.000Z',
};

const generacion = (cambios: Partial<ImagenGenerada> = {}): ImagenGenerada => ({
  id: 7,
  referenciaId: 1,
  referencia: 'Mesa de madera',
  promptExtra: '',
  calidad: 'media',
  estado: 'generando',
  error: null,
  producto: null,
  creadoEn: '2026-10-10T12:00:00.000Z',
  terminadoEn: null,
  ...cambios,
});

describe('ImagenesIa', () => {
  let fixture: ComponentFixture<ImagenesIa>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;

  async function cargar(estado: EstadoImagenesIa, referencias = [REFERENCIA]): Promise<void> {
    fixture = TestBed.createComponent(ImagenesIa);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/imagenes-ia/estado').flush(estado);
    http.expectOne('/api/imagenes-ia/referencias').flush(referencias);
    http.expectOne('/api/imagenes-ia/generaciones').flush([]);
    await asentar();
  }

  /**
   * Deja correr las promesas y pinta. Sin `whenStable`: espera a todas las peticiones,
   * y las de las imágenes (que piden las miniaturas) se contestan aquí mismo.
   */
  async function asentar(): Promise<void> {
    await new Promise((listo) => setTimeout(listo, 0));
    TestBed.tick();
    soltarImagenes();
    fixture.detectChanges();
  }

  /** Las imágenes se piden aparte (con sesión); aquí no importan. */
  const soltarImagenes = () => {
    for (const peticion of http.match((r) => /\/(imagen|foto)$/.test(r.url))) {
      peticion.flush(new Blob(['x'], { type: 'image/png' }));
    }
  };

  const boton = (texto: string) =>
    [...pantalla.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(texto),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImagenesIa],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LOCALE_ID, useValue: 'es-MX' },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    soltarImagenes();
    http.verify();
    vi.useRealTimers();
  });

  it('sin créditos lo avisa arriba, con desde cuándo y a dónde ir', async () => {
    await cargar({ configurado: true, sinCreditosDesde: '2026-10-10T18:30:00.000Z' });
    const aviso = pantalla.querySelector('[role="alert"]');
    expect(aviso?.textContent).toContain('Se acabaron los créditos de OpenAI');
    expect(aviso?.textContent).toContain('10 de octubre');
    expect(aviso?.querySelector('a')?.getAttribute('href')).toContain('platform.openai.com');
  });

  it('sin llave dice que falta configurarla y no deja generar', async () => {
    await cargar({ configurado: false, sinCreditosDesde: null });
    expect(pantalla.querySelector('[role="alert"]')?.textContent).toContain(
      'Falta configurar la llave de OpenAI',
    );
    expect(boton('Generar imagen')?.disabled).toBe(true);
  });

  it('carga el prompt de la referencia y pide la foto antes de generar', async () => {
    await cargar({ configurado: true, sinCreditosDesde: null });
    expect(pantalla.querySelector('.prompt-referencia')?.textContent).toContain(
      'Sobre una mesa de madera clara',
    );
    expect(boton('Generar imagen')?.disabled).toBe(true);
    expect(pantalla.querySelector('#falta-para-generar')?.textContent).toContain(
      'Sube la foto del producto',
    );
  });

  it('genera, espera a que termine y ofrece asignar, repetir o descartar', async () => {
    await cargar({ configurado: true, sinCreditosDesde: null });
    const entrada = pantalla.querySelector<HTMLInputElement>('.foto input[type="file"]');
    if (!entrada) throw new Error('Falta el campo de la foto');
    const archivo = new File(['foto'], 'galletas.jpg', { type: 'image/jpeg' });
    Object.defineProperty(entrada, 'files', { value: [archivo] });
    entrada.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    boton('Generar imagen')?.click();
    const pedida = http.expectOne('/api/imagenes-ia/generaciones');
    const cuerpo = pedida.request.body as FormData;
    expect(cuerpo.get('referenciaId')).toBe('1');
    expect(cuerpo.get('calidad')).toBe('media');
    expect(cuerpo.get('foto')).toBe(archivo);
    pedida.flush(generacion());
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/imagenes-ia/generaciones').flush([generacion()]);
    fixture.detectChanges();
    expect(pantalla.querySelector('mat-progress-bar')).not.toBeNull();
    expect(pantalla.textContent).toContain('puede tardar hasta 2 minutos');

    await vi.advanceTimersByTimeAsync(INTERVALO_CONSULTA);
    http.expectOne('/api/imagenes-ia/generaciones/7').flush(generacion({ estado: 'lista' }));
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/imagenes-ia/generaciones').flush([generacion({ estado: 'lista' })]);
    http.expectOne('/api/imagenes-ia/estado').flush({ configurado: true, sinCreditosDesde: null });
    fixture.detectChanges();

    expect(boton('Asignar a un producto')).toBeDefined();
    expect(boton('Generar otra vez')).toBeDefined();
    expect(boton('Descartar')).toBeDefined();
    // La foto quedó con la generación: repetir no pide subirla otra vez.
    expect(pantalla.textContent).toContain('Se usa la misma foto de la imagen anterior');
  });

  it('si no salió, enseña el motivo que dio la API', async () => {
    await cargar({ configurado: true, sinCreditosDesde: null });
    fixture.componentInstance['ver'](
      generacion({
        estado: 'error',
        error: { tipo: 'moderacion', mensaje: 'OpenAI no generó la imagen por sus reglas.' },
      }),
    );
    fixture.detectChanges();
    expect(pantalla.querySelector('.resultado')?.textContent).toContain(
      'OpenAI no generó la imagen por sus reglas.',
    );
    expect(boton('Intentar de nuevo')).toBeDefined();
  });
});
