import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapLimit } from '../common/format';
import {
  AssetContext,
  Candle,
  MarketSnapshot,
  Mover,
  Ticker,
} from '../common/types';
import { changeOver, summarize } from './indicators';
import { BinanceFuturesProvider } from './providers/binance-futures.provider';
import { BinanceVisionProvider } from './providers/binance-vision.provider';
import { BybitProvider } from './providers/bybit.provider';
import { FearGreedProvider } from './providers/fear-greed.provider';
import { OkxProvider } from './providers/okx.provider';
import { Interval, MarketDataProvider } from './providers/provider.interface';

/**
 * Piyasa verisi cephesi:
 *  - Kaynak zinciri: BINANCE_FUTURES → OKX → BYBIT → BINANCE_VISION (.env'de sıralanabilir)
 *  - İlk erişilebilen kaynak seçilir, 5 dk boyunca ona sadık kalınır (cooldown ile)
 *  - Ticker/FNG/snapshot önbellekleri rate-limit'i korur
 *  - İki aşamalı tarama: 50 coin ticker → shortlist'e detaylı mum/indikatör analizi
 */
@Injectable()
export class MarketService {
  private readonly log = new Logger(MarketService.name);

  private providers: MarketDataProvider[];
  private activeProvider: MarketDataProvider | null = null;
  private failedAt = new Map<string, number>();

  private tickerCache: { at: number; tickers: Ticker[]; source: string } | null = null;
  private snapshotCache: { at: number; snapshot: MarketSnapshot } | null = null;

  constructor(
    private readonly cfg: ConfigService,
    private readonly binanceFutures: BinanceFuturesProvider,
    private readonly okx: OkxProvider,
    private readonly bybit: BybitProvider,
    private readonly binanceVision: BinanceVisionProvider,
    private readonly fearGreed: FearGreedProvider,
  ) {
    const byName: Record<string, MarketDataProvider> = {
      BINANCE_FUTURES: binanceFutures,
      OKX: okx,
      BYBIT: bybit,
      BINANCE_VISION: binanceVision,
    };
    this.providers = cfg
      .get<string[]>('market.sourcePriority')
      .map((n) => byName[n])
      .filter(Boolean);
    if (this.providers.length === 0) this.providers = [binanceFutures, okx, bybit, binanceVision];
  }

  /** Sıradaki erişilebilir kaynağı bul (önbellekli seçim + cooldown) */
  private async resolveProvider(): Promise<MarketDataProvider> {
    const cooldown = this.cfg.get<number>('market.providerCooldownMs');
    if (this.activeProvider) {
      const failed = this.failedAt.get(this.activeProvider.name);
      if (!failed || Date.now() - failed > cooldown) return this.activeProvider;
    }
    for (const p of this.providers) {
      const failed = this.failedAt.get(p.name);
      if (failed && Date.now() - failed < cooldown) continue;
      if (await p.ping()) {
        if (this.activeProvider?.name !== p.name) {
          this.log.log(`Veri kaynağı: ${p.name}${p.isPerp ? ' (vadeli)' : ' (spot)'}`);
        }
        this.activeProvider = p;
        this.failedAt.delete(p.name);
        return p;
      }
      this.failedAt.set(p.name, Date.now());
    }
    // Hepsi cooldown'da → cooldown'u beklemeden sırayla son bir deneme
    for (const p of this.providers) {
      if (await p.ping()) {
        this.activeProvider = p;
        this.failedAt.delete(p.name);
        return p;
      }
    }
    throw new Error('Hiçbir piyasa verisi kaynağına erişilemiyor (internet/bölge kontrol et)');
  }

