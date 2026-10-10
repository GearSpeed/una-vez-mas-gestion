import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface Barra {
  readonly etiqueta: string;
  readonly valor: number;
  /** El valor ya formateado: «7», «70 %». Siempre se muestra en texto. */
  readonly texto: string;
}

/**
 * Barras horizontales hechas con una tabla: un lector de pantalla la recorre como
 * cualquier tabla y el valor siempre está en texto, la barra solo lo acompaña.
 */
@Component({
  selector: 'uvm-grafica-barras',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="grafica">
      <figcaption>{{ titulo() }}</figcaption>
      <table>
        <thead class="visualmente-oculto">
          <tr>
            <th scope="col">{{ columnaEtiqueta() }}</th>
            <th scope="col">{{ columnaValor() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (barra of barras(); track barra.etiqueta) {
            <tr>
              <th scope="row">{{ barra.etiqueta }}</th>
              <td>
                <span class="pista">
                  <span class="barra" [style.inline-size.%]="barra.ancho" aria-hidden="true"></span>
                  <span class="valor">{{ barra.texto }}</span>
                </span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </figure>
  `,
  styles: `
    .grafica {
      margin: 0;
    }
    figcaption {
      font: var(--mat-sys-title-small);
      margin-block-end: 0.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    th {
      font-weight: 400;
      text-align: start;
      padding: 0.25rem 0.75rem 0.25rem 0;
      width: 40%;
      vertical-align: middle;
    }
    td {
      padding: 0.25rem 0;
    }
    .pista {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .barra {
      display: block;
      block-size: 1rem;
      min-inline-size: 2px;
      border-radius: 0 0.25rem 0.25rem 0;
      background: var(--uvm-barra, var(--mat-sys-primary));
    }
    .valor {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    @media (prefers-contrast: more) {
      .barra {
        outline: 1px solid var(--mat-sys-on-surface);
      }
    }
    /* En colores forzados los fondos desaparecen: la barra se dibuja con el texto. */
    @media (forced-colors: active) {
      .barra {
        background: CanvasText;
      }
    }
    /* En pantallas angostas la etiqueta va arriba y la barra usa todo el ancho. */
    @media (max-width: 30rem) {
      tr {
        display: grid;
      }
      th {
        width: auto;
        padding-block-end: 0;
      }
    }
  `,
})
export class GraficaBarras {
  readonly titulo = input.required<string>();
  readonly datos = input.required<readonly Barra[]>();
  /** El valor que llena la barra completa. Sin él, el mayor de los datos. */
  readonly maximo = input<number>();
  readonly columnaEtiqueta = input('Producto');
  readonly columnaValor = input('Valor');

  protected readonly barras = computed(() => {
    const datos = this.datos();
    const maximo = this.maximo() ?? Math.max(0, ...datos.map((d) => d.valor));
    return datos.map((d) => ({
      ...d,
      ancho: maximo > 0 ? Math.max(0, Math.min(100, (d.valor / maximo) * 85)) : 0,
    }));
  });
}
