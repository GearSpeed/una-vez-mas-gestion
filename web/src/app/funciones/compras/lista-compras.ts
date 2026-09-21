import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import {
  type CompraResumen,
  type EstadoDocumento,
  fechaDeHoy,
  inicioDeMes,
  type Paginado,
  type Proveedor,
  sumar,
} from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

@Component({
  selector: 'uvm-lista-compras',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
  ],
  templateUrl: './lista-compras.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaCompras {
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);
  protected readonly puedeRegistrar = computed(() => this.sesion.puede('compras.registrar'));

  protected readonly desde = signal(inicioDeMes(fechaDeHoy()));
  protected readonly hasta = signal(fechaDeHoy());
  protected readonly proveedorId = signal<number | null>(null);
  protected readonly estado = signal<EstadoDocumento | null>(null);
  protected readonly pagina = signal(1);

  protected readonly proveedores = httpResource<Proveedor[]>(() => '/api/proveedores');
  protected readonly compras = httpResource<Paginado<CompraResumen>>(() =>
    conParametros('/compras', {
      desde: this.desde(),
      hasta: this.hasta(),
      proveedorId: this.proveedorId(),
      estado: this.estado(),
      pagina: this.pagina(),
    }),
  );
  protected readonly totalPagina = computed(() =>
    sumar(
      (this.compras.value()?.filas ?? []).filter((c) => c.estado === 'vigente').map((c) => c.total),
    ),
  );

  protected readonly columnas = [
    'folio',
    'fecha',
    'proveedor',
    'vehiculo',
    'piezas',
    'costoTraslado',
    'total',
    'estado',
  ];

  protected filtrar(cambio: () => void): void {
    cambio();
    this.pagina.set(1);
  }

  protected cambiarPagina(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex + 1);
  }

  protected abrir(id: number): void {
    void this.router.navigate(['/compras', id]);
  }
}
