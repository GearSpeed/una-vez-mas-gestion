import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  type DatosAsignarImagenGenerada,
  type DatosGeneracionImagen,
  type DatosReferenciaImagen,
  esquemaAsignarImagenGenerada,
  esquemaGeneracionImagen,
  esquemaReferenciaImagen,
  type EstadoImagenesIa,
  type ImagenGenerada,
  type Producto,
  type ReferenciaImagen,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { LIMITE_IMAGENES, LIMITE_IMAGENES_IA } from '../comun/limite-peticiones.js';
import { ParseId, Validar } from '../comun/validar.js';
import { PESO_MAXIMO_IMAGEN } from '../imagenes/procesar-imagen.js';
import { ImagenesIaService } from './imagenes-ia.service.js';

type Archivo = { readonly buffer: Buffer } | undefined;

const unaImagen = (campo: string) =>
  FileInterceptor(campo, { limits: { fileSize: PESO_MAXIMO_IMAGEN, files: 1 } });

/** Imágenes de producto con IA. Todo gasta (o administra lo que gasta) créditos de OpenAI. */
@Controller('imagenes-ia')
export class ImagenesIaController {
  constructor(private readonly ia: ImagenesIaService) {}

  @Get('estado')
  @RequierePermiso('imagenes.generar')
  estado(): Promise<EstadoImagenesIa> {
    return this.ia.estado();
  }

  @Get('referencias')
  @RequierePermiso('imagenes.generar')
  referencias(): Promise<ReferenciaImagen[]> {
    return this.ia.referencias();
  }

  /** Multipart: `archivo` (JPG, PNG o WebP de hasta 10 MB), `nombre` y `prompt`. */
  @Post('referencias')
  @RequierePermiso('imagenes.generar')
  @Throttle(LIMITE_IMAGENES)
  @UseInterceptors(unaImagen('archivo'))
  crearReferencia(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaReferenciaImagen)) datos: DatosReferenciaImagen,
    @UploadedFile() archivo: Archivo,
  ): Promise<ReferenciaImagen> {
    return this.ia.crearReferencia(usuario, datos, archivo?.buffer);
  }

  /** Multipart: `nombre`, `prompt` y, si se cambia, `archivo`. */
  @Put('referencias/:id')
  @RequierePermiso('imagenes.generar')
  @Throttle(LIMITE_IMAGENES)
  @UseInterceptors(unaImagen('archivo'))
  editarReferencia(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaReferenciaImagen)) datos: DatosReferenciaImagen,
    @UploadedFile() archivo: Archivo,
  ): Promise<ReferenciaImagen> {
    return this.ia.editarReferencia(usuario, id, datos, archivo?.buffer);
  }

  @Delete('referencias/:id')
  @RequierePermiso('imagenes.generar')
  @HttpCode(204)
  quitarReferencia(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
  ): Promise<void> {
    return this.ia.quitarReferencia(usuario, id);
  }

  @Get('referencias/:id/imagen')
  @RequierePermiso('imagenes.generar')
  @Header('Cache-Control', 'private, max-age=300')
  async imagenReferencia(@Param('id', ParseId) id: number): Promise<StreamableFile> {
    return new StreamableFile(await this.ia.imagenReferencia(id), { type: 'image/jpeg' });
  }

  /**
   * Multipart: `referenciaId`, `promptExtra`, `calidad` y la foto del producto en `foto`
   * (o `fotoDe`: el id de una generación anterior para reusar su foto). Responde 202 en
   * cuanto la deja «generando»; el resultado se consulta con `GET generaciones/:id`.
   */
  @Post('generaciones')
  @RequierePermiso('imagenes.generar')
  @HttpCode(202)
  @Throttle(LIMITE_IMAGENES_IA)
  @UseInterceptors(unaImagen('foto'))
  generar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaGeneracionImagen)) datos: DatosGeneracionImagen,
    @UploadedFile() foto: Archivo,
  ): Promise<ImagenGenerada> {
    return this.ia.generar(usuario, datos, foto?.buffer);
  }

  @Get('generaciones')
  @RequierePermiso('imagenes.generar')
  generaciones(): Promise<ImagenGenerada[]> {
    return this.ia.generaciones();
  }

  @Get('generaciones/:id')
  @RequierePermiso('imagenes.generar')
  generacion(@Param('id', ParseId) id: number): Promise<ImagenGenerada> {
    return this.ia.generacion(id);
  }

  @Get('generaciones/:id/foto')
  @RequierePermiso('imagenes.generar')
  @Header('Cache-Control', 'private, max-age=300')
  async foto(@Param('id', ParseId) id: number): Promise<StreamableFile> {
    return new StreamableFile(await this.ia.foto(id), { type: 'image/jpeg' });
  }

  @Get('generaciones/:id/imagen')
  @RequierePermiso('imagenes.generar')
  @Header('Cache-Control', 'private, max-age=300')
  async imagen(@Param('id', ParseId) id: number): Promise<StreamableFile> {
    return new StreamableFile(await this.ia.imagen(id), { type: 'image/png' });
  }

  /** Además de `imagenes.generar`, el servicio exige `productos.gestionar`. */
  @Post('generaciones/:id/asignar')
  @RequierePermiso('imagenes.generar')
  @HttpCode(200)
  asignar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaAsignarImagenGenerada)) datos: DatosAsignarImagenGenerada,
  ): Promise<Producto> {
    return this.ia.asignar(usuario, id, datos);
  }

  @Post('generaciones/:id/descartar')
  @RequierePermiso('imagenes.generar')
  @HttpCode(200)
  descartar(@Param('id', ParseId) id: number): Promise<ImagenGenerada> {
    return this.ia.descartar(id);
  }
}
