import { CurrencyPipe, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import {
  CANALES_VENTA,
  type CanalVenta,
  type ComisionPago,
  comisionDeCobro,
  type Existencia,
  type ExistenciasRespuesta,
  importeLinea,
  METODOS_PAGO,
  type MetodoPago,
  normalizar,
  totalVenta,
  type Ubicacion,
  type VentaDetalle,
} from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { estadoDeError, mensajeDeError } from '../../core/errores';
import { SesionService } from '../../core/sesion';
import { nuevaClave } from '../../ui/claves';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

interface LineaCarrito {
  readonly cantidad: number;
  /** Descuento de toda la línea, en pesos (solo con `ventas.descontar`). */
  readonly descuento: string;
}

/**
 * Registrar una venta desde el celular: se toca + en lo que se entregó y se
 * registra. Solo aparece lo que hay en la ubicación del vendedor y tiene precio.
 */
@Component({
  selector: 'uvm-nueva-venta',
  imports: [
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    CurrencyPipe,
    PercentPipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './nueva-venta.html',
  styleUrl: './nueva-venta.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NuevaVenta {
  private readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  protected readonly canales = CANALES_VENTA;
  protected readonly metodos = METODOS_PAGO;

  /** Admin: elige desde qué ubicación vende. Vendedor: siempre la suya. */
  protected readonly eligeUbicacion = computed(() =>
    this.sesion.puede('ventas.cualquier_ubicacion'),
  );
  protected readonly puedeDescontar = computed(() => this.sesion.puede('ventas.descontar'));

  protected readonly ubicaciones = httpResource<Ubicacion[]>(() =>
    this.eligeUbicacion() ? '/api/ubicaciones' : undefined,
  );
  protected readonly ubicacionesActivas = computed(() =>
    (this.ubicaciones.value() ?? []).filter((u) => u.activa),
  );
  protected readonly ubicacionId = linkedSignal<number | null>(
    () =>
      this.sesion.sesion()?.ubicacion?.id ??
      this.ubicacionesActivas().find((u) => u.tipo === 'almacen')?.id ??
      null,
  );

  protected readonly existencias = httpResource<ExistenciasRespuesta>(() => {
    if (!this.eligeUbicacion()) return '/api/inventario/existencias';
    const id = this.ubicacionId();
    return id ? `/api/inventario/existencias?ubicacionId=${id}` : undefined;
  });
  protected readonly nombreUbicacion = computed(
    () => this.existencias.value()?.ubicacion?.nombre ?? '',
  );

  protected readonly busqueda = signal('');
  private readonly disponibles = computed(() =>
    (this.existencias.value()?.filas ?? []).filter(
      (f) => f.activo && f.precioVenta !== null && f.cantidad > 0,
    ),
  );
  protected readonly visibles = computed(() => {
    const q = normalizar(this.busqueda());
    return this.disponibles().filter(
      (f) => !q || normalizar(`${f.producto} ${f.categoria}`).includes(q),
    );
  });

  protected readonly carrito = signal<ReadonlyMap<number, LineaCarrito>>(new Map());
  protected readonly lineas = computed(() => {
    const porId = new Map(this.disponibles().map((f) => [f.productoId, f]));
    return [...this.carrito()].flatMap(([productoId, linea]) => {
      const producto = porId.get(productoId);
      if (!producto?.precioVenta) return [];
      const conPrecio = {
        cantidad: linea.cantidad,
        precioUnitario: producto.precioVenta,
        descuento: linea.descuento || '0',
      };
      return [
        { productoId, producto: producto.producto, ...conPrecio, importe: importeLinea(conPrecio) },
      ];
    });
  });
  protected readonly total = computed(() => totalVenta(this.lineas()));
  protected readonly piezas = computed(() =>
    this.lineas().reduce((suma, l) => suma + l.cantidad, 0),
  );

  protected readonly canal = signal<CanalVenta>('whatsapp');
  protected readonly metodoPago = signal<MetodoPago>('efectivo');

  /** Lo que retiene Mercado Pago si se cobra con tarjeta (lo absorbe el negocio). */
  private readonly tarifas = httpResource<ComisionPago[]>(() => '/api/comisiones');
  protected readonly comision = computed(() => {
    const tarifa = this.tarifas.value()?.find((t) => t.metodoPago === this.metodoPago());
    if (!tarifa || this.lineas().length === 0) return null;
    return { ...comisionDeCobro(this.total(), tarifa), tasaEfectiva: tarifa.tasaEfectiva };
  });
  protected readonly notas = signal('');
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  private clave = nuevaClave();

  protected cantidadDe(productoId: number): number {
    return this.carrito().get(productoId)?.cantidad ?? 0;
  }

  protected agregar(producto: Existencia): void {
    const actual = this.carrito().get(producto.productoId);
    if ((actual?.cantidad ?? 0) >= producto.cantidad) return;
    this.cambiar(producto.productoId, {
      cantidad: (actual?.cantidad ?? 0) + 1,
      descuento: actual?.descuento ?? '',
    });
  }

  protected quitar(productoId: number): void {
    const actual = this.carrito().get(productoId);
    if (!actual) return;
    this.cambiar(
      productoId,
      actual.cantidad > 1 ? { ...actual, cantidad: actual.cantidad - 1 } : null,
    );
  }

  protected cambiarDescuento(productoId: number, descuento: string): void {
    const actual = this.carrito().get(productoId);
    if (actual) this.cambiar(productoId, { ...actual, descuento });
  }

  protected cambiarUbicacion(id: number): void {
    this.ubicacionId.set(id);
    this.carrito.set(new Map());
  }

  protected async registrar(): Promise<void> {
    if (this.enviando() || this.lineas().length === 0) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      const venta = await this.api.post<VentaDetalle>('/ventas', {
        claveIdempotencia: this.clave,
        ubicacionId: this.eligeUbicacion() ? (this.ubicacionId() ?? undefined) : undefined,
        canal: this.canal(),
        metodoPago: this.metodoPago(),
        notas: this.notas(),
        lineas: this.lineas().map((l) => ({
          productoId: l.productoId,
          cantidad: l.cantidad,
          descuento: this.puedeDescontar() ? l.descuento : '0',
        })),
      });
      this.avisos.exito(`Venta ${venta.folio} registrada por $${venta.total}.`);
      this.clave = nuevaClave();
      this.carrito.set(new Map());
      this.notas.set('');
      this.existencias.reload();
    } catch (error) {
      this.error.set(mensajeDeError(error));
      // Si alguien más vendió lo mismo, la existencia cambió: se vuelve a leer.
      if (estadoDeError(error) === 409) this.existencias.reload();
    } finally {
      this.enviando.set(false);
    }
  }

  private cambiar(productoId: number, linea: LineaCarrito | null): void {
    this.carrito.update((carrito) => {
      const nuevo = new Map(carrito);
      if (linea) nuevo.set(productoId, linea);
      else nuevo.delete(productoId);
      return nuevo;
    });
  }
}
