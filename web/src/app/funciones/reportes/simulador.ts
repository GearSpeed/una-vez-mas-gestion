import { CurrencyPipe, PercentPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  type Categoria,
  type ComisionPago,
  coincideBusqueda,
  comisionDeCobro,
  comisionDeVendedor,
  comparar,
  DECIMALES_COSTO,
  type Decimal,
  descuentoPorVolumen,
  type EscalonesCategoria,
  type Existencia,
  type ExistenciasRespuesta,
  type LineaConCategoria,
  multiplicar,
  redondear,
  restar,
  sumar,
  totalVenta,
  type Usuario,
} from '@uvm/compartido';
import { SesionService } from '../../core/sesion';
import { EstadoCarga } from '../../ui/estado-carga';
import { Desplazable } from '../../ui/desplazable';

interface LineaSimulador {
  readonly productoId: number;
  readonly categoriaId: number;
  readonly producto: string;
  readonly categoria: string;
  readonly precioUnitario: Decimal;
  readonly costoUnitario: Decimal;
  readonly existencia: number;
  readonly cantidad: number;
}

/**
 * «¿Cuánto me queda si vendo esto?» — sin registrar ninguna venta ni tocar
 * existencias. Usa las mismas funciones de `compartido` que la venta real, así
 * que el número coincide con lo que de verdad cobraría y ganaría el negocio.
 */
