import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DECIMALES_COSTO,
  type Decimal,
  promedioTrasEntrada,
  promedioTrasRetiro,
  redondear,
  type TipoMovimiento,
} from '@uvm/compartido';
import { and, eq, inArray } from 'drizzle-orm';
import type { Transaccion } from '../db/conexion.js';
import { existencias, movimientos, productos, ubicaciones } from '../db/esquema.js';

export interface SolicitudMovimiento {
  readonly productoId: number;
  readonly ubicacionId: number;
  /** Con signo: positivo entra, negativo sale. */
  readonly cantidad: number;
  readonly tipo: TipoMovimiento;
  /**
   * Costo de lo que entra (compra, ajuste que suma, venta cancelada) o de lo que
   * se retira al cancelar una compra. Sin él, se usa el costo promedio.
   */
  readonly costo?: Decimal;
}

export interface Referencia {
  readonly compraId?: number;
  readonly ventaId?: number;
  readonly traspasoId?: number;
  readonly ajusteId?: number;
  readonly devolucionId?: number;
}

export interface ContextoMovimiento {
  readonly referencia: Referencia;
  readonly usuarioId: number;
  readonly fecha: string;
}

export interface MovimientoAplicado {
  readonly productoId: number;
  readonly ubicacionId: number;
  readonly tipo: TipoMovimiento;
  readonly cantidad: number;
  /** El costo al que se valuó el movimiento; para una venta es el costo de lo vendido. */
  readonly costoUnitario: Decimal;
  readonly existenciaResultante: number;
  readonly costoPromedioResultante: Decimal;
}

export interface ProductoBloqueado {
  readonly id: number;
  readonly nombre: string;
  readonly costoPromedio: Decimal;
  readonly precioVenta: Decimal | null;
  readonly activo: boolean;
}

/** El signo que exige cada tipo (0 = cualquiera): una venta nunca suma. */
const SIGNO: Readonly<Record<TipoMovimiento, 1 | -1 | 0>> = {
  compra: 1,
  venta: -1,
  traspaso_salida: -1,
  traspaso_entrada: 1,
  ajuste: 0,
  cancelacion_compra: -1,
  cancelacion_venta: 1,
  devolucion: 1,
};

/** Entradas que mueven el costo promedio. El traspaso no: la pieza solo cambia de lugar. */
const ENTRADAS_CON_COSTO: ReadonlySet<TipoMovimiento> = new Set([
  'compra',
  'ajuste',
  'cancelacion_venta',
  'devolucion',
]);

const clave = (productoId: number, ubicacionId: number) => `${productoId}:${ubicacionId}`;

/**
 * El único camino para cambiar existencias. Corre dentro de la transacción del
 * documento (compra, venta, traspaso, ajuste): si algo falla, no queda nada a
 * medias. Mantiene tres cosas a la vez:
 *
 * - `existencias`: cuánto hay de cada producto en cada ubicación.
 * - `productos.costo_promedio`: el costo promedio ponderado móvil.
 * - `movimientos`: el kardex, con la existencia y el costo que resultaron.
 */
@Injectable()
export class MovimientosService {
  /**
   * Bloquea los productos en orden de id. Todo lo que cambia existencias pasa
   * primero por aquí, así que dos documentos sobre el mismo producto se forman
   * en fila en vez de cruzarse, y el orden fijo evita bloqueos mutuos.
   */
  async bloquearProductos(
    tx: Transaccion,
    productoIds: readonly number[],
  ): Promise<Map<number, ProductoBloqueado>> {
    const ids = [...new Set(productoIds)].toSorted((a, b) => a - b);
    const filas = await tx
      .select({
        id: productos.id,
        nombre: productos.nombre,
        costoPromedio: productos.costoPromedio,
        precioVenta: productos.precioVenta,
        activo: productos.activo,
      })
      .from(productos)
      .where(inArray(productos.id, ids))
      .orderBy(productos.id)
      .for('update');
    if (filas.length !== ids.length) throw new NotFoundException('Uno de los productos no existe.');
    return new Map(filas.map((fila) => [fila.id, fila]));
  }

