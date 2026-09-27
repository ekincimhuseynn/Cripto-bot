import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Candle, Ticker } from '../../common/types';
import { httpJson, Interval, isUsdtPair, MarketDataProvider } from './provider.interface';

/**
 * YEDEK 2: Bybit V5 linear perpetual.
 * Bazı bölgelerde/sunucularda 403 dönebilir; zincirde OKX'ten sonra gelir.
 */
@Injectable()
export class BybitProvider implements MarketDataProvider {
  readonly name = 'BYBIT';
  readonly isPerp = true;
  private readonly log = new Logger(this.name);
  private readonly base = 'https://api.bybit.com';

  constructor(private readonly cfg: ConfigService) {}

  private get timeout() {
    return this.cfg.get<number>('market.requestTimeoutMs');
  }

  async ping(): Promise<boolean> {
    try {
      await httpJson(`${this.base}/v5/market/time`, this.timeout);
      return true;
    } catch (e) {
      this.log.warn(`Bybit erişilemedi: ${e.message}`);
      return false;
    }
  }

  async getTickers(): Promise<Ticker[]> {
    const res = await httpJson(`${this.base}/v5/market/tickers?category=linear`, this.timeout);
    if (res.retCode !== 0) throw new Error(`Bybit hatası: ${res.retCode} ${res.retMsg}`);
    const out: Ticker[] = [];
    for (const t of res.result?.list || []) {
      if (!isUsdtPair(t.symbol)) continue;
      const price = parseFloat(t.lastPrice);
      const qv = parseFloat(t.turnover24h);
      const pct = parseFloat(t.price24hPcnt); // oran: 0.032 = %3.2
      if (!isFinite(price) || price <= 0) continue;
      out.push({
        symbol: t.symbol.toUpperCase(),
        price,
        change24hPct: isFinite(pct) ? pct * 100 : 0,
        quoteVolume: isFinite(qv) ? qv : 0,
        high24h: parseFloat(t.highPrice24h),
        low24h: parseFloat(t.lowPrice24h),
        source: this.name,
        isPerp: true,
      });
    }
    return out;
  }

  async getCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
    const iv = interval === '15m' ? '15' : interval === '1h' ? '60' : '240';
    const res = await httpJson(
      `${this.base}/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${Math.min(limit, 1000)}`,
      this.timeout,
    );
    if (res.retCode !== 0) throw new Error(`Bybit kline hatası: ${res.retCode} ${res.retMsg}`);
    // [start, open, high, low, close, volume, turnover] — YENİDEN ESKİYE → çevir
    const rows: Candle[] = (res.result?.list || []).map((k: any[]) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]) || 0,
    }));
    rows.reverse();
    return rows;
  }

  async getFundingRate(symbol: string): Promise<number | null> {
    try {
      const res = await httpJson(
        `${this.base}/v5/market/tickers?category=linear&symbol=${symbol}`,
        this.timeout,
      );
      const r = parseFloat(res.result?.list?.[0]?.fundingRate);
      return isFinite(r) ? r : null;
    } catch {
      return null;
    }
  }
}
