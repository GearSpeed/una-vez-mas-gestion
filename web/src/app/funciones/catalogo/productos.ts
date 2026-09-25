import { CurrencyPipe, NgOptimizedImage, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { type Categoria, coincideBusqueda, type Producto } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { CobroTarjeta } from './cobro-tarjeta';
import { type DatosDialogoProducto, DialogoProducto } from './dialogo-producto';

@Component({
  selector: 'uvm-productos',
  imports: [
    CobroTarjeta,
    Desplazable,
    Encabezado,
    EstadoCarga,
    CurrencyPipe,
    NgOptimizedImage,
    PercentPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTabsModule,
  ],
  templateUrl: './productos.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Productos {
  private readonly sesion = inject(SesionService);
  private readonly dialogo = inject(MatDialog);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly puedeEditar = computed(() => this.sesion.puede('productos.gestionar'));
  protected readonly incluirInactivos = signal(false);
  protected readonly busqueda = signal('');

  protected readonly productos = httpResource<Producto[]>(() =>
    this.incluirInactivos() ? '/api/productos?inactivos=1' : '/api/productos',
  );
  protected readonly categorias = httpResource<Categoria[]>(() => '/api/categorias');
  protected readonly visibles = computed(() => {
    const q = this.busqueda();
    return (this.productos.value() ?? []).filter((p) =>
      coincideBusqueda(q, p.id, `${p.nombre} ${p.slug} ${p.categoria}`),
    );
  });
  protected readonly conCostos = computed(() => this.visibles().some((p) => p.costos));

  /**
   * Un grupo, no un control suelto: `ngSubmit` lo emite la directiva del formulario, y
   * sin `[formGroup]` en el `<form>` el envío se lo queda el navegador (recarga la
   * página) sin llamar nunca a `agregarCategoria()`.
   */
  protected readonly formularioCategoria = this.fb.group({
    nombre: ['', Validators.required],
  });

  protected abrir(producto: Producto | null): void {
    const datos: DatosDialogoProducto = { producto, categorias: this.categorias.value() ?? [] };
    this.dialogo
      .open<DialogoProducto, DatosDialogoProducto, Producto>(DialogoProducto, {
        data: datos,
        width: '44rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.avisos.exito(`${guardado.nombre} guardado.`);
        this.productos.reload();
      });
  }

  protected async agregarCategoria(): Promise<void> {
    const nombre = this.formularioCategoria.getRawValue().nombre.trim();
    if (!nombre) {
      this.formularioCategoria.markAllAsTouched();
      return;
    }
    try {
      const orden = (this.categorias.value() ?? []).length + 1;
      const creada = await this.api.post<Categoria>('/categorias', { nombre, orden });
      this.formularioCategoria.reset();
      this.categorias.reload();
      this.avisos.exito(`Categoría ${creada.nombre} agregada.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  protected async cambiarCategoria(
    categoria: Categoria,
    cambios: Partial<Categoria>,
  ): Promise<void> {
    try {
      await this.api.put<Categoria>(`/categorias/${categoria.id}`, { ...categoria, ...cambios });
      this.categorias.reload();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }
}
