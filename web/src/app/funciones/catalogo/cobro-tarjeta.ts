import { PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { type ComisionPago, dividir, multiplicar } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { EstadoCarga } from '../../ui/estado-carga';

/** Porcentaje de 0 a 99.99, con hasta dos decimales. */
const PORCENTAJE = /^\d{1,2}(\.\d{1,2})?$/;

/**
 * Lo que retiene Mercado Pago por cobrar con tarjeta: su tasa y el IVA sobre esa
 * tasa. Lo absorbe el negocio y solo aplica a las ventas nuevas.
 */
@Component({
  selector: 'uvm-cobro-tarjeta',
  imports: [
    ReactiveFormsModule,
    PercentPipe,
    EstadoCarga,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <uvm-estado-carga
      [cargando]="tarifas.isLoading()"
      [error]="tarifas.error()"
      (reintentar)="tarifas.reload()"
    />
    @if (tarjeta(); as t) {
      <p>
        Mercado Pago retiene <strong>{{ t.tasaEfectiva | percent: '1.2-2' }}</strong> de cada cobro
        con tarjeta ({{ t.tasa | percent: '1.2-2' }} más {{ t.iva | percent: '1.0-2' }} de IVA sobre
        esa comisión). Lo absorbe el negocio: el cliente paga el precio normal.
      </p>
      @if (puedeEditar()) {
        <form class="acciones" [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
          <mat-form-field>
            <mat-label>Comisión (%)</mat-label>
            <input matInput inputmode="decimal" formControlName="tasa" />
            @if (formulario.controls.tasa.invalid) {
              <mat-error>Un porcentaje menor a 100, con hasta 2 decimales.</mat-error>
            }
          </mat-form-field>
          <mat-form-field>
            <mat-label>IVA sobre la comisión (%)</mat-label>
            <input matInput inputmode="decimal" formControlName="iva" />
            @if (formulario.controls.iva.invalid) {
              <mat-error>Un porcentaje menor a 100, con hasta 2 decimales.</mat-error>
            }
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar' }}
          </button>
        </form>
        <p class="ayuda">Las ventas ya registradas conservan la comisión con que se cobraron.</p>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobroTarjeta {
  readonly puedeEditar = input(false);

  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly tarifas = httpResource<ComisionPago[]>(() => '/api/comisiones');
  protected readonly tarjeta = signal<ComisionPago | null>(null);
  protected readonly guardando = signal(false);

  protected readonly formulario = this.fb.group({
    tasa: ['', [Validators.required, Validators.pattern(PORCENTAJE)]],
    iva: ['', [Validators.required, Validators.pattern(PORCENTAJE)]],
  });

  constructor() {
    effect(() => {
      const tarjeta = this.tarifas.value()?.find((t) => t.metodoPago === 'tarjeta') ?? null;
      this.tarjeta.set(tarjeta);
      if (tarjeta) this.llenar(tarjeta);
    });
  }

  private llenar(tarjeta: ComisionPago): void {
    this.formulario.setValue({
      tasa: multiplicar(tarjeta.tasa, 100, 2),
      iva: multiplicar(tarjeta.iva, 100, 2),
    });
  }

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    const { tasa, iva } = this.formulario.getRawValue();
    try {
      const tarjeta = await this.api.put<ComisionPago>('/comisiones/tarjeta', {
        tasa: dividir(tasa, '100', 4),
        iva: dividir(iva, '100', 4),
      });
      this.tarjeta.set(tarjeta);
      this.llenar(tarjeta);
      this.avisos.exito('Comisión de tarjeta guardada.');
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
