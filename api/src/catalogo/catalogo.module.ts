import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller.js';
import { ProductosService } from './productos.service.js';

@Module({
  controllers: [CatalogoController],
  providers: [ProductosService],
})
export class CatalogoModule {}
