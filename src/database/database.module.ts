import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { ChatMessage } from './entities/chat-message.entity';
import { Instruction } from './entities/instruction.entity';
import { Setting } from './entities/setting.entity';
import { SignalLog } from './entities/signal-log.entity';

export const ALL_ENTITIES = [Setting, ChatMessage, Instruction, SignalLog];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const dbPath = resolve(process.cwd(), cfg.get<string>('db.path'));
        const dir = dirname(dbPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        return {
          type: 'better-sqlite3',
          database: dbPath,
          entities: ALL_ENTITIES,
          synchronize: true, // tek kullanıcılı botta şemayı otomatik yönet
          logging: false,
        };
      },
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
