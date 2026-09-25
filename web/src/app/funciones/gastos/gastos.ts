import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import {
  type Categoria,
  type EstadoDocumento,
  fechaDeHoy,
  type Gasto,
  inicioDeMes,
  type ListaGastos,
} from '@uvm/compartido';
import { ApiService, conParametros } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { type DatosDialogoMotivo, DialogoMotivo } from '../../ui/dialogo-motivo';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';
import { type DatosDialogoGasto, DialogoGasto } from './dialogo-gasto';

/**
 * Lo que cuesta operar y no es mercancía. Es la otra mitad de la cuenta: sin esto,
 * la utilidad bruta se lee como ganancia y no lo es.
 */
@Component({
  selector: 'uvm-gastos',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTabsModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './gastos.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Gastos {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = inject(MatDialog);
  private readonly sesion = inject(SesionService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly puedeRegistrar = computed(() => this.sesion.puede('gastos.registrar'));
  protected readonly puedeCancelar = computed(() => this.sesion.puede('gastos.cancelar'));

  protected readonly desde = signal(inicioDeMes(fechaDeHoy()));
  protected readonly hasta = signal(fechaDeHoy());
  protected readonly categoriaId = signal<number | null>(null);
  protected readonly estado = signal<EstadoDocumento | null>(null);
  protected readonly pagina = signal(1);

  protected readonly categorias = httpResource<Categoria[]>(() => '/api/gastos/categorias');
  protected readonly gastos = httpResource<ListaGastos>(() =>
    conParametros('/gastos', {
      desde: this.desde(),
      hasta: this.hasta(),
      categoriaId: this.categoriaId(),
      estado: this.estado(),
      pagina: this.pagina(),
    }),
  );

  protected readonly columnas = computed(() =>
    this.puedeCancelar()
      ? ['folio', 'fecha', 'categoria', 'concepto', 'metodoPago', 'importe', 'estado', 'acciones']
      : ['folio', 'fecha', 'categoria', 'concepto', 'metodoPago', 'importe', 'estado'],
  );

  protected readonly formularioCategoria = this.fb.group({
    nombre: ['', Validators.required],
  });

  protected filtrar(cambio: () => void): void {
    cambio();
    this.pagina.set(1);
  }

  protected cambiarPagina(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex + 1);
  }

  protected nuevo(): void {
    const datos: DatosDialogoGasto = { categorias: this.categorias.value() ?? [] };
    this.dialogo
      .open<DialogoGasto, DatosDialogoGasto, Gasto>(DialogoGasto, {
        data: datos,
        width: '34rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((gasto) => {
        if (!gasto) return;
        this.avisos.exito(`Gasto ${gasto.folio} registrado por $${gasto.importe}.`);
        this.gastos.reload();
      });
  }

  /** Un gasto no se borra: se cancela con motivo y queda a la vista. */
  protected cancelar(gasto: Gasto): void {
    const datos: DatosDialogoMotivo = {
      titulo: `Cancelar el gasto ${gasto.folio}`,
      explicacion:
        'Deja de contar en el resultado del mes, pero el registro se queda: así el hueco en la numeración tiene explicación.',
      confirmar: 'Cancelar el gasto',
    };
    this.dialogo
      .open<DialogoMotivo, DatosDialogoMotivo, string>(DialogoMotivo, { data: datos })
      .afterClosed()
      .subscribe((motivo) => {
        if (motivo) void this.confirmarCancelacion(gasto.id, motivo);
      });
  }

  private async confirmarCancelacion(id: number, motivo: string): Promise<void> {
    try {
      const cancelado = await this.api.post<Gasto>(`/gastos/${id}/cancelar`, { motivo });
      this.avisos.exito(`El gasto ${cancelado.folio} quedó cancelado.`);
      this.gastos.reload();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  protected async agregarCategoria(): Promise<void> {
    const nombre = this.formularioCategoria.getRawValue().nombre.trim();
    if (!nombre) {
      this.formularioCategoria.markAllAsTouched();
      return;
    }
    try {
      const orden = (this.categorias.value() ?? []).length + 1;
      const creada = await this.api.post<Categoria>('/gastos/categorias', { nombre, orden });
      this.formularioCategoria.reset();
      this.categorias.reload();
      this.avisos.exito(`Categoría ${creada.nombre} agregada.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  protected async cambiarCategoria(categoria: Categoria, activa: boolean): Promise<void> {
    try {
      await this.api.put<Categoria>(`/gastos/categorias/${categoria.id}`, {
        ...categoria,
        activa,
      });
      this.categorias.reload();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }
}