@Component({
  selector: 'uvm-simulador',
  imports: [
    Desplazable,
    EstadoCarga,
    CurrencyPipe,
    PercentPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './simulador.html',
  styleUrl: './simulador.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Simulador {
  private readonly sesion = inject(SesionService);

  protected readonly existencias = httpResource<ExistenciasRespuesta>(
    () => '/api/inventario/existencias',
  );
  private readonly categorias = httpResource<Categoria[]>(() => '/api/categorias');
  /**
   * `/reportes/comisiones` no sirve aquí: oculta a quien nunca ha ganado ni cobrado
   * nada, justo quien más usaría un simulador (una tasa recién capturada, o en cero).
   * `/api/usuarios` no filtra, a cambio de pedir `usuarios.gestionar`: sin ese
   * permiso el selector queda vacío y solo se puede escribir la tasa a mano.
   */
  protected readonly vendedores = httpResource<Usuario[]>(() =>
    this.sesion.puede('usuarios.gestionar') ? '/api/usuarios' : undefined,
  );
  protected readonly vendedoresActivos = computed(() =>
    (this.vendedores.value() ?? []).filter((v) => v.activo),
  );
  private readonly tarifas = httpResource<ComisionPago[]>(() => '/api/comisiones');

  private readonly escalones = computed(
    () =>
      new Map<number, EscalonesCategoria>(
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

  protected readonly vendible = computed(() =>
    (this.existencias.value()?.filas ?? []).filter((f) => f.activo && f.precioVenta !== null),
  );

  protected readonly busqueda = signal('');
  protected readonly visibles = computed(() => {
    const q = this.busqueda();
    return this.vendible().filter((f) =>
      coincideBusqueda(q, f.productoId, `${f.producto} ${f.categoria}`),
    );
  });

  protected readonly cantidades = signal<ReadonlyMap<number, number>>(new Map());

  protected readonly vendedorId = signal<number | null>(null);
  protected readonly tasaManual = signal<number | null>(null);
  /** La tasa que de verdad se usa: la escrita a mano manda sobre la del vendedor elegido. */
  protected readonly tasaComision = computed<Decimal>(() => {
    if (this.tasaManual() !== null) return String(this.tasaManual());
    const vendedor = this.vendedoresActivos().find((v) => v.id === this.vendedorId());
    return vendedor?.comisionVenta ?? '0';
  });

  protected readonly cobroConTarjeta = computed(() =>
    (this.tarifas.value() ?? []).find((t) => t.metodoPago === 'tarjeta'),
  );

  private readonly lineasConDatos = computed<LineaSimulador[]>(() => {
    const porId = new Map(this.vendible().map((f) => [f.productoId, f]));
    return [...this.cantidades()].flatMap(([productoId, cantidad]) => {
      const producto: Existencia | undefined = porId.get(productoId);
      if (!producto?.precioVenta || cantidad <= 0) return [];
      return [
        {
          productoId,
          categoriaId: producto.categoriaId,
          producto: producto.producto,
          categoria: producto.categoria,
          precioUnitario: producto.precioVenta,
          costoUnitario: producto.costos?.costoPromedio ?? '0',
          existencia: producto.cantidad,
          cantidad,
        },
      ];
    });
  });

  /** Mismo cálculo que el carrito real: si aquí diera otro número, no serviría de nada. */
  protected readonly lineas = computed(() => {
    const base = this.lineasConDatos();
    const paraDescuento: LineaConCategoria[] = base.map((l) => ({
      productoId: l.productoId,
      categoriaId: l.categoriaId,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
    }));
    const porVolumen = descuentoPorVolumen(paraDescuento, this.escalones());
    return base.map((l) => {
      const descuento = porVolumen.get(l.productoId) ?? '0';
      const importe = restar(multiplicar(l.precioUnitario, String(l.cantidad)), descuento);
      return { ...l, descuentoVolumen: descuento, importe };
    });
  });

  protected readonly piezas = computed(() =>
    this.lineas().reduce((suma, l) => suma + l.cantidad, 0),
  );
  protected readonly subtotal = computed(() =>
    sumar(this.lineas().map((l) => multiplicar(l.precioUnitario, String(l.cantidad)))),
  );
  protected readonly ventaNeta = computed(() =>
    totalVenta(
      this.lineas().map((l) => ({
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuento: l.descuentoVolumen,
      })),
    ),
  );
  protected readonly descuentoTotal = computed(() => restar(this.subtotal(), this.ventaNeta()));

  /** Se suma con todos sus decimales y se redondea una vez, como la API: mismo centavo. */
  protected readonly costoTotal = computed(() =>
    redondear(
      sumar(
        this.lineas().map((l) => multiplicar(l.costoUnitario, String(l.cantidad), DECIMALES_COSTO)),
        DECIMALES_COSTO,
      ),
    ),
  );
  protected readonly utilidadBruta = computed(() => restar(this.ventaNeta(), this.costoTotal()));
  protected readonly comisionVendedor = computed(() =>
    comisionDeVendedor(this.utilidadBruta(), this.tasaComision()),
  );
  protected readonly utilidadNeta = computed(() =>
    restar(this.utilidadBruta(), this.comisionVendedor()),
  );

  /** Lo que quedaría si en vez de efectivo se cobrara todo con tarjeta. */
  protected readonly comisionTarjeta = computed(() => {
    const tarifa = this.cobroConTarjeta();
    if (!tarifa || this.lineas().length === 0) return null;
    return comisionDeCobro(this.ventaNeta(), tarifa);
  });
  protected readonly utilidadConTarjeta = computed(() => {
    const comision = this.comisionTarjeta();
    return comision ? restar(this.utilidadNeta(), comision.total) : null;
  });

  protected cantidadDe(productoId: number): number {
    return this.cantidades().get(productoId) ?? 0;
  }

  protected cambiarCantidad(productoId: number, cantidad: number): void {
    this.cantidades.update((actuales) => {
      const nuevas = new Map(actuales);
      if (cantidad > 0) nuevas.set(productoId, Math.trunc(cantidad));
      else nuevas.delete(productoId);
      return nuevas;
    });
  }

  /** Llena cada cantidad con lo que hay hoy en existencia, de un solo toque. */
  protected usarInventarioActual(): void {
    this.cantidades.set(
      new Map(
        this.vendible()
          .filter((f) => f.cantidad > 0)
          .map((f) => [f.productoId, f.cantidad]),
      ),
    );
  }

  protected vaciar(): void {
    this.cantidades.set(new Map());
  }

  protected cambiarVendedor(id: number | null): void {
    this.vendedorId.set(id);
    this.tasaManual.set(null);
  }

  protected cambiarTasaManual(valor: string): void {
    const numero = Number(valor);
    this.tasaManual.set(valor === '' || Number.isNaN(numero) ? null : numero / 100);
  }

  protected comparar(a: Decimal, b: Decimal): number {
    return comparar(a, b);
  }
}
