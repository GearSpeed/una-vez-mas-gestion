import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { mensajeDeError } from '../core/errores';

/** Barra de carga y, si la lectura falló, el mensaje con un botón para reintentar. */
@Component({
  selector: 'uvm-estado-carga',
  imports: [MatProgressBarModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cargando()) {
      <mat-progress-bar mode="indeterminate" aria-label="Cargando" />
    }
    @if (mensaje(); as texto) {
      <div class="tarjeta error" role="alert">
        <p class="error-texto">{{ texto }}</p>
        <button mat-button type="button" (click)="reintentar.emit()">Reintentar</button>
      </div>
    }
  `,
  styles: `
    .error {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      justify-content: space-between;
    }
  `,
})
export class EstadoCarga {
  readonly cargando = input(false);
  readonly error = input<unknown>(undefined);
  readonly reintentar = output();

  protected readonly mensaje = computed(() => (this.error() ? mensajeDeError(this.error()) : null));
}
