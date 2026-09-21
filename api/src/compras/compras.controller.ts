import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  type CompraDetalle,
  type CompraResumen,
  type DatosCancelacion,
  esquemaCancelacion,
  esquemaFiltroCompras,
  esquemaNuevaCompra,
  type FiltroCompras,
  type NuevaCompra,
  type Paginado,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { ComprasService } from './compras.service.js';

@Controller('compras')
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  @Get()
  @RequierePermiso('compras.ver')
  listar(
    @Query(new Validar(esquemaFiltroCompras)) filtro: FiltroCompras,
  ): Promise<Paginado<CompraResumen>> {
    return this.compras.listar(filtro);
  }

  @Get(':id')
  @RequierePermiso('compras.ver')
  detalle(@Param('id', ParseId) id: number): Promise<CompraDetalle> {
    return this.compras.detalle(id);
  }

  @Post()
  @RequierePermiso('compras.registrar')
  registrar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaNuevaCompra)) datos: NuevaCompra,
  ): Promise<CompraDetalle> {
    return this.compras.registrar(usuario, datos);
  }

  @Post(':id/cancelar')
  @RequierePermiso('compras.cancelar')
  cancelar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCancelacion)) datos: DatosCancelacion,
  ): Promise<CompraDetalle> {
    return this.compras.cancelar(usuario, id, datos.motivo);
  }
}
