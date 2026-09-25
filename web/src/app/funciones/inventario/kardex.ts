import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import type { MovimientoKardex, Paginado, Producto, Ubicacion } from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';
import { type DatosDialogoDocumento, DialogoDocumento } from './dialogo-documento';

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
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './kardex.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Kardex {
  private readonly dialogo = inject(MatDialog);
  private readonly router = inject(Router);

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

  /**
   * Del movimiento al documento que lo causó: la compra o la venta tienen su
   * pantalla; el traspaso y el ajuste se abren aquí mismo, con sus notas. Una
   * devolución se ve dentro de su venta.
   */
  protected abrir(movimiento: MovimientoKardex): void {
    const id = movimiento.documentoId;
    if (id === null) return;
    switch (movimiento.tipo) {
      case 'compra':
      case 'cancelacion_compra':
        void this.router.navigate(['/compras', id]);
        return;
      case 'venta':
      case 'cancelacion_venta':
      case 'devolucion':
        void this.router.navigate(['/ventas', id]);
        return;
      case 'traspaso_salida':
      case 'traspaso_entrada':
        this.abrirDocumento('traspaso', id);
        return;
      case 'ajuste':
        this.abrirDocumento('ajuste', id);
        return;
    }
  }

  private abrirDocumento(clase: DatosDialogoDocumento['clase'], id: number): void {
    const datos: DatosDialogoDocumento = { clase, id };
    this.dialogo.open<DialogoDocumento, DatosDialogoDocumento>(DialogoDocumento, {
      data: datos,
      width: '36rem',
      maxWidth: '95vw',
    });
  }
}

function numero(valor: string | undefined): number | null {
  const n = Number(valor);
  return valor && Number.isInteger(n) && n > 0 ? n : null;
}
