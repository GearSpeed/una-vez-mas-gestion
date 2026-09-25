import { Inject, Injectable } from '@nestjs/common';
import { PIEZAS_ULTIMAS, type ProductoPublico } from '@uvm/compartido';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type BaseDatos, DB } from '../db/conexion.js';
import { categorias, existencias, productos } from '../db/esquema.js';
import { AlmacenImagenes } from '../imagenes/almacen-imagenes.js';

/**
 * El catálogo que consume el back del sitio. Es lo único que la API entrega sin
 * identidad, así que sale lo justo: ni ids internos, ni costos, ni la existencia
 * exacta (solo si hay, si quedan pocas o si se agotó). Ver `docs/contrato-sitio.md`.
 */
@Injectable()
export class CatalogoPublicoService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly almacen: AlmacenImagenes,
  ) {}

  async catalogo(): Promise<ProductoPublico[]> {
    const filas = await this.db
      .select({
        slug: productos.slug,
        nombre: productos.nombre,
        categoria: categorias.nombre,
        presentacion: productos.presentacion,
        descripcion: productos.descripcion,
        ingredientes: productos.ingredientes,
        precio: productos.precioVenta,
        imagenClave: productos.imagenClave,
        imagenAlt: productos.imagenAlt,
        piezas: sql<number>`coalesce((select sum(e.cantidad) from ${existencias} e
          where e.producto_id = ${productos.id}), 0)::int`,
      })
      .from(productos)
      .innerJoin(categorias, eq(categorias.id, productos.categoriaId))
      .where(and(eq(productos.activo, true), eq(productos.publicado, true)))
      .orderBy(asc(categorias.orden), asc(productos.nombre));

    return filas.map(({ piezas, imagenClave, imagenAlt, ...fila }) => ({
      ...fila,
      disponibilidad:
        piezas <= 0 ? 'agotado' : piezas <= PIEZAS_ULTIMAS ? 'ultimas_piezas' : 'disponible',
      imagen: imagenClave ? { ...this.almacen.urls(imagenClave), alt: imagenAlt } : null,
    }));
  }
}
