import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  type DatosProveedor,
  type DatosVehiculo,
  esquemaProveedor,
  esquemaVehiculo,
  type Proveedor,
  type Vehiculo,
} from '@uvm/compartido';
import { RequierePermiso } from '../acceso/decoradores.js';
import { ParseId, Validar } from '../comun/validar.js';
import { ProveedoresService } from './proveedores.service.js';

@Controller()
export class ProveedoresController {
  constructor(private readonly servicio: ProveedoresService) {}

  /** Quien captura o consulta compras necesita la lista para elegir. */
  @Get('proveedores')
  @RequierePermiso('proveedores.gestionar', 'compras.registrar', 'compras.ver')
  proveedores(): Promise<Proveedor[]> {
    return this.servicio.proveedores();
  }

  @Post('proveedores')
  @RequierePermiso('proveedores.gestionar')
  crearProveedor(@Body(new Validar(esquemaProveedor)) datos: DatosProveedor): Promise<Proveedor> {
    return this.servicio.crearProveedor(datos);
  }

  @Put('proveedores/:id')
  @RequierePermiso('proveedores.gestionar')
  actualizarProveedor(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaProveedor)) datos: DatosProveedor,
  ): Promise<Proveedor> {
    return this.servicio.actualizarProveedor(id, datos);
  }

  @Get('vehiculos')
  @RequierePermiso('proveedores.gestionar', 'compras.registrar', 'compras.ver')
  vehiculos(): Promise<Vehiculo[]> {
    return this.servicio.vehiculos();
  }

  @Post('vehiculos')
  @RequierePermiso('proveedores.gestionar')
  crearVehiculo(@Body(new Validar(esquemaVehiculo)) datos: DatosVehiculo): Promise<Vehiculo> {
    return this.servicio.crearVehiculo(datos);
  }

  @Put('vehiculos/:id')
  @RequierePermiso('proveedores.gestionar')
  actualizarVehiculo(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaVehiculo)) datos: DatosVehiculo,
  ): Promise<Vehiculo> {
    return this.servicio.actualizarVehiculo(id, datos);
  }
}
