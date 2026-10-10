import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  DatosAsignarImagenGenerada,
  DatosGeneracionImagen,
  DatosReferenciaImagen,
  EstadoImagenesIa,
  ImagenGenerada,
  Producto,
  ReferenciaImagen,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { ProductosService } from '../catalogo/productos.service.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { imagenesGeneradas, productos, referenciasImagen } from '../db/esquema.js';
import { prepararParaIa } from '../imagenes/procesar-imagen.js';
import {
  type ClienteOpenAi,
  type ResultadoEdicion,
  type SugerenciaReferencia,
} from './cliente-openai.js';
import { falloHttp, SIN_LLAVE } from './fallos.js';
import { OPENAI, type OpenAi } from './openai.provider.js';
import { armarPrompt } from './prompt.js';

/** Cuántas a la vez: cada una tiene en memoria sus imágenes y espera hasta minutos. */
const MAXIMO_EN_CURSO = 2;
/** Lo que no se asignó se queda un mes; después se sueltan sus imágenes. */
const DIAS_DE_BORRADORES = 30;
/** Las que se ven en «Generadas recientemente». */
const RECIENTES = 12;

/**
 * Fotos de producto con IA: se elige una referencia (escena y prompt), se sube la foto
 * del producto y OpenAI arma la imagen. Pedirla tarda hasta un par de minutos, más de
 * lo que aguanta el túnel de Cloudflare con una petición abierta, así que se trabaja en
 * segundo plano: se crea la fila en «generando» y el front pregunta hasta que cambia.
 */
