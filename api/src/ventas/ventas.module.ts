import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ComisionesController } from './comisiones.controller.js';
import { ComisionesService } from './comisiones.service.js';
import { VentasController } from './ventas.controller.js';
import { VentasService } from './ventas.service.js';

@Module({
  imports: [InventarioModule],
  controllers: [VentasController, ComisionesController],
  providers: [VentasService, ComisionesService],
})
export class VentasModule {}
