import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  fechaDeHoy,
  METODOS_PAGO,
  type MetodoPago,
  type MovimientoCapital,
  type SaldosCaja,
  type Socio,
  TIPOS_CAPITAL,
  type TipoCapital,
} from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave } from '../../ui/claves';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';

export interface DatosDialogoCapital {
  readonly socios: readonly Socio[];
  /** Para avisar cuánto hay en esa bolsa antes de sacar dinero. */
  readonly saldos?: SaldosCaja | null;
}

/**
 * Alta de un movimiento de capital: quién puso o sacó dinero, cuánto y por dónde.
 * Un retiro que deje la caja en negativo no se bloquea —el dinero puede salir de
 * otro lado—, pero el saldo se enseña al capturarlo para que sea una decisión.
 */
@Component({
  selector: 'uvm-dialogo-capital',
  imports: [
    CurrencyPipe,
    EtiquetaPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './dialogo-capital.html',
  styleUrl: './dialogo-capital.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoCapital {
  protected readonly datos = inject<DatosDialogoCapital>(MAT_DIALOG_DATA);
  private readonly referencia =
    inject<MatDialogRef<DialogoCapital, MovimientoCapital>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly tipos = TIPOS_CAPITAL;
  protected readonly metodos = METODOS_PAGO;
  protected readonly hoy = fechaDeHoy();
  protected readonly tipo = signal<TipoCapital>('aportacion');
  protected readonly metodoPago = signal<MetodoPago>('efectivo');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly clave = nuevaClave();

  protected readonly sociosActivos = this.datos.socios.filter((s) => s.activo);

  /** Lo que debería haber en la bolsa elegida, para no sacar a ciegas. */
  protected readonly saldoDeLaBolsa = computed(() => {
    if (this.tipo() !== 'retiro') return null;
    const bolsa = this.datos.saldos?.bolsas.find((b) => b.metodoPago === this.metodoPago());
    return bolsa?.saldo ?? null;
  });

  protected readonly formulario = this.fb.group({
    fecha: [this.hoy, Validators.required],
    socioId: this.fb.control<number | null>(
      this.sociosActivos.length === 1 ? (this.sociosActivos[0]?.id ?? null) : null,
      Validators.required,
    ),
    concepto: ['', [Validators.required, Validators.maxLength(200)]],
    importe: this.fb.control<number | null>(null, [Validators.required, Validators.min(0.01)]),
    notas: [''],
  });

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      const movimiento = await this.api.post<MovimientoCapital>('/capital', {
        ...this.formulario.getRawValue(),
        claveIdempotencia: this.clave,
        importe: String(this.formulario.getRawValue().importe),
        tipo: this.tipo(),
        metodoPago: this.metodoPago(),
      });
      this.referencia.close(movimiento);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
