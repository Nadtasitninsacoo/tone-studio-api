// Must stay first: it populates process.env before any module that reads it at
// import time (see load-env.ts).
import './load-env';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Default port is 3100, not 3000.
 *
 * `next dev` claims 3000/3001, and a backend that silently loses the port race is
 * a confusing first-run failure. Override with PORT.
 */
const DEFAULT_PORT = 3100;

/** Dev origins allowed by default; override with a comma-separated CORS_ORIGIN. */
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  const origins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : DEFAULT_ORIGINS;

  // The frontend runs on a different origin in development, so the browser blocks
  // fetch without this. `exposedHeaders` lets the client read the download filename.
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
  });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}`);
  logger.log(`CORS origins: ${origins.join(', ')}`);
}

void bootstrap();
