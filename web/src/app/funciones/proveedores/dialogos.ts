import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { Proveedor, Vehiculo } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';

const IMPORTS = [
  ReactiveFormsModule,
  MatButtonModule,
  MatCheckboxModule,
  MatDialogModule,
  MatFormFieldModule,
  MatInputModule,
];

@Component({
  selector: 'uvm-dialogo-proveedor',
  imports: IMPORTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ proveedor ? 'Editar proveedor' : 'Nuevo proveedor' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content class="rejilla-campos">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" cdkFocusInitial />
          @if (formulario.controls.nombre.invalid) {
            <mat-error>{{
              formulario.controls.nombre.getError('servidor') ?? 'Escribe el nombre.'
            }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Kilómetros ida y vuelta</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0"
            step="0.1"
            formControlName="distanciaKm"
          />
          <mat-hint>Desde el almacén: con esto se calcula la gasolina.</mat-hint>
          @if (formulario.controls.distanciaKm.invalid) {
            <mat-error>Indica los kilómetros (0 si entrega el proveedor).</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Contacto</mat-label>
          <input matInput formControlName="contacto" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Teléfono</mat-label>
          <input matInput type="tel" formControlName="telefono" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Qué surte</mat-label>
          <input matInput formControlName="categoriasQueSurte" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Notas</mat-label>
          <input matInput formControlName="notas" />
        </mat-form-field>
        <mat-checkbox formControlName="activo">Activo</mat-checkbox>
        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="guardando()">Guardar</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class DialogoProveedor {
  protected readonly proveedor = inject<Proveedor | null>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoProveedor, Proveedor>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly formulario = this.fb.group({
    nombre: [this.proveedor?.nombre ?? '', Validators.required],
    distanciaKm: this.fb.control<number | null>(
      this.proveedor ? Number(this.proveedor.distanciaKm) : null,
      [Validators.required, Validators.min(0)],
    ),
    contacto: [this.proveedor?.contacto ?? ''],
    telefono: [this.proveedor?.telefono ?? ''],
    categoriasQueSurte: [this.proveedor?.categoriasQueSurte ?? ''],
    notas: [this.proveedor?.notas ?? ''],
    activo: [this.proveedor?.activo ?? true],
  });
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    try {
      const valor = this.formulario.getRawValue();
      const guardado = this.proveedor
        ? await this.api.put<Proveedor>(`/proveedores/${this.proveedor.id}`, valor)
        : await this.api.post<Proveedor>('/proveedores', valor);
      this.referencia.close(guardado);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}

@Component({
  selector: 'uvm-dialogo-vehiculo',
  imports: IMPORTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ vehiculo ? 'Editar vehículo' : 'Nuevo vehículo' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content class="rejilla-campos">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" cdkFocusInitial />
          @if (formulario.controls.nombre.invalid) {
            <mat-error>{{
              formulario.controls.nombre.getError('servidor') ?? 'Escribe el nombre.'
            }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Rendimiento</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.1"
            formControlName="rendimientoKmL"
          />
          <span matTextSuffix>&nbsp;km/l</span>
          @if (formulario.controls.rendimientoKmL.invalid) {
            <mat-error>Debe ser mayor que cero.</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Notas</mat-label>
          <input matInput formControlName="notas" />
        </mat-form-field>
        <mat-checkbox formControlName="activo">Activo</mat-checkbox>
        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="guardando()">Guardar</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class DialogoVehiculo {
  protected readonly vehiculo = inject<Vehiculo | null>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoVehiculo, Vehiculo>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly formulario = this.fb.group({
    nombre: [this.vehiculo?.nombre ?? '', Validators.required],
    rendimientoKmL: this.fb.control<number | null>(
      this.vehiculo ? Number(this.vehiculo.rendimientoKmL) : null,
      [Validators.required, Validators.min(0.01)],
    ),
    notas: [this.vehiculo?.notas ?? ''],
    activo: [this.vehiculo?.activo ?? true],
  });
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    try {
      const valor = this.formulario.getRawValue();
      const guardado = this.vehiculo
        ? await this.api.put<Vehiculo>(`/vehiculos/${this.vehiculo.id}`, valor)
        : await this.api.post<Vehiculo>('/vehiculos', valor);
      this.referencia.close(guardado);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
