import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import type { CompraDetalle } from '@uvm/compartido';
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
  selector: 'uvm-detalle-compra',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
  ],
  templateUrl: './detalle-compra.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetalleCompra {
  private readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = inject(MatDialog);

  /** Viene de la ruta `/compras/:id`. */
  readonly id = input.required<string>();

  protected readonly compra = httpResource<CompraDetalle>(() => `/api/compras/${this.id()}`);
  protected readonly titulo = computed(() =>
    this.compra.value() ? `Compra ${this.compra.value()?.folio}` : 'Compra',
  );
  protected readonly puedeCancelar = computed(
    () => this.sesion.puede('compras.cancelar') && this.compra.value()?.estado === 'vigente',
  );
  protected readonly cancelando = signal(false);

  protected cancelar(): void {
    const compra = this.compra.value();
    if (!compra) return;
    const datos: DatosDialogoMotivo = {
      titulo: `Cancelar la compra ${compra.folio}`,
      explicacion:
        'Las piezas salen del inventario y el costo promedio vuelve a como estaba. Solo se puede si no se ha vendido ni ajustado nada de esos productos desde esta compra.',
      confirmar: 'Cancelar compra',
    };
    this.dialogo
      .open<DialogoMotivo, DatosDialogoMotivo, string>(DialogoMotivo, {
        data: datos,
        width: '30rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((motivo) => {
        if (motivo) void this.confirmarCancelacion(compra.id, motivo);
      });
  }

  private async confirmarCancelacion(id: number, motivo: string): Promise<void> {
    this.cancelando.set(true);
    try {
      const cancelada = await this.api.post<CompraDetalle>(`/compras/${id}/cancelar`, { motivo });
      this.compra.set(cancelada);
      this.avisos.exito(`La compra ${cancelada.folio} quedó cancelada.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.cancelando.set(false);
    }
  }
}
