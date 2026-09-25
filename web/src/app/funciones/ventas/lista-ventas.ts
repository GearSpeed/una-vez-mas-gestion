import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import {
  type EstadoDocumento,
  fechaDeHoy,
  inicioDeMes,
  type ListaVentas as RespuestaVentas,
  METODOS_PAGO,
  type Ubicacion,
} from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';

@Component({
  selector: 'uvm-lista-ventas',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './lista-ventas.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaVentas {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);

  protected readonly verTodas = computed(() => this.sesion.puede('ventas.ver_todas'));
  protected readonly puedeVender = computed(() => this.sesion.puede('ventas.registrar'));
  protected readonly titulo = computed(() => (this.verTodas() ? 'Ventas' : 'Mis ventas'));
  protected readonly metodos = METODOS_PAGO;

  protected readonly desde = signal(inicioDeMes(fechaDeHoy()));
  protected readonly hasta = signal(fechaDeHoy());
  protected readonly ubicacionId = signal<number | null>(null);
  protected readonly estado = signal<EstadoDocumento | null>(null);
  protected readonly pagina = signal(1);

  protected readonly ubicaciones = httpResource<Ubicacion[]>(() =>
    this.verTodas() &&
    this.sesion.puede('reportes.ver', 'inventario.ver_todo', 'usuarios.gestionar')
      ? '/api/ubicaciones'
      : undefined,
  );
  protected readonly ventas = httpResource<RespuestaVentas>(() =>
    conParametros('/ventas', {
      desde: this.desde(),
      hasta: this.hasta(),
      ubicacionId: this.ubicacionId(),
      estado: this.estado(),
      pagina: this.pagina(),
    }),
  );

  protected readonly columnas = computed(() =>
    this.verTodas()
      ? ['folio', 'fecha', 'vendedor', 'canal', 'metodoPago', 'piezas', 'total', 'estado']
      : ['folio', 'fecha', 'canal', 'metodoPago', 'piezas', 'total', 'estado'],
  );

  protected filtrar(cambio: () => void): void {
    cambio();
    this.pagina.set(1);
  }

  protected cambiarPagina(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex + 1);
  }

  protected abrir(id: number): void {
    void this.router.navigate(['/ventas', id]);
  }
}
