import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { SignalLog } from '../database/entities/signal-log.entity';

/**
 * Sinyal kaydı & spam önleme (dedupe).
 * "Aynı fırsatı tekrar göndermesin" kuralının bekçisi:
 * aynı coin + aynı yön, belirlenen saat aralığında bir kez gönderilir.
 */
@Injectable()
export class SignalLogService {
  constructor(@InjectRepository(SignalLog) private readonly repo: Repository<SignalLog>) {}

  async log(entry: {
    type: 'TRADE' | 'ALERT' | 'MANUAL_TRADE' | 'PHOTO_TRADE' | 'NO_TRADE';
    symbol?: string | null;
    direction?: string | null;
    entryPrice?: number | null;
    confidence?: number | null;
    summary?: string | null;
    source?: string;
  }): Promise<void> {
    await this.repo.save(
      this.repo.create({
        type: entry.type,
        symbol: entry.symbol ?? null,
        direction: entry.direction ?? null,
        entryPrice: entry.entryPrice ?? null,
        confidence: entry.confidence ?? null,
        summary: entry.summary ?? null,
        source: entry.source ?? 'patrol',
      }),
    );
  }

  /** Aynı coin+yön bu kadar saat içinde gönderilmiş mi? */
  async isDuplicateTrade(symbol: string, direction: string, withinHours: number): Promise<boolean> {
    const since = new Date(Date.now() - withinHours * 3600_000);
    const count = await this.repo.count({
      where: {
        type: In(['TRADE', 'MANUAL_TRADE', 'PHOTO_TRADE']),
        symbol,
        direction,
        createdAt: MoreThan(since),
      },
    });
    return count > 0;
  }

  /** Aynı coin için uyarı cooldown'u doldu mu? */
  async isDuplicateAlert(symbol: string, withinMinutes: number): Promise<boolean> {
    const since = new Date(Date.now() - withinMinutes * 60_000);
    const count = await this.repo.count({
      where: { type: 'ALERT', symbol, createdAt: MoreThan(since) },
    });
    return count > 0;
  }

  /** LLM promptuna "son gönderilenler" özeti (spam önleme bağlamı) */
  async recentSummary(hours = 24): Promise<string> {
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await this.repo.find({
      where: { type: In(['TRADE', 'MANUAL_TRADE', 'PHOTO_TRADE', 'ALERT']), createdAt: MoreThan(since) },
      order: { createdAt: 'DESC' },
      take: 12,
    });
    if (!rows.length) return '';
    return rows
      .map(
        (r) =>
          `- ${r.type === 'ALERT' ? 'UYARI' : 'KART'} ${r.symbol}${r.direction ? ' ' + r.direction : ''}${r.confidence ? ` güven=${r.confidence}` : ''} @ ${new Date(r.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`,
      )
      .join('\n');
  }

  async recent(limit = 10): Promise<SignalLog[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
