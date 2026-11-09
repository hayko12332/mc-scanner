import { Module } from '@nestjs/common';
import { CarriersController } from './carriers.controller.js';
import { CarriersService } from './carriers.service.js';
import { InsuranceService } from './insurance.service.js';
import { LookupController } from './lookup.controller.js';
import { LookupService } from './lookup.service.js';
import { SocrataClient } from './socrata.client.js';
import { SourceProbeService } from './source-probe.service.js';

@Module({
  controllers: [CarriersController, LookupController],
  providers: [SocrataClient, CarriersService, InsuranceService, LookupService, SourceProbeService],
})
export class FmcsaModule {}
