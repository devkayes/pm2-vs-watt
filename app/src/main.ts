// Entry point for pm2 (and plain `node dist/main.js`).
// Under Watt this file is not used: @platformatic/nest boots AppModule itself.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // logger: only errors/warnings, so request logging never skews results
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0');
}
bootstrap();
