import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module.js';
import { FichaIaController } from './ficha-ia.controller.js';
import { FichaIaService } from './ficha-ia.service.js';
import { ImagenesIaController } from './imagenes-ia.controller.js';
import { ImagenesIaService } from './imagenes-ia.service.js';
import { proveedorOpenAi } from './openai.provider.js';

@Module({
  imports: [CatalogoModule],
  controllers: [ImagenesIaController, FichaIaController],
  providers: [proveedorOpenAi, ImagenesIaService, FichaIaService],
})
export class ImagenesIaModule {}
