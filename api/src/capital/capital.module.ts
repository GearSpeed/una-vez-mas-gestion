import { Module } from '@nestjs/common';
import { CapitalController } from './capital.controller.js';
import { CapitalService } from './capital.service.js';

@Module({
  controllers: [CapitalController],
  providers: [CapitalService],
  exports: [CapitalService],
})
export class CapitalModule {}
