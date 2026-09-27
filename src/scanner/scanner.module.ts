import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { RiskModule } from '../risk/risk.module';
import { ScannerService } from './scanner.service';
import { SignalLogService } from './signal-log.service';

@Module({
  imports: [BrainModule, RiskModule],
  providers: [ScannerService, SignalLogService],
  exports: [ScannerService, SignalLogService],
})
export class ScannerModule {}
