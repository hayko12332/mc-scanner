import { Module } from '@nestjs/common';
import { CarriersController } from './carriers.controller.js';
import { CarriersService } from './carriers.service.js';
import { InsuranceService } from './insurance.service.js';
import { SocrataClient } from './socrata.client.js';

@Module({
  controllers: [CarriersController],
  providers: [SocrataClient, CarriersService, InsuranceService],
})
export class FmcsaModule {}
