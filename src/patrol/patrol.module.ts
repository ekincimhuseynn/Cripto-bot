import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { RiskModule } from '../risk/risk.module';
import { ScannerModule } from '../scanner/scanner.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PatrolService } from './patrol.service';

@Module({
  imports: [BrainModule, RiskModule, ScannerModule, TelegramModule],
  providers: [PatrolService],
  exports: [PatrolService],
})
export class PatrolModule {}
