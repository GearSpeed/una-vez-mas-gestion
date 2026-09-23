import { Module } from '@nestjs/common';
import { CatalogoPublicoService } from './catalogo-publico.service.js';
import { PublicoController } from './publico.controller.js';

@Module({
  controllers: [PublicoController],
  providers: [CatalogoPublicoService],
})
export class PublicoModule {}
