/**
 * UÇTAN UCA SİMÜLASYON — Telegram ve gerçek LLM olmadan TAM karar hattını
 * canlı piyasa verisiyle test eder:
 *   MarketService (gerçek OKX/Binance verisi) → sahte LLM kararı → RiskService → kart render
 * Çalıştır: npm run smoke:e2e
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
import { RiskService } from '../src/risk/risk.service';
import { renderNoTrade, renderTradeCard } from '../src/risk/trade-card';
import { TradeCardDraft, TradingPrefs } from '../src/common/types';
import { fmtPrice } from '../src/common/format';

const prefs: TradingPrefs = {
  maxLeverage: 10,
  maxMarginPct: 50,
  minConfidence: 6,
  avoidSymbols: [],
  preferSymbols: [],
  activeInstructions: [],
};

/** Sahte "LLM": detaylı analizden en güçlü trende ATR bazlı SL/TP ile kart üretir (gerçek LLM'in döndüreceği format) */
function fakeLlmDecision(snapshot: any, balance: number): TradeCardDraft {
  const detailed = snapshot.detailed.filter((d: any) => d.tf?.['1h']);
  if (!detailed.length) return { action: 'NO_TRADE', rationale: 'Yeterli veri yok.' };
  // Trend + RSI + hacim kombine skoru
  const scored = detailed.map((d: any) => {
    const h = d.tf['1h'];
    const bull = (h.trendUp ? 2 : 0) + (h.rsi14 > 55 && h.rsi14 < 72 ? 2 : 0) + (h.macdHist > 0 ? 1 : 0) + (h.volRatio > 1.2 ? 1 : 0);
    const bear = (!h.trendUp ? 2 : 0) + (h.rsi14 < 45 && h.rsi14 > 28 ? 2 : 0) + (h.macdHist < 0 ? 1 : 0) + (h.volRatio > 1.2 ? 1 : 0);
    return { d, h, bull, bear };
  });
  scored.sort((a: any, b: any) => Math.max(b.bull, b.bear) - Math.max(a.bull, a.bear));
  const best = scored[0];
  const strength = Math.max(best.bull, best.bear);
  if (strength < 4) return { action: 'NO_TRADE', confidence: 3, rationale: 'Sinyaller zayıf/hizalı değil — kenarda bekliyoruz.' };
  const dir = best.bull >= best.bear ? 'LONG' : 'SHORT';
  const entry = best.d.price;
  const atrPct = best.h.atrPct / 100;
  const sl = dir === 'LONG' ? entry * (1 - 2 * atrPct) : entry * (1 + 2 * atrPct);
  const tp = dir === 'LONG' ? entry * (1 + 4 * atrPct) : entry * (1 - 4 * atrPct);
  return {
    action: 'TRADE',
    symbol: best.d.symbol,
    direction: dir as 'LONG' | 'SHORT',
    leverage: Math.min(5, Math.max(2, Math.round(strength))),
    margin_usdt: Math.round(balance * 0.15),
    entry_price: entry,
    stop_loss: Number(sl.toFixed(6)),
    take_profit: Number(tp.toFixed(6)),
    confidence: Math.min(9, 4 + strength),
    rationale: `[SİMÜLASYON] 1s trend ${best.h.trendUp ? 'yukarı' : 'aşağı'}, RSI ${best.h.rsi14}, MACD hist ${best.h.macdHist}, hacim oranı ${best.h.volRatio}.`,
  };
}

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

  console.log('════════ 1) CANLI TARAMA (50 coin + detaylı shortlist) ════════');
  const t0 = Date.now();
  const snapshot = await market.getFullSnapshot({ force: true });
  console.log(`Tarama ${Date.now() - t0}ms | kaynak: ${snapshot.source} | top50: ${snapshot.top50.length} | detaylı: ${snapshot.detailed.length} | hareketli: ${snapshot.movers.length}`);
  console.log(`Majörler: BTC $${fmtPrice(snapshot.majors.btc?.price ?? 0)} | ETH $${fmtPrice(snapshot.majors.eth?.price ?? 0)} | SOL $${fmtPrice(snapshot.majors.sol?.price ?? 0)}`);
  console.log(`Korku/Açgözlülük: ${snapshot.fearGreed ? `${snapshot.fearGreed.value}/100 (${snapshot.fearGreed.labelTr})` : '?'}`);
  if (snapshot.movers.length) {
    console.log(`Sert hareketler: ${snapshot.movers.slice(0, 5).map((m) => `${m.symbol}(${m.reason})`).join(', ')}`);
  }

  console.log('\n════════ 2) KARAR (sahte LLM) ════════');
  const balance = 1000;
  const draft = fakeLlmDecision(snapshot, balance);
  console.log(JSON.stringify(draft, null, 1));

  console.log('\n════════ 3) RİSK DOĞRULAMASI + KART ════════');
  const settingsStub: any = {
    getBalance: async () => balance,
    getKillThreshold: async () => 700,
    isKillSwitchTripped: async () => balance < 700,
  };
  const memoryStub: any = { getPrefs: async () => prefs };
  const risk = new RiskService(cfg, settingsStub, memoryStub);
  const result = await risk.buildCard(draft, snapshot, 'manual');

  if (result.status === 'ok') {
    console.log('\n' + renderTradeCard(result.card, { title: '🧪 SİMÜLASYON KARTI' }).replace(/<[^>]+>/g, ''));
  } else {
    console.log('\n' + renderNoTrade((result as any).userMessage || (result as any).reason).replace(/<[^>]+>/g, ''));
  }

  console.log('\n════════ 4) KILL SWITCH SİMÜLASYONU (bakiye 650) ════════');
  const poorStub: any = { ...settingsStub, getBalance: async () => 650, isKillSwitchTripped: async () => true };
  const risk2 = new RiskService(cfg, poorStub, memoryStub);
  const res2 = await risk2.buildCard(draft, snapshot, 'manual');
  console.log(`Sonuç: ${res2.status} — ${(res2 as any).userMessage?.replace(/<[^>]+>/g, '').split('\n')[0]}`);

  console.log('\n✅ Uçtan uca simülasyon tamam — karar hattı canlı veriyle çalışıyor.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Simülasyon BAŞARISIZ:', e);
  process.exit(1);
});
