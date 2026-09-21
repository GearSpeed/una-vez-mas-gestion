import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * El encabezado de cada pantalla: su único h1 (al que se mueve el foco al
 * navegar) y, a la derecha, las acciones que se proyecten.
 */
@Component({
  selector: 'uvm-encabezado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="texto">
      <h1 tabindex="-1">{{ titulo() }}</h1>
      @if (subtitulo()) {
        <p class="ayuda">{{ subtitulo() }}</p>
      }
    </div>
    <div class="acciones"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
      align-items: center;
      justify-content: space-between;
    }
    h1:focus {
      outline: none;
    }
    h1:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 4px;
    }
  `,
})
export class Encabezado {
  readonly titulo = input.required<string>();
  readonly subtitulo = input<string | null>(null);
}
