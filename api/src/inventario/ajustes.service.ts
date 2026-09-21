import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AjusteDetalle,
  comparar,
  type NuevoAjuste,
  type NuevoConteo,
  type ResultadoConteo,
} from '@uvm/compartido';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { conCostos } from '../comun/costos.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB, type Transaccion } from '../db/conexion.js';
import {
  ajusteDetalle,
  ajustes,
  existencias,
  productos,
  ubicaciones,
  usuarios,
} from '../db/esquema.js';
import { MovimientosService } from './movimientos.service.js';

interface LineaAjuste {
  readonly productoId: number;
  readonly cantidad: number;
  readonly costoUnitario: string | null;
}

/**
 * Ajustes: mermas, caducidad, piezas dañadas, muestras, y el conteo físico,
 * que registra lo que de verdad hay y ajusta por la diferencia.
 */
@Injectable()
export class AjustesService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly movimientos: MovimientosService,
  ) {}

  async registrar(usuario: UsuarioSesion, datos: NuevoAjuste): Promise<AjusteDetalle> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      () => this.porClave(usuario, datos.claveIdempotencia),
      async () => {
        const id = await this.db.transaction((tx) =>
          this.crear(tx, usuario, { ...datos, fecha }, datos.lineas),
        );
        return this.detalle(usuario, id);
      },
    );
  }

  /** Conteo físico: si no hay diferencias no se crea nada. */
  async contar(usuario: UsuarioSesion, datos: NuevoConteo): Promise<ResultadoConteo> {
    const fecha = fechaDelDocumento(datos.fecha);
    const previo = await this.porClave(usuario, datos.claveIdempotencia);
    if (previo) return { diferencias: previo.lineas.length, ajuste: previo };

    const id = await this.db.transaction(async (tx) => {
      const ids = datos.conteos.map((c) => c.productoId);
      // Bloquear primero: así nadie vende entre que se lee la existencia y se ajusta.
      await this.movimientos.bloquearProductos(tx, ids);
      const actuales = await tx
        .select({ productoId: existencias.productoId, cantidad: existencias.cantidad })
        .from(existencias)
        .where(
          and(eq(existencias.ubicacionId, datos.ubicacionId), inArray(existencias.productoId, ids)),
        );
      const hay = new Map(actuales.map((fila) => [fila.productoId, fila.cantidad]));

      const diferencias = datos.conteos
        .map((conteo) => ({
          productoId: conteo.productoId,
          cantidad: conteo.contado - (hay.get(conteo.productoId) ?? 0),
          costoUnitario: null,
        }))
        .filter((linea) => linea.cantidad !== 0);
      if (diferencias.length === 0) return null;

      return this.crear(tx, usuario, { ...datos, fecha, motivo: 'conteo' }, diferencias);
    });

    if (id === null) {
      await this.validarUbicacion(datos.ubicacionId);
      return { diferencias: 0, ajuste: null };
    }
    const ajuste = await this.detalle(usuario, id);
    return { diferencias: ajuste.lineas.length, ajuste };
  }

  async recientes(usuario: UsuarioSesion, limite = 30): Promise<AjusteDetalle[]> {
    const filas = await this.db
      .select({ id: ajustes.id })
      .from(ajustes)
      .orderBy(desc(ajustes.id))
      .limit(limite);
    return Promise.all(filas.map((fila) => this.detalle(usuario, fila.id)));
  }

  async detalle(usuario: UsuarioSesion, id: number): Promise<AjusteDetalle> {
    const [ajuste] = await this.db
      .select({
        id: ajustes.id,
        folio: ajustes.folio,
        fecha: ajustes.fecha,
        ubicacion: ubicaciones.nombre,
        motivo: ajustes.motivo,
        registradoPor: usuarios.nombre,
        notas: ajustes.notas,
      })
      .from(ajustes)
      .innerJoin(ubicaciones, eq(ubicaciones.id, ajustes.ubicacionId))
      .innerJoin(usuarios, eq(usuarios.id, ajustes.usuarioId))
      .where(eq(ajustes.id, id));
    if (!ajuste) throw new NotFoundException('El ajuste no existe.');

    const lineas = await this.db
      .select({
        productoId: ajusteDetalle.productoId,
        producto: productos.nombre,
        cantidad: ajusteDetalle.cantidad,
        costoUnitario: ajusteDetalle.costoUnitario,
      })
      .from(ajusteDetalle)
      .innerJoin(productos, eq(productos.id, ajusteDetalle.productoId))
      .where(eq(ajusteDetalle.ajusteId, id))
      .orderBy(productos.nombre);

    return {
      ...ajuste,
      lineas: lineas.map(({ costoUnitario, ...linea }) =>
        conCostos(usuario, linea, () => ({ costoUnitario })),
      ),
    };
  }

  private async crear(
    tx: Transaccion,
    usuario: UsuarioSesion,
    datos: Pick<NuevoAjuste, 'ubicacionId' | 'motivo' | 'notas' | 'claveIdempotencia'> & {
      fecha: string;
    },
    lineas: readonly LineaAjuste[],
  ): Promise<number> {
    const porProducto = await this.movimientos.bloquearProductos(
      tx,
      lineas.map((l) => l.productoId),
    );
    // Lo que entra sin costo toma el promedio; si el producto nunca se ha comprado, no hay promedio.
    lineas.forEach((linea, i) => {
      const producto = porProducto.get(linea.productoId);
      const sinCosto =
        linea.cantidad > 0 && linea.costoUnitario === null && datos.motivo !== 'conteo';
      if (producto && sinCosto && comparar(producto.costoPromedio, '0') === 0) {
        throw new UnprocessableEntityException({
          mensaje: `Indica el costo de ${producto.nombre}: todavía no tiene costo promedio.`,
          campos: { [`lineas.${i}.costoUnitario`]: 'Indica el costo' },
        });
      }
    });

    const [ajuste] = await tx
      .insert(ajustes)
      .values({
        fecha: datos.fecha,
        ubicacionId: datos.ubicacionId,
        motivo: datos.motivo,
        notas: datos.notas,
        usuarioId: usuario.id,
        claveIdempotencia: datos.claveIdempotencia,
      })
      .returning({ id: ajustes.id });
    if (!ajuste) throw new Error('No se registró el ajuste');

    const aplicados = await this.movimientos.aplicar(
      tx,
      lineas.map((linea) => ({
        productoId: linea.productoId,
        ubicacionId: datos.ubicacionId,
        cantidad: linea.cantidad,
        tipo: 'ajuste' as const,
        costo: linea.cantidad > 0 ? (linea.costoUnitario ?? undefined) : undefined,
      })),
      { referencia: { ajusteId: ajuste.id }, usuarioId: usuario.id, fecha: datos.fecha },
    );
    await tx.insert(ajusteDetalle).values(
      aplicados.map((aplicado) => ({
        ajusteId: ajuste.id,
        productoId: aplicado.productoId,
        cantidad: aplicado.cantidad,
        costoUnitario: aplicado.costoUnitario,
      })),
    );
    return ajuste.id;
  }

  private async porClave(
    usuario: UsuarioSesion,
    claveIdempotencia: string,
  ): Promise<AjusteDetalle | null> {
    const [fila] = await this.db
      .select({ id: ajustes.id })
      .from(ajustes)
      .where(
        and(eq(ajustes.claveIdempotencia, claveIdempotencia), eq(ajustes.usuarioId, usuario.id)),
      );
    return fila ? this.detalle(usuario, fila.id) : null;
  }

  private async validarUbicacion(id: number): Promise<void> {
    const [ubicacion] = await this.db
      .select({ id: ubicaciones.id })
      .from(ubicaciones)
      .where(eq(ubicaciones.id, id));
    if (!ubicacion) throw new NotFoundException('La ubicación no existe.');
  }
}
