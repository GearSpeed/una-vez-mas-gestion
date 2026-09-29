import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Categoria,
  type DatosCategoria,
  type DatosImagenProducto,
  type DatosProducto,
  indicadoresPrecio,
  type Producto,
  slugDe,
} from '@uvm/compartido';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { conCostos } from '../comun/costos.js';
import { type BaseDatos, DB, type Ejecutor } from '../db/conexion.js';
import { categorias, existencias, productos } from '../db/esquema.js';
import { AlmacenImagenes } from '../imagenes/almacen-imagenes.js';
import { procesarImagen } from '../imagenes/procesar-imagen.js';

/** Las tarjetas que dibuja «Los Favoritos de la Casa» en la portada del sitio. */
const MAXIMO_EN_PORTADA = 4;

@Injectable()
export class ProductosService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly almacen: AlmacenImagenes,
  ) {}

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

  /** El slug sale del nombre y queda fijo: es la URL del producto en el sitio. */
  async crear(usuario: UsuarioSesion, datos: DatosProducto): Promise<Producto> {
    const slug = slugDe(datos.nombre);
    if (!slug) {
      throw new UnprocessableEntityException({
        mensaje: 'El nombre necesita al menos una letra o un número.',
        campos: { nombre: 'Escribe un nombre con letras o números' },
      });
    }
    const id = await this.db.transaction(async (tx) => {
      await this.validarCategoria(tx, datos.categoriaId);
      const portada = await this.portadaQueQueda(tx, datos, null);
      const [creado] = await tx
        .insert(productos)
        .values({ ...datos, ...portada, slug })
        .returning({ id: productos.id });
      if (!creado) throw new Error('No se creó el producto');
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'producto',
        entidadId: creado.id,
        datos: { slug, precioVenta: datos.precioVenta },
      });
      return creado.id;
    });
    return this.obtener(usuario, id);
  }

  /**
   * El slug no se toca aunque cambie el nombre, para no romper la URL del sitio.
   * Cambio de precio y de publicación quedan en la bitácora: quién, cuándo, de cuánto a cuánto.
   */
  async actualizar(usuario: UsuarioSesion, id: number, datos: DatosProducto): Promise<Producto> {
    await this.db.transaction(async (tx) => {
      const [actual] = await tx
        .select({
          precioVenta: productos.precioVenta,
          publicado: productos.publicado,
          destacado: productos.destacado,
        })
        .from(productos)
        .where(eq(productos.id, id))
        .for('update');
      if (!actual) throw new NotFoundException('El producto no existe.');
      await this.validarCategoria(tx, datos.categoriaId);
      const portada = await this.portadaQueQueda(tx, datos, id);

      await tx
        .update(productos)
        .set({ ...datos, ...portada, actualizadoEn: new Date() })
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
      if (actual.publicado !== datos.publicado) {
        await registrarEnBitacora(tx, {
          usuarioId: usuario.id,
          accion: 'cambiar_publicacion',
          entidad: 'producto',
          entidadId: id,
          datos: { antes: actual.publicado, despues: datos.publicado },
        });
      }
      if (actual.destacado !== portada.destacado) {
        await registrarEnBitacora(tx, {
          usuarioId: usuario.id,
          accion: 'cambiar_portada',
          entidad: 'producto',
          entidadId: id,
          datos: { antes: actual.destacado, despues: portada.destacado },
        });
      }
    });
    return this.obtener(usuario, id);
  }

  /* ---- imagen ---- */

  /**
   * Optimiza la foto, la sube al bucket y se la asigna al producto. La clave lleva
   * la huella del archivo: la misma foto no se vuelve a subir, y una nueva nunca
   * choca con la caché de la anterior (que se queda en el bucket).
   */
  async subirImagen(
    usuario: UsuarioSesion | null,
    id: number,
    archivo: Buffer | undefined,
    { alt }: DatosImagenProducto,
  ): Promise<Producto | null> {
    if (!archivo) {
      throw new UnprocessableEntityException({
        mensaje: 'Elige una imagen.',
        campos: { archivo: 'Elige una imagen' },
      });
    }
    const [actual] = await this.db
      .select({ imagenClave: productos.imagenClave, imagenAlt: productos.imagenAlt })
      .from(productos)
      .where(eq(productos.id, id));
    if (!actual) throw new NotFoundException('El producto no existe.');

    const imagen = await procesarImagen(archivo);
    const clave = `productos/${id}/${imagen.huella}`;
    if (clave !== actual.imagenClave) await this.almacen.subir(clave, imagen);
    const anterior = clave === actual.imagenClave ? null : actual.imagenClave;
    if (clave !== actual.imagenClave || alt !== actual.imagenAlt) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(productos)
          .set({ imagenClave: clave, imagenAlt: alt, actualizadoEn: new Date() })
          .where(eq(productos.id, id));
        await registrarEnBitacora(tx, {
          usuarioId: usuario?.id ?? null,
          accion: 'cambiar_imagen',
          entidad: 'producto',
          entidadId: id,
          datos: { antes: actual.imagenClave, despues: clave },
        });
      });
      // La foto anterior se va del bucket: una imagen subida por error no se queda
      // pública para siempre.
      if (anterior) await this.almacen.borrar(anterior);
    }
    return usuario ? this.obtener(usuario, id) : null;
  }

  async cambiarAltImagen(
    usuario: UsuarioSesion,
    id: number,
    { alt }: DatosImagenProducto,
  ): Promise<Producto> {
    const [cambiado] = await this.db
      .update(productos)
      .set({ imagenAlt: alt, actualizadoEn: new Date() })
      .where(eq(productos.id, id))
      .returning({ imagenClave: productos.imagenClave });
    if (!cambiado) throw new NotFoundException('El producto no existe.');
    return this.obtener(usuario, id);
  }

  /** El producto se queda sin imagen y el archivo se borra del bucket. */
  async quitarImagen(usuario: UsuarioSesion, id: number): Promise<Producto> {
    let borrada: string | null = null;
    await this.db.transaction(async (tx) => {
      const [actual] = await tx
        .select({ imagenClave: productos.imagenClave })
        .from(productos)
        .where(eq(productos.id, id))
        .for('update');
      if (!actual) throw new NotFoundException('El producto no existe.');
      if (actual.imagenClave === null) return;
      borrada = actual.imagenClave;
      await tx
        .update(productos)
        .set({ imagenClave: null, imagenAlt: '', actualizadoEn: new Date() })
        .where(eq(productos.id, id));
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'quitar_imagen',
        entidad: 'producto',
        entidadId: id,
        datos: { antes: actual.imagenClave },
      });
    });
    if (borrada) await this.almacen.borrar(borrada);
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
        resumen: productos.resumen,
        descripcion: productos.descripcion,
        ingredientes: productos.ingredientes,
        precioVenta: productos.precioVenta,
        gananciaObjetivo: productos.gananciaObjetivo,
        costoPromedio: productos.costoPromedio,
        stockMinimo: productos.stockMinimo,
        activo: productos.activo,
        publicado: productos.publicado,
        destacado: productos.destacado,
        destacadoEtiqueta: productos.destacadoEtiqueta,
        destacadoQuip: productos.destacadoQuip,
        destacadoTexto: productos.destacadoTexto,
        imagenClave: productos.imagenClave,
        imagenAlt: productos.imagenAlt,
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
      imagenClave,
      imagenAlt,
      ...fila
    }: Awaited<ReturnType<ProductosService['consulta']>>[number],
  ): Producto {
    const imagen = imagenClave ? { ...this.almacen.urls(imagenClave), alt: imagenAlt } : null;
    return conCostos(usuario, { ...fila, imagen, imagenAlt }, () => ({
      costoPromedio,
      gananciaObjetivo,
      ...indicadoresPrecio(costoPromedio, fila.precioVenta, gananciaObjetivo),
    }));
  }

  /**
   * Qué queda guardado de la portada, con las dos reglas que no se le pueden pedir al
   * formulario:
   *
   * 1. **Destacar exige publicar.** Un producto sin publicar no tiene página en el
   *    sitio, así que la tarjeta llevaría a ningún lado. En vez de un error que
   *    esquivar, despublicar apaga la portada sola.
   * 2. **Solo caben cuatro**, que es la fila que dibuja el sitio. Se cuenta dentro de la
   *    transacción, con el renglón ya bloqueado por el `for('update')` de quien llama.
   *
   * Los tres textos se limpian cuando el switch queda apagado: si no, mañana alguien lo
   * vuelve a prender y aparece un guiño que ya no venía a cuento.
   */
  private async portadaQueQueda(
    db: Ejecutor,
    datos: DatosProducto,
    id: number | null,
  ): Promise<{
    destacado: boolean;
    destacadoEtiqueta: string;
    destacadoQuip: string;
    destacadoTexto: string;
  }> {
    const destacado = datos.destacado && datos.publicado;
    if (!destacado) {
      return {
        destacado: false,
        destacadoEtiqueta: '',
        destacadoQuip: '',
        destacadoTexto: '',
      };
    }

    const otros = await db
      .select({ cuantos: count() })
      .from(productos)
      .where(
        id === null
          ? eq(productos.destacado, true)
          : and(eq(productos.destacado, true), ne(productos.id, id)),
      );
    if ((otros[0]?.cuantos ?? 0) >= MAXIMO_EN_PORTADA) {
      throw new UnprocessableEntityException({
        mensaje: `Ya hay ${MAXIMO_EN_PORTADA} productos en la portada.`,
        campos: { destacado: 'Apaga otro primero: en la portada solo caben cuatro' },
      });
    }

    return {
      destacado: true,
      destacadoEtiqueta: datos.destacadoEtiqueta,
      destacadoQuip: datos.destacadoQuip,
      destacadoTexto: datos.destacadoTexto,
    };
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
