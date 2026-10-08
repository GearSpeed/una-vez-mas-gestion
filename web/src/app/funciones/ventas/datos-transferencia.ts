import { Clipboard } from '@angular/cdk/clipboard';
import { CurrencyPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  clabeLegible,
  type DatosTransferencia,
  type Decimal,
  type QrTransferencia,
} from '@uvm/compartido';
import { AvisosService } from '../../core/avisos';
import { type DatosDialogoQr, DialogoQr } from './dialogo-qr';

/**
 * A dónde transfiere el cliente, a la vista de quien cobra: la CLABE para copiarla
 * y mandarla por WhatsApp, o uno de los QR en grande para que lo escanee.
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
          @for (q of c.qrs; track q.posicion) {
            <button mat-stroked-button type="button" (click)="mostrarQr(q)">
              <mat-icon aria-hidden="true">qr_code_2</mat-icon>
              Mostrar QR · {{ q.titulo }}
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

  /** El diálogo descarga su QR: solo se pide el que se va a enseñar. */
  protected mostrarQr(qr: QrTransferencia): void {
    this.dialogo.open<DialogoQr, DatosDialogoQr>(DialogoQr, {
      data: { posicion: qr.posicion, titulo: qr.titulo, monto: this.monto() },
      maxWidth: '95vw',
    });
  }
}
