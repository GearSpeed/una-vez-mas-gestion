import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
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
import { clabeLegible, clabeValida, type DatosTransferencia } from '@uvm/compartido';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { qrDeTransferencia } from '../../core/qr-transferencia';
import { EstadoCarga } from '../../ui/estado-carga';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PESO_MAXIMO = 10 * 1024 * 1024;

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
  imports: [ReactiveFormsModule, EstadoCarga, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './cobro-transferencia.html',
  styleUrl: './cobro-transferencia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobroTransferencia {
  readonly puedeEditar = input(false);

  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly avisos = inject(AvisosService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly selector = viewChild<ElementRef<HTMLInputElement>>('selector');

  protected readonly recurso = httpResource<DatosTransferencia | null>(() => '/api/transferencia');
  protected readonly datos = signal<DatosTransferencia | null>(null);
  protected readonly qr = qrDeTransferencia(() => this.datos()?.tieneQr ?? false);
  protected readonly guardando = signal(false);
  /** El QR elegido y todavía sin guardar, con su vista previa local. */
  protected readonly archivoQr = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
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
    inject(DestroyRef).onDestroy(() => this.descartarQr());
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
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    const { banco, titular, clabe } = this.formulario.getRawValue();
    try {
      // Primero la cuenta: el QR cuelga de ella y la API no lo acepta sin datos.
      let datos = await this.api.put<DatosTransferencia>('/transferencia', {
        banco,
        titular,
        clabe: soloDigitos(clabe),
      });
      this.datos.set(datos);
      this.llenar(datos);
      const archivo = this.archivoQr();
      if (archivo) {
        try {
          datos = await this.subirQr(archivo);
        } catch (error) {
          this.avisos.error(`Los datos se guardaron, pero el QR no: ${mensajeDeError(error)}`);
          return;
        }
      }
      this.avisos.exito('Datos de transferencia guardados.');
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }

  private async subirQr(archivo: File): Promise<DatosTransferencia> {
    const formulario = new FormData();
    formulario.append('archivo', archivo);
    const datos = await firstValueFrom(
      this.http.post<DatosTransferencia>('/api/transferencia/qr', formulario),
    );
    this.datos.set(datos);
    this.descartarQr();
    // La ruta del QR no cambia: sin esto se seguiría viendo el anterior.
    this.qr.recurso.reload();
    return datos;
  }

  protected elegirQr(): void {
    this.selector()?.nativeElement.click();
  }

  /** Solo lo deja listo: se sube con «Guardar», junto con los datos de la cuenta. */
  protected alElegir(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;
    if (!TIPOS.includes(archivo.type)) {
      this.avisos.error('Elige una imagen JPG, PNG o WebP.');
      return;
    }
    if (archivo.size > PESO_MAXIMO) {
      this.avisos.error('La imagen pesa más de 10 MB.');
      return;
    }
    this.descartarQr();
    this.archivoQr.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
  }

  protected descartarQr(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
    this.archivoQr.set(null);
  }

  /** Quitar sí es inmediato: es destructivo y se pide a propósito. */
  protected async quitarQr(): Promise<void> {
    try {
      this.datos.set(await this.api.delete<DatosTransferencia>('/transferencia/qr'));
      this.avisos.exito('QR quitado.');
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }
}
