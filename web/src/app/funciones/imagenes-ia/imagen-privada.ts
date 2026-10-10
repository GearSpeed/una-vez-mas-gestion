import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { imagenConSesion } from '../../core/imagen-con-sesion';

/** Un `<img>` para las imágenes de la API que exigen sesión (no van al bucket público). */
@Component({
  selector: 'uvm-imagen-privada',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (imagen.url(); as url) {
      <img [src]="url" [alt]="alt()" />
    } @else if (imagen.recurso.error()) {
      <span class="aviso">No se pudo cargar la imagen.</span>
    } @else {
      <span class="aviso" role="status">Cargando…</span>
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      overflow: hidden;
      background: var(--mat-sys-surface-container);
      border-radius: inherit;
    }
    img {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
    }
    .aviso {
      padding: 0.5rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
    }
  `,
})
export class ImagenPrivada {
  readonly ruta = input.required<string>();
  /** Vacío si la imagen es decorativa (su nombre ya está escrito al lado). */
  readonly alt = input.required<string>();

  protected readonly imagen = imagenConSesion(() => this.ruta());
}
