import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import type { Decimal } from '@uvm/compartido';

export interface DatosDialogoQr {
  /** URL local (`blob:`) del QR ya descargado. */
  readonly url: string;
  readonly monto: Decimal;
  readonly banco: string;
  readonly titular: string;
}

/** El QR en grande, para que el cliente lo escanee de la pantalla del celular. */
@Component({
  selector: 'uvm-dialogo-qr',
  imports: [CurrencyPipe, MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Transferir {{ datos.monto | currency }}</h2>
    <mat-dialog-content class="contenido">
      <img
        [src]="datos.url"
        [alt]="'QR para transferir a ' + datos.titular + ' en ' + datos.banco"
        class="qr"
      />
      <p>
        <strong>{{ datos.titular }}</strong> · {{ datos.banco }}
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
}
