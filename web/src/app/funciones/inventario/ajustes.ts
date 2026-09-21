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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type AjusteDetalle,
  type ExistenciasRespuesta,
  MOTIVOS_AJUSTE,
  type Producto,
  type ResultadoConteo,
  type Ubicacion,
} from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave } from '../../ui/claves';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

/**
 * Ajustes (mermas, caducidad, dañados, muestras) y conteo físico: se captura
 * lo que de verdad hay y la diferencia se ajusta sola.
 */
@Component({
  selector: 'uvm-ajustes',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
  ],
  templateUrl: './ajustes.html',
  styleUrl: './documento-inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ajustes {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  protected readonly motivos = MOTIVOS_AJUSTE.filter((m) => m !== 'conteo');
  protected readonly ubicaciones = httpResource<Ubicacion[]>(() => '/api/ubicaciones');
  protected readonly activas = computed(() =>
    (this.ubicaciones.value() ?? []).filter((u) => u.activa),
  );
  protected readonly productos = httpResource<Producto[]>(() => '/api/productos');
  protected readonly recientes = httpResource<AjusteDetalle[]>(() => '/api/inventario/ajustes');

  /* ---- ajuste ---- */

  protected readonly formulario = this.fb.group({
    ubicacionId: this.fb.control<number | null>(null, Validators.required),
    motivo: this.fb.control<(typeof MOTIVOS_AJUSTE)[number]>('merma', Validators.required),
    notas: [''],
    lineas: this.fb.array([this.nuevaLinea()]),
  });
  protected readonly lineas = this.formulario.controls.lineas;
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  private clave = nuevaClave();

  /* ---- conteo ---- */

  protected readonly ubicacionConteo = signal<number | null>(null);
  protected readonly enUbicacion = httpResource<ExistenciasRespuesta>(() => {
    const id = this.ubicacionConteo();
    return id ? `/api/inventario/existencias?ubicacionId=${id}` : undefined;
  });
  /** Lo contado por producto; lo que no se toca se queda como dice el sistema. */
  protected readonly contado = signal<ReadonlyMap<number, number>>(new Map());
  protected readonly diferencias = computed(
    () =>
      (this.enUbicacion.value()?.filas ?? []).filter((f) => {
        const contado = this.contado().get(f.productoId);
        return contado !== undefined && contado !== f.cantidad;
      }).length,
  );
  protected readonly contando = signal(false);
  protected readonly resultadoConteo = signal<ResultadoConteo | null>(null);
  private claveConteo = nuevaClave();

  constructor() {
    effect(() => {
      const almacen = this.activas().find((u) => u.tipo === 'almacen');
      if (almacen && this.formulario.controls.ubicacionId.value === null) {
        this.formulario.controls.ubicacionId.setValue(almacen.id);
      }
      if (almacen && this.ubicacionConteo() === null) this.ubicacionConteo.set(almacen.id);
    });
  }

  protected agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  protected quitarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
  }

  protected async registrar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.enviando()) {
      this.error.set('Revisa los campos marcados.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    const valor = this.formulario.getRawValue();
    try {
      const ajuste = await this.api.post<AjusteDetalle>('/inventario/ajustes', {
        claveIdempotencia: this.clave,
        ubicacionId: valor.ubicacionId,
        motivo: valor.motivo,
        notas: valor.notas,
        lineas: valor.lineas.map((l) => ({
          productoId: l.productoId,
          cantidad: l.sentido === 'sale' ? -(l.cantidad ?? 0) : (l.cantidad ?? 0),
          costoUnitario: l.sentido === 'entra' ? l.costoUnitario : null,
        })),
      });
      this.clave = nuevaClave();
      this.avisos.exito(`Ajuste ${ajuste.folio} registrado.`);
      this.lineas.clear();
      this.lineas.push(this.nuevaLinea());
      this.formulario.controls.notas.setValue('');
      this.recientes.reload();
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.enviando.set(false);
    }
  }

  protected cambiarUbicacionConteo(id: number): void {
    this.ubicacionConteo.set(id);
    this.contado.set(new Map());
    this.resultadoConteo.set(null);
  }

  protected capturar(productoId: number, valor: string): void {
    const numero = Number(valor);
    this.contado.update((mapa) => {
      const nuevo = new Map(mapa);
      if (valor === '' || !Number.isInteger(numero) || numero < 0) nuevo.delete(productoId);
      else nuevo.set(productoId, numero);
      return nuevo;
    });
  }

  protected async registrarConteo(): Promise<void> {
    const ubicacionId = this.ubicacionConteo();
    const filas = this.enUbicacion.value()?.filas ?? [];
    if (!ubicacionId || this.contando()) return;
    this.contando.set(true);
    try {
      const resultado = await this.api.post<ResultadoConteo>('/inventario/conteos', {
        claveIdempotencia: this.claveConteo,
        ubicacionId,
        conteos: filas
          .filter((f) => f.activo || f.cantidad > 0)
          .map((f) => ({
            productoId: f.productoId,
            contado: this.contado().get(f.productoId) ?? f.cantidad,
          })),
      });
      this.claveConteo = nuevaClave();
      this.resultadoConteo.set(resultado);
      this.contado.set(new Map());
      this.enUbicacion.reload();
      this.recientes.reload();
      this.avisos.exito(
        resultado.ajuste
          ? `Conteo registrado: ${resultado.diferencias} diferencias ajustadas (${resultado.ajuste.folio}).`
          : 'Conteo registrado: todo coincide.',
      );
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    } finally {
      this.contando.set(false);
    }
  }

  private nuevaLinea() {
    return this.fb.group({
      productoId: this.fb.control<number | null>(null, Validators.required),
      sentido: this.fb.control<'sale' | 'entra'>('sale'),
      cantidad: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
      costoUnitario: this.fb.control<number | null>(null, Validators.min(0)),
    });
  }
}
