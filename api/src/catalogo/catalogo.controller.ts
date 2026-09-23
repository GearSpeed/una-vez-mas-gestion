import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  type Categoria,
  type DatosCategoria,
  type DatosImagenProducto,
  type DatosProducto,
  esquemaCategoria,
  esquemaImagenProducto,
  esquemaProducto,
  type Producto,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { LIMITE_IMAGENES } from '../comun/limite-peticiones.js';
import { PESO_MAXIMO_IMAGEN } from '../imagenes/procesar-imagen.js';
import { ProductosService } from './productos.service.js';

@Controller()
export class CatalogoController {
  constructor(private readonly productos: ProductosService) {}

  /** `?inactivos=1` incluye los dados de baja. */
  @Get('productos')
  @RequierePermiso('catalogo.ver')
  listar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query('inactivos') inactivos?: string,
  ): Promise<Producto[]> {
    return this.productos.listar(usuario, inactivos === '1' || inactivos === 'true');
  }

  @Get('productos/:id')
  @RequierePermiso('catalogo.ver')
  obtener(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
  ): Promise<Producto> {
    return this.productos.obtener(usuario, id);
  }

  @Post('productos')
  @RequierePermiso('productos.gestionar')
  crear(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaProducto)) datos: DatosProducto,
  ): Promise<Producto> {
    return this.productos.crear(usuario, datos);
  }

  @Put('productos/:id')
  @RequierePermiso('productos.gestionar')
  actualizar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaProducto)) datos: DatosProducto,
  ): Promise<Producto> {
    return this.productos.actualizar(usuario, id, datos);
  }

  /** Multipart: `archivo` (JPG, PNG o WebP de hasta 10 MB) y `alt`. */
  @Post('productos/:id/imagen')
  @RequierePermiso('productos.gestionar')
  @Throttle(LIMITE_IMAGENES)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: PESO_MAXIMO_IMAGEN, files: 1 } }),
  )
  async subirImagen(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @UploadedFile() archivo: { readonly buffer: Buffer } | undefined,
    @Body(new Validar(esquemaImagenProducto)) datos: DatosImagenProducto,
  ): Promise<Producto> {
    const producto = await this.productos.subirImagen(usuario, id, archivo?.buffer, datos);
    if (!producto) throw new Error('No se leyó el producto');
    return producto;
  }

  @Put('productos/:id/imagen')
  @RequierePermiso('productos.gestionar')
  cambiarAltImagen(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaImagenProducto)) datos: DatosImagenProducto,
  ): Promise<Producto> {
    return this.productos.cambiarAltImagen(usuario, id, datos);
  }

  @Delete('productos/:id/imagen')
  @RequierePermiso('productos.gestionar')
  quitarImagen(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
  ): Promise<Producto> {
    return this.productos.quitarImagen(usuario, id);
  }

  @Get('categorias')
  @RequierePermiso('catalogo.ver')
  categorias(): Promise<Categoria[]> {
    return this.productos.categorias();
  }

  @Post('categorias')
  @RequierePermiso('productos.gestionar')
  crearCategoria(@Body(new Validar(esquemaCategoria)) datos: DatosCategoria): Promise<Categoria> {
    return this.productos.crearCategoria(datos);
  }

  @Put('categorias/:id')
  @RequierePermiso('productos.gestionar')
  actualizarCategoria(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCategoria)) datos: DatosCategoria,
  ): Promise<Categoria> {
    return this.productos.actualizarCategoria(id, datos);
  }
}
