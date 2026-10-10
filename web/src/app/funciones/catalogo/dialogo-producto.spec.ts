import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { Categoria, FichaSugerida, Producto } from '@uvm/compartido';
import { DialogoProducto } from './dialogo-producto';

/** Datos de prueba, no reales. */
const PRODUCTO: Producto = {
  id: 10,
  slug: 'galletas-de-prueba',
  nombre: 'Galletas de Prueba',
  categoriaId: 1,
  categoria: 'Galletas',
  variedad: 'Avena',
  presentacion: '6 pzas',
  resumen: 'El resumen de antes.',
  descripcion: 'La descripción de antes.',
  ingredientes: ['avena'],
  precioVenta: '30.00',
  stockMinimo: 0,
  activo: true,
  publicado: false,
  destacado: false,
  destacadoEtiqueta: '',
  destacadoQuip: '',
  destacadoTexto: '',
  existenciaTotal: 5,
  imagen: { url: '/logo-producto.webp', urlChica: '/logo-producto.webp', alt: 'Galletas' },
  imagenAlt: 'Galletas',
};

const FICHA: FichaSugerida = {
  resumen: 'Crujientes por fuera, suaves por dentro.',
  descripcion: 'Avena horneada en casa, para el café de la tarde.',
  ingredientes: ['avena', 'canela'],
  destacadoEtiqueta: 'Clásico',
  destacadoQuip: 'La de siempre',
  destacadoTexto: 'Como las de la abuela.',
};

describe('DialogoProducto: ficha con IA', () => {
  let fixture: ComponentFixture<DialogoProducto>;
  let http: HttpTestingController;
  let pantalla: HTMLElement;

  function abrir(producto: Producto | null): void {
    TestBed.configureTestingModule({
      imports: [DialogoProducto],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { producto, categorias: [{ id: 1, nombre: 'Galletas' } as Categoria] },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DialogoProducto);
    http = TestBed.inject(HttpTestingController);
    pantalla = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const generar = () =>
    [...pantalla.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Generar con IA'),
    );
  const campo = (etiqueta: string) =>
    [...pantalla.querySelectorAll<HTMLElement>('mat-form-field')]
      .find((c) => c.querySelector('mat-label')?.textContent?.trim() === etiqueta)
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  const chips = () =>
    [...pantalla.querySelectorAll('mat-chip-row')].map((c) =>
      c.textContent?.replace('cancel', '').trim(),
    );

  afterEach(() => http.verify());

  it('sin foto guardada dice qué falta y no deja generar', () => {
    abrir({ ...PRODUCTO, imagen: null, variedad: '' });
    expect(generar()?.disabled).toBe(true);
    expect(pantalla.querySelector('#ficha-ia-ayuda')?.textContent).toContain(
      'la foto (súbela y guarda), la variedad',
    );
  });

  it('manda lo del formulario, llena la ficha y «Deshacer» regresa lo de antes', async () => {
    abrir(PRODUCTO);
    expect(generar()?.disabled).toBe(false);
    generar()?.click();
    fixture.detectChanges();
    expect(pantalla.textContent).toContain('La IA está redactando la ficha');

    const peticion = http.expectOne('/api/productos/10/ficha-ia');
    expect(peticion.request.body).toEqual({
      nombre: 'Galletas de Prueba',
      categoriaId: 1,
      variedad: 'Avena',
      presentacion: '6 pzas',
      destacado: false,
    });
    peticion.flush(FICHA);
    await new Promise((listo) => setTimeout(listo, 0));
    fixture.detectChanges();

    expect(campo('Resumen')?.value).toBe(FICHA.resumen);
    expect(campo('Descripción')?.value).toBe(FICHA.descripcion);
    expect(chips()).toEqual(['avena', 'canela']);
    expect(pantalla.textContent).toContain('revísala antes de guardar');

    [...pantalla.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Deshacer')
      ?.click();
    fixture.detectChanges();
    expect(campo('Resumen')?.value).toBe('El resumen de antes.');
    expect(campo('Descripción')?.value).toBe('La descripción de antes.');
    expect(chips()).toEqual(['avena']);
  });

  it('si no se pudo, enseña el motivo y no toca nada', async () => {
    abrir(PRODUCTO);
    generar()?.click();
    http
      .expectOne('/api/productos/10/ficha-ia')
      .flush({ mensaje: 'Se acabaron los créditos de OpenAI.' }, { status: 402, statusText: 'x' });
    await new Promise((listo) => setTimeout(listo, 0));
    fixture.detectChanges();
    expect(pantalla.querySelector('.ficha-ia-estado')?.textContent).toContain(
      'Se acabaron los créditos de OpenAI.',
    );
    expect(campo('Resumen')?.value).toBe('El resumen de antes.');
  });
});
