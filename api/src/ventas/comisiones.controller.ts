import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  type ComisionPago,
  type DatosComision,
  esquemaComision,
  METODOS_PAGO,
  type MetodoPago,
} from '@uvm/compartido';
import { Autenticado, RequierePermiso } from '../acceso/decoradores.js';
import { Validar } from '../comun/validar.js';
import { ComisionesService } from './comisiones.service.js';

@Controller('comisiones')
export class ComisionesController {
  constructor(private readonly comisiones: ComisionesService) {}

  /** Cualquiera con sesión: el vendedor ve cuánto retiene Mercado Pago al cobrar. */
  @Get()
  @Autenticado()
  listar(): Promise<ComisionPago[]> {
    return this.comisiones.listar();
  }

  @Put(':metodo')
  @RequierePermiso('productos.gestionar')
  actualizar(
    @Param('metodo') metodo: string,
    @Body(new Validar(esquemaComision)) datos: DatosComision,
  ): Promise<ComisionPago> {
    if (!(METODOS_PAGO as readonly string[]).includes(metodo)) {
      throw new BadRequestException('Método de pago inválido.');
    }
    return this.comisiones.actualizar(metodo as MetodoPago, datos);
  }
}
