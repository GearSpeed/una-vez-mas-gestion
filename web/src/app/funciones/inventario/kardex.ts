import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import type { MovimientoKardex, Paginado, Producto, Ubicacion } from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

/** El historial de un producto: cada entrada y salida con la existencia que dejó. */
@Component({
  selector: 'uvm-kardex',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
  ],
  templateUrl: './kardex.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Kardex {
  /** Se puede llegar con `?productoId=3&ubicacionId=1` desde Existencias. */
  readonly productoIdInicial = input<string | undefined>(undefined, { alias: 'productoId' });
  readonly ubicacionIdInicial = input<string | undefined>(undefined, { alias: 'ubicacionId' });

  protected readonly productoId = linkedSignal(() => numero(this.productoIdInicial()));
  protected readonly ubicacionId = linkedSignal(() => numero(this.ubicacionIdInicial()));
  protected readonly desde = signal('');
  protected readonly hasta = signal('');
  protected readonly pagina = signal(1);

  protected readonly productos = httpResource<Producto[]>(() => '/api/productos?inactivos=1');
  protected readonly ubicaciones = httpResource<Ubicacion[]>(() => '/api/ubicaciones');
  protected readonly movimientos = httpResource<Paginado<MovimientoKardex>>(() => {
    const productoId = this.productoId();
    if (productoId === null) return undefined;
    return conParametros('/inventario/kardex', {
      productoId,
      ubicacionId: this.ubicacionId(),
      desde: this.desde(),
      hasta: this.hasta(),
      pagina: this.pagina(),
    });
  });
  protected readonly nombreProducto = computed(
    () => this.productos.value()?.find((p) => p.id === this.productoId())?.nombre ?? '',
  );

  protected filtrar(cambio: () => void): void {
    cambio();
    this.pagina.set(1);
  }

  protected cambiarPagina(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex + 1);
  }
}

function numero(valor: string | undefined): number | null {
  const n = Number(valor);
  return valor && Number.isInteger(n) && n > 0 ? n : null;
}
