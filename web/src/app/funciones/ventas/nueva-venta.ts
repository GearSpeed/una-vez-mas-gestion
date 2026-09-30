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
  coincideBusqueda,
  type ComisionPago,
  comisionDeCobro,
  type Categoria,
  comparar,
  descuentoPorVolumen,
  type Decimal,
  type Existencia,
  type ExistenciasRespuesta,
  importeLinea,
  METODOS_PAGO,
  type MetodoPago,
  redondear,
  restar,
  sumar,
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
    const q = this.busqueda();
    return this.disponibles().filter((f) =>
      coincideBusqueda(q, f.productoId, `${f.producto} ${f.categoria}`),
    );
  });

  /** Los escalones de descuento por volumen, que se capturan en cada categoría. */
  private readonly categorias = httpResource<Categoria[]>(() => '/api/categorias');
  private readonly escalones = computed(
    () =>
      new Map(
        (this.categorias.value() ?? []).map((c) => [
          c.id,
          {
            desde1: c.descuentoDesde1,
            tasa1: c.descuentoTasa1,
            desde2: c.descuentoDesde2,
            tasa2: c.descuentoTasa2,
          },
        ]),
      ),
  );

  protected readonly carrito = signal<ReadonlyMap<number, LineaCarrito>>(new Map());
  protected readonly lineas = computed(() => {
    const porId = new Map(this.disponibles().map((f) => [f.productoId, f]));
    const enCarrito = [...this.carrito()].flatMap(([productoId, linea]) => {
      const producto = porId.get(productoId);
      if (!producto?.precioVenta) return [];
      return [
        {
          productoId,
          categoriaId: producto.categoriaId,
          producto: producto.producto,
          cantidad: linea.cantidad,
          precioUnitario: producto.precioVenta,
          descuentoManual: linea.descuento || '0',
        },
      ];
    });

    // La misma función que usa el servidor: si aquí se cobrara un centavo distinto, la
    // venta se rechazaría por no cuadrar con los pagos.
    const porVolumen = descuentoPorVolumen(enCarrito, this.escalones());

    return enCarrito.map((linea) => {
      const volumen = porVolumen.get(linea.productoId) ?? '0';
      // Quien compra nunca recibe menos de lo que le toca por volumen.
      const descuento =
        comparar(linea.descuentoManual, volumen) > 0 ? linea.descuentoManual : volumen;
      const conPrecio = {
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        descuento,
      };
      return {
        productoId: linea.productoId,
        producto: linea.producto,
        descuentoVolumen: volumen,
        ...conPrecio,
        importe: importeLinea(conPrecio),
      };
    });
  });
  protected readonly total = computed(() => totalVenta(this.lineas()));
  protected readonly piezas = computed(() =>
    this.lineas().reduce((suma, l) => suma + l.cantidad, 0),
  );

  protected readonly canal = signal<CanalVenta>('whatsapp');
  protected readonly metodoPago = signal<MetodoPago>('efectivo');

  /**
   * El pago repartido entre métodos: el cliente paga una parte en efectivo y otra
   * con tarjeta. Apagado, la venta se cobra completa con el método elegido, que es
   * lo de siempre y sigue siendo un solo toque.
   */
  protected readonly dividido = signal(false);
  protected readonly importes = signal<Partial<Record<MetodoPago, string>>>({});

  protected readonly pagos = computed<{ metodoPago: MetodoPago; importe: Decimal }[]>(() => {
    if (!this.dividido()) return [{ metodoPago: this.metodoPago(), importe: this.total() }];
    return METODOS_PAGO.flatMap((metodo) => {
      const importe = this.importes()[metodo];
      return importe && comparar(redondear(importe), '0') > 0
        ? [{ metodoPago: metodo, importe: redondear(importe) }]
        : [];
    });
  });

  /** Lo que falta por cobrar (o lo que sobra, en negativo). */
  protected readonly falta = computed(() =>
    restar(this.total(), sumar(this.pagos().map((pago) => pago.importe))),
  );
  protected readonly cuadra = computed(() => comparar(this.falta(), '0') === 0);

  /** Lo que retiene Mercado Pago de la parte cobrada con tarjeta (lo absorbe el negocio). */
  private readonly tarifas = httpResource<ComisionPago[]>(() => '/api/comisiones');
  protected readonly comision = computed(() => {
    const tarifas = this.tarifas.value();
    if (!tarifas || this.lineas().length === 0) return null;
    const conTarifa = this.pagos().flatMap((pago) => {
      const tarifa = tarifas.find((t) => t.metodoPago === pago.metodoPago);
      return tarifa ? [{ cobro: comisionDeCobro(pago.importe, tarifa), tarifa }] : [];
    });
    if (conTarifa.length === 0) return null;
    const total = sumar(conTarifa.map(({ cobro }) => cobro.total));
    return {
      total,
      neto: restar(sumar(this.pagos().map((p) => p.importe)), total),
      /** Con un solo método con comisión se puede decir la tasa; con varios, no. */
      tasaEfectiva: conTarifa.length === 1 ? (conTarifa[0]?.tarifa.tasaEfectiva ?? null) : null,
    };
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

  protected cambiarImporte(metodo: MetodoPago, importe: string): void {
    this.importes.update((actuales) => ({ ...actuales, [metodo]: importe }));
  }

  /** Al dividir, se arranca con todo en el método que ya estaba elegido. */
  protected dividir(activo: boolean): void {
    this.dividido.set(activo);
    this.importes.set(activo ? { [this.metodoPago()]: this.total() } : {});
  }

  protected async registrar(): Promise<void> {
    if (this.enviando() || this.lineas().length === 0 || !this.cuadra()) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      const venta = await this.api.post<VentaDetalle>('/ventas', {
        claveIdempotencia: this.clave,
        ubicacionId: this.eligeUbicacion() ? (this.ubicacionId() ?? undefined) : undefined,
        canal: this.canal(),
        pagos: this.pagos(),
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
      this.dividir(false);
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
