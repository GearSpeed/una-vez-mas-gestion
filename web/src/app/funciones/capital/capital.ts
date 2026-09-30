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
  fechaDeHoy,
  inicioDeMes,
  type ListaCapital,
  type MovimientoCapital,
  type SaldosCaja,
  type Socio,
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
import { type DatosDialogoCapital, DialogoCapital } from './dialogo-capital';

/**
 * El dinero que ponen y sacan los socios. No es venta ni gasto: no entra en la
 * utilidad, solo mueve la caja. Saber cuánto lleva puesto cada quien es lo que
 * después permite repartir sin discutir de memoria.
 */
@Component({
  selector: 'uvm-capital',
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
  templateUrl: './capital.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Capital {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = inject(MatDialog);
  private readonly sesion = inject(SesionService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly puedeRegistrar = computed(() => this.sesion.puede('capital.registrar'));
  protected readonly puedeCancelar = computed(() => this.sesion.puede('capital.cancelar'));

  protected readonly desde = signal(inicioDeMes(fechaDeHoy()));
  protected readonly hasta = signal(fechaDeHoy());
  protected readonly socioId = signal<number | null>(null);
  protected readonly pagina = signal(1);

  protected readonly socios = httpResource<Socio[]>(() => '/api/capital/socios');
  protected readonly saldos = httpResource<SaldosCaja>(() => '/api/capital/saldos');
  protected readonly movimientos = httpResource<ListaCapital>(() =>
    conParametros('/capital', {
      desde: this.desde(),
      hasta: this.hasta(),
      socioId: this.socioId(),
      pagina: this.pagina(),
    }),
  );

  protected readonly columnas = computed(() =>
    this.puedeCancelar()
      ? [
          'folio',
          'fecha',
          'socio',
          'tipo',
          'concepto',
          'metodoPago',
          'importe',
          'estado',
          'acciones',
        ]
      : ['folio', 'fecha', 'socio', 'tipo', 'concepto', 'metodoPago', 'importe', 'estado'],
  );

  protected readonly formularioSocio = this.fb.group({
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
    const datos: DatosDialogoCapital = {
      socios: this.socios.value() ?? [],
      saldos: this.saldos.value() ?? null,
    };
    this.dialogo
      .open<DialogoCapital, DatosDialogoCapital, MovimientoCapital>(DialogoCapital, {
        data: datos,
        width: '34rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((movimiento) => {
        if (!movimiento) return;
        this.avisos.exito(`Movimiento ${movimiento.folio} registrado por $${movimiento.importe}.`);
        this.recargar();
      });
  }

  /** No se borra: se cancela con motivo y queda a la vista. */
  protected cancelar(movimiento: MovimientoCapital): void {
    const datos: DatosDialogoMotivo = {
      titulo: `Cancelar el movimiento ${movimiento.folio}`,
      explicacion:
        'Deja de contar en la caja y en lo que lleva puesto el socio, pero el registro se queda: así el hueco en la numeración tiene explicación.',
      confirmar: 'Cancelar el movimiento',
    };
    this.dialogo
      .open<DialogoMotivo, DatosDialogoMotivo, string>(DialogoMotivo, { data: datos })
      .afterClosed()
      .subscribe((motivo) => {
        if (motivo) void this.confirmarCancelacion(movimiento.id, motivo);
      });
  }

  private async confirmarCancelacion(id: number, motivo: string): Promise<void> {
    try {
      const cancelado = await this.api.post<MovimientoCapital>(`/capital/${id}/cancelar`, {
        motivo,
      });
      this.avisos.exito(`El movimiento ${cancelado.folio} quedó cancelado.`);
      this.recargar();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  protected async agregarSocio(): Promise<void> {
    const nombre = this.formularioSocio.getRawValue().nombre.trim();
    if (!nombre) {
      this.formularioSocio.markAllAsTouched();
      return;
    }
    try {
      const creado = await this.api.post<Socio>('/capital/socios', { nombre, activo: true });
      this.formularioSocio.reset();
      this.socios.reload();
      this.avisos.exito(`${creado.nombre} ya está en la lista de socios.`);
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  protected async cambiarSocio(socio: Socio, activo: boolean): Promise<void> {
    try {
      await this.api.put<Socio>(`/capital/socios/${socio.id}`, { nombre: socio.nombre, activo });
      this.socios.reload();
    } catch (error) {
      this.avisos.error(mensajeDeError(error));
    }
  }

  /** Un movimiento cambia la lista, lo que lleva puesto cada socio y la caja. */
  private recargar(): void {
    this.movimientos.reload();
    this.socios.reload();
    this.saldos.reload();
  }
}
