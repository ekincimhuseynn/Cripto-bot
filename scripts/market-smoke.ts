/**
 * CANLI VERİ SMOKE TESTİ — Telegram/LLM olmadan sadece piyasa katmanını doğrular.
 * Çalıştır: npm run smoke
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { BinanceFuturesProvider } from '../src/market/providers/binance-futures.provider';
import { OkxProvider } from '../src/market/providers/okx.provider';
import { BybitProvider } from '../src/market/providers/bybit.provider';
import { BinanceVisionProvider } from '../src/market/providers/binance-vision.provider';
import { FearGreedProvider } from '../src/market/providers/fear-greed.provider';
import { summarize } from '../src/market/indicators';
import { fmtPrice } from '../src/common/format';

async function main() {
  // Elle kurulmuş mini "container" (Nest olmadan)
  const env = configuration();
  const cfg = { get: (path: string) => path.split('.').reduce((o: any, k) => o?.[k], env) } as unknown as ConfigService;

  const providers = [
    new BinanceFuturesProvider(cfg),
    new OkxProvider(cfg),
    new BybitProvider(cfg),
    new BinanceVisionProvider(cfg),
  ];

  console.log('════════ PING ════════');
  let active: any = null;
  for (const p of providers) {
    const ok = await p.ping();
    console.log(`${ok ? '✅' : '❌'} ${p.name}${p.isPerp ? ' (vadeli)' : ' (spot)'}`);
    if (ok && !active) active = p;
  }
  if (!active) {
    console.error('HİÇBİR KAYNAK ERİŞİLEBİLİR DEĞİL!');
    process.exit(1);
  }
  console.log(`\nSeçilen kaynak: ${active.name}`);

  console.log('\n════════ TICKERLAR (hacme göre ilk 10 / 50) ════════');
  const tickers = await active.getTickers();
  const top = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 50);
  console.log(`Toplam USDT paritesi: ${tickers.length} | Top50 listelendi:`);
  for (const t of top.slice(0, 10)) {
    console.log(`  ${t.symbol.padEnd(12)} $${fmtPrice(t.price).padStart(12)}  24s: ${t.change24hPct.toFixed(2).padStart(7)}%  hacim: ${(t.quoteVolume / 1e6).toFixed(0).padStart(6)}M$`);
  }

  const btc = top.find((t: any) => t.symbol === 'BTCUSDT');
  console.log('\n════════ BTCUSDT MUM + İNDİKATÖR ════════');
  const candles = await active.getCandles('BTCUSDT', '1h', 210);
  console.log(`Mum sayısı: ${candles.length} | son kapanış: $${fmtPrice(candles[candles.length - 1].close)}`);
  const s = summarize(candles)!;
  console.log(`RSI14: ${s.rsi14} | EMA20: ${fmtPrice(s.ema20)} | EMA50: ${fmtPrice(s.ema50)} | EMA200: ${s.ema200 ? fmtPrice(s.ema200) : '-'} | ATR%: ${s.atrPct} | MACD hist: ${s.macdHist} | trend: ${s.trendUp ? 'YUKARI' : 'AŞAĞI'}`);

  const funding = await active.getFundingRate('BTCUSDT');
  console.log(`Funding: ${funding != null ? (funding * 100).toFixed(4) + '%' : 'yok (spot kaynak)'}`);

  console.log('\n════════ KORKU/AÇGÖZLÜLÜK ════════');
  const fg = await new FearGreedProvider(cfg).get();
  console.log(fg ? `${fg.value}/100 — ${fg.labelTr} (${fg.source})` : 'alınamadı');

  console.log('\n✅ Smoke testi tamam — piyasa katmanı çalışıyor.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Smoke testi BAŞARISIZ:', e);
  process.exit(1);
});
