import { Module } from '@nestjs/common';
import { AnalisisService } from './analisis.service.js';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';

@Module({
  controllers: [ReportesController],
  providers: [ReportesService, AnalisisService],
})
export class ReportesModule {}
