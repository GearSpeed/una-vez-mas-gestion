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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type Corte, fechaDeHoy, METODOS_PAGO, type Ubicacion } from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

/**
 * El corte de un vendedor: lo que cargó, vendió y devolvió, lo que trae y lo
 * que cobró por método de pago. El vendedor ve el suyo; quien ve reportes, el
 * de cualquier ubicación.
 */
@Component({
  selector: 'uvm-corte',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    DatePipe,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './corte.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CorteVendedor {
  private readonly sesion = inject(SesionService);

  /** Dentro de Reportes no lleva su propio h1. */
  readonly incrustado = input(false);

  protected readonly eligeUbicacion = computed(() => this.sesion.puede('reportes.ver'));
  protected readonly metodos = METODOS_PAGO;
  protected readonly desde = signal(fechaDeHoy());
  protected readonly hasta = signal(fechaDeHoy());

  protected readonly ubicaciones = httpResource<Ubicacion[]>(() =>
    this.eligeUbicacion() ? '/api/ubicaciones' : undefined,
  );
  protected readonly ubicacionId = linkedSignal<number | null>(
    () =>
      this.sesion.sesion()?.ubicacion?.id ??
      (this.ubicaciones.value() ?? []).find((u) => u.tipo === 'vendedor' && u.activa)?.id ??
      null,
  );
  protected readonly corte = httpResource<Corte>(() => {
    if (this.eligeUbicacion() && this.ubicacionId() === null) return undefined;
    return conParametros('/reportes/corte', {
      ubicacionId: this.eligeUbicacion() ? this.ubicacionId() : null,
      desde: this.desde(),
      hasta: this.hasta(),
    });
  });
}
