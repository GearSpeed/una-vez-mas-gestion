import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  type DatosCancelacion,
  type DatosMovimientoCapital,
  type DatosSocio,
  esquemaCancelacion,
  esquemaFiltroCapital,
  esquemaMovimientoCapital,
  esquemaSocio,
  type FiltroCapital,
  type ListaCapital,
  type MovimientoCapital,
  type SaldosCaja,
  type Socio,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { CapitalService } from './capital.service.js';

@Controller()
export class CapitalController {
  constructor(private readonly servicio: CapitalService) {}

  @Get('capital')
  @RequierePermiso('capital.ver')
  listar(@Query(new Validar(esquemaFiltroCapital)) filtro: FiltroCapital): Promise<ListaCapital> {
    return this.servicio.listar(filtro);
  }

  /** Cuánto dinero debería haber, acumulado y separado por dónde está. */
  @Get('capital/saldos')
  @RequierePermiso('capital.ver')
  saldos(): Promise<SaldosCaja> {
    return this.servicio.saldos();
  }

  @Get('capital/socios')
  @RequierePermiso('capital.ver', 'capital.registrar')
  socios(): Promise<Socio[]> {
    return this.servicio.socios();
  }

  @Post('capital/socios')
  @RequierePermiso('capital.registrar')
  crearSocio(@Body(new Validar(esquemaSocio)) datos: DatosSocio): Promise<Socio> {
    return this.servicio.crearSocio(datos);
  }

  @Put('capital/socios/:id')
  @RequierePermiso('capital.registrar')
  actualizarSocio(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaSocio)) datos: DatosSocio,
  ): Promise<Socio> {
    return this.servicio.actualizarSocio(id, datos);
  }

  @Post('capital')
  @RequierePermiso('capital.registrar')
  registrar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaMovimientoCapital)) datos: DatosMovimientoCapital,
  ): Promise<MovimientoCapital> {
    return this.servicio.registrar(usuario, datos);
  }

  /** No se borra: se cancela con motivo y queda a la vista. */
  @Post('capital/:id/cancelar')
  @RequierePermiso('capital.cancelar')
  cancelar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaCancelacion)) { motivo }: DatosCancelacion,
  ): Promise<MovimientoCapital> {
    return this.servicio.cancelar(usuario, id, motivo);
  }
}
