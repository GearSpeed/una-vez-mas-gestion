import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { ReferenciaImagen } from '@uvm/compartido';
import { DialogoReferencia } from './dialogo-referencia';

const SUGERENCIA = {
  nombre: 'Mesa de madera rústica',
  prompt: 'Mesa de madera con vetas marcadas y luz cálida lateral.',
};

const EXISTENTE: ReferenciaImagen = {
  id: 3,
  nombre: 'Mi mesa',
  prompt: 'El prompt que ya había escrito a mano.',
  actualizadoEn: '2026-10-10T12:00:00.000Z',
};

describe('DialogoReferencia', () => {
  let fixture: ComponentFixture<DialogoReferencia>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;

  function abrir(datos: ReferenciaImagen | null): void {
    TestBed.configureTestingModule({
      imports: [DialogoReferencia],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: datos },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DialogoReferencia);
    http = TestBed.inject(HttpTestingController);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // La miniatura de una referencia que ya existe se pide con sesión.
    for (const p of http.match((r) => r.url.endsWith('/imagen'))) p.flush(new Blob(['x']));
  }

  const campo = (etiqueta: string) =>
    [...pantalla.querySelectorAll<HTMLElement>('mat-form-field')]
      .find((c) => c.textContent?.includes(etiqueta))
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');

  async function elegirImagen(): Promise<void> {
    const entrada = pantalla.querySelector<HTMLInputElement>('input[type="file"]');
    if (!entrada) throw new Error('Falta el campo de la imagen');
    Object.defineProperty(entrada, 'files', {
      value: [new File(['img'], 'mesa.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    entrada.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function responder(cuerpo: object, estado = 200): Promise<void> {
    const peticion = http.expectOne('/api/imagenes-ia/referencias/sugerencia');
    expect(peticion.request.body).toBeInstanceOf(FormData);
    if (estado === 200) peticion.flush(cuerpo);
    else peticion.flush(cuerpo, { status: estado, statusText: 'Error' });
    await new Promise((listo) => setTimeout(listo, 0));
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('en una referencia nueva, la IA llena nombre y prompt como sugerencia', async () => {
    abrir(null);
    await elegirImagen();
    expect(pantalla.textContent).toContain('La IA está mirando la imagen');
    await responder(SUGERENCIA);
    expect(campo('Nombre')?.value).toBe(SUGERENCIA.nombre);
    expect(campo('Prompt de la escena')?.value).toBe(SUGERENCIA.prompt);
    expect(pantalla.textContent).toContain('Sugerido por la IA');
  });

  it('lo que ya se escribió no se pisa: se ofrece «Usar la sugerencia»', async () => {
    abrir(null);
    const nombre = campo('Nombre');
    if (!nombre) throw new Error('Falta el nombre');
    nombre.value = 'Mi nombre';
    nombre.dispatchEvent(new Event('input'));
    await elegirImagen();
    await responder(SUGERENCIA);
    expect(campo('Nombre')?.value).toBe('Mi nombre');
    expect(campo('Prompt de la escena')?.value).toBe(SUGERENCIA.prompt);

    const usar = [...pantalla.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Usar la sugerencia'),
    );
    usar?.click();
    fixture.detectChanges();
    expect(campo('Nombre')?.value).toBe(SUGERENCIA.nombre);
  });

  it('al cambiar la imagen de una que ya existía, no reemplaza lo guardado', async () => {
    abrir(EXISTENTE);
    await elegirImagen();
    await responder(SUGERENCIA);
    expect(campo('Nombre')?.value).toBe('Mi mesa');
    expect(campo('Prompt de la escena')?.value).toBe(EXISTENTE.prompt);
    expect(pantalla.textContent).toContain('Usar la sugerencia');
  });

  it('si no se pudo sugerir, lo dice y deja escribirlos a mano', async () => {
    abrir(null);
    await elegirImagen();
    await responder({ mensaje: 'Se acabaron los créditos de OpenAI.' }, 402);
    expect(pantalla.querySelector('.sugerencia')?.textContent).toContain(
      'No se pudo sugerir: Se acabaron los créditos de OpenAI.',
    );
    expect(campo('Nombre')?.value).toBe('');
  });
});
