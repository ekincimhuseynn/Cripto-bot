import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { BrainService } from '../brain/brain.service';
import { fmtPrice } from '../common/format';
import { MarketService } from '../market/market.service';
import { MemoryService } from '../memory/memory.service';
import { RiskService } from '../risk/risk.service';
import { renderAlert, renderTradeCard } from '../risk/trade-card';
import { SignalLogService } from '../scanner/signal-log.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramSender } from '../telegram/telegram-sender.service';

/**
 * OTOMATİK NÖBET — 10 dakikada bir (cron) kimse yazmadan tarar:
 *  - Sert hareket varsa → uyarı gönderir
 *  - Güçlü fırsat varsa → hazır işlem kartını otomatik gönderir
 *  - Aynı fırsatı TEKRAR GÖNDERMEZ (signal_log dedupe)
 *  - Kill switch aktifse kart üretmez (sadece durum bildirimi)
 */
@Injectable()
export class PatrolService {
  private readonly log = new Logger(PatrolService.name);
  private running = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly market: MarketService,
    private readonly brain: BrainService,
    private readonly risk: RiskService,
    private readonly memory: MemoryService,
    private readonly settings: SettingsService,
    private readonly signals: SignalLogService,
    private readonly sender: TelegramSender,
  ) {}

  @Cron(process.env.PATROL_CRON || '*/10 * * * *', { name: 'patrol' })
  async onCron() {
    await this.runPatrol().catch((e) => this.log.error(`Nöbet turu hatası: ${e.message}`));
  }

  async runPatrol(): Promise<void> {
    if (this.running) {
      this.log.warn('Önceki nöbet turu hâlâ çalışıyor — bu tur atlandı');
      return;
    }
    if (!(await this.settings.isPatrolEnabled())) return;
    if (!this.brain.llmStatus.ready) {
      this.log.debug('LLM hazır değil — nöbet turu atlandı');
      return;
    }

    this.running = true;
    const t0 = Date.now();
    try {
      // ---- Kill switch bildirimi (tek sefer) ----
      if (await this.settings.shouldNotifyKillSwitch()) {
        const balance = await this.settings.getBalance();
        const threshold = await this.settings.getKillThreshold();
        await this.sender.broadcast(
          `🛑🚨 <b>KILL SWITCH AKTİF!</b>\nBakiye ${fmtPrice(balance)} USDT → eşik ${fmtPrice(threshold)} USDT altına düştü.\n` +
            `<b>Tüm işlem önerileri durduruldu.</b> Nöbet sadece izlemeye devam ediyor.\n` +
            `<i>Bakiye düzelince: /bakiye &lt;miktar&gt; veya /killswitch sıfırla</i>`,
        );
        await this.settings.markKillSwitchNotified();
      }

      // ---- Veri + karar ----
      const snapshot = await this.market.getFullSnapshot({ force: true });
      const prefs = await this.memory.getPrefs();
      const recentSummary = await this.signals.recentSummary(24);
      const decision = await this.brain.decidePatrol({ snapshot, prefs, recentSentSummary: recentSummary });

      // ---- Uyarılar (dedupe + cooldown) ----
      const cooldown = this.cfg.get<number>('patrol.alertCooldownMin');
      const maxAlerts = this.cfg.get<number>('patrol.maxAlertsPerRun');
      let alertsSent = 0;
      for (const alert of decision.alerts || []) {
        if (alertsSent >= maxAlerts) break;
        const symbol = String(alert.symbol || '').toUpperCase();
        if (!symbol) continue;
        if (await this.signals.isDuplicateAlert(symbol, cooldown)) {
          this.log.debug(`Uyarı atlandı (cooldown): ${symbol}`);
          continue;
        }
        const text = renderAlert(alert, decision.market_summary);
        const n = await this.sender.broadcast(text);
        if (n > 0) {
          alertsSent++;
          await this.signals.log({ type: 'ALERT', symbol, summary: alert.message?.slice(0, 200), source: 'patrol' });
        } else {
          this.log.warn('Uyarı üretildi ama gönderilecek chat yok (TELEGRAM_CHAT_ID tanımla!)');
        }
      }

      // ---- İşlem kartı (dedupe: aynı fırsat tekrar gönderilmez) ----
      const trade = decision.trade;
      if (trade && trade.action === 'TRADE') {
        const symbol = String(trade.symbol || '').toUpperCase();
        const direction = String(trade.direction || '').toUpperCase();
        const dedupeHours = this.cfg.get<number>('patrol.dedupeHours');
        if (await this.signals.isDuplicateTrade(symbol, direction, dedupeHours)) {
          this.log.log(`Aynı fırsat tekrar gönderilmedi (spam önleme): ${symbol} ${direction} ← son ${dedupeHours} saat içinde zaten iletildi`);
        } else {
          const result = await this.risk.buildCardWithRetry(trade, snapshot, 'patrol', async (hint) =>
            this.brain.repairTrade({ snapshot, prefs, hint, previous: trade }),
          );
          if (result.status === 'ok') {
            const cardText = renderTradeCard(result.card, { title: '🤖⚡ OTOMATİK NÖBET — GÜÇLÜ FIRSAT' });
            const n = await this.sender.broadcast(cardText);
            if (n > 0) {
              await this.signals.log({
                type: 'TRADE',
                symbol: result.card.symbol,
                direction: result.card.direction,
                entryPrice: result.card.entryPrice,
                confidence: result.card.confidence,
                summary: `${result.card.leverage}x margin=${result.card.marginUsdt} SL=${result.card.stopLoss} TP=${result.card.takeProfit}`,
                source: 'patrol',
              });
              this.log.log(`Nöbet kartı gönderildi: ${result.card.symbol} ${result.card.direction} güven=${result.card.confidence}`);
            }
          } else {
            this.log.log(`Nöbet fırsatı doğrulanamadı → sessizce atlandı: ${result.status} ${result.reason}`);
            await this.signals.log({
              type: 'NO_TRADE',
              symbol: trade.symbol || null,
              direction: trade.direction || null,
              confidence: trade.confidence ?? null,
              summary: `patrol-rejected: ${(result as any).reason?.slice(0, 200) || ''}`,
              source: 'patrol',
            });
          }
        }
      }

      this.log.log(
        `Nöbet turu tamam (${Date.now() - t0}ms) | uyarı=${alertsSent} | karar=${trade ? `${trade.symbol} ${trade.direction}` : 'işlem yok'} | özet="${(decision.market_summary || '').slice(0, 60)}"`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Elle tetikleme (test için) */
  async runNow(): Promise<string> {
    await this.runPatrol();
    return 'Nöbet turu çalıştırıldı (loglara bak).';
  }
}
