import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ExistenciasRespuesta,
  type FiltroKardex,
  type MovimientoKardex,
  multiplicar,
  type Paginado,
  sumar,
  type UbicacionResumen,
} from '@uvm/compartido';
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import {
  ajustes,
  categorias,
  compras,
  devoluciones,
  existencias,
  movimientos,
  productos,
  traspasos,
  ubicaciones,
  usuarios,
  ventas,
} from '../db/esquema.js';

const POR_PAGINA = 50;

@Injectable()
export class ExistenciasService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /**
   * Existencia por producto en una ubicación, o sumada de todas. Un vendedor
   * (sin `inventario.ver_todo`) solo puede ver la suya.
   */
  async listar(
    usuario: UsuarioSesion,
    ubicacionId: number | undefined,
  ): Promise<ExistenciasRespuesta> {
    const ubicacion = await this.ubicacionVisible(usuario, ubicacionId);

    const cantidad = ubicacion
      ? sql<number>`coalesce((select e.cantidad from ${existencias} e
          where e.producto_id = ${productos.id} and e.ubicacion_id = ${ubicacion.id}), 0)::int`
      : sql<number>`coalesce((select sum(e.cantidad) from ${existencias} e
          where e.producto_id = ${productos.id}), 0)::int`;

    const filas = await this.db
      .select({
        productoId: productos.id,
        slug: productos.slug,
        producto: productos.nombre,
        categoria: categorias.nombre,
        presentacion: productos.presentacion,
        precioVenta: productos.precioVenta,
        activo: productos.activo,
        stockMinimo: productos.stockMinimo,
        costoPromedio: productos.costoPromedio,
        cantidad,
      })
      .from(productos)
      .innerJoin(categorias, eq(categorias.id, productos.categoriaId))
      .orderBy(categorias.orden, productos.nombre);

    // Un producto dado de baja solo aparece mientras le queden piezas.
    const visibles = filas.filter((fila) => fila.activo || fila.cantidad > 0);
    const valor = (fila: (typeof visibles)[number]) =>
      multiplicar(fila.cantidad, fila.costoPromedio);

    return conCostos(
      usuario,
      {
        ubicacion,
        filas: visibles.map((fila) =>
          conCostos(
            usuario,
            {
              productoId: fila.productoId,
              slug: fila.slug,
              producto: fila.producto,
              categoria: fila.categoria,
              presentacion: fila.presentacion,
              precioVenta: fila.precioVenta,
              activo: fila.activo,
              cantidad: fila.cantidad,
              stockMinimo: fila.stockMinimo,
            },
            () => ({ costoPromedio: fila.costoPromedio, valor: valor(fila) }),
          ),
        ),
      },
      () => ({ valorTotal: sumar(visibles.map(valor)) }),
    );
  }

  /** Kardex de un producto: cada entrada y salida con la existencia que dejó. */
  async kardex(usuario: UsuarioSesion, filtro: FiltroKardex): Promise<Paginado<MovimientoKardex>> {
    const condiciones: SQL[] = [eq(movimientos.productoId, filtro.productoId)];
    if (filtro.ubicacionId !== undefined)
      condiciones.push(eq(movimientos.ubicacionId, filtro.ubicacionId));
    if (filtro.desde) condiciones.push(gte(movimientos.fecha, filtro.desde));
    if (filtro.hasta) condiciones.push(lte(movimientos.fecha, filtro.hasta));
    const donde = and(...condiciones);

    const [filas, [conteo]] = await Promise.all([
      this.db
        .select({
          id: movimientos.id,
          fecha: movimientos.fecha,
          registradoEn: movimientos.registradoEn,
          tipo: movimientos.tipo,
          cantidad: movimientos.cantidad,
          existenciaResultante: movimientos.existenciaResultante,
          costoUnitario: movimientos.costoUnitario,
          costoPromedioResultante: movimientos.costoPromedioResultante,
          ubicacion: ubicaciones.nombre,
          usuario: usuarios.nombre,
          documento: sql<string>`coalesce(${compras.folio}, ${ventas.folio}, ${traspasos.folio}, ${ajustes.folio}, ${devoluciones.folio})`,
          // Con qué abrir el documento desde el kardex. Una devolución se ve dentro
          // de su venta, así que ahí va el id de la venta, no el de la devolución.
          documentoId: sql<
            number | null
          >`coalesce(${compras.id}, ${ventas.id}, ${traspasos.id}, ${ajustes.id}, ${devoluciones.ventaId})`,
        })
        .from(movimientos)
        .innerJoin(ubicaciones, eq(ubicaciones.id, movimientos.ubicacionId))
        .innerJoin(usuarios, eq(usuarios.id, movimientos.usuarioId))
        .leftJoin(compras, eq(compras.id, movimientos.compraId))
        .leftJoin(ventas, eq(ventas.id, movimientos.ventaId))
        .leftJoin(traspasos, eq(traspasos.id, movimientos.traspasoId))
        .leftJoin(ajustes, eq(ajustes.id, movimientos.ajusteId))
        .leftJoin(devoluciones, eq(devoluciones.id, movimientos.devolucionId))
        .where(donde)
        .orderBy(desc(movimientos.id))
        .limit(POR_PAGINA)
        .offset((filtro.pagina - 1) * POR_PAGINA),
      this.db.select({ total: count() }).from(movimientos).where(donde),
    ]);

    return {
      filas: filas.map((fila) =>
        conCostos(
          usuario,
          {
            id: fila.id,
            fecha: fila.fecha,
            registradoEn: fila.registradoEn.toISOString(),
            tipo: fila.tipo,
            documento: fila.documento,
            documentoId: fila.documentoId,
            ubicacion: fila.ubicacion,
            cantidad: fila.cantidad,
            existenciaResultante: fila.existenciaResultante,
            usuario: fila.usuario,
          },
          () => ({
            costoUnitario: fila.costoUnitario,
            costoPromedioResultante: fila.costoPromedioResultante,
          }),
        ),
      ),
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
    };
  }

  private async ubicacionVisible(
    usuario: UsuarioSesion,
    ubicacionId: number | undefined,
  ): Promise<UbicacionResumen | null> {
    if (!usuario.puede('inventario.ver_todo')) {
      if (!usuario.ubicacion) throw new ForbiddenException('No tienes una ubicación asignada.');
      if (ubicacionId !== undefined && ubicacionId !== usuario.ubicacion.id) {
        throw new ForbiddenException('Solo puedes ver la mercancía que traes tú.');
      }
      return usuario.ubicacion;
    }
    if (ubicacionId === undefined) return null;

    const [ubicacion] = await this.db
      .select({ id: ubicaciones.id, nombre: ubicaciones.nombre, tipo: ubicaciones.tipo })
      .from(ubicaciones)
      .where(eq(ubicaciones.id, ubicacionId));
    if (!ubicacion) throw new NotFoundException('La ubicación no existe.');
    return ubicacion;
  }
}
