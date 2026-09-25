import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  type Categoria,
  type DatosCancelacion,
  type DatosCategoria,
  type DatosGasto,
  esquemaCancelacion,
  esquemaCategoriaGasto,
  esquemaFiltroGastos,
  esquemaGasto,
  type FiltroGastos,
  type Gasto,
  type ListaGastos,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { GastosService } from './gastos.service.js';

@Controller()
export class GastosController {
  constructor(private readonly servicio: GastosService) {}

  @Get('gastos')
  @RequierePermiso('gastos.ver')
  listar(@Query(new Validar(esquemaFiltroGastos)) filtro: FiltroGastos): Promise<ListaGastos> {
    return this.servicio.listar(filtro);
  }

  @Get('gastos/categorias')
  @RequierePermiso('gastos.ver', 'gastos.registrar')
  categorias(): Promise<Categoria[]> {
    return this.servicio.categorias();
  }

  @Post('gastos/categorias')
  @RequierePermiso('gastos.registrar')
  crearCategoria(
    @Body(new Validar(esquemaCategoriaGasto)) datos: DatosCategoria,
  ): Promise<Categoria> {
    return this.servicio.crearCategoria(datos);
  }

  @Put('gastos/categorias/:id')
  @RequierePermiso('gastos.registrar')
  actualizarCategoria(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCategoriaGasto)) datos: DatosCategoria,
  ): Promise<Categoria> {
    return this.servicio.actualizarCategoria(id, datos);
  }

  @Get('gastos/:id')
  @RequierePermiso('gastos.ver')
  obtener(@Param('id', ParseId) id: number): Promise<Gasto> {
    return this.servicio.obtener(id);
  }

  @Post('gastos')
  @RequierePermiso('gastos.registrar')
  registrar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaGasto)) datos: DatosGasto,
  ): Promise<Gasto> {
    return this.servicio.registrar(usuario, datos);
  }

  @Post('gastos/:id/cancelar')
  @RequierePermiso('gastos.cancelar')
  cancelar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCancelacion)) { motivo }: DatosCancelacion,
  ): Promise<Gasto> {
    return this.servicio.cancelar(usuario, id, motivo);
  }
}
