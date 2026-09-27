import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { RiskModule } from '../risk/risk.module';
import { ScannerModule } from '../scanner/scanner.module';
import { TelegramSender } from './telegram-sender.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ScannerModule, BrainModule, RiskModule],
  providers: [TelegramService, TelegramSender],
  exports: [TelegramSender],
})
export class TelegramModule {}
