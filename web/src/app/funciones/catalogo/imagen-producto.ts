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
 * La foto del producto: la misma que sirve el sitio desde el bucket. Se elige un
 * archivo, se escribe su texto alternativo y se sube; la API la optimiza.
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
  readonly producto = input.required<Producto>();
  /** El producto con su imagen nueva (o sin imagen), para refrescar la lista. */
  readonly cambio = output<Producto>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly selector = viewChild.required<ElementRef<HTMLInputElement>>('selector');

  /** La que tiene ahora (se actualiza al subir o quitar, sin cerrar el diálogo). */
  private readonly actual = signal<Producto | null>(null);
  protected readonly imagen = computed(() => (this.actual() ?? this.producto()).imagen);

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
    this.alt.setValue(this.producto().imagen?.alt ?? '');
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

  protected async subir(): Promise<void> {
    const archivo = this.archivo();
    this.alt.markAsTouched();
    if (!archivo || this.alt.invalid || this.progreso() !== null) return;
    const formulario = new FormData();
    formulario.append('alt', this.alt.value);
    formulario.append('archivo', archivo);
    this.progreso.set(0);
    this.error.set(null);
    try {
      const respuesta = await lastValueFrom(
        this.http
          .post<Producto>(`/api/productos/${this.producto().id}/imagen`, formulario, {
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
      if (respuesta.type === HttpEventType.Response && respuesta.body) {
        this.listo(respuesta.body);
        this.descartar();
      }
    } catch (error) {
      this.error.set(mensajeDeError(error));
    } finally {
      this.progreso.set(null);
    }
  }

  protected async guardarAlt(): Promise<void> {
    this.alt.markAsTouched();
    if (this.alt.invalid || this.progreso() !== null) return;
    this.error.set(null);
    try {
      this.listo(
        await this.api.put<Producto>(`/productos/${this.producto().id}/imagen`, {
          alt: this.alt.value,
        }),
      );
    } catch (error) {
      this.error.set(mensajeDeError(error));
    }
  }

  protected async quitar(): Promise<void> {
    this.error.set(null);
    try {
      this.listo(await this.api.delete<Producto>(`/productos/${this.producto().id}/imagen`));
      this.alt.reset();
    } catch (error) {
      this.error.set(mensajeDeError(error));
    }
  }

  private listo(producto: Producto): void {
    this.actual.set(producto);
    this.alt.markAsPristine();
    this.cambio.emit(producto);
  }

  private soltarVistaPrevia(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
  }
}
