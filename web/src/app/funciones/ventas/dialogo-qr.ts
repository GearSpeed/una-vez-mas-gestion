import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import type { Decimal, PosicionQr } from '@uvm/compartido';
import { qrDeTransferencia } from '../../core/qr-transferencia';

export interface DatosDialogoQr {
  readonly posicion: PosicionQr;
  /** El título del QR: «Mercado Pago», «Banco Azteca». */
  readonly titulo: string;
  readonly monto: Decimal;
}

/** El QR en grande, para que el cliente lo escanee de la pantalla del celular. */
@Component({
  selector: 'uvm-dialogo-qr',
  imports: [CurrencyPipe, MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Transferir {{ datos.monto | currency }}</h2>
    <mat-dialog-content class="contenido">
      @if (qr.url(); as url) {
        <img [src]="url" [alt]="'QR de ' + datos.titulo + ' para transferir'" class="qr" />
      } @else if (qr.recurso.error()) {
        <p role="alert">No se pudo cargar el QR; pásale la CLABE.</p>
      } @else {
        <p role="status">Cargando el QR…</p>
      }
      <p>
        <strong>{{ datos.titulo }}</strong>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close>Listo</button>
    </mat-dialog-actions>
  `,
  styles: `
    .contenido {
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      text-align: center;
    }
    .qr {
      width: min(20rem, 100%);
      height: auto;
      /* El QR se lee sobre blanco aunque la app esté en modo oscuro. */
      background: #fff;
      padding: 0.75rem;
      border-radius: 0.5rem;
    }
    p {
      margin: 0;
    }
  `,
})
export class DialogoQr {
  protected readonly datos = inject<DatosDialogoQr>(MAT_DIALOG_DATA);
  protected readonly qr = qrDeTransferencia(() => this.datos.posicion);
}
