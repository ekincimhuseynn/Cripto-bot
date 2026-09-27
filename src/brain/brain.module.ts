import { Module } from '@nestjs/common';
import { BrainService } from './brain.service';

@Module({
  providers: [BrainService],
  exports: [BrainService],
})
export class BrainModule {}
