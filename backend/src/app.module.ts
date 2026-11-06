import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { fileURLToPath } from 'node:url';
import { FmcsaModule } from './fmcsa/fmcsa.module.js';
import { HealthController } from './health.controller.js';
import { SaferModule } from './safer/safer.module.js';

@Module({
  imports: [
    // The built React app (frontend/dist), served from the same origin as the API.
    ServeStaticModule.forRoot({
      rootPath: fileURLToPath(new URL('../../frontend/dist', import.meta.url)),
      exclude: ['/api/{*path}'],
    }),
    FmcsaModule,
    SaferModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
