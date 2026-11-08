import { Module } from '@nestjs/common';
import { SocrataClient } from '../fmcsa/socrata.client.js';
import { RegistryController } from './registry.controller.js';
import { RegistryService } from './registry.service.js';

/** State business registries (Secretary of State data published as open data). */
@Module({
  controllers: [RegistryController],
  providers: [SocrataClient, RegistryService],
})
export class RegistryModule {}
