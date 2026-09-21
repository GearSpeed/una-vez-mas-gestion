import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { ExistenciasRespuesta, TraspasoDetalle, Ubicacion } from '@uvm/compartido';
import { startWith } from 'rxjs';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave } from '../../ui/claves';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';

/** Cargar mercancía a un vendedor o recibir lo que regresa. El costo no cambia. */
@Component({
  selector: 'uvm-traspasos',
  imports: [
    Encabezado,
    EstadoCarga,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './traspasos.html',
  styleUrl: './documento-inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Traspasos {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  protected readonly ubicaciones = httpResource<Ubicacion[]>(() => '/api/ubicaciones');
  protected readonly activas = computed(() =>
    (this.ubicaciones.value() ?? []).filter((u) => u.activa),
  );
  protected readonly recientes = httpResource<TraspasoDetalle[]>(() => '/api/inventario/traspasos');

  protected readonly formulario = this.fb.group({
    origenId: this.fb.control<number | null>(null, Validators.required),
    destinoId: this.fb.control<number | null>(null, Validators.required),
    notas: [''],
    lineas: this.fb.array([this.nuevaLinea()]),
  });
  protected readonly lineas = this.formulario.controls.lineas;

  private readonly origenId = toSignal(
    this.formulario.controls.origenId.valueChanges.pipe(
      startWith(this.formulario.controls.origenId.value),
    ),
    { initialValue: null },
  );
  /** Lo que hay en el origen: de ahí se elige qué mover y cuánto. */
  protected readonly enOrigen = httpResource<ExistenciasRespuesta>(() => {
    const id = this.origenId();
    return id ? `/api/inventario/existencias?ubicacionId=${id}` : undefined;
  });
  protected readonly disponibles = computed(() =>
    (this.enOrigen.value()?.filas ?? []).filter((f) => f.cantidad > 0),
  );

  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  private clave = nuevaClave();

  constructor() {
    // Lo más común: del almacén al primer vendedor.
    effect(() => {
      const activas = this.activas();
      const { origenId, destinoId } = this.formulario.controls;
      if (origenId.value === null && destinoId.value === null && activas.length > 1) {
        origenId.setValue(activas.find((u) => u.tipo === 'almacen')?.id ?? null);
        destinoId.setValue(activas.find((u) => u.tipo === 'vendedor')?.id ?? null);
      }
    });
  }

  protected intercambiar(): void {
    const { origenId, destinoId } = this.formulario.controls;
    const origen = origenId.value;
    origenId.setValue(destinoId.value);
    destinoId.setValue(origen);
    this.lineas.clear();
    this.lineas.push(this.nuevaLinea());
  }

  protected disponibleDe(productoId: number | null): number {
    return this.disponibles().find((f) => f.productoId === productoId)?.cantidad ?? 0;
  }

  protected elegidoEnOtraLinea(productoId: number, indice: number): boolean {
    return this.lineas.controls.some(
      (l, i) => i !== indice && l.controls.productoId.value === productoId,
    );
  }

  protected agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  protected quitarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
  }

  protected async registrar(): Promise<void> {
    this.formulario.markAllAsTouched();
    const valor = this.formulario.getRawValue();
    if (this.formulario.invalid || this.enviando()) {
      this.error.set('Revisa los campos marcados.');
      return;
    }
    if (valor.origenId === valor.destinoId) {
      this.error.set('El origen y el destino deben ser distintos.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    try {
      const traspaso = await this.api.post<TraspasoDetalle>('/inventario/traspasos', {
        claveIdempotencia: this.clave,
        ...valor,
      });
      this.clave = nuevaClave();
      const piezas = traspaso.lineas.reduce((suma, l) => suma + l.cantidad, 0);
      this.avisos.exito(
        `${traspaso.folio}: ${piezas} piezas de ${traspaso.origen} a ${traspaso.destino}.`,
      );
      this.lineas.clear();
      this.lineas.push(this.nuevaLinea());
      this.formulario.controls.notas.setValue('');
      this.enOrigen.reload();
      this.recientes.reload();
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.enviando.set(false);
    }
  }

  private nuevaLinea() {
    return this.fb.group({
      productoId: this.fb.control<number | null>(null, Validators.required),
      cantidad: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
    });
  }
}
