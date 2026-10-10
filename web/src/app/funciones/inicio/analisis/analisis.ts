import { CurrencyPipe, DatePipe, DecimalPipe, formatDate, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type AnalisisVentas,
  DIAS_A_LLEVAR,
  fechaDeHoy,
  inicioDeMes,
  porcentajeVendido,
  sugeridoLlevar,
  sumarDias,
  ventasPorDia,
} from '@uvm/compartido';
import { conParametros } from '../../../core/api';
import { AvisosService } from '../../../core/avisos';
import { DescargasService } from '../../../core/descargas';
import { mensajeDeError } from '../../../core/errores';
import { Desplazable } from '../../../ui/desplazable';
import { EstadoCarga } from '../../../ui/estado-carga';
import { type Barra, GraficaBarras } from '../../../ui/grafica-barras';
import { GraficaLineas } from '../../../ui/grafica-lineas';
import { AnalisisMatriz } from './analisis-matriz';

type ClavePeriodo = '7' | '30' | 'mes' | '90' | '365';

const PERIODOS: readonly { valor: ClavePeriodo; etiqueta: string }[] = [
  { valor: '7', etiqueta: 'Últimos 7 días' },
  { valor: '30', etiqueta: 'Últimos 30 días' },
  { valor: 'mes', etiqueta: 'Este mes' },
  { valor: '90', etiqueta: 'Últimos 90 días' },
  { valor: '365', etiqueta: 'Último año' },
];

/**
 * Análisis de ventas de Inicio: qué se vendió, qué se acabó primero y cómo van las
 * piezas por día, mes y año, con el sugerido de qué llevar y el mismo análisis en Excel.
 */
@Component({
  selector: 'uvm-analisis-ventas',
  imports: [
    AnalisisMatriz,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    Desplazable,
    EstadoCarga,
    GraficaBarras,
    GraficaLineas,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    PercentPipe,
    ReactiveFormsModule,
  ],
  templateUrl: './analisis.html',
  styleUrl: './analisis.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalisisVentasSeccion {
  private readonly descargas = inject(DescargasService);
  private readonly avisos = inject(AvisosService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly periodos = PERIODOS;
  protected readonly clavePeriodo = signal<ClavePeriodo>('30');
  protected readonly diasALlevar = new FormControl(DIAS_A_LLEVAR, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(1), Validators.max(90)],
  });
  private readonly diasEscritos = toSignal(this.diasALlevar.valueChanges, {
    initialValue: DIAS_A_LLEVAR,
  });
  /** Mientras lo escrito no sea válido, el sugerido se queda con el último bueno. */
  protected readonly dias = linkedSignal<number, number>({
    source: this.diasEscritos,
    computation: (dias, anterior) =>
      Number.isInteger(dias) && dias >= 1 && dias <= 90 ? dias : (anterior?.value ?? DIAS_A_LLEVAR),
  });
  protected readonly descargando = signal(false);

  private readonly rango = computed(() => {
    const hasta = fechaDeHoy();
    const clave = this.clavePeriodo();
    const desde = clave === 'mes' ? inicioDeMes(hasta) : sumarDias(hasta, -(Number(clave) - 1));
    return { desde, hasta };
  });

  protected readonly analisis = httpResource<AnalisisVentas>(() =>
    conParametros('/reportes/analisis', this.rango()),
  );

  protected readonly filas = computed(() => {
    const a = this.analisis.value();
    if (!a) return [];
    return a.productos.map((p) => {
      const porcentaje = porcentajeVendido(p.vendidas, p.inicial + p.compradas);
      return {
        ...p,
        porcentaje: porcentaje === null ? null : Number(porcentaje),
        porDia: Number(ventasPorDia(p.vendidas, a.dias)),
        sugerido: sugeridoLlevar({
          vendidas: p.vendidas,
          dias: a.dias,
          diasALlevar: this.dias(),
          existencia: p.existencia,
        }),
      };
    });
  });

  protected readonly conExistencia = computed(() => this.filas().filter((f) => f.existencia > 0));

  protected readonly barrasVendidas = computed((): Barra[] =>
    this.filas().map((f) => ({ etiqueta: f.producto, valor: f.vendidas, texto: `${f.vendidas}` })),
  );

  protected readonly barrasPorcentaje = computed((): Barra[] =>
    this.filas().map((f) => ({
      etiqueta: f.producto,
      valor: f.porcentaje ?? 0,
      texto: f.porcentaje === null ? 'Sin existencias' : `${Math.round(f.porcentaje * 100)} %`,
    })),
  );

  protected readonly barrasAgotamiento = computed((): Barra[] =>
    (this.analisis.value()?.agotados ?? [])
      .filter((g) => g.diasEnAgotarse !== null)
      .map((g) => ({
        etiqueta: `${g.lugar}. ${g.producto}`,
        valor: g.diasEnAgotarse ?? 0,
        texto: g.diasEnAgotarse === 1 ? '1 día' : `${g.diasEnAgotarse} días`,
      })),
  );

  protected readonly diario = computed(() => {
    const m = this.analisis.value()?.diario;
    if (!m) return null;
    const etiquetas = m.periodos.map((p) => formatDate(p, 'd MMM', this.locale));
    const top = m.filas.slice(0, 5);
    return {
      etiquetas,
      total: [{ nombre: 'Total', valores: m.totales }],
      top: top.map((f) => ({ nombre: f.producto, valores: f.piezas })),
      // Para el celular: un día por renglón, el más reciente arriba.
      renglones: m.periodos.map((_, k) => {
        const i = m.periodos.length - 1 - k;
        return {
          periodo: m.periodos[i] ?? '',
          total: m.totales[i] ?? 0,
          piezas: top.map((f) => f.piezas[i] ?? 0),
        };
      }),
      columnas: top.map((f) => f.producto),
    };
  });

  protected readonly mensual = computed(() => {
    const m = this.analisis.value()?.mensual;
    if (!m) return null;
    return {
      etiquetas: m.periodos.map((p) => formatDate(p, 'MMM y', this.locale)),
      total: [{ nombre: 'Total', valores: m.totales }],
    };
  });

  protected cambiarPeriodo(clave: ClavePeriodo): void {
    this.clavePeriodo.set(clave);
  }

  protected async descargarExcel(): Promise<void> {
    const { desde, hasta } = this.rango();
    this.descargando.set(true);
    try {
      await this.descargas.descargar(
        conParametros('/reportes/analisis/excel', { desde, hasta, diasALlevar: this.dias() }),
        `analisis-ventas-${desde}-a-${hasta}.xlsx`,
      );
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.descargando.set(false);
    }
  }
}
