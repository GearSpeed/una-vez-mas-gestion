import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import {
  type AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { clabeLegible, clabeValida, type DatosTransferencia, POSICIONES_QR } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { EstadoCarga } from '../../ui/estado-carga';
import { QrDeCobro } from './qr-de-cobro';

/** Sin espacios ni guiones, como la guarda la API. */
const soloDigitos = (clabe: string) => clabe.replace(/[\s-]/g, '');

function validarClabe(control: AbstractControl<string>): ValidationErrors | null {
  const clabe = soloDigitos(control.value ?? '');
  if (!clabe) return null;
  if (!/^\d{18}$/.test(clabe)) return { digitos: true };
  return clabeValida(clabe) ? null : { verificador: true };
}

/**
 * La cuenta a la que transfieren los clientes. Quien cobra la ve en Nueva venta al
 * elegir «Transferencia»; aquí la captura quien administra el catálogo.
 */
@Component({
  selector: 'uvm-cobro-transferencia',
  imports: [
    ReactiveFormsModule,
    EstadoCarga,
    QrDeCobro,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './cobro-transferencia.html',
  styleUrl: './cobro-transferencia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobroTransferencia {
  readonly puedeEditar = input(false);

  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly lugares = viewChildren(QrDeCobro);

  protected readonly recurso = httpResource<DatosTransferencia | null>(() => '/api/transferencia');
  protected readonly datos = signal<DatosTransferencia | null>(null);
  protected readonly guardando = signal(false);
  protected readonly posiciones = POSICIONES_QR;
  protected readonly clabeLegible = clabeLegible;

  protected readonly formulario = this.fb.group({
    banco: ['', [Validators.required, Validators.maxLength(80)]],
    titular: ['', [Validators.required, Validators.maxLength(80)]],
    clabe: ['', [Validators.required, validarClabe]],
  });

  constructor() {
    effect(() => {
      const datos = this.recurso.value() ?? null;
      this.datos.set(datos);
      if (datos) this.llenar(datos);
    });
  }

  protected guardadoEn(datos: DatosTransferencia | null, posicion: number) {
    return datos?.qrs.find((q) => q.posicion === posicion);
  }

  private llenar(datos: DatosTransferencia): void {
    this.formulario.setValue({
      banco: datos.banco,
      titular: datos.titular,
      clabe: clabeLegible(datos.clabe),
    });
  }

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    const lugares = this.lugares();
    const qrsValidos = lugares.map((l) => l.valido()).every(Boolean);
    if (this.formulario.invalid || !qrsValidos || this.guardando()) return;
    this.guardando.set(true);
    const { banco, titular, clabe } = this.formulario.getRawValue();
    try {
      // Primero la cuenta: los QR cuelgan de ella y la API no los acepta sin datos.
      let datos = await this.api.put<DatosTransferencia>('/transferencia', {
        banco,
        titular,
        clabe: soloDigitos(clabe),
      });
      this.llenar(datos);
      for (const lugar of lugares.filter((l) => l.pendiente())) {
        try {
          datos = await lugar.guardar();
        } catch (error) {
          this.datos.set(datos);
          this.avisos.error(
            `Los datos se guardaron, pero el QR ${lugar.posicion()} no: ${mensajeDeError(error)}`,
          );
          return;
        }
      }
      this.datos.set(datos);
      this.avisos.exito('Datos de transferencia guardados.');
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