@Injectable()
export class ImagenesIaService implements OnModuleInit {
  private readonly logger = new Logger(ImagenesIaService.name);
  private readonly cliente: ClienteOpenAi | null;

  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    @Inject(OPENAI) openAi: OpenAi,
    private readonly catalogo: ProductosService,
  ) {
    this.cliente = openAi.cliente;
  }

  /** Lo que quedó «generando» cuando la app se apagó ya no va a terminar. */
  async onModuleInit(): Promise<void> {
    await this.db
      .update(imagenesGeneradas)
      .set({
        estado: 'error',
        errorTipo: 'servicio',
        errorMensaje: 'Se interrumpió porque el servidor se reinició. Genérala otra vez.',
        terminadoEn: new Date(),
      })
      .where(eq(imagenesGeneradas.estado, 'generando'));
  }

  async estado(): Promise<EstadoImagenesIa> {
    // Si la última que terminó fue por falta de créditos, desde cuándo: la primera
    // de esa racha, después de la última que salió bien.
    const [ultima] = await this.db
      .select({ errorTipo: imagenesGeneradas.errorTipo })
      .from(imagenesGeneradas)
      .where(isNotNull(imagenesGeneradas.terminadoEn))
      .orderBy(desc(imagenesGeneradas.terminadoEn))
      .limit(1);
    let sinCreditosDesde: string | null = null;
    if (ultima?.errorTipo === 'sin_creditos') {
      const [desde] = await this.db
        .select({ en: sql<Date>`min(${imagenesGeneradas.terminadoEn})` })
        .from(imagenesGeneradas)
        .where(
          and(
            eq(imagenesGeneradas.errorTipo, 'sin_creditos'),
            sql`${imagenesGeneradas.terminadoEn} > coalesce((
              select max(terminado_en) from gestion.imagenes_generadas
              where estado <> 'error' and terminado_en is not null
            ), '-infinity')`,
          ),
        );
      sinCreditosDesde = desde?.en ? new Date(desde.en).toISOString() : null;
    }
    return { configurado: this.cliente !== null, sinCreditosDesde };
  }

  /* ---- referencias ---- */

  async referencias(): Promise<ReferenciaImagen[]> {
    const filas = await this.db
      .select({
        id: referenciasImagen.id,
        nombre: referenciasImagen.nombre,
        prompt: referenciasImagen.prompt,
        actualizadoEn: referenciasImagen.actualizadoEn,
      })
      .from(referenciasImagen)
      .where(eq(referenciasImagen.activa, true))
      .orderBy(asc(referenciasImagen.nombre), asc(referenciasImagen.id));
    return filas.map((f) => ({ ...f, actualizadoEn: f.actualizadoEn.toISOString() }));
  }

  async crearReferencia(
    usuario: UsuarioSesion,
    datos: DatosReferenciaImagen,
    archivo: Buffer | undefined,
  ): Promise<ReferenciaImagen> {
    if (!archivo) {
      throw new UnprocessableEntityException({
        mensaje: 'Elige la imagen de referencia.',
        campos: { archivo: 'Elige una imagen' },
      });
    }
    const imagen = await prepararParaIa(archivo);
    const id = await this.db.transaction(async (tx) => {
      const [creada] = await tx
        .insert(referenciasImagen)
        .values({ ...datos, imagen })
        .returning({ id: referenciasImagen.id });
      if (!creada) throw new Error('No se creó la referencia');
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'crear_referencia_imagen',
        entidad: 'referencia_imagen',
        entidadId: creada.id,
        datos,
      });
      return creada.id;
    });
    return this.referencia(id);
  }

  /**
   * Mira la imagen de una referencia (antes de guardarla) y sugiere su nombre y su
   * prompt, para que quien la sube solo los corrija. No guarda nada.
   */
  async sugerirReferencia(archivo: Buffer | undefined): Promise<SugerenciaReferencia> {
    const cliente = this.cliente;
    if (!cliente) throw new ServiceUnavailableException(SIN_LLAVE);
    if (!archivo) {
      throw new UnprocessableEntityException({
        mensaje: 'Elige la imagen de referencia.',
        campos: { archivo: 'Elige una imagen' },
      });
    }
    const resultado = await cliente.describirReferencia(await prepararParaIa(archivo));
    if (!resultado.ok) {
      this.logger.warn(`No salió la sugerencia (${resultado.tipo}): ${resultado.detalle}`);
      throw falloHttp(resultado);
    }
    return { nombre: resultado.nombre, prompt: resultado.prompt };
  }

  /** Nombre y prompt; la imagen, si viene, también. */
  async editarReferencia(
    usuario: UsuarioSesion,
    id: number,
    datos: DatosReferenciaImagen,
    archivo: Buffer | undefined,
  ): Promise<ReferenciaImagen> {
    const imagen = archivo ? await prepararParaIa(archivo) : undefined;
    await this.db.transaction(async (tx) => {
      const [antes] = await tx
        .select({ nombre: referenciasImagen.nombre, prompt: referenciasImagen.prompt })
        .from(referenciasImagen)
        .where(and(eq(referenciasImagen.id, id), eq(referenciasImagen.activa, true)))
        .for('update');
      if (!antes) throw new NotFoundException('La referencia no existe.');
      await tx
        .update(referenciasImagen)
        .set({ ...datos, ...(imagen ? { imagen } : {}), actualizadoEn: new Date() })
        .where(eq(referenciasImagen.id, id));
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cambiar_referencia_imagen',
        entidad: 'referencia_imagen',
        entidadId: id,
        datos: { antes, despues: datos, imagenNueva: Boolean(imagen) },
      });
    });
    return this.referencia(id);
  }

  /** Se desactiva: las generaciones que la usaron siguen diciendo de cuál salieron. */
  async quitarReferencia(usuario: UsuarioSesion, id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [quitada] = await tx
        .update(referenciasImagen)
        .set({ activa: false, actualizadoEn: new Date() })
        .where(and(eq(referenciasImagen.id, id), eq(referenciasImagen.activa, true)))
        .returning({ id: referenciasImagen.id });
      if (!quitada) throw new NotFoundException('La referencia no existe.');
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'quitar_referencia_imagen',
        entidad: 'referencia_imagen',
        entidadId: id,
      });
    });
  }

  async imagenReferencia(id: number): Promise<Buffer> {
    const [fila] = await this.db
      .select({ imagen: referenciasImagen.imagen })
      .from(referenciasImagen)
      .where(eq(referenciasImagen.id, id));
    if (!fila) throw new NotFoundException('La referencia no existe.');
    return fila.imagen;
  }

  private async referencia(id: number): Promise<ReferenciaImagen> {
    const encontrada = (await this.referencias()).find((r) => r.id === id);
    if (!encontrada) throw new NotFoundException('La referencia no existe.');
    return encontrada;
  }

  /* ---- generaciones ---- */

  /**
   * Pide la imagen y regresa en cuanto la deja «generando»: el resultado se consulta
   * con `generacion(id)`. La foto del producto llega en `foto`, o se reusa la de una
   * generación anterior (`fotoDe`) para volver a generar sin subirla otra vez.
   */
  async generar(
    usuario: UsuarioSesion,
    { referenciaId, promptExtra, calidad, fotoDe }: DatosGeneracionImagen,
    archivo: Buffer | undefined,
  ): Promise<ImagenGenerada> {
    const cliente = this.cliente;
    if (!cliente) throw new ServiceUnavailableException(SIN_LLAVE);

    const [referencia] = await this.db
      .select({ prompt: referenciasImagen.prompt, imagen: referenciasImagen.imagen })
      .from(referenciasImagen)
      .where(and(eq(referenciasImagen.id, referenciaId), eq(referenciasImagen.activa, true)));
    if (!referencia) {
      throw new UnprocessableEntityException({
        mensaje: 'Esa referencia ya no existe; elige otra.',
        campos: { referenciaId: 'Elige una referencia' },
      });
    }

    const foto = archivo ? await prepararParaIa(archivo) : await this.fotoAnterior(fotoDe);

    const [{ enCurso } = { enCurso: 0 }] = await this.db
      .select({ enCurso: count() })
      .from(imagenesGeneradas)
      .where(eq(imagenesGeneradas.estado, 'generando'));
    if (enCurso >= MAXIMO_EN_CURSO) {
      throw new ConflictException(
        `Ya hay ${enCurso} imágenes generándose. Espera a que termine alguna.`,
      );
    }

    const prompt = armarPrompt(referencia.prompt, promptExtra);
    const [creada] = await this.db
      .insert(imagenesGeneradas)
      .values({
        referenciaId,
        foto,
        promptExtra,
        prompt,
        calidad,
        modelo: cliente.modeloEnUso,
        creadoPor: usuario.id,
      })
      .returning({ id: imagenesGeneradas.id });
    if (!creada) throw new Error('No se creó la generación');

    // Sin esperar: la petición a OpenAI puede durar minutos.
    void this.trabajar(cliente, creada.id, {
      imagenes: [
        { datos: referencia.imagen, nombre: 'referencia.jpg', tipo: 'image/jpeg' },
        { datos: foto, nombre: 'producto.jpg', tipo: 'image/jpeg' },
      ],
      prompt,
      calidad,
    });
    await this.soltarBorradoresViejos();
    return this.generacion(creada.id);
  }

  private async fotoAnterior(fotoDe: number | undefined): Promise<Buffer> {
    const [anterior] = fotoDe
      ? await this.db
          .select({ foto: imagenesGeneradas.foto })
          .from(imagenesGeneradas)
          .where(eq(imagenesGeneradas.id, fotoDe))
      : [];
    if (!anterior?.foto) {
      throw new UnprocessableEntityException({
        mensaje: 'Sube la foto del producto.',
        campos: { foto: 'Elige la foto del producto' },
      });
    }
    return anterior.foto;
  }

  private async trabajar(
    cliente: ClienteOpenAi,
    id: number,
    peticion: Parameters<ClienteOpenAi['editar']>[0],
  ): Promise<void> {
    let resultado: ResultadoEdicion;
    try {
      resultado = await cliente.editar(peticion);
    } catch (error) {
      resultado = {
        ok: false,
        tipo: 'servicio',
        mensaje: 'No se pudo generar la imagen. Intenta de nuevo.',
        detalle: String(error),
      };
    }
    try {
      if (resultado.ok) {
        await this.db
          .update(imagenesGeneradas)
          .set({ estado: 'lista', resultado: resultado.png, terminadoEn: new Date() })
          .where(eq(imagenesGeneradas.id, id));
        return;
      }
      this.logger.warn(`La imagen ${id} no salió (${resultado.tipo}): ${resultado.detalle}`);
      await this.db
        .update(imagenesGeneradas)
        .set({
          estado: 'error',
          errorTipo: resultado.tipo,
          errorMensaje: resultado.mensaje,
          terminadoEn: new Date(),
        })
        .where(eq(imagenesGeneradas.id, id));
    } catch (error) {
      this.logger.error(`No se pudo guardar el resultado de la imagen ${id}: ${String(error)}`);
    }
  }

  /** Lo que no se asignó en un mes suelta sus imágenes: la BD no se llena de borradores. */
  private async soltarBorradoresViejos(): Promise<void> {
    await this.db
      .update(imagenesGeneradas)
      .set({ foto: null, resultado: null })
      .where(
        and(
          ne(imagenesGeneradas.estado, 'generando'),
          lt(imagenesGeneradas.creadoEn, sql`now() - make_interval(days => ${DIAS_DE_BORRADORES})`),
          sql`(${imagenesGeneradas.foto} is not null or ${imagenesGeneradas.resultado} is not null)`,
        ),
      );
  }

  /** Las más recientes que no se descartaron, de la más nueva a la más vieja. */
  async generaciones(): Promise<ImagenGenerada[]> {
    const filas = await this.consulta()
      .where(ne(imagenesGeneradas.estado, 'descartada'))
      .orderBy(desc(imagenesGeneradas.id))
      .limit(RECIENTES);
    return filas.map((f) => this.aGeneracion(f));
  }

  async generacion(id: number): Promise<ImagenGenerada> {
    const [fila] = await this.consulta().where(eq(imagenesGeneradas.id, id));
    if (!fila) throw new NotFoundException('Esa imagen no existe.');
    return this.aGeneracion(fila);
  }

  async foto(id: number): Promise<Buffer> {
    const [fila] = await this.db
      .select({ foto: imagenesGeneradas.foto })
      .from(imagenesGeneradas)
      .where(eq(imagenesGeneradas.id, id));
    if (!fila?.foto) throw new NotFoundException('Esa foto ya no está.');
    return fila.foto;
  }

  async imagen(id: number): Promise<Buffer> {
    const [fila] = await this.db
      .select({ resultado: imagenesGeneradas.resultado })
      .from(imagenesGeneradas)
      .where(eq(imagenesGeneradas.id, id));
    if (!fila?.resultado) throw new NotFoundException('Esa imagen ya no está.');
    return fila.resultado;
  }

  /**
   * La imagen pasa a ser la foto del producto, por el mismo camino que subirla a mano
   * (se optimiza, va al bucket y queda en la bitácora). Asignar cambia lo que se ve en
   * el sitio: además de generar, hace falta poder gestionar productos.
   */
  async asignar(
    usuario: UsuarioSesion,
    id: number,
    { productoId, alt }: DatosAsignarImagenGenerada,
  ): Promise<Producto> {
    if (!usuario.puede('productos.gestionar')) {
      throw new ForbiddenException(
        'Para cambiar la foto de un producto hace falta poder gestionar productos.',
      );
    }
    // Se aparta primero: dos clics seguidos no la asignan dos veces.
    const [apartada] = await this.db
      .update(imagenesGeneradas)
      .set({ estado: 'asignada', productoId })
      .where(
        and(
          eq(imagenesGeneradas.id, id),
          eq(imagenesGeneradas.estado, 'lista'),
          isNotNull(imagenesGeneradas.resultado),
        ),
      )
      .returning({ resultado: imagenesGeneradas.resultado });
    if (!apartada?.resultado) {
      await this.generacion(id); // 404 si no existe
      throw new ConflictException('Esa imagen ya no está disponible para asignarse.');
    }
    try {
      const producto = await this.catalogo.subirImagen(usuario, productoId, apartada.resultado, {
        alt,
      });
      if (!producto) throw new Error('subirImagen no devolvió el producto');
      await this.db.transaction(async (tx) => {
        // Ya está en el bucket: aquí sobra.
        await tx
          .update(imagenesGeneradas)
          .set({ resultado: null })
          .where(eq(imagenesGeneradas.id, id));
        await registrarEnBitacora(tx, {
          usuarioId: usuario.id,
          accion: 'asignar_imagen_ia',
          entidad: 'producto',
          entidadId: productoId,
          datos: { generacion: id },
        });
      });
      return producto;
    } catch (error) {
      // No se pudo (el producto no existe, el bucket no respondió): vuelve a estar lista.
      await this.db
        .update(imagenesGeneradas)
        .set({ estado: 'lista', productoId: null })
        .where(eq(imagenesGeneradas.id, id));
      throw error;
    }
  }

  async descartar(id: number): Promise<ImagenGenerada> {
    const [descartada] = await this.db
      .update(imagenesGeneradas)
      .set({ estado: 'descartada', resultado: null })
      .where(
        and(eq(imagenesGeneradas.id, id), inArray(imagenesGeneradas.estado, ['lista', 'error'])),
      )
      .returning({ id: imagenesGeneradas.id });
    if (!descartada) {
      await this.generacion(id);
      throw new ConflictException('Esa imagen ya no se puede descartar.');
    }
    return this.generacion(id);
  }

  private consulta() {
    return this.db
      .select({
        id: imagenesGeneradas.id,
        referenciaId: imagenesGeneradas.referenciaId,
        referencia: referenciasImagen.nombre,
        promptExtra: imagenesGeneradas.promptExtra,
        calidad: imagenesGeneradas.calidad,
        estado: imagenesGeneradas.estado,
        errorTipo: imagenesGeneradas.errorTipo,
        errorMensaje: imagenesGeneradas.errorMensaje,
        productoId: imagenesGeneradas.productoId,
        producto: productos.nombre,
        creadoEn: imagenesGeneradas.creadoEn,
        terminadoEn: imagenesGeneradas.terminadoEn,
      })
      .from(imagenesGeneradas)
      .innerJoin(referenciasImagen, eq(referenciasImagen.id, imagenesGeneradas.referenciaId))
      .leftJoin(productos, eq(productos.id, imagenesGeneradas.productoId))
      .$dynamic();
  }

  private aGeneracion(
    fila: Awaited<ReturnType<ImagenesIaService['consulta']>>[number],
  ): ImagenGenerada {
    return {
      id: fila.id,
      referenciaId: fila.referenciaId,
      referencia: fila.referencia,
      promptExtra: fila.promptExtra,
      calidad: fila.calidad,
      estado: fila.estado,
      error:
        fila.errorTipo && fila.errorMensaje
          ? { tipo: fila.errorTipo, mensaje: fila.errorMensaje }
          : null,
      producto:
        fila.productoId !== null && fila.producto !== null
          ? { id: fila.productoId, nombre: fila.producto }
          : null,
      creadoEn: fila.creadoEn.toISOString(),
      terminadoEn: fila.terminadoEn?.toISOString() ?? null,
    };
  }
}
