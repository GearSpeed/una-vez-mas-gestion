import { CurrencyPipe, DatePipe, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type AgruparVentasPor,
  fechaDeHoy,
  type FilaReporteCompras,
  type FilaReporteVentas,
  type FilaUtilidad,
  inicioDeMes,
  sumar,
} from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { DescargasService } from '../../core/descargas';
import { mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { CorteVendedor } from './corte';

const AGRUPACIONES: readonly { valor: AgruparVentasPor; etiqueta: string }[] = [
  { valor: 'dia', etiqueta: 'Día' },
  { valor: 'producto', etiqueta: 'Producto' },
  { valor: 'vendedor', etiqueta: 'Vendedor' },
  { valor: 'canal', etiqueta: 'Canal' },
  { valor: 'metodo', etiqueta: 'Método de pago' },
];

@Component({
  selector: 'uvm-reportes',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    CorteVendedor,
    CurrencyPipe,
    DatePipe,
    PercentPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
  ],
  templateUrl: './reportes.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reportes {
  private readonly sesion = inject(SesionService);
  private readonly descargas = inject(DescargasService);
  private readonly avisos = inject(AvisosService);

  protected readonly verCostos = computed(() => this.sesion.puede('costos.ver'));
  protected readonly agrupaciones = AGRUPACIONES;

  protected readonly desde = signal(inicioDeMes(fechaDeHoy()));
  protected readonly hasta = signal(fechaDeHoy());
  protected readonly agrupar = signal<AgruparVentasPor>('dia');

  private readonly periodo = computed(() => ({ desde: this.desde(), hasta: this.hasta() }));
  protected readonly ventas = httpResource<FilaReporteVentas[]>(() =>
    conParametros('/reportes/ventas', { ...this.periodo(), agrupar: this.agrupar() }),
  );
  protected readonly utilidad = httpResource<FilaUtilidad[]>(() =>
    this.verCostos() ? conParametros('/reportes/utilidad', this.periodo()) : undefined,
  );
  protected readonly compras = httpResource<FilaReporteCompras[]>(() =>
    conParametros('/reportes/compras', this.periodo()),
  );

  protected readonly totalVentas = computed(() =>
    sumar((this.ventas.value() ?? []).map((f) => f.importe)),
  );
  protected readonly totalUtilidad = computed(() =>
    sumar((this.utilidad.value() ?? []).map((f) => f.utilidad)),
  );
  protected readonly totalCompras = computed(() => ({
    mercancia: sumar((this.compras.value() ?? []).map((f) => f.mercancia)),
    gasolina: sumar((this.compras.value() ?? []).map((f) => f.gasolina)),
    total: sumar((this.compras.value() ?? []).map((f) => f.total)),
  }));

  protected async exportar(reporte: 'ventas' | 'utilidad' | 'compras'): Promise<void> {
    const extra = reporte === 'ventas' ? { agrupar: this.agrupar() } : {};
    try {
      await this.descargas.csv(
        conParametros(`/reportes/${reporte}`, { ...this.periodo(), ...extra, formato: 'csv' }),
        `${reporte}-${this.desde()}-a-${this.hasta()}.csv`,
      );
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }
}
