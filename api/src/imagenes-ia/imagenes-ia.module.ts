import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module.js';
import { ImagenesIaController } from './imagenes-ia.controller.js';
import { ImagenesIaService } from './imagenes-ia.service.js';

@Module({
  imports: [CatalogoModule],
  controllers: [ImagenesIaController],
  providers: [ImagenesIaService],
})
export class ImagenesIaModule {}
