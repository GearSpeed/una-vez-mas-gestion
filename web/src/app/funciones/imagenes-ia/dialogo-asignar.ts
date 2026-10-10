import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { ImagenGenerada, Producto } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';

/** La imagen generada pasa a ser la foto de un producto (la que se ve en el sitio). */
@Component({
  selector: 'uvm-dialogo-asignar',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Asignar a un producto</h2>
    <form [formGroup]="formulario" (ngSubmit)="asignar()" novalidate>
      <mat-dialog-content class="contenido">
        <mat-form-field>
          <mat-label>Producto</mat-label>
          <mat-select formControlName="productoId">
            @for (p of productos(); track p.id) {
              <mat-option [value]="p.id">{{ p.nombre }}</mat-option>
            }
          </mat-select>
          @if (formulario.controls.productoId.invalid) {
            <mat-error>Elige el producto.</mat-error>
          }
        </mat-form-field>
        @if (reemplaza()) {
          <p class="aviso" role="status">
            Ese producto ya tiene foto: esta la reemplaza, en el gestor y en el sitio.
          </p>
        }

        <mat-form-field>
          <mat-label>Texto alternativo</mat-label>
          <input matInput formControlName="alt" maxlength="200" />
          <mat-hint>Qué se ve en la foto, para quien no puede verla.</mat-hint>
          @if (formulario.controls.alt.hasError('servidor')) {
            <mat-error>{{ formulario.controls.alt.getError('servidor') }}</mat-error>
          } @else if (formulario.controls.alt.invalid) {
            <mat-error>Describe la imagen en pocas palabras.</mat-error>
          }
        </mat-form-field>

        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="asignando()">
          {{ asignando() ? 'Asignando…' : 'Asignar' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .contenido {
      display: grid;
      gap: 0.5rem;
      min-inline-size: min(26rem, 100%);
    }
    .aviso {
      margin: 0;
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
  `,
})
export class DialogoAsignar {
  private readonly generacion = inject<ImagenGenerada>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoAsignar, Producto>>(MatDialogRef);
  private readonly api = inject(ApiService);

  private readonly lista = httpResource<Producto[]>(() => '/api/productos');
  protected readonly productos = computed(() => (this.lista.value() ?? []).filter((p) => p.activo));

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    productoId: inject(FormBuilder).control<number | null>(null, Validators.required),
    alt: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
  });
  private readonly elegido = toSignal(this.formulario.controls.productoId.valueChanges, {
    initialValue: null,
  });
  protected readonly reemplaza = computed(
    () => this.productos().find((p) => p.id === this.elegido())?.imagen != null,
  );
  protected readonly asignando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async asignar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.asignando()) return;
    this.asignando.set(true);
    this.error.set(null);
    try {
      const producto = await this.api.post<Producto>(
        `/imagenes-ia/generaciones/${this.generacion.id}/asignar`,
        this.formulario.getRawValue(),
      );
      this.referencia.close(producto);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.asignando.set(false);
    }
  }
}
