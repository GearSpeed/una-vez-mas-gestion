import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccesoGuard } from './acceso.guard.js';
import { IdentidadService } from './identidad.service.js';
import { SesionesService } from './sesiones.service.js';
import { YoController } from './yo.controller.js';

@Global()
@Module({
  controllers: [YoController],
  providers: [IdentidadService, SesionesService, { provide: APP_GUARD, useClass: AccesoGuard }],
  exports: [SesionesService],
})
export class AccesoModule {}
