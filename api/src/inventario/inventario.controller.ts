import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  type AjusteDetalle,
  esquemaConteo,
  esquemaFiltroExistencias,
  esquemaFiltroKardex,
  esquemaNuevoAjuste,
  esquemaNuevoTraspaso,
  type ExistenciasRespuesta,
  type FiltroExistencias,
  type FiltroKardex,
  type MovimientoKardex,
  type NuevoAjuste,
  type NuevoConteo,
  type NuevoTraspaso,
  type Paginado,
  type ResultadoConteo,
  type TraspasoDetalle,
} from '@uvm/compartido';
import { Autenticado, RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { AjustesService } from './ajustes.service.js';
import { ExistenciasService } from './existencias.service.js';
import { TraspasosService } from './traspasos.service.js';

@Controller('inventario')
export class InventarioController {
  constructor(
    private readonly existencias: ExistenciasService,
    private readonly traspasos: TraspasosService,
    private readonly ajustes: AjustesService,
  ) {}

  /** Cualquiera con sesión: el vendedor solo ve su ubicación (lo decide el servicio). */
  @Get('existencias')
  @Autenticado()
  listarExistencias(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroExistencias)) filtro: FiltroExistencias,
  ): Promise<ExistenciasRespuesta> {
    return this.existencias.listar(usuario, filtro.ubicacionId);
  }

  @Get('kardex')
  @RequierePermiso('inventario.ver_todo')
  kardex(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroKardex)) filtro: FiltroKardex,
  ): Promise<Paginado<MovimientoKardex>> {
    return this.existencias.kardex(usuario, filtro);
  }

  @Get('traspasos')
  @RequierePermiso('inventario.ver_todo', 'traspasos.registrar')
  traspasosRecientes(): Promise<TraspasoDetalle[]> {
    return this.traspasos.recientes();
  }

  @Get('traspasos/:id')
  @RequierePermiso('inventario.ver_todo', 'traspasos.registrar')
  traspaso(@Param('id', ParseId) id: number): Promise<TraspasoDetalle> {
    return this.traspasos.detalle(id);
  }

  @Post('traspasos')
  @RequierePermiso('traspasos.registrar')
  registrarTraspaso(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaNuevoTraspaso)) datos: NuevoTraspaso,
  ): Promise<TraspasoDetalle> {
    return this.traspasos.registrar(usuario, datos);
  }

  @Get('ajustes')
  @RequierePermiso('inventario.ver_todo', 'ajustes.registrar')
  ajustesRecientes(@UsuarioActual() usuario: UsuarioSesion): Promise<AjusteDetalle[]> {
    return this.ajustes.recientes(usuario);
  }

  @Get('ajustes/:id')
  @RequierePermiso('inventario.ver_todo', 'ajustes.registrar')
  ajuste(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
  ): Promise<AjusteDetalle> {
    return this.ajustes.detalle(usuario, id);
  }

  @Post('ajustes')
  @RequierePermiso('ajustes.registrar')
  registrarAjuste(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaNuevoAjuste)) datos: NuevoAjuste,
  ): Promise<AjusteDetalle> {
    return this.ajustes.registrar(usuario, datos);
  }

  @Post('conteos')
  @RequierePermiso('ajustes.registrar')
  contar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaConteo)) datos: NuevoConteo,
  ): Promise<ResultadoConteo> {
    return this.ajustes.contar(usuario, datos);
  }
}
