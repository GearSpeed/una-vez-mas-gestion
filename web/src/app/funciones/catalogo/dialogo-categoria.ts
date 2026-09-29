import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { Categoria } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { ImagenEditable } from './imagen-editable';

/**
 * Los íconos que puede llevar la insignia de la tarjeta, con el nombre con el que se
 * leen. Es una lista corta a propósito: nadie tiene por qué saber que el de los
 * borrachitos se llama `local_bar`, y una lista larga solo vuelve lenta la decisión.
 */
const ICONOS: readonly { readonly valor: string; readonly nombre: string }[] = [
  { valor: 'cookie', nombre: 'Galleta' },
  { valor: 'local_bar', nombre: 'Copa' },
  { valor: 'grain', nombre: 'Grano' },
  { valor: 'cake', nombre: 'Pastel' },
  { valor: 'icecream', nombre: 'Nieve' },
  { valor: 'bakery_dining', nombre: 'Pan' },
  { valor: 'coffee', nombre: 'Café' },
  { valor: 'nutrition', nombre: 'Fruta' },
  { valor: 'redeem', nombre: 'Regalo' },
  { valor: 'celebration', nombre: 'Fiesta' },
];

export interface DatosDialogoCategoria {
  readonly categoria: Categoria;
}

/**
 * Editar una categoría: su nombre y su orden, y la tarjeta que le toca en «Nuestras
 * Categorías Dulces» de la portada del sitio.
 *
 * Nada de la tarjeta es obligatorio: una categoría sirve para agrupar productos aunque
 * nunca salga en la portada. Lo que enciende la tarjeta es la foto.
 */
@Component({
  selector: 'uvm-dialogo-categoria',
  imports: [
    ImagenEditable,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './dialogo-categoria.html',
  styleUrl: './dialogo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoCategoria {
  private readonly datos = inject<DatosDialogoCategoria>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoCategoria, Categoria>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly imagenRef = viewChild.required(ImagenEditable<Categoria>);

  protected readonly categoria = this.datos.categoria;
  protected readonly iconos = ICONOS;
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Lo último que devolvió el servidor: la foto se graba por su cuenta. */
  protected readonly guardado = signal<Categoria | null>(null);
  protected readonly base = computed(() => this.guardado() ?? this.categoria);

  protected readonly formulario = this.fb.group({
    nombre: [this.categoria.nombre, [Validators.required, Validators.maxLength(60)]],
    orden: [this.categoria.orden, [Validators.required, Validators.min(0)]],
    activa: [this.categoria.activa],
    titulo: [this.categoria.titulo, Validators.maxLength(80)],
    insignia: [this.categoria.insignia, Validators.maxLength(40)],
    insigniaIcono: [this.categoria.insigniaIcono],
    descripcion: [this.categoria.descripcion, Validators.maxLength(300)],
    cta: [this.categoria.cta, Validators.maxLength(60)],
  });

  protected cerrar(): void {
    this.referencia.close(this.guardado() ?? undefined);
  }

  /**
   * Guarda los campos y, aparte, la foto: esta va en su propia petición porque es
   * multipart. Si la foto falla, el resto ya quedó y se dice con todas sus letras.
   */
  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    const imagen = this.imagenRef();
    if (this.formulario.invalid || !imagen.valido() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      const guardada = await this.api.put<Categoria>(
        `/categorias/${this.categoria.id}`,
        this.formulario.getRawValue(),
      );
      this.guardado.set(guardada);
      const conImagen = await imagen.guardarEn(this.categoria.id);
      this.referencia.close(conImagen ?? guardada);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