  private async withFallback<T>(op: (p: MarketDataProvider) => Promise<T>, what: string): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < this.providers.length + 1; attempt++) {
      const p = await this.resolveProvider();
      try {
        return await op(p);
      } catch (e) {
        lastErr = e;
        this.failedAt.set(p.name, Date.now());
        this.log.warn(`${what} → ${p.name} başarısız: ${e.message} (yedek kaynağa geçiliyor)`);
      }
    }
    throw lastErr || new Error(`${what}: tüm kaynaklar tükendi`);
  }

  /** Tüm USDT paritelerinin 24 saatlik verisi (45sn önbellek) */
  async getTickers(): Promise<{ tickers: Ticker[]; source: string }> {
    const ttl = this.cfg.get<number>('scan.tickerCacheMs');
    if (this.tickerCache && Date.now() - this.tickerCache.at < ttl) {
      return { tickers: this.tickerCache.tickers, source: this.tickerCache.source };
    }
    const { tickers, source } = await this.withFallback(async (p) => {
      const t = await p.getTickers();
      if (t.length < 20) throw new Error(`${p.name} sadece ${t.length} parite döndürdü`);
      return { tickers: t, source: p.name };
    }, 'getTickers');
    this.tickerCache = { at: Date.now(), tickers, source };
    return this.tickerCache;
  }

  async getCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
    return this.withFallback((p) => p.getCandles(symbol, interval, limit), `getCandles(${symbol},${interval})`);
  }

  async getFundingRate(symbol: string): Promise<number | null> {
    try {
      const p = await this.resolveProvider();
      return await p.getFundingRate(symbol);
    } catch {
      return null;
    }
  }

  /** En yüksek hacimli 50 coin */
  async getTop50(): Promise<{ list: Ticker[]; source: string }> {
    const { tickers, source } = await this.getTickers();
    const list = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 50);
    return { list, source };
  }

  /**
   * Shortlist seçimi: BTC/ETH/SOL her zaman + en çok hareket edenler (mutlak 24s değişim)
   * + en hacimlilerden takviye.
   */
  private pickShortlist(top50: Ticker[]): Ticker[] {
    const limit = this.cfg.get<number>('scan.shortlist');
    const majors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const picked = new Map<string, Ticker>();
    for (const m of majors) {
      const t = top50.find((x) => x.symbol === m);
      if (t) picked.set(m, t);
    }
    // Mutlak değişime göre en hareketliler
    const byMove = [...top50].sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));
    for (const t of byMove) {
      if (picked.size >= limit) break;
      picked.set(t.symbol, t);
    }
    // Hacme göre takviye
    for (const t of top50) {
      if (picked.size >= limit) break;
      picked.set(t.symbol, t);
    }
    return [...picked.values()].slice(0, limit);
  }

  /** Bir varlık için detaylı indikatör bağlamı üret */
  async buildAssetContext(t: Ticker): Promise<AssetContext | null> {
    try {
      const [h1, m15, funding] = await Promise.all([
        this.getCandles(t.symbol, '1h', 210),
        this.getCandles(t.symbol, '15m', 100),
        this.getFundingRate(t.symbol),
      ]);
      const s1h = summarize(h1);
      const s15m = summarize(m15);
      if (!s1h) return null;
      return {
        symbol: t.symbol,
        price: h1[h1.length - 1]?.close ?? t.price,
        change24hPct: t.change24hPct,
        quoteVolume: t.quoteVolume,
        fundingRate: funding,
        tf: { '1h': s1h, ...(s15m ? { '15m': s15m } : {}) },
        change1hPct: changeOver(h1, 1),
        change15mPct: changeOver(m15, 1),
      };
    } catch (e) {
      this.log.warn(`${t.symbol} detay analizi atlandı: ${e.message}`);
      return null;
    }
  }

  /** Sert hareket tespiti */
  private detectMovers(top50: Ticker[], detailed: AssetContext[]): Mover[] {
    const a1h = this.cfg.get<number>('patrol.alert1hPct');
    const a15m = this.cfg.get<number>('patrol.alert15mPct');
    const a24h = this.cfg.get<number>('patrol.alert24hPct');
    const movers: Mover[] = [];
    const seen = new Set<string>();
    for (const d of detailed) {
      if (seen.has(d.symbol)) continue;
      if (d.change15mPct != null && Math.abs(d.change15mPct) >= a15m) {
        seen.add(d.symbol);
        movers.push({
          symbol: d.symbol,
          reason: `15dk: ${d.change15mPct > 0 ? '+' : ''}${d.change15mPct.toFixed(2)}%`,
          severity: Math.abs(d.change15mPct) >= a15m * 1.8 ? 'YUKSEK' : 'ORTA',
        });
        continue;
      }
      if (d.change1hPct != null && Math.abs(d.change1hPct) >= a1h) {
        seen.add(d.symbol);
        movers.push({
          symbol: d.symbol,
          reason: `1s: ${d.change1hPct > 0 ? '+' : ''}${d.change1hPct.toFixed(2)}%`,
          severity: Math.abs(d.change1hPct) >= a1h * 1.6 ? 'YUKSEK' : 'ORTA',
        });
      }
    }
    for (const t of top50) {
      if (seen.has(t.symbol)) continue;
      if (Math.abs(t.change24hPct) >= a24h) {
        seen.add(t.symbol);
        movers.push({
          symbol: t.symbol,
          reason: `24s: ${t.change24hPct > 0 ? '+' : ''}${t.change24hPct.toFixed(2)}%`,
          severity: Math.abs(t.change24hPct) >= a24h * 1.5 ? 'YUKSEK' : 'ORTA',
        });
      }
    }
    return movers.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'YUKSEK' ? -1 : 1));
  }

  /**
   * TAM TARAMA: 50 coin + majörler + FNG + shortlist detay analizi.
   * 30sn önbellekli (arka arkaya "tara" komutları API'yi dövmez).
   */
  async getFullSnapshot(opts: { force?: boolean; focusSymbol?: string } = {}): Promise<MarketSnapshot> {
    const ttl = this.cfg.get<number>('scan.snapshotCacheMs');
    if (!opts.force && this.snapshotCache && Date.now() - this.snapshotCache.at < ttl) {
      return this.snapshotCache.snapshot;
    }

    const [{ list: top50, source }, fg] = await Promise.all([this.getTop50(), this.fearGreed.get()]);

    const shortlist = this.pickShortlist(top50);
    // Kullanıcı belirli bir coin sorduysa shortlist'e zorla ekle
    if (opts.focusSymbol) {
      const fs = opts.focusSymbol.toUpperCase();
      const t = top50.find((x) => x.symbol === fs) || (await this.getTickers()).tickers.find((x) => x.symbol === fs);
      if (t && !shortlist.some((x) => x.symbol === t.symbol)) shortlist.unshift(t);
    }

    const conc = this.cfg.get<number>('scan.concurrency');
    const detailed = (await mapLimit(shortlist, conc, (t) => this.buildAssetContext(t))).filter(Boolean);

    const snapshot: MarketSnapshot = {
      time: new Date().toISOString(),
      source,
      fearGreed: fg,
      majors: {
        btc: top50.find((t) => t.symbol === 'BTCUSDT') || null,
        eth: top50.find((t) => t.symbol === 'ETHUSDT') || null,
        sol: top50.find((t) => t.symbol === 'SOLUSDT') || null,
      },
      top50,
      detailed,
      movers: this.detectMovers(top50, detailed),
    };
    this.snapshotCache = { at: Date.now(), snapshot };
    return snapshot;
  }

  /** Hızlı fiyat özeti (/fiyat komutu için — detaylı analiz yok) */
  async getQuickSummary(): Promise<{ majors: MarketSnapshot['majors']; fg: any; source: string; top50: Ticker[] }> {
    const [{ list: top50, source }, fg] = await Promise.all([this.getTop50(), this.fearGreed.get()]);
    return {
      majors: {
        btc: top50.find((t) => t.symbol === 'BTCUSDT') || null,
        eth: top50.find((t) => t.symbol === 'ETHUSDT') || null,
        sol: top50.find((t) => t.symbol === 'SOLUSDT') || null,
      },
      fg,
      source,
      top50,
    };
  }

  /** Sağlık durumu: hangi kaynak aktif, son hata durumu */
  async status(): Promise<{ active: string | null; failed: Record<string, string>; chain: string[] }> {
    return {
      active: this.activeProvider?.name || null,
      failed: Object.fromEntries([...this.failedAt.entries()].map(([k, v]) => [k, new Date(v).toISOString()])),
      chain: this.providers.map((p) => p.name),
    };
  }
}
