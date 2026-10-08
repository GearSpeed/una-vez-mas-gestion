import { Clipboard } from '@angular/cdk/clipboard';
import { CurrencyPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { clabeLegible, type DatosTransferencia, type Decimal } from '@uvm/compartido';
import { AvisosService } from '../../core/avisos';
import { qrDeTransferencia } from '../../core/qr-transferencia';
import { type DatosDialogoQr, DialogoQr } from './dialogo-qr';

/**
 * A dónde transfiere el cliente, a la vista de quien cobra: la CLABE para copiarla
 * y mandarla por WhatsApp, o el QR en grande para que lo escanee.
 */
@Component({
  selector: 'uvm-datos-transferencia',
  imports: [CurrencyPipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="transferencia" aria-labelledby="titulo-transferencia">
      <h3 id="titulo-transferencia">Datos para transferir {{ monto() | currency }}</h3>
      @if (cuenta.value(); as c) {
        <dl>
          <dt>Banco</dt>
          <dd>{{ c.banco }}</dd>
          <dt>A nombre de</dt>
          <dd>{{ c.titular }}</dd>
          <dt>CLABE</dt>
          <dd class="clabe">{{ clabe() }}</dd>
        </dl>
        <div class="acciones">
          <button mat-stroked-button type="button" (click)="copiar(c)">
            <mat-icon aria-hidden="true">content_copy</mat-icon>
            Copiar datos
          </button>
          @if (c.tieneQr) {
            <button mat-stroked-button type="button" (click)="mostrarQr(c)" [disabled]="!qr.url()">
              <mat-icon aria-hidden="true">qr_code_2</mat-icon>
              Mostrar QR
            </button>
          }
        </div>
      } @else if (cuenta.isLoading()) {
        <p class="ayuda">Cargando los datos de la cuenta…</p>
      } @else if (cuenta.error()) {
        <p class="ayuda">No se pudieron cargar los datos de la cuenta.</p>
      } @else {
        <p class="ayuda">Aún no hay datos de transferencia; pídelos al administrador.</p>
      }
    </section>
  `,
  styles: `
    .transferencia {
      display: grid;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      background: var(--mat-sys-surface-container);
    }
    h3 {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 1rem;
      margin: 0;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .clabe {
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.05em;
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class DatosTransferenciaVenta {
  /** Lo que se cobra por transferencia en esta venta. */
  readonly monto = input.required<Decimal>();

  private readonly portapapeles = inject(Clipboard);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(AvisosService);

  protected readonly cuenta = httpResource<DatosTransferencia | null>(() => '/api/transferencia');
  protected readonly qr = qrDeTransferencia(() => this.cuenta.value()?.tieneQr ?? false);
  protected readonly clabe = computed(() => {
    const cuenta = this.cuenta.value();
    return cuenta ? clabeLegible(cuenta.clabe) : '';
  });

  /** Lo que se pega en el chat: la CLABE va sin espacios para que el banco la acepte. */
  protected copiar(cuenta: DatosTransferencia): void {
    const texto = `${cuenta.banco}\n${cuenta.titular}\nCLABE: ${cuenta.clabe}`;
    if (this.portapapeles.copy(texto)) this.avisos.exito('Datos copiados.');
    else this.avisos.error('No se pudo copiar; díctale la CLABE.');
  }

  protected mostrarQr(cuenta: DatosTransferencia): void {
    const url = this.qr.url();
    if (!url) return;
    this.dialogo.open<DialogoQr, DatosDialogoQr>(DialogoQr, {
      data: { url, monto: this.monto(), banco: cuenta.banco, titular: cuenta.titular },
      maxWidth: '95vw',
    });
  }
}
