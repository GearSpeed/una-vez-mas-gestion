import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Caja de una tabla ancha. Cuando la tabla no cabe (en el celular), la caja se
 * desplaza de lado y entonces se vuelve enfocable y con nombre, para que se
 * pueda recorrer con el teclado (WCAG 2.1.1). Si cabe, no agrega una parada.
 *
 *   <div uvmDesplazable="Ventas del periodo"><table>…</table></div>
 */
@Directive({
  selector: '[uvmDesplazable]',
  host: {
    class: 'tabla-contenedor',
    '[attr.tabindex]': 'desborda() ? 0 : null',
    '[attr.role]': 'desborda() ? "region" : null',
    '[attr.aria-label]': 'desborda() ? etiqueta() : null',
  },
})
export class Desplazable {
  readonly etiqueta = input.required<string>({ alias: 'uvmDesplazable' });
  protected readonly desborda = signal(false);

  constructor() {
    const caja = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const alDestruir = inject(DestroyRef);
    afterNextRender(() => {
      const medir = () => this.desborda.set(caja.scrollWidth > caja.clientWidth + 1);
      const tamanos = new ResizeObserver(medir);
      const cambios = new MutationObserver(medir);
      tamanos.observe(caja);
      cambios.observe(caja, { childList: true, subtree: true });
      medir();
      alDestruir.onDestroy(() => {
        tamanos.disconnect();
        cambios.disconnect();
      });
    });
  }
}
