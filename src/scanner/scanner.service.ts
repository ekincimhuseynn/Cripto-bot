import { Injectable, Logger } from '@nestjs/common';
import { MarketSnapshot, CardBuildResult, TradeCardDraft } from '../common/types';
import { BrainService } from '../brain/brain.service';
import { MarketService } from '../market/market.service';
import { MemoryService } from '../memory/memory.service';
import { RiskService } from '../risk/risk.service';
import { SignalLogService } from './signal-log.service';
import { SettingsService } from '../settings/settings.service';

export interface ScanOptions {
  mode: 'manual' | 'patrol' | 'photo';
  focusSymbol?: string;
  userQuestion?: string;
  /** Önbelleği atla (nöbet turlarında taze veri için) */
  force?: boolean;
}

export interface ScanResult {
  snapshot: MarketSnapshot;
  draft: TradeCardDraft;
  result: CardBuildResult;
}

/**
 * TARAMA HATTI: canlı veri → LLM kararı → risk doğrulaması → nihai sonuç.
 * Hem manuel komutlar hem nöbet hem de ekran görüntüsü akışı buradan geçer.
 */
@Injectable()
export class ScannerService {
  private readonly log = new Logger(ScannerService.name);

  constructor(
    private readonly market: MarketService,
    private readonly brain: BrainService,
    private readonly risk: RiskService,
    private readonly memory: MemoryService,
    private readonly settings: SettingsService,
    private readonly signals: SignalLogService,
  ) {}

  async scan(opts: ScanOptions): Promise<ScanResult> {
    const t0 = Date.now();
    this.log.log(`Tarama başladı [${opts.mode}]${opts.focusSymbol ? ` odak=${opts.focusSymbol}` : ''}`);

    const snapshot = await this.market.getFullSnapshot({
      force: opts.force ?? opts.mode === 'patrol',
      focusSymbol: opts.focusSymbol,
    });
    const prefs = await this.memory.getPrefs();

    const draft = await this.brain.decideTrade({
      snapshot,
      prefs,
      focusSymbol: opts.focusSymbol,
      userQuestion: opts.userQuestion,
    });

    const result = await this.risk.buildCardWithRetry(draft, snapshot, opts.mode === 'photo' ? 'photo' : opts.mode, async (hint) =>
      this.brain.repairTrade({ snapshot, prefs, hint, previous: draft, focusSymbol: opts.focusSymbol }),
    );

    this.log.log(`Tarama bitti [${opts.mode}] → ${result.status} (${Date.now() - t0}ms)`);
    return { snapshot, draft, result };
  }

  /** Kart başarıyla kullanıcıya iletildikten sonra çağrılır (dedupe kaydı) */
  async logSentCard(res: ScanResult, type: 'MANUAL_TRADE' | 'TRADE' | 'PHOTO_TRADE'): Promise<void> {
    if (res.result.status !== 'ok') return;
    const c = res.result.card;
    await this.signals.log({
      type,
      symbol: c.symbol,
      direction: c.direction,
      entryPrice: c.entryPrice,
      confidence: c.confidence,
      summary: `${c.leverage}x margin=${c.marginUsdt} SL=${c.stopLoss} TP=${c.takeProfit}`,
      source: type === 'MANUAL_TRADE' ? 'manual' : type === 'PHOTO_TRADE' ? 'photo' : 'patrol',
    });
  }

  /** İşlem önerilmediğini de logla (analiz için, kullanıcıya mesaj gitmez) */
  async logNoTrade(res: ScanResult, source: string): Promise<void> {
    if (res.result.status !== 'none') return;
    await this.signals.log({
      type: 'NO_TRADE',
      symbol: res.draft?.symbol || null,
      direction: res.draft?.direction || null,
      confidence: res.draft?.confidence ?? null,
      summary: res.result.reason?.slice(0, 300) || null,
      source,
    });
  }

  get signalLog(): SignalLogService {
    return this.signals;
  }
}
