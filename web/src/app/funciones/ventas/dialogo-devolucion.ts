import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { comisionDevuelta, reembolsoDeLinea, sumar, type VentaDetalle } from '@uvm/compartido';
import { startWith } from 'rxjs';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave, numeroONulo } from '../../ui/claves';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

/**
 * Devolución de piezas de una venta. Por cada producto se elige cuántas regresan
 * y si vuelven a la venta o llegaron dañadas. Se reembolsa la parte proporcional
 * de la línea, con el mismo método con que pagó el cliente.
 */
@Component({
  selector: 'uvm-dialogo-devolucion',
  imports: [
    ReactiveFormsModule,
    CurrencyPipe,
    EtiquetaPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './dialogo-devolucion.html',
  styleUrl: './dialogo-devolucion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoDevolucion {
  protected readonly venta = inject<VentaDetalle>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoDevolucion, VentaDetalle>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Solo las líneas que todavía tienen piezas por devolver. */
  protected readonly pendientes = this.venta.lineas
    .map((linea) => ({ ...linea, quedan: linea.cantidad - linea.devueltas }))
    .filter((linea) => linea.quedan > 0);

  protected readonly formulario = this.fb.group({
    motivo: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(300)]],
    lineas: this.fb.array(
      this.pendientes.map((linea) =>
        this.fb.group({
          cantidad: this.fb.control<number | null>(0, [
            Validators.min(0),
            Validators.max(linea.quedan),
          ]),
          regresaAInventario: [true],
        }),
      ),
    ),
  });
  protected readonly lineas = this.formulario.controls.lineas;

  private readonly valor = toSignal(
    this.formulario.valueChanges.pipe(startWith(this.formulario.getRawValue())),
    { initialValue: this.formulario.getRawValue() },
  );

  /** Lo que se le regresará al cliente, con la misma cuenta que hará la API. */
  protected readonly reembolso = computed(() =>
    sumar(
      this.pendientes.map((linea, i) => {
        const cantidad = Math.trunc(numeroONulo(this.valor().lineas?.[i]?.cantidad) ?? 0);
        if (cantidad <= 0 || cantidad > linea.quedan) return '0';
        return reembolsoDeLinea({
          importe: linea.importe,
          cantidadVendida: linea.cantidad,
          devueltasAntes: linea.devueltas,
          reembolsadoAntes: linea.reembolsado,
          cantidad,
        });
      }),
    ),
  );

  /** Lo que retuvo Mercado Pago al cobrar y lo que ya regresó en devoluciones anteriores. */
  private readonly comisionDevueltaAntes = sumar(
    this.venta.devoluciones.map((d) => d.comisionDevuelta),
  );
  private readonly comisionCobrada = sumar([this.venta.comision, this.comisionDevueltaAntes]);
  protected readonly conComision = this.comisionCobrada !== '0.00';
  /** La parte de su comisión que regresa Mercado Pago, con la misma cuenta que la API. */
  protected readonly comisionQueRegresa = computed(() =>
    comisionDevuelta({
      comision: this.comisionCobrada,
      total: this.venta.total,
      reembolsadoAntes: this.venta.reembolsado,
      devueltaAntes: this.comisionDevueltaAntes,
      reembolso: this.reembolso(),
    }),
  );
  protected readonly piezas = computed(() =>
    (this.valor().lineas ?? []).reduce(
      (suma, linea) => suma + Math.max(0, Math.trunc(numeroONulo(linea?.cantidad) ?? 0)),
      0,
    ),
  );

  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly clave = nuevaClave();

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    if (this.piezas() === 0) {
      this.error.set('Indica cuántas piezas regresan.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    const valor = this.formulario.getRawValue();
    try {
      const venta = await this.api.post<VentaDetalle>(`/ventas/${this.venta.id}/devoluciones`, {
        claveIdempotencia: this.clave,
        motivo: valor.motivo,
        lineas: this.pendientes.flatMap((linea, i) => {
          const cantidad = Math.trunc(numeroONulo(valor.lineas[i]?.cantidad) ?? 0);
          return cantidad > 0
            ? [
                {
                  productoId: linea.productoId,
                  cantidad,
                  regresaAInventario: valor.lineas[i]?.regresaAInventario ?? true,
                },
              ]
            : [];
        }),
      });
      this.referencia.close(venta);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
