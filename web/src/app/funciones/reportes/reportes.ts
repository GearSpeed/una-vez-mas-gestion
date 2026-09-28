import { CurrencyPipe, DatePipe, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import {
  type AgruparVentasPor,
  type Categoria,
  type ComisionVendedor,
  fechaDeHoy,
  type FilaReporteCompras,
  type FilaReporteVentas,
  type EstadoResultados,
  type FilaUtilidad,
  inicioDeMes,
  sumar,
} from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { type DatosDialogoGasto, DialogoGasto } from '../gastos/dialogo-gasto';
import { AvisosService } from '../../core/avisos';
import { DescargasService } from '../../core/descargas';
import { mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { CorteVendedor } from './corte';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';

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
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reportes {
  private readonly sesion = inject(SesionService);
  private readonly dialogo = inject(MatDialog);
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

  /** El resultado del periodo: de lo vendido a lo que de verdad quedó. */
  protected readonly resultado = httpResource<EstadoResultados>(() =>
    this.verCostos() ? conParametros('/reportes/resultado', this.periodo()) : undefined,
  );

  /** Lo que se le debe a cada quien por vender: ganado de siempre menos pagado. */
  protected readonly comisiones = httpResource<ComisionVendedor[]>(() =>
    this.verCostos() ? conParametros('/reportes/comisiones', this.periodo()) : undefined,
  );
  private readonly categoriasGasto = httpResource<Categoria[]>(() =>
    this.verCostos() ? '/api/gastos/categorias' : undefined,
  );
  protected readonly totalPorPagar = computed(() =>
    sumar((this.comisiones.value() ?? []).map((c) => c.saldo)),
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

  /**
   * Registrar el pago de la comisión: abre el gasto ya lleno con la categoría, la
   * persona y su saldo. El monto se puede cambiar —un abono parcial es normal— y el
   * saldo se recalcula solo.
   */
  protected pagar(comision: ComisionVendedor): void {
    const datos: DatosDialogoGasto = {
      categorias: this.categoriasGasto.value() ?? [],
      vendedores: [{ id: comision.vendedorId, nombre: comision.vendedor }],
      inicial: {
        categoria: 'Comisiones',
        vendedorId: comision.vendedorId,
        importe: comision.saldo,
        concepto: `Comisión de ${comision.vendedor}`,
      },
    };
    this.dialogo
      .open<DialogoGasto, DatosDialogoGasto>(DialogoGasto, {
        data: datos,
        width: '34rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((gasto) => {
        if (!gasto) return;
        this.avisos.exito(`Pago registrado: ${gasto.folio} por $${gasto.importe}.`);
        this.comisiones.reload();
        this.resultado.reload();
      });
  }
}
