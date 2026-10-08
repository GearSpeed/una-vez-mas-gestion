import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { DatosTransferencia, PosicionQr, QrTransferencia } from '@uvm/compartido';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { qrDeTransferencia } from '../../core/qr-transferencia';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PESO_MAXIMO = 10 * 1024 * 1024;

/**
 * Un lugar para QR de transferencia: su título y su imagen. Lo elegido no se sube
 * solo: lo sube `guardar()`, que llama la pantalla con su botón «Guardar».
 */
@Component({
  selector: 'uvm-qr-de-cobro',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editable()) {
      <fieldset class="qr">
        <legend>QR {{ posicion() }} (opcional)</legend>
        <mat-form-field>
          <mat-label>Título</mat-label>
          <input matInput [formControl]="titulo" maxlength="40" autocomplete="off" />
          <mat-hint>Por ejemplo, Mercado Pago o Banco Azteca.</mat-hint>
          @if (titulo.invalid) {
            <mat-error>Escribe un título para este QR.</mat-error>
          }
        </mat-form-field>
        @if (vistaPrevia(); as url) {
          <img
            [src]="url"
            [alt]="'Vista previa del QR ' + posicion() + ' elegido'"
            class="vista-qr"
          />
        } @else if (qr.url(); as url) {
          <img [src]="url" [alt]="'QR de ' + guardado()?.titulo" class="vista-qr" />
        } @else if (guardado()) {
          <p class="ayuda">Cargando el QR…</p>
        }
        <input
          #selector
          type="file"
          class="visualmente-oculto"
          accept="image/jpeg,image/png,image/webp"
          tabindex="-1"
          aria-hidden="true"
          (change)="alElegir($event)"
        />
        <div class="acciones">
          <button mat-stroked-button type="button" (click)="elegir()">
            {{ tieneImagen() ? 'Cambiar QR ' + posicion() : 'Elegir QR ' + posicion() }}
          </button>
          @if (archivo(); as a) {
            <span class="ayuda nombre-archivo">{{ a.name }}</span>
            <button mat-button type="button" (click)="descartar()">Descartar</button>
          } @else if (guardado()) {
            <button mat-button type="button" (click)="quitar()">Quitar QR {{ posicion() }}</button>
          }
        </div>
      </fieldset>
    } @else if (guardado(); as g) {
      <figure class="qr">
        @if (qr.url(); as url) {
          <img [src]="url" [alt]="'QR de ' + g.titulo" class="vista-qr" />
        }
        <figcaption>{{ g.titulo }}</figcaption>
      </figure>
    }
  `,
  styles: `
    .qr {
      display: grid;
      gap: 0.5rem;
      margin: 0.5rem 0 1rem;
      padding: 0;
      border: 0;
    }
    legend {
      padding-bottom: 0.5rem;
      font: var(--mat-sys-title-medium);
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .nombre-archivo {
      overflow-wrap: anywhere;
    }
    .vista-qr {
      width: min(16rem, 100%);
      height: auto;
      border-radius: 0.5rem;
      /* El QR se lee sobre blanco aunque la app esté en modo oscuro. */
      background: #fff;
      padding: 0.5rem;
    }
  `,
})
export class QrDeCobro {
  readonly posicion = input.required<PosicionQr>();
  /** Lo que ya está guardado en este lugar, si hay. */
  readonly guardado = input<QrTransferencia | undefined>();
  readonly editable = input(false);
  /** Al quitarlo, que es inmediato: la cuenta como queda. */
  readonly cambio = output<DatosTransferencia>();

  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly avisos = inject(AvisosService);
  private readonly selector = viewChild<ElementRef<HTMLInputElement>>('selector');

  protected readonly qr = qrDeTransferencia(() => (this.guardado() ? this.posicion() : null));
  /** El QR elegido y todavía sin guardar, con su vista previa local. */
  protected readonly archivo = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
  protected readonly tieneImagen = computed(() => !!this.guardado() || !!this.archivo());
  private readonly tituloGuardado = computed(() => this.guardado()?.titulo ?? '');

  /** Obligatorio solo si el lugar tiene imagen, guardada o recién elegida. */
  readonly titulo = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.maxLength(40),
      (control) => (this.tieneImagen() && !control.value.trim() ? { required: true } : null),
    ],
  });

  constructor() {
    // Solo cuando cambia lo guardado: guardar la cuenta no borra un título a medio escribir.
    effect(() => this.titulo.setValue(this.tituloGuardado()));
    inject(DestroyRef).onDestroy(() => this.descartar());
  }

  /** Si hay algo que subir: una imagen nueva o un título distinto del guardado. */
  pendiente(): boolean {
    return (
      !!this.archivo() || (!!this.guardado() && this.titulo.value.trim() !== this.tituloGuardado())
    );
  }

  valido(): boolean {
    this.titulo.updateValueAndValidity();
    this.titulo.markAsTouched();
    return this.titulo.valid;
  }

  /** Sube lo pendiente; la cuenta ya debe estar guardada. */
  async guardar(): Promise<DatosTransferencia> {
    const formulario = new FormData();
    formulario.append('titulo', this.titulo.value.trim());
    const archivo = this.archivo();
    if (archivo) formulario.append('archivo', archivo);
    const datos = await firstValueFrom(
      this.http.put<DatosTransferencia>(`/api/transferencia/qr/${this.posicion()}`, formulario),
    );
    this.descartar();
    // La ruta del QR no cambia: sin esto se seguiría viendo el anterior.
    if (archivo) this.qr.recurso.reload();
    return datos;
  }

  protected elegir(): void {
    this.selector()?.nativeElement.click();
  }

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
    this.descartar();
    this.archivo.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
  }

  protected descartar(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
    this.archivo.set(null);
    this.titulo.updateValueAndValidity();
  }

  /** Quitar sí es inmediato: es destructivo y se pide a propósito. */
  protected async quitar(): Promise<void> {
    try {
      this.cambio.emit(
        await this.api.delete<DatosTransferencia>(`/transferencia/qr/${this.posicion()}`),
      );
      this.avisos.exito(`QR ${this.posicion()} quitado.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }
}
