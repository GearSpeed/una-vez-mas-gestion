import { DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  CALIDADES_IMAGEN_IA,
  type CalidadImagenIa,
  type EstadoGeneracion,
  type EstadoImagenesIa,
  type ImagenGenerada,
  type Producto,
  type ReferenciaImagen,
} from '@uvm/compartido';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { DialogoAsignar } from './dialogo-asignar';
import { DialogoReferencia, type DatosDialogoReferencia } from './dialogo-referencia';
import { ImagenPrivada } from './imagen-privada';
import { revisarImagen } from './revisar-imagen';

/** Cada cuánto se pregunta si ya terminó una imagen. */
export const INTERVALO_CONSULTA = 3000;

export const ETIQUETA_CALIDAD: Readonly<Record<CalidadImagenIa, string>> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
};

export const ETIQUETA_ESTADO: Readonly<Record<EstadoGeneracion, string>> = {
  generando: 'Generando',
  lista: 'Lista',
  error: 'No salió',
  asignada: 'Asignada',
  descartada: 'Descartada',
};

/**
 * Fotos de producto con IA (OpenAI): se elige una referencia (la escena, con su prompt),
 * se sube la foto del producto, se complementa el prompt y se genera. El resultado se
 * asigna a un producto, se descarta o se vuelve a generar sin subir la foto otra vez.
 */
