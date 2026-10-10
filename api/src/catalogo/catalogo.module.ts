import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller.js';
import { ProductosService } from './productos.service.js';

@Module({
  controllers: [CatalogoController],
  providers: [ProductosService],
  // Imágenes con IA asigna la foto por el mismo camino que subirla a mano.
  exports: [ProductosService],
})
export class CatalogoModule {}
