/**
 * KriptoKaptan — Telegram Trading Asistanı
 * NestJS giriş noktası.
 */
import { config as loadDotenv } from 'dotenv';

// .env'i HER ŞEYDEN ÖNCE yükle (@Cron dekoratörü gibi import-anı değerlendirmeleri için kritik)
loadDotenv();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const level = process.env.LOG_LEVEL || 'info';
  const logger =
    level === 'debug'
      ? ['log', 'error', 'warn', 'debug', 'verbose']
      : level === 'warn'
        ? ['error', 'warn']
        : ['log', 'error', 'warn'];

  const app = await NestFactory.create(AppModule, { logger: logger as any });
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');

  const log = new Logger('Bootstrap');
  log.log('═══════════════════════════════════════════════════');
  log.log('  ⚓ KriptoKaptan — Trading Asistanı çalışıyor');
  log.log(`  🌐 Sağlık ucu: http://0.0.0.0:${port}/health`);
  log.log(`  🧠 Model: ${process.env.LLM_PROVIDER || 'openai'} | Nöbet cron: ${process.env.PATROL_CRON || '*/10 * * * *'}`);
  log.log('═══════════════════════════════════════════════════');
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Ölümcül açılış hatası:', e);
  process.exit(1);
});
