import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  type DatosCancelacion,
  esquemaCancelacion,
  esquemaDevolucion,
  esquemaFiltroVentas,
  esquemaNuevaVenta,
  type FiltroVentas,
  type ListaVentas,
  type NuevaDevolucion,
  type NuevaVenta,
  type VentaDetalle,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { VentasService } from './ventas.service.js';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  /** El vendedor ve las suyas; con `ventas.ver_todas`, las de todos. */
  @Get()
  @RequierePermiso('ventas.registrar', 'ventas.ver_todas')
  listar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroVentas)) filtro: FiltroVentas,
  ): Promise<ListaVentas> {
    return this.ventas.listar(usuario, filtro);
  }

  @Get(':id')
  @RequierePermiso('ventas.registrar', 'ventas.ver_todas')
  detalle(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
  ): Promise<VentaDetalle> {
    return this.ventas.detalle(usuario, id);
  }

  @Post()
  @RequierePermiso('ventas.registrar')
  registrar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaNuevaVenta)) datos: NuevaVenta,
  ): Promise<VentaDetalle> {
    return this.ventas.registrar(usuario, datos);
  }

  @Post(':id/cancelar')
  @RequierePermiso('ventas.cancelar')
  cancelar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCancelacion)) datos: DatosCancelacion,
  ): Promise<VentaDetalle> {
    return this.ventas.cancelar(usuario, id, datos.motivo);
  }

  /** El vendedor, de sus ventas; con `ventas.ver_todas`, de cualquiera. */
  @Post(':id/devoluciones')
  @RequierePermiso('ventas.devolver')
  devolver(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaDevolucion)) datos: NuevaDevolucion,
  ): Promise<VentaDetalle> {
    return this.ventas.devolver(usuario, id, datos);
  }
}
