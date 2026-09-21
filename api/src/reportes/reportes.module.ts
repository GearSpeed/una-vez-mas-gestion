import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';

@Module({
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
