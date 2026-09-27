/**
 * GERÇEK BEYİN TESTİ — Telegram olmadan TAM karar hattını GERÇEK LLM ile çalıştırır:
 *   canlı piyasa verisi → Gemini kararı → risk doğrulaması → işlem kartı
 * Çalıştır: npm run smoke:brain   (.env'de GEMINI/OPENAI/ANTHROPIC anahtarı gerekir)
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { MarketService } from '../src/market/market.service';
import { BinanceFuturesProvider } from '../src/market/providers/binance-futures.provider';
import { OkxProvider } from '../src/market/providers/okx.provider';
import { BybitProvider } from '../src/market/providers/bybit.provider';
import { BinanceVisionProvider } from '../src/market/providers/binance-vision.provider';
import { FearGreedProvider } from '../src/market/providers/fear-greed.provider';
import { BrainService } from '../src/brain/brain.service';
import { RiskService } from '../src/risk/risk.service';
import { renderNoTrade, renderTradeCard } from '../src/risk/trade-card';
import { TradingPrefs } from '../src/common/types';

async function main() {
  const env = configuration();
  const cfg = { get: (path: string) => path.split('.').reduce((o: any, k) => o?.[k], env) } as unknown as ConfigService;

  const market = new MarketService(
    cfg,
    new BinanceFuturesProvider(cfg),
    new OkxProvider(cfg),
    new BybitProvider(cfg),
    new BinanceVisionProvider(cfg),
    new FearGreedProvider(cfg),
  );

  const prefs: TradingPrefs = {
    maxLeverage: 10,
    maxMarginPct: 50,
    minConfidence: 6,
    avoidSymbols: [],
    preferSymbols: [],
    activeInstructions: [],
  };
  const memoryStub: any = { getPrefs: async () => prefs, getRecent: async () => [], addMessage: async () => {} };
  const settingsStub: any = {
    getBalance: async () => 1000,
    getKillThreshold: async () => 700,
    isKillSwitchTripped: async () => false,
  };

  console.log('════════ 1) CANLI TARAMA ════════');
  const t0 = Date.now();
  const snapshot = await market.getFullSnapshot({ force: true });
  console.log(`${Date.now() - t0}ms | kaynak: ${snapshot.source} | detaylı: ${snapshot.detailed.length} | FNG: ${snapshot.fearGreed?.value ?? '?'}`);

  console.log('\n════════ 2) GERÇEK LLM KARARI ════════');
  const brain = new BrainService(cfg, memoryStub, settingsStub, market);
  console.log(`Model durumu: ${JSON.stringify(brain.llmStatus)}`);
  const t1 = Date.now();
  const draft = await brain.decideTrade({ snapshot, prefs, userQuestion: 'smoke:brain testi — en iyi fırsat nedir?' });
  console.log(`LLM yanıtı ${Date.now() - t1}ms:`);
  console.log(JSON.stringify(draft, null, 1));

  console.log('\n════════ 3) RİSK DOĞRULAMASI ════════');
  const risk = new RiskService(cfg, settingsStub, memoryStub);
  const result = await risk.buildCardWithRetry(draft, snapshot, 'manual', async (hint) =>
    brain.repairTrade({ snapshot, prefs, hint, previous: draft }),
  );

  console.log('\n════════ 4) SONUÇ ════════');
  if (result.status === 'ok') {
    console.log(renderTradeCard(result.card, { title: '🧠 GERÇEK LLM KARTI' }).replace(/<[^>]+>/g, ''));
  } else {
    console.log(renderNoTrade((result as any).userMessage || (result as any).reason).replace(/<[^>]+>/g, ''));
  }
  console.log('\n✅ Gerçek beyin testi tamam — LLM + veri + risk hattı uçtan uca çalışıyor.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Test BAŞARISIZ:', e);
  process.exit(1);
});
