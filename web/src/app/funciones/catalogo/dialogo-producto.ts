import { CurrencyPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type Categoria, indicadoresPrecio, type Producto, slugDe } from '@uvm/compartido';
import { startWith } from 'rxjs';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { numeroONulo } from '../../ui/claves';
import { ImagenProducto } from './imagen-producto';

export interface DatosDialogoProducto {
  readonly producto: Producto | null;
  readonly categorias: readonly Categoria[];
}

/**
 * Alta y edición de un producto. El precio se captura aquí, con el sugerido y
 * los dos márgenes a la vista, cada uno con su nombre.
 */
@Component({
  selector: 'uvm-dialogo-producto',
  imports: [
    ImagenProducto,
    ReactiveFormsModule,
    CurrencyPipe,
    PercentPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './dialogo-producto.html',
  styleUrl: './dialogo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoProducto {
  protected readonly datos = inject<DatosDialogoProducto>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoProducto, Producto>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly producto = this.datos.producto;
  /** Si ya se subió o quitó la imagen: al cerrar, la lista se actualiza. */
  protected readonly imagenCambiada = signal<Producto | null>(null);
  protected readonly titulo = this.producto ? `Editar ${this.producto.nombre}` : 'Nuevo producto';

  protected readonly formulario = this.fb.group({
    nombre: [this.producto?.nombre ?? '', [Validators.required, Validators.maxLength(120)]],
    categoriaId: this.fb.control<number | null>(
      this.producto?.categoriaId ?? null,
      Validators.required,
    ),
    variedad: [this.producto?.variedad ?? ''],
    presentacion: [this.producto?.presentacion ?? ''],
    precioVenta: this.fb.control<number | null>(
      numeroONulo(this.producto?.precioVenta),
      Validators.min(0),
    ),
    /** En pantalla va en %; la API lo guarda como proporción (80 → 0.8). */
    gananciaPorcentaje: this.fb.control<number | null>(
      this.producto?.costos?.gananciaObjetivo
        ? Number(this.producto.costos.gananciaObjetivo) * 100
        : null,
      Validators.min(0),
    ),
    stockMinimo: [this.producto?.stockMinimo ?? 0, [Validators.required, Validators.min(0)]],
    activo: [this.producto?.activo ?? true],
    publicado: [this.producto?.publicado ?? false],
  });

  private readonly valor = toSignal(
    this.formulario.valueChanges.pipe(startWith(this.formulario.getRawValue())),
    {
      initialValue: this.formulario.getRawValue(),
    },
  );
  protected readonly costo = this.producto?.costos?.costoPromedio ?? null;
  protected readonly indicadores = computed(() => {
    const valor = this.valor();
    if (!this.costo) return null;
    const precio = numeroONulo(valor.precioVenta);
    const ganancia = numeroONulo(valor.gananciaPorcentaje);
    return indicadoresPrecio(
      this.costo,
      precio === null ? null : String(precio),
      ganancia === null ? null : String(ganancia / 100),
    );
  });

  /**
   * El slug no se captura: al crear sale del nombre (lo genera la API con la misma
   * función) y al editar se queda como estaba, para no romper la URL del sitio.
   */
  protected readonly slug = computed(
    () => this.producto?.slug ?? slugDe(this.valor().nombre ?? ''),
  );

  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected cerrar(): void {
    this.referencia.close(this.imagenCambiada() ?? undefined);
  }

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    const { gananciaPorcentaje, ...valor } = this.formulario.getRawValue();
    const cuerpo = {
      ...valor,
      presentacion: valor.presentacion || null,
      gananciaObjetivo:
        gananciaPorcentaje === null ? null : Number((gananciaPorcentaje / 100).toFixed(4)),
    };
    try {
      const guardado = this.producto
        ? await this.api.put<Producto>(`/productos/${this.producto.id}`, cuerpo)
        : await this.api.post<Producto>('/productos', cuerpo);
      this.referencia.close(guardado);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
