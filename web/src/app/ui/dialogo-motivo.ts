import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface DatosDialogoMotivo {
  readonly titulo: string;
  readonly explicacion: string;
  readonly confirmar: string;
}

/** Pide el motivo antes de algo que no se deshace (cancelar una venta o una compra). */
@Component({
  selector: 'uvm-dialogo-motivo',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ datos.titulo }}</h2>
    <mat-dialog-content>
      <p>{{ datos.explicacion }}</p>
      <mat-form-field class="campo">
        <mat-label>Motivo</mat-label>
        <textarea matInput [formControl]="motivo" rows="3" cdkFocusInitial required></textarea>
        @if (motivo.hasError('required') || motivo.hasError('minlength')) {
          <mat-error>Escribe el motivo (al menos 3 letras).</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>No, regresar</button>
      <button mat-flat-button type="button" (click)="aceptar()">{{ datos.confirmar }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .campo {
      width: 100%;
    }
  `,
})
export class DialogoMotivo {
  protected readonly datos = inject<DatosDialogoMotivo>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoMotivo, string>>(MatDialogRef);

  protected readonly motivo = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3)],
  });

  protected aceptar(): void {
    this.motivo.markAsTouched();
    if (this.motivo.valid) this.referencia.close(this.motivo.value.trim());
  }
}
