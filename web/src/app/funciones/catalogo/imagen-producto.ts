import { NgOptimizedImage } from '@angular/common';
import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  type OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { Producto } from '@uvm/compartido';
import { lastValueFrom, tap } from 'rxjs';
import { ApiService } from '../../core/api';
import { mensajeDeError } from '../../core/errores';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PESO_MAXIMO = 10 * 1024 * 1024;

/**
 * La foto del producto: la misma que sirve el sitio desde el bucket.
 *
 * Aquí solo se elige el archivo y se escribe su texto alternativo; quien graba es el
 * diálogo del producto con su botón «Guardar» (`guardarEn`), porque al dar de alta
 * todavía no existe el id al que subirla.
 */
@Component({
  selector: 'uvm-imagen-producto',
  imports: [
    NgOptimizedImage,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './imagen-producto.html',
  styleUrl: './imagen-producto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImagenProducto implements OnInit {
  /** `null` mientras el producto no existe (alta). */
  readonly producto = input<Producto | null>(null);
  /** El producto ya sin su imagen, cuando se quita: la lista se actualiza. */
  readonly cambio = output<Producto>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly selector = viewChild.required<ElementRef<HTMLInputElement>>('selector');

  /** La que quedó guardada durante esta edición (al quitarla o al subirla). */
  private readonly actual = signal<Producto | null>(null);
  protected readonly imagen = computed(() => (this.actual() ?? this.producto())?.imagen ?? null);

  protected readonly archivo = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
  protected readonly progreso = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly alt = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.soltarVistaPrevia());
  }

  ngOnInit(): void {
    this.alt.setValue(this.producto()?.imagen?.alt ?? '');
  }

  /**
   * ¿Se puede guardar? Si hay foto (elegida o ya guardada), su texto alternativo es
   * obligatorio: sin él, quien no puede ver la imagen se queda sin saber qué es.
   */
  valido(): boolean {
    if (!this.archivo() && !this.imagen()) return true;
    this.alt.markAsTouched();
    return this.alt.valid;
  }

  /**
   * Graba lo que quedó pendiente en el producto `id`: sube el archivo elegido, o
   * cambia solo el texto si es lo único que se tocó. Devuelve el producto ya
   * actualizado, o `null` si no había nada que hacer.
   */
  async guardarEn(id: number): Promise<Producto | null> {
    const archivo = this.archivo();
    if (archivo) return this.subir(id, archivo);
    if (this.imagen() && this.alt.dirty) {
      return this.listo(
        await this.api.put<Producto>(`/productos/${id}/imagen`, {
          alt: this.alt.value,
        }),
      );
    }
    return null;
  }

  protected elegir(): void {
    this.selector().nativeElement.click();
  }

  protected alElegir(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;
    this.error.set(null);
    if (!TIPOS.includes(archivo.type)) {
      this.error.set('Elige una imagen JPG, PNG o WebP.');
      return;
    }
    if (archivo.size > PESO_MAXIMO) {
      this.error.set('La imagen pesa más de 10 MB.');
      return;
    }
    this.soltarVistaPrevia();
    this.archivo.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
  }

  protected descartar(): void {
    this.soltarVistaPrevia();
    this.archivo.set(null);
    this.error.set(null);
  }

  /** Quitar sí es inmediato: es destructivo y se pide a propósito. */
  protected async quitar(): Promise<void> {
    const producto = this.actual() ?? this.producto();
    if (!producto) return;
    this.error.set(null);
    try {
      const sinImagen = await this.api.delete<Producto>(`/productos/${producto.id}/imagen`);
      this.listo(sinImagen);
      this.cambio.emit(sinImagen);
      this.alt.reset();
    } catch (error) {
      this.error.set(mensajeDeError(error));
    }
  }

  private async subir(id: number, archivo: File): Promise<Producto> {
    const formulario = new FormData();
    formulario.append('alt', this.alt.value);
    formulario.append('archivo', archivo);
    this.progreso.set(0);
    this.error.set(null);
    try {
      const respuesta = await lastValueFrom(
        this.http
          .post<Producto>(`/api/productos/${id}/imagen`, formulario, {
            reportProgress: true,
            observe: 'events',
          })
          .pipe(
            tap((evento) => {
              if (evento.type === HttpEventType.UploadProgress && evento.total) {
                this.progreso.set(Math.round((evento.loaded / evento.total) * 100));
              }
            }),
          ),
      );
      if (respuesta.type !== HttpEventType.Response || !respuesta.body) {
        throw new Error('El servidor no devolvió el producto');
      }
      this.descartar();
      return this.listo(respuesta.body);
    } finally {
      this.progreso.set(null);
    }
  }

  private listo(producto: Producto): Producto {
    this.actual.set(producto);
    this.alt.markAsPristine();
    return producto;
  }

  private soltarVistaPrevia(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
  }
}
