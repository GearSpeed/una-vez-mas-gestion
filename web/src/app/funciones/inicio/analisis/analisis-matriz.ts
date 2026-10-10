import { DatePipe, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
} from '@angular/core';
import type { MatrizPiezas } from '@uvm/compartido';
import { Desplazable } from '../../../ui/desplazable';
import { type Barra, GraficaBarras } from '../../../ui/grafica-barras';

/** Piezas por producto y periodo (mes o año): la tabla y el total de cada periodo. */
@Component({
  selector: 'uvm-analisis-matriz',
  imports: [DatePipe, Desplazable, GraficaBarras],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (matriz().filas.length) {
      <uvm-grafica-barras
        [titulo]="'Piezas vendidas por ' + unidad()"
        [datos]="totales()"
        [columnaEtiqueta]="unidad() === 'mes' ? 'Mes' : 'Año'"
        columnaValor="Piezas"
      />
      <div [uvmDesplazable]="'Piezas por producto y ' + unidad()">
        <table class="tabla-simple">
          <caption class="visualmente-oculto">
            Piezas vendidas por producto y
            {{
              unidad()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              @for (p of matriz().periodos; track p) {
                <th scope="col" class="numero">{{ p | date: formato() }}</th>
              }
              <th scope="col" class="numero">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (fila of matriz().filas; track fila.productoId) {
              <tr>
                <th scope="row">{{ fila.producto }}</th>
                @for (piezas of fila.piezas; track $index) {
                  <td class="numero">{{ piezas }}</td>
                }
                <td class="numero">
                  <strong>{{ fila.total }}</strong>
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              @for (total of matriz().totales; track $index) {
                <td class="numero">
                  <strong>{{ total }}</strong>
                </td>
              }
              <td class="numero">
                <strong>{{ granTotal() }}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      @if (matriz().periodos.length === 1) {
        <p class="ayuda">
          Por ahora solo hay un {{ unidad() }} con ventas: la tendencia se verá conforme pasen los
          {{ unidad() === 'mes' ? 'meses' : 'años' }}. Mientras, «Por día» la muestra dentro del
          mes.
        </p>
      }
    } @else {
      <p class="ayuda">Todavía no hay ventas en estos periodos.</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 1rem;
    }
  `,
})
export class AnalisisMatriz {
  private readonly locale = inject(LOCALE_ID);
  readonly matriz = input.required<MatrizPiezas>();
  readonly unidad = input.required<'mes' | 'año'>();

  protected readonly formato = computed(() => (this.unidad() === 'mes' ? 'MMM y' : 'y'));
  protected readonly granTotal = computed(() => this.matriz().totales.reduce((a, b) => a + b, 0));
  protected readonly totales = computed((): Barra[] => {
    const formato = this.formato();
    const { periodos, totales } = this.matriz();
    return periodos.map((p, i) => ({
      etiqueta: formatDate(p, formato, this.locale),
      valor: totales[i] ?? 0,
      texto: `${totales[i] ?? 0}`,
    }));
  });
}
