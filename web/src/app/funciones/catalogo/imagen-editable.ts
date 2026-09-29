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
import type { ImagenProducto } from '@uvm/compartido';
import { lastValueFrom, tap } from 'rxjs';
import { ApiService } from '../../core/api';
import { mensajeDeError } from '../../core/errores';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PESO_MAXIMO = 10 * 1024 * 1024;

/** Lo que necesita tener algo para que este componente le administre su foto. */
export interface ConImagen {
  readonly id: number;
  readonly imagen: ImagenProducto | null;
  readonly imagenAlt: string;
}

/**
 * La foto de un producto o de una categoría: la misma que sirve el sitio desde el bucket.
 *
 * Aquí solo se elige el archivo y se escribe su texto alternativo; quien graba es el
 * diálogo que lo contiene, con su botón «Guardar» (`guardarEn`), porque al dar de alta
 * todavía no existe el id al que subirla.
 *
 * Sirve para los dos porque lo único que cambia entre ellos es la ruta (`productos` o
 * `categorias`) y las dos entidades exponen `imagen` e `imagenAlt` igual.
 */
@Component({
  selector: 'uvm-imagen-editable',
  imports: [
    NgOptimizedImage,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './imagen-editable.html',
  styleUrl: './imagen-editable.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImagenEditable<T extends ConImagen = ConImagen> implements OnInit {
  /** `null` mientras la entidad no existe (alta). */
  readonly entidad = input<T | null>(null);
  /** El segmento de la API: `productos` o `categorias`. */
  readonly ruta = input.required<'productos' | 'categorias'>();
  /** La entidad ya sin su imagen, cuando se quita: la lista se actualiza. */
  readonly cambio = output<T>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly selector = viewChild.required<ElementRef<HTMLInputElement>>('selector');

  /** La que quedó guardada durante esta edición (al quitarla o al subirla). */
  private readonly actual = signal<T | null>(null);
  protected readonly imagen = computed(() => (this.actual() ?? this.entidad())?.imagen ?? null);

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
    this.alt.setValue(this.entidad()?.imagenAlt ?? '');
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
   * Graba lo que quedó pendiente en la entidad `id`: sube el archivo elegido, o cambia
   * solo el texto si es lo único que se tocó. Devuelve la entidad ya actualizada, o
   * `null` si no había nada que hacer.
   */
  async guardarEn(id: number): Promise<T | null> {
    const archivo = this.archivo();
    if (archivo) return this.subir(id, archivo);
    // El texto se puede escribir antes de tener la foto: se guarda igual y la espera.
    if (this.alt.dirty && this.alt.valid) {
      return this.listo(
        await this.api.put<T>(`/${this.ruta()}/${id}/imagen`, {
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
    const entidad = this.actual() ?? this.entidad();
    if (!entidad) return;
    this.error.set(null);
    try {
      const sinImagen = await this.api.delete<T>(`/${this.ruta()}/${entidad.id}/imagen`);
      this.listo(sinImagen);
      this.cambio.emit(sinImagen);
      this.alt.reset();
    } catch (error) {
      this.error.set(mensajeDeError(error));
    }
  }

  private async subir(id: number, archivo: File): Promise<T> {
    const formulario = new FormData();
    formulario.append('alt', this.alt.value);
    formulario.append('archivo', archivo);
    this.progreso.set(0);
    this.error.set(null);
    try {
      const respuesta = await lastValueFrom(
        this.http
          .post<T>(`/api/${this.ruta()}/${id}/imagen`, formulario, {
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
        throw new Error('El servidor no devolvió la respuesta esperada');
      }
      this.descartar();
      return this.listo(respuesta.body);
    } finally {
      this.progreso.set(null);
    }
  }

  private listo(entidad: T): T {
    this.actual.set(entidad);
    this.alt.markAsPristine();
    return entidad;
  }

  private soltarVistaPrevia(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
  }
}
