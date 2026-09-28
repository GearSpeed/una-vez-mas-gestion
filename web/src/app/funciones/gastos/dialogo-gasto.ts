import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type Categoria,
  fechaDeHoy,
  type Gasto,
  METODOS_PAGO,
  type MetodoPago,
} from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave } from '../../ui/claves';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';

export interface DatosDialogoGasto {
  readonly categorias: readonly Categoria[];
  /**
   * A quién se le puede pagar. Si viene vacío, el campo no se muestra: no todos los
   * gastos son un pago a alguien, y quien registra gastos no siempre puede ver la
   * lista de usuarios.
   */
  readonly vendedores?: readonly { readonly id: number; readonly nombre: string }[];
  /** Con qué abre, cuando se registra un pago desde la pantalla de Comisiones. */
  readonly inicial?: {
    readonly categoria?: string;
    readonly vendedorId?: number;
    readonly importe?: string;
    readonly concepto?: string;
  };
}

/** Alta de un gasto: lo que salió, de dónde salió y por qué. */
@Component({
  selector: 'uvm-dialogo-gasto',
  imports: [
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
  templateUrl: './dialogo-gasto.html',
  styleUrl: './dialogo-gasto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoGasto {
  protected readonly datos = inject<DatosDialogoGasto>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoGasto, Gasto>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly metodos = METODOS_PAGO;
  protected readonly hoy = fechaDeHoy();
  protected readonly metodoPago = signal<MetodoPago>('efectivo');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly clave = nuevaClave();

  protected readonly vendedores = this.datos.vendedores ?? [];

  /** La categoría con la que abre, buscada por nombre: los ids cambian entre bases. */
  private readonly categoriaInicial =
    this.datos.categorias.find((c) => c.nombre === this.datos.inicial?.categoria)?.id ?? null;

  protected readonly formulario = this.fb.group({
    fecha: [this.hoy, Validators.required],
    categoriaId: this.fb.control<number | null>(this.categoriaInicial, Validators.required),
    concepto: [
      this.datos.inicial?.concepto ?? '',
      [Validators.required, Validators.maxLength(200)],
    ],
    importe: this.fb.control<number | null>(
      this.datos.inicial?.importe ? Number(this.datos.inicial.importe) : null,
      [Validators.required, Validators.min(0.01)],
    ),
    vendedorId: this.fb.control<number | null>(this.datos.inicial?.vendedorId ?? null),
    notas: [''],
  });

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      const gasto = await this.api.post<Gasto>('/gastos', {
        ...this.formulario.getRawValue(),
        claveIdempotencia: this.clave,
        importe: String(this.formulario.getRawValue().importe),
        metodoPago: this.metodoPago(),
      });
      this.referencia.close(gasto);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
