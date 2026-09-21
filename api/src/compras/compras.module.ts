import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module.js';
import { ComprasController } from './compras.controller.js';
import { ComprasService } from './compras.service.js';

@Module({
  imports: [InventarioModule],
  controllers: [ComprasController],
  providers: [ComprasService],
})
export class ComprasModule {}
