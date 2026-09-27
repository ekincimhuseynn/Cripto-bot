import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { SettingsModule } from './settings/settings.module';
import { MemoryModule } from './memory/memory.module';
import { MarketModule } from './market/market.module';
import { RiskModule } from './risk/risk.module';
import { BrainModule } from './brain/brain.module';
import { ScannerModule } from './scanner/scanner.module';
import { TelegramModule } from './telegram/telegram.module';
import { PatrolModule } from './patrol/patrol.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    SettingsModule,
    MemoryModule,
    MarketModule,
    RiskModule,
    BrainModule,
    ScannerModule,
    TelegramModule,
    PatrolModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
