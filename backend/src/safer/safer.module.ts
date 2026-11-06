import { Module } from '@nestjs/common';
import { SaferController } from './safer.controller.js';
import { SaferService } from './safer.service.js';

@Module({
  controllers: [SaferController],
  providers: [SaferService],
})
export class SaferModule {}
