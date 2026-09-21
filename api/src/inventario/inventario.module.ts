import { Module } from '@nestjs/common';
import { AjustesService } from './ajustes.service.js';
import { ExistenciasService } from './existencias.service.js';
import { InventarioController } from './inventario.controller.js';
import { MovimientosService } from './movimientos.service.js';
import { TraspasosService } from './traspasos.service.js';

@Module({
  controllers: [InventarioController],
  providers: [MovimientosService, ExistenciasService, TraspasosService, AjustesService],
  exports: [MovimientosService],
})
export class InventarioModule {}
