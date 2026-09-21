import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { VentasController } from './ventas.controller.js';
import { VentasService } from './ventas.service.js';

@Module({
  imports: [InventarioModule],
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
