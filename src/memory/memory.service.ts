import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatMessage } from '../database/entities/chat-message.entity';
import { Instruction } from '../database/entities/instruction.entity';
import { InstructionRecord, TradingPrefs } from '../common/types';
import { ConfigService } from '@nestjs/config';

export interface ExtractedInstruction {
  text: string;
  constraintType: 'max_leverage' | 'max_margin_pct' | 'min_confidence' | 'avoid_symbols' | 'prefer_symbols' | 'other' | null;
  constraintValue: number | null;
  constraintSymbols: string[] | null;
}

/**
 * KALICI HAFIZA:
 *  - Kullanıcı talimatları (instructions tablosu) — her kararda uygulanır
 *  - Sohbet geçmişi (chat_messages) — serbest sohbette bağlam
 */
@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(Instruction) private readonly instrRepo: Repository<Instruction>,
    @InjectRepository(ChatMessage) private readonly msgRepo: Repository<ChatMessage>,
    private readonly cfg: ConfigService,
  ) {}

  // ---------------- Talimatlar ----------------

  async addInstruction(ex: ExtractedInstruction): Promise<Instruction> {
    const row = this.instrRepo.create({
      text: ex.text,
      constraintType: ex.constraintType,
      constraintValue: ex.constraintValue,
      constraintSymbols: ex.constraintSymbols ? JSON.stringify(ex.constraintSymbols) : null,
      active: true,
    });
    return this.instrRepo.save(row);
  }

  async listInstructions(activeOnly = true): Promise<Instruction[]> {
    return this.instrRepo.find({
      where: activeOnly ? { active: true } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async removeInstruction(id: number): Promise<boolean> {
    const r = await this.instrRepo.update({ id }, { active: false });
    return r.affected > 0;
  }

  /** Tüm talimatları devre dışı bırak */
  async clearInstructions(): Promise<number> {
    const r = await this.instrRepo.update({ active: true }, { active: false });
    return r.affected || 0;
  }

  private toRecord(i: Instruction): InstructionRecord {
    let symbols: string[] | null = null;
    try {
      symbols = i.constraintSymbols ? JSON.parse(i.constraintSymbols) : null;
    } catch {
      symbols = null;
    }
    return {
      id: i.id,
      text: i.text,
      constraintType: i.constraintType,
      constraintValue: i.constraintValue,
      constraintSymbols: symbols,
      createdAt: i.createdAt,
    };
  }

  /**
   * Talimatlardan + .env varsayılanlarından etkin işlem tercihlerini üretir.
   * DEĞİŞMEZ KURALLAR her zaman tavan olarak kalır: maxLev ≤ 10, maxMarginPct ≤ 50.
   */
  async getPrefs(): Promise<TradingPrefs> {
    const envMaxLev = this.cfg.get<number>('risk.maxLeverage');
    const envMaxMargin = this.cfg.get<number>('risk.maxMarginPct');
    const envMinConf = this.cfg.get<number>('risk.minConfidence');

    const instructions = (await this.listInstructions()).map((i) => this.toRecord(i));

    let maxLeverage = envMaxLev;
    let maxMarginPct = envMaxMargin;
    let minConfidence = envMinConf;
    const avoidSymbols: string[] = [];
    const preferSymbols: string[] = [];

    for (const ins of instructions) {
      switch (ins.constraintType) {
        case 'max_leverage':
          if (ins.constraintValue != null) maxLeverage = Math.min(maxLeverage, Math.max(1, ins.constraintValue));
          break;
        case 'max_margin_pct':
          if (ins.constraintValue != null) maxMarginPct = Math.min(maxMarginPct, Math.max(1, ins.constraintValue));
          break;
        case 'min_confidence':
          if (ins.constraintValue != null) minConfidence = Math.min(10, Math.max(1, ins.constraintValue));
          break;
        case 'avoid_symbols':
          if (ins.constraintSymbols) avoidSymbols.push(...ins.constraintSymbols.map((s) => s.toUpperCase()));
          break;
        case 'prefer_symbols':
          if (ins.constraintSymbols) preferSymbols.push(...ins.constraintSymbols.map((s) => s.toUpperCase()));
          break;
      }
    }
    // Sert tavanlar asla aşılamaz
    maxLeverage = Math.min(maxLeverage, 10);
    maxMarginPct = Math.min(maxMarginPct, 50);

    return { maxLeverage, maxMarginPct, minConfidence, avoidSymbols, preferSymbols, activeInstructions: instructions };
  }

  // ---------------- Sohbet geçmişi ----------------

  async addMessage(chatId: number, role: 'user' | 'bot', content: string, kind = 'text'): Promise<void> {
    // Çok uzun içerikleri kırp (tablo şişmesin)
    const trimmed = content.length > 4000 ? content.slice(0, 4000) + '…' : content;
    await this.msgRepo.save(this.msgRepo.create({ chatId, role, content: trimmed, kind }));
    // Basit budama: 5000 mesajı aşınca en eskileri sil
    const count = await this.msgRepo.count();
    if (count > 5000) {
      const old = await this.msgRepo.find({ order: { id: 'ASC' }, take: count - 5000, select: ['id'] });
      if (old.length) await this.msgRepo.delete({ id: In(old.map((o) => o.id)) });
    }
  }

  async getRecent(chatId: number, limit = 20): Promise<ChatMessage[]> {
    return this.msgRepo.find({ where: { chatId }, order: { id: 'DESC' }, take: limit });
  }
}
