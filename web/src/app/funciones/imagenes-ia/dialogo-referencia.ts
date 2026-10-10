import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ReferenciaImagen, SugerenciaReferenciaImagen } from '@uvm/compartido';
import { firstValueFrom } from 'rxjs';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { ImagenPrivada } from './imagen-privada';
import { revisarImagen } from './revisar-imagen';

/** `null`: una referencia nueva. */
export type DatosDialogoReferencia = ReferenciaImagen | null;

/** Alta o edición de una referencia: la imagen de la escena, su nombre y su prompt. */
@Component({
  selector: 'uvm-dialogo-referencia',
  imports: [
    ImagenPrivada,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ actual ? 'Editar referencia' : 'Nueva referencia' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content class="contenido">
        <div class="imagen">
          <div class="marco">
            @if (vistaPrevia(); as url) {
              <img [src]="url" alt="Vista previa de la referencia elegida" />
            } @else if (actual) {
              <uvm-imagen-privada
                [ruta]="'/api/imagenes-ia/referencias/' + actual.id + '/imagen'"
                [alt]="'Referencia ' + actual.nombre"
              />
            } @else {
              <span class="ayuda">Sin imagen</span>
            }
          </div>
          <div class="controles">
            <input
              #selector
              type="file"
              class="visualmente-oculto"
              accept="image/jpeg,image/png,image/webp"
              tabindex="-1"
              aria-hidden="true"
              (change)="alElegir($event)"
            />
            <button mat-stroked-button type="button" (click)="selector.click()">
              {{ actual || archivo() ? 'Cambiar imagen' : 'Elegir imagen' }}
            </button>
            <p class="ayuda">
              La escena que quieres: el fondo, la superficie, la luz. JPG, PNG o WebP de hasta 10
              MB.
            </p>
            @if (errorArchivo()) {
              <p class="error-texto" role="alert">{{ errorArchivo() }}</p>
            }
          </div>
        </div>

        <div class="sugerencia" aria-live="polite">
          @if (sugiriendo()) {
            <mat-progress-bar mode="indeterminate" aria-label="Analizando la imagen" />
            <p class="ayuda">La IA está mirando la imagen para sugerir el nombre y el prompt…</p>
          } @else if (avisoSugerencia()) {
            <p class="ayuda">No se pudo sugerir: {{ avisoSugerencia() }} Escríbelos a mano.</p>
          } @else if (sugerenciaPendiente()) {
            <p class="ayuda">La IA tiene otra sugerencia para esta imagen.</p>
            <button mat-button type="button" (click)="usarSugerencia()">Usar la sugerencia</button>
          }
        </div>

        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" maxlength="60" placeholder="Mesa de madera" />
          @if (sugeridos().nombre) {
            <mat-hint>Sugerido por la IA; cámbialo como quieras.</mat-hint>
          }
          @if (formulario.controls.nombre.hasError('servidor')) {
            <mat-error>{{ formulario.controls.nombre.getError('servidor') }}</mat-error>
          } @else if (formulario.controls.nombre.invalid) {
            <mat-error>Escribe un nombre.</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>Prompt de la escena</mat-label>
          <textarea
            matInput
            formControlName="prompt"
            rows="5"
            maxlength="2000"
            placeholder="Sobre una mesa de madera clara, luz cálida de mañana, fondo desenfocado, estilo de foto de revista."
          ></textarea>
          <mat-hint>
            {{
              sugeridos().prompt
                ? 'Sugerido por la IA a partir de la imagen; cámbialo como quieras.'
                : 'Se carga solo al elegir esta referencia; al generar se le puede sumar algo.'
            }}
          </mat-hint>
          @if (formulario.controls.prompt.hasError('servidor')) {
            <mat-error>{{ formulario.controls.prompt.getError('servidor') }}</mat-error>
          } @else if (formulario.controls.prompt.invalid) {
            <mat-error>Describe la escena en al menos 10 caracteres.</mat-error>
          }
        </mat-form-field>

        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="guardando()">
          {{ guardando() ? 'Guardando…' : 'Guardar' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .contenido {
      display: grid;
      gap: 0.5rem;
    }
    .imagen {
      display: grid;
      grid-template-columns: 8rem minmax(0, 1fr);
      gap: 1rem;
      align-items: start;
      margin-block-end: 0.5rem;
    }
    .marco {
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      border-radius: 0.75rem;
      overflow: hidden;
      background: var(--mat-sys-surface-container);
    }
    .marco img,
    .marco uvm-imagen-privada {
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
    }
    .controles {
      display: grid;
      gap: 0.5rem;
      justify-items: start;
    }
    .controles p {
      margin: 0;
    }
    .sugerencia {
      display: grid;
      gap: 0.25rem;
      justify-items: start;
    }
    .sugerencia:empty {
      display: none;
    }
    .sugerencia mat-progress-bar {
      inline-size: 100%;
    }
  `,
})
export class DialogoReferencia {
  protected readonly actual = inject<DatosDialogoReferencia>(MAT_DIALOG_DATA);
  private readonly referencia =
    inject<MatDialogRef<DialogoReferencia, ReferenciaImagen>>(MatDialogRef);
  private readonly http = inject(HttpClient);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    nombre: [this.actual?.nombre ?? '', [Validators.required, Validators.maxLength(60)]],
    prompt: [
      this.actual?.prompt ?? '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(2000)],
    ],
  });
  protected readonly archivo = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
  protected readonly errorArchivo = signal<string | null>(null);
  protected readonly sugiriendo = signal(false);
  protected readonly sugerencia = signal<SugerenciaReferenciaImagen | null>(null);
  protected readonly avisoSugerencia = signal<string | null>(null);
  /** Qué campos llenó la IA (para decirlo junto al campo). */
  protected readonly sugeridos = signal({ nombre: false, prompt: false });
  /** Hay una sugerencia que no se aplicó (porque ya se había escrito algo). */
  protected readonly sugerenciaPendiente = signal(false);
  /** Si se elige otra imagen antes de que llegue la sugerencia, la vieja no se aplica. */
  private pedidas = 0;
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.soltarVistaPrevia());
  }

  protected alElegir(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;
    const problema = revisarImagen(archivo);
    this.errorArchivo.set(problema);
    if (problema) return;
    this.soltarVistaPrevia();
    this.archivo.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
    void this.sugerir(archivo);
  }

  /**
   * La IA mira la imagen y sugiere nombre y prompt. En una referencia nueva llena los
   * campos que nadie ha tocado; lo que ya se escribió no se pisa, y en una que ya
   * existía tampoco: ahí se ofrece «Usar la sugerencia».
   */
  private async sugerir(archivo: File): Promise<void> {
    const pedida = ++this.pedidas;
    this.sugiriendo.set(true);
    this.avisoSugerencia.set(null);
    this.sugerenciaPendiente.set(false);
    const formulario = new FormData();
    formulario.append('archivo', archivo);
    try {
      const sugerencia = await firstValueFrom(
        this.http.post<SugerenciaReferenciaImagen>(
          '/api/imagenes-ia/referencias/sugerencia',
          formulario,
        ),
      );
      if (pedida !== this.pedidas) return;
      this.sugerencia.set(sugerencia);
      const libre = (campo: 'nombre' | 'prompt') => {
        const control = this.formulario.controls[campo];
        return control.value.trim() === '' || (!this.actual && !control.dirty);
      };
      const nombre = libre('nombre');
      const prompt = libre('prompt');
      if (nombre) this.formulario.controls.nombre.setValue(sugerencia.nombre);
      if (prompt) this.formulario.controls.prompt.setValue(sugerencia.prompt);
      this.sugeridos.set({ nombre, prompt });
      this.sugerenciaPendiente.set(!nombre || !prompt);
    } catch (error) {
      if (pedida === this.pedidas) this.avisoSugerencia.set(mensajeDeError(error));
    } finally {
      if (pedida === this.pedidas) this.sugiriendo.set(false);
    }
  }

  protected usarSugerencia(): void {
    const sugerencia = this.sugerencia();
    if (!sugerencia) return;
    this.formulario.setValue({ nombre: sugerencia.nombre, prompt: sugerencia.prompt });
    this.sugeridos.set({ nombre: true, prompt: true });
    this.sugerenciaPendiente.set(false);
  }

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    const archivo = this.archivo();
    if (!this.actual && !archivo) {
      this.errorArchivo.set('Elige la imagen de la escena.');
      return;
    }
    if (this.formulario.invalid || this.guardando()) return;
    const formulario = new FormData();
    formulario.append('nombre', this.formulario.getRawValue().nombre);
    formulario.append('prompt', this.formulario.getRawValue().prompt);
    if (archivo) formulario.append('archivo', archivo);
    this.guardando.set(true);
    this.error.set(null);
    try {
      const ruta = '/api/imagenes-ia/referencias';
      const guardada = await firstValueFrom(
        this.actual
          ? this.http.put<ReferenciaImagen>(`${ruta}/${this.actual.id}`, formulario)
          : this.http.post<ReferenciaImagen>(ruta, formulario),
      );
      this.referencia.close(guardada);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }

  private soltarVistaPrevia(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
  }
}
