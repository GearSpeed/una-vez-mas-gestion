import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import type { VentaDetalle } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { DialogoMotivo, type DatosDialogoMotivo } from '../../ui/dialogo-motivo';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

@Component({
  selector: 'uvm-detalle-venta',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    RouterLink,
    MatButtonModule,
  ],
  templateUrl: './detalle-venta.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetalleVenta {
  private readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = inject(MatDialog);

  /** Viene de la ruta `/ventas/:id`. */
  readonly id = input.required<string>();

  protected readonly venta = httpResource<VentaDetalle>(() => `/api/ventas/${this.id()}`);
  protected readonly titulo = computed(() =>
    this.venta.value() ? `Venta ${this.venta.value()?.folio}` : 'Venta',
  );
  protected readonly puedeCancelar = computed(
    () => this.sesion.puede('ventas.cancelar') && this.venta.value()?.estado === 'vigente',
  );
  protected readonly cancelando = signal(false);

  protected cancelar(): void {
    const venta = this.venta.value();
    if (!venta) return;
    const datos: DatosDialogoMotivo = {
      titulo: `Cancelar la venta ${venta.folio}`,
      explicacion: `Las ${venta.piezas} piezas regresan a ${venta.ubicacion}. La venta queda registrada como cancelada.`,
      confirmar: 'Cancelar venta',
    };
    this.dialogo
      .open<DialogoMotivo, DatosDialogoMotivo, string>(DialogoMotivo, {
        data: datos,
        width: '28rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((motivo) => {
        if (motivo) void this.confirmarCancelacion(venta.id, motivo);
      });
  }

  private async confirmarCancelacion(id: number, motivo: string): Promise<void> {
    this.cancelando.set(true);
    try {
      const cancelada = await this.api.post<VentaDetalle>(`/ventas/${id}/cancelar`, { motivo });
      this.venta.set(cancelada);
      this.avisos.exito(`La venta ${cancelada.folio} quedó cancelada.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.cancelando.set(false);
    }
  }
}
