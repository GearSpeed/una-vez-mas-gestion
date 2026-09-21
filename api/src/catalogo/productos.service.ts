import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Categoria,
  type DatosCategoria,
  type DatosProducto,
  indicadoresPrecio,
  type Producto,
} from '@uvm/compartido';
import { asc, eq, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB, type Ejecutor } from '../db/conexion.js';
import { categorias, existencias, productos } from '../db/esquema.js';

@Injectable()
export class ProductosService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async listar(usuario: UsuarioSesion, incluirInactivos: boolean): Promise<Producto[]> {
    const filas = await this.consulta(this.db).orderBy(
      asc(categorias.orden),
      asc(productos.nombre),
    );
    return filas
      .filter((fila) => incluirInactivos || fila.activo)
      .map((fila) => this.aProducto(usuario, fila));
  }

  async obtener(usuario: UsuarioSesion, id: number): Promise<Producto> {
    const [fila] = await this.consulta(this.db).where(eq(productos.id, id));
    if (!fila) throw new NotFoundException('El producto no existe.');
    return this.aProducto(usuario, fila);
  }

  async crear(usuario: UsuarioSesion, datos: DatosProducto): Promise<Producto> {
    const id = await this.db.transaction(async (tx) => {
      await this.validarCategoria(tx, datos.categoriaId);
      const [creado] = await tx.insert(productos).values(datos).returning({ id: productos.id });
      if (!creado) throw new Error('No se creó el producto');
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'producto',
        entidadId: creado.id,
        datos: { slug: datos.slug, precioVenta: datos.precioVenta },
      });
      return creado.id;
    });
    return this.obtener(usuario, id);
  }

  /** Cambio de precio y de publicación quedan en la bitácora: quién, cuándo, de cuánto a cuánto. */
  async actualizar(usuario: UsuarioSesion, id: number, datos: DatosProducto): Promise<Producto> {
    await this.db.transaction(async (tx) => {
      const [actual] = await tx
        .select({
          precioVenta: productos.precioVenta,
          publicado: productos.publicado,
          slug: productos.slug,
        })
        .from(productos)
        .where(eq(productos.id, id))
        .for('update');
      if (!actual) throw new NotFoundException('El producto no existe.');
      await this.validarCategoria(tx, datos.categoriaId);

      await tx
        .update(productos)
        .set({ ...datos, actualizadoEn: new Date() })
        .where(eq(productos.id, id));

      const antes = actual.precioVenta === null ? null : Number(actual.precioVenta);
      const despues = datos.precioVenta === null ? null : Number(datos.precioVenta);
      if (antes !== despues) {
        await registrarEnBitacora(tx, {
          usuarioId: usuario.id,
          accion: 'cambiar_precio',
          entidad: 'producto',
          entidadId: id,
          datos: { antes: actual.precioVenta, despues: datos.precioVenta },
        });
      }
      if (actual.publicado !== datos.publicado || actual.slug !== datos.slug) {
        await registrarEnBitacora(tx, {
          usuarioId: usuario.id,
          accion: 'cambiar_publicacion',
          entidad: 'producto',
          entidadId: id,
          datos: {
            antes: { publicado: actual.publicado, slug: actual.slug },
            despues: { publicado: datos.publicado, slug: datos.slug },
          },
        });
      }
    });
    return this.obtener(usuario, id);
  }

  /* ---- categorías ---- */

  async categorias(): Promise<Categoria[]> {
    return this.db.select().from(categorias).orderBy(asc(categorias.orden), asc(categorias.nombre));
  }

  async crearCategoria(datos: DatosCategoria): Promise<Categoria> {
    const [creada] = await this.db.insert(categorias).values(datos).returning();
    if (!creada) throw new Error('No se creó la categoría');
    return creada;
  }

  async actualizarCategoria(id: number, datos: DatosCategoria): Promise<Categoria> {
    const [actualizada] = await this.db
      .update(categorias)
      .set(datos)
      .where(eq(categorias.id, id))
      .returning();
    if (!actualizada) throw new NotFoundException('La categoría no existe.');
    return actualizada;
  }

  /* ---- internos ---- */

  private consulta(db: Ejecutor) {
    return db
      .select({
        id: productos.id,
        slug: productos.slug,
        nombre: productos.nombre,
        categoriaId: productos.categoriaId,
        categoria: categorias.nombre,
        variedad: productos.variedad,
        presentacion: productos.presentacion,
        precioVenta: productos.precioVenta,
        gananciaObjetivo: productos.gananciaObjetivo,
        costoPromedio: productos.costoPromedio,
        stockMinimo: productos.stockMinimo,
        activo: productos.activo,
        publicado: productos.publicado,
        existenciaTotal: sql<number>`coalesce((select sum(e.cantidad) from ${existencias} e
          where e.producto_id = ${productos.id}), 0)::int`,
      })
      .from(productos)
      .innerJoin(categorias, eq(categorias.id, productos.categoriaId))
      .$dynamic();
  }

  private aProducto(
    usuario: UsuarioSesion,
    {
      costoPromedio,
      gananciaObjetivo,
      ...fila
    }: Awaited<ReturnType<ProductosService['consulta']>>[number],
  ): Producto {
    return conCostos(usuario, fila, () => ({
      costoPromedio,
      gananciaObjetivo,
      ...indicadoresPrecio(costoPromedio, fila.precioVenta, gananciaObjetivo),
    }));
  }

  private async validarCategoria(db: Ejecutor, categoriaId: number): Promise<void> {
    const [categoria] = await db
      .select({ id: categorias.id })
      .from(categorias)
      .where(eq(categorias.id, categoriaId));
    if (!categoria) {
      throw new UnprocessableEntityException({
        mensaje: 'La categoría no existe.',
        campos: { categoriaId: 'Elige una categoría' },
      });
    }
  }
}
