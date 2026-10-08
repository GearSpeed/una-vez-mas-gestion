import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ComisionesController } from './comisiones.controller.js';
import { ComisionesService } from './comisiones.service.js';
import { TransferenciaController } from './transferencia.controller.js';
import { TransferenciaService } from './transferencia.service.js';
import { VentasController } from './ventas.controller.js';
import { VentasService } from './ventas.service.js';

@Module({
  imports: [InventarioModule],
  controllers: [VentasController, ComisionesController, TransferenciaController],
  providers: [VentasService, ComisionesService, TransferenciaService],
})
export class VentasModule {}
