import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  type Categoria,
  type DatosCategoria,
  type DatosProducto,
  esquemaCategoria,
  esquemaProducto,
  type Producto,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
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
