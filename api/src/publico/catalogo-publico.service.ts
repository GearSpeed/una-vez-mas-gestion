import { Inject, Injectable } from '@nestjs/common';
import {
  type CatalogoPublico,
  type CategoriaPublica,
  comparar,
  type Decimal,
  type ImagenPublica,
  PIEZAS_ULTIMAS,
  type ProductoPublico,
} from '@uvm/compartido';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type BaseDatos, DB } from '../db/conexion.js';
import { categorias, existencias, productos } from '../db/esquema.js';
import { AlmacenImagenes } from '../imagenes/almacen-imagenes.js';
import { ALT_PLACEHOLDER, CLAVE_PLACEHOLDER } from '../imagenes/placeholder.js';

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

  async catalogo(): Promise<CatalogoPublico> {
    const [categoriasActivas, productosPublicados] = await Promise.all([
      this.categorias(),
      this.productos(),
    ]);
    return { categorias: categoriasActivas, productos: productosPublicados };
  }

  /**
   * Todas las activas, tengan productos o no. Una recién dada de alta todavía no tiene
   * ninguno, y el sitio necesita saber que existe para anunciarla.
   */
  private async categorias(): Promise<CategoriaPublica[]> {
    const filas = await this.db
      .select({
        nombre: categorias.nombre,
        titulo: categorias.titulo,
        insignia: categorias.insignia,
        icono: categorias.insigniaIcono,
        descripcion: categorias.descripcion,
        cta: categorias.cta,
        imagenClave: categorias.imagenClave,
        imagenAlt: categorias.imagenAlt,
      })
      .from(categorias)
      .where(eq(categorias.activa, true))
      .orderBy(asc(categorias.orden), asc(categorias.nombre));

    return filas.map(({ nombre, imagenClave, imagenAlt, titulo, cta, ...resto }) => ({
      nombre,
      // Sin foto no hay tarjeta: una a medias se ve rota, y el sitio no tiene con qué
      // rellenarla. La categoría sigue saliendo para filtrar el catálogo.
      vitrina: imagenClave
        ? {
            ...resto,
            // Resueltos aquí, para que el sitio no tenga que conocer estas reglas.
            titulo: titulo || nombre,
            cta: cta || `Ver ${nombre.toLocaleLowerCase('es-MX')}`,
            imagen: { ...this.almacen.urls(imagenClave), alt: imagenAlt },
          }
        : null,
    }));
  }

  private async productos(): Promise<ProductoPublico[]> {
    const filas = await this.db
      .select({
        slug: productos.slug,
        nombre: productos.nombre,
        categoria: categorias.nombre,
        presentacion: productos.presentacion,
        resumen: productos.resumen,
        descripcion: productos.descripcion,
        ingredientes: productos.ingredientes,
        precio: productos.precioVenta,
        destacado: productos.destacado,
        destacadoEtiqueta: productos.destacadoEtiqueta,
        destacadoQuip: productos.destacadoQuip,
        destacadoTexto: productos.destacadoTexto,
        imagenClave: productos.imagenClave,
        imagenAlt: productos.imagenAlt,
        piezas: sql<number>`coalesce((select sum(e.cantidad) from ${existencias} e
          where e.producto_id = ${productos.id}), 0)::int`,
      })
      .from(productos)
      .innerJoin(categorias, eq(categorias.id, productos.categoriaId))
      .where(and(eq(productos.activo, true), eq(productos.publicado, true)))
      .orderBy(asc(categorias.orden), asc(productos.nombre));

    return filas.map(
      ({
        piezas,
        imagenClave,
        imagenAlt,
        precio,
        destacado,
        destacadoEtiqueta,
        destacadoQuip,
        destacadoTexto,
        ...fila
      }) => ({
        ...fila,
        precio: precioPublicable(precio),
        disponibilidad:
          piezas <= 0 ? 'agotado' : piezas <= PIEZAS_ULTIMAS ? 'ultimas_piezas' : 'disponible',
        imagen: this.imagen(imagenClave, imagenAlt),
        destacado: destacado
          ? {
              etiqueta: destacadoEtiqueta,
              quip: destacadoQuip,
              // Resuelto aquí: el sitio no tiene por qué conocer esta regla.
              texto: destacadoTexto || fila.resumen,
            }
          : null,
      }),
    );
  }

  /**
   * Un producto sin foto no deja un hueco en el sitio: se sirve el logo, y el
   * catálogo lo dice, para que el sitio pueda tratarlo como relleno (no indexarlo
   * como foto del producto, poner `alt=""`…).
   */
  private imagen(clave: string | null, alt: string): ImagenPublica {
    if (clave) return { ...this.almacen.urls(clave), alt, esPlaceholder: false };
    return { ...this.almacen.urls(CLAVE_PLACEHOLDER), alt: ALT_PLACEHOLDER, esPlaceholder: true };
  }
}

/**
 * Un precio en cero no es un precio: es una captura a medias o un dedazo. Publicarlo
 * sería anunciar el producto en $0, y quien lo vea puede exigir que se le respete
 * (la Ley Federal de Protección al Consumidor obliga a respetar el precio exhibido).
 *
 * Así que sale como `null`, que en el contrato significa «Consulta precio». Se filtra
 * aquí y no en la pantalla porque el catálogo público lo puede leer cualquiera.
 */
function precioPublicable(precio: Decimal | null): Decimal | null {
  if (precio === null) return null;
  return comparar(precio, '0') > 0 ? precio : null;
}