@Component({
  selector: 'uvm-imagenes-ia',
  imports: [
    DatePipe,
    Encabezado,
    EstadoCarga,
    ImagenPrivada,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './imagenes-ia.html',
  styleUrl: './imagenes-ia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImagenesIa {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = inject(MatDialog);
  private destruido = false;

  protected readonly calidades = CALIDADES_IMAGEN_IA;
  protected readonly etiquetaCalidad = ETIQUETA_CALIDAD;
  protected readonly etiquetaEstado = ETIQUETA_ESTADO;

  protected readonly estado = httpResource<EstadoImagenesIa>(() => '/api/imagenes-ia/estado');
  protected readonly referencias = httpResource<ReferenciaImagen[]>(
    () => '/api/imagenes-ia/referencias',
  );
  protected readonly recientes = httpResource<ImagenGenerada[]>(
    () => '/api/imagenes-ia/generaciones',
  );

  /** La elegida; si desaparece de la lista (se quitó), la primera. */
  protected readonly referenciaId = linkedSignal<ReferenciaImagen[] | undefined, number | null>({
    source: () => this.referencias.value(),
    computation: (lista, anterior) => {
      const previa = anterior?.value;
      if (lista?.some((r) => r.id === previa)) return previa ?? null;
      return lista?.[0]?.id ?? null;
    },
  });
  protected readonly referencia = computed(
    () => this.referencias.value()?.find((r) => r.id === this.referenciaId()) ?? null,
  );

  protected readonly foto = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
  protected readonly errorFoto = signal<string | null>(null);
  /** La generación cuya foto se reusa mientras no se elija otra. */
  protected readonly fotoDe = signal<number | null>(null);

  protected readonly promptExtra = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(1000)],
  });
  protected readonly calidad = signal<CalidadImagenIa>('media');

  /** La que se está viendo: la que se acaba de pedir o una de las recientes. */
  protected readonly actual = signal<ImagenGenerada | null>(null);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly configurado = computed(() => this.estado.value()?.configurado ?? false);
  protected readonly generando = computed(() => this.actual()?.estado === 'generando');
  protected readonly faltaParaGenerar = computed(() => {
    if (!this.configurado()) return 'Falta configurar la llave de OpenAI.';
    if (!this.referencia()) return 'Elige una referencia.';
    if (!this.foto() && this.fotoDe() === null) return 'Sube la foto del producto.';
    return null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      this.soltarVistaPrevia();
    });
  }

  /* ---- referencias ---- */

  protected elegirReferencia(id: number): void {
    this.referenciaId.set(id);
  }

  protected async editarReferencia(referencia: ReferenciaImagen | null): Promise<void> {
    const guardada = await firstValueFrom(
      this.dialogo
        .open<DialogoReferencia, DatosDialogoReferencia, ReferenciaImagen>(DialogoReferencia, {
          data: referencia,
          width: '36rem',
          maxWidth: 'calc(100vw - 2rem)',
        })
        .afterClosed(),
    );
    if (!guardada) return;
    this.avisos.exito(`Referencia «${guardada.nombre}» guardada.`);
    this.referencias.reload();
    this.referenciaId.set(guardada.id);
  }

  protected async quitarReferencia(referencia: ReferenciaImagen): Promise<void> {
    try {
      await this.api.delete(`/imagenes-ia/referencias/${referencia.id}`);
      this.avisos.exito(`Se quitó la referencia «${referencia.nombre}».`);
      this.referencias.reload();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  /* ---- foto del producto ---- */

  protected alElegirFoto(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;
    const problema = revisarImagen(archivo);
    this.errorFoto.set(problema);
    if (problema) return;
    this.soltarVistaPrevia();
    this.foto.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
  }

  /* ---- generar ---- */

  protected async generar(): Promise<void> {
    const referencia = this.referencia();
    if (this.faltaParaGenerar() || !referencia || this.enviando() || this.generando()) return;
    if (this.promptExtra.invalid) return;
    const formulario = new FormData();
    formulario.append('referenciaId', String(referencia.id));
    formulario.append('promptExtra', this.promptExtra.value);
    formulario.append('calidad', this.calidad());
    const foto = this.foto();
    const fotoDe = this.fotoDe();
    if (foto) formulario.append('foto', foto);
    else if (fotoDe !== null) formulario.append('fotoDe', String(fotoDe));

    this.enviando.set(true);
    this.error.set(null);
    try {
      const generada = await firstValueFrom(
        this.http.post<ImagenGenerada>('/api/imagenes-ia/generaciones', formulario),
      );
      this.actual.set(generada);
      // La foto ya está guardada con esta generación: «Generar otra vez» la reusa.
      this.fotoDe.set(generada.id);
      this.foto.set(null);
      this.soltarVistaPrevia();
      this.recientes.reload();
      void this.seguir(generada.id);
    } catch (error) {
      this.error.set(mensajeDeError(error));
      this.estado.reload();
    } finally {
      this.enviando.set(false);
    }
  }

  /** Pregunta hasta que la imagen deja de estar «generando». */
  private async seguir(id: number): Promise<void> {
    while (!this.destruido && this.actual()?.id === id) {
      await new Promise((listo) => setTimeout(listo, INTERVALO_CONSULTA));
      if (this.destruido || this.actual()?.id !== id) return;
      try {
        const generacion = await firstValueFrom(
          this.http.get<ImagenGenerada>(`/api/imagenes-ia/generaciones/${id}`),
        );
        if (this.actual()?.id !== id) return;
        this.actual.set(generacion);
        if (generacion.estado !== 'generando') {
          this.recientes.reload();
          this.estado.reload();
          return;
        }
      } catch {
        // Un tropiezo de la red: se vuelve a preguntar en la siguiente vuelta.
      }
    }
  }

  /** Abre una de las recientes con los datos con que se pidió, lista para repetirla. */
  protected ver(generacion: ImagenGenerada): void {
    this.actual.set(generacion);
    this.error.set(null);
    this.foto.set(null);
    this.soltarVistaPrevia();
    this.fotoDe.set(generacion.id);
    if (this.referencias.value()?.some((r) => r.id === generacion.referenciaId)) {
      this.referenciaId.set(generacion.referenciaId);
    }
    this.promptExtra.setValue(generacion.promptExtra);
    this.calidad.set(generacion.calidad);
    if (generacion.estado === 'generando') void this.seguir(generacion.id);
  }

  protected async asignar(): Promise<void> {
    const generacion = this.actual();
    if (generacion?.estado !== 'lista') return;
    const producto = await firstValueFrom(
      this.dialogo
        .open<DialogoAsignar, ImagenGenerada, Producto>(DialogoAsignar, {
          data: generacion,
          width: '30rem',
          maxWidth: 'calc(100vw - 2rem)',
        })
        .afterClosed(),
    );
    if (!producto) return;
    this.avisos.exito(`Listo: ahora es la foto de ${producto.nombre}.`);
    this.actual.set(
      await firstValueFrom(
        this.http.get<ImagenGenerada>(`/api/imagenes-ia/generaciones/${generacion.id}`),
      ),
    );
    this.recientes.reload();
  }

  protected async descartar(): Promise<void> {
    const generacion = this.actual();
    if (!generacion) return;
    try {
      await this.api.post(`/imagenes-ia/generaciones/${generacion.id}/descartar`);
      this.actual.set(null);
      this.recientes.reload();
      this.avisos.exito('Imagen descartada.');
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  private soltarVistaPrevia(): void {
    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.vistaPrevia.set(null);
  }
}
