import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DatosFichaIa, FichaSugerida } from '@uvm/compartido';
import { and, asc, eq, ne } from 'drizzle-orm';
import { type BaseDatos, DB } from '../db/conexion.js';
import { categorias, productos } from '../db/esquema.js';
import { AlmacenImagenes } from '../imagenes/almacen-imagenes.js';
import { falloHttp, SIN_LLAVE } from './fallos.js';
import { OPENAI, type OpenAi } from './openai.provider.js';

/** Cuántas fichas del sitio se le pasan como ejemplo del tono. */
const EJEMPLOS = 3;

/**
 * La ficha del sitio redactada por la IA a partir de la foto (la ya guardada) y de lo
 * que está en el formulario. No guarda nada: quien la pidió la revisa y la guarda.
 */
@Injectable()
export class FichaIaService {
  private readonly logger = new Logger(FichaIaService.name);

  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    @Inject(OPENAI) private readonly openAi: OpenAi,
    private readonly almacen: AlmacenImagenes,
  ) {}

  async redactar(id: number, datos: DatosFichaIa): Promise<FichaSugerida> {
    const cliente = this.openAi.cliente;
    if (!cliente) throw new ServiceUnavailableException(SIN_LLAVE);

    const [producto] = await this.db
      .select({ imagenClave: productos.imagenClave })
      .from(productos)
      .where(eq(productos.id, id));
    if (!producto) throw new NotFoundException('El producto no existe.');
    if (!producto.imagenClave) {
      throw new UnprocessableEntityException(
        'Primero sube y guarda la foto del producto: la IA la necesita para escribir la ficha.',
      );
    }
    const [categoria] = await this.db
      .select({ nombre: categorias.nombre })
      .from(categorias)
      .where(eq(categorias.id, datos.categoriaId));
    if (!categoria) {
      throw new UnprocessableEntityException({
        mensaje: 'Esa categoría no existe.',
        campos: { categoriaId: 'Elige la categoría' },
      });
    }

    const ejemplos = await this.db
      .select({
        nombre: productos.nombre,
        resumen: productos.resumen,
        descripcion: productos.descripcion,
      })
      .from(productos)
      .where(
        and(
          eq(productos.publicado, true),
          ne(productos.id, id),
          ne(productos.resumen, ''),
          ne(productos.descripcion, ''),
        ),
      )
      .orderBy(asc(productos.id))
      .limit(EJEMPLOS);

    const imagen = await this.almacen.leer(producto.imagenClave);
    const resultado = await cliente.redactarFicha(
      {
        nombre: datos.nombre,
        categoria: categoria.nombre,
        variedad: datos.variedad,
        presentacion: datos.presentacion,
      },
      { datos: imagen, nombre: 'producto.webp', tipo: 'image/webp' },
      ejemplos,
    );
    if (!resultado.ok) {
      this.logger.warn(
        `No salió la ficha del producto ${id} (${resultado.tipo}): ${resultado.detalle}`,
      );
      throw falloHttp(resultado);
    }
    return resultado.ficha;
  }
}