  async aplicar(
    tx: Transaccion,
    solicitudes: readonly SolicitudMovimiento[],
    contexto: ContextoMovimiento,
  ): Promise<MovimientoAplicado[]> {
    if (solicitudes.length === 0) return [];
    solicitudes.forEach(validarSigno);

    const productoIds = [...new Set(solicitudes.map((s) => s.productoId))];
    const porProducto = await this.bloquearProductos(tx, productoIds);
    const porUbicacion = await this.ubicaciones(tx, solicitudes);

    // Una fila por par producto-ubicación; las que no existían nacen en cero.
    const pares = new Map(solicitudes.map((s) => [clave(s.productoId, s.ubicacionId), s]));
    await tx
      .insert(existencias)
      .values(
        [...pares.values()].map((s) => ({
          productoId: s.productoId,
          ubicacionId: s.ubicacionId,
          cantidad: 0,
        })),
      )
      .onConflictDoNothing();

    // Con los productos bloqueados nadie más puede mover estas existencias.
    const filas = await tx
      .select()
      .from(existencias)
      .where(inArray(existencias.productoId, productoIds));
    const enUbicacion = new Map<string, number>();
    const totalEmpresa = new Map<number, number>();
    for (const fila of filas) {
      enUbicacion.set(clave(fila.productoId, fila.ubicacionId), fila.cantidad);
      totalEmpresa.set(fila.productoId, (totalEmpresa.get(fila.productoId) ?? 0) + fila.cantidad);
    }
    const promedios = new Map([...porProducto].map(([id, p]) => [id, p.costoPromedio]));

    const aplicados: MovimientoAplicado[] = [];
    for (const solicitud of solicitudes) {
      const producto = porProducto.get(solicitud.productoId);
      const ubicacion = porUbicacion.get(solicitud.ubicacionId);
      if (!producto || !ubicacion) {
        throw new UnprocessableEntityException({
          mensaje: 'Ese producto o esa ubicación no existen.',
          campos: { ubicacionId: 'Elige una ubicación válida' },
        });
      }

      const k = clave(solicitud.productoId, solicitud.ubicacionId);
      const antes = enUbicacion.get(k) ?? 0;
      const total = totalEmpresa.get(solicitud.productoId) ?? 0;
      if (antes + solicitud.cantidad < 0) {
        throw new ConflictException(
          `Solo hay ${antes} de ${producto.nombre} en ${ubicacion.nombre}.`,
        );
      }
      if (solicitud.cantidad > 0 && !ubicacion.activa) {
        throw new ConflictException(`La ubicación ${ubicacion.nombre} está desactivada.`);
      }

      const promedioAntes = promedios.get(solicitud.productoId) ?? '0';
      let costoUnitario = redondear(promedioAntes, DECIMALES_COSTO);
      let promedio = promedioAntes;
      if (solicitud.cantidad > 0 && ENTRADAS_CON_COSTO.has(solicitud.tipo)) {
        costoUnitario = redondear(solicitud.costo ?? promedioAntes, DECIMALES_COSTO);
        promedio = promedioTrasEntrada(total, promedioAntes, solicitud.cantidad, costoUnitario);
      } else if (solicitud.tipo === 'cancelacion_compra') {
        if (solicitud.costo === undefined) throw new Error('Cancelar una compra requiere su costo');
        costoUnitario = redondear(solicitud.costo, DECIMALES_COSTO);
        promedio = promedioTrasRetiro(total, promedioAntes, -solicitud.cantidad, costoUnitario);
      }

      enUbicacion.set(k, antes + solicitud.cantidad);
      totalEmpresa.set(solicitud.productoId, total + solicitud.cantidad);
      promedios.set(solicitud.productoId, promedio);
      aplicados.push({
        productoId: solicitud.productoId,
        ubicacionId: solicitud.ubicacionId,
        tipo: solicitud.tipo,
        cantidad: solicitud.cantidad,
        costoUnitario,
        existenciaResultante: antes + solicitud.cantidad,
        costoPromedioResultante: redondear(promedio, DECIMALES_COSTO),
      });
    }

    for (const k of pares.keys()) {
      const [productoId, ubicacionId] = k.split(':').map(Number) as [number, number];
      await tx
        .update(existencias)
        .set({ cantidad: enUbicacion.get(k) ?? 0 })
        .where(
          and(eq(existencias.productoId, productoId), eq(existencias.ubicacionId, ubicacionId)),
        );
    }
    for (const [id, producto] of porProducto) {
      const promedio = promedios.get(id);
      if (promedio !== undefined && promedio !== producto.costoPromedio) {
        await tx
          .update(productos)
          .set({ costoPromedio: promedio, actualizadoEn: new Date() })
          .where(eq(productos.id, id));
      }
    }
    await tx.insert(movimientos).values(
      aplicados.map((aplicado) => ({
        ...aplicado,
        ...contexto.referencia,
        fecha: contexto.fecha,
        usuarioId: contexto.usuarioId,
      })),
    );
    return aplicados;
  }

  private async ubicaciones(tx: Transaccion, solicitudes: readonly SolicitudMovimiento[]) {
    const ids = [...new Set(solicitudes.map((s) => s.ubicacionId))];
    const filas = await tx
      .select({ id: ubicaciones.id, nombre: ubicaciones.nombre, activa: ubicaciones.activa })
      .from(ubicaciones)
      .where(inArray(ubicaciones.id, ids));
    if (filas.length !== ids.length) throw new NotFoundException('La ubicación no existe.');
    return new Map(filas.map((fila) => [fila.id, fila]));
  }
}

function validarSigno(solicitud: SolicitudMovimiento): void {
  const signo = SIGNO[solicitud.tipo];
  const valido =
    Number.isSafeInteger(solicitud.cantidad) &&
    solicitud.cantidad !== 0 &&
    (signo === 0 || Math.sign(solicitud.cantidad) === signo);
  if (!valido)
    throw new Error(`Movimiento inválido: ${solicitud.tipo} con cantidad ${solicitud.cantidad}`);
}
