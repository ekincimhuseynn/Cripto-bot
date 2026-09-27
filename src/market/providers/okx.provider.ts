import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Candle, Ticker } from '../../common/types';
import { httpJson, Interval, MarketDataProvider } from './provider.interface';

/**
 * YEDEK 1: OKX USDT-M Perpetual Swaps.
 * Binance Futures engelli sunucularda gerçek vadeli veri sağlar.
 * instId formatı: BTC-USDT-SWAP → kanonik BTCUSDT
 */
@Injectable()
export class OkxProvider implements MarketDataProvider {
  readonly name = 'OKX';
  readonly isPerp = true;
  private readonly log = new Logger(this.name);
  private readonly base = 'https://www.okx.com';

  constructor(private readonly cfg: ConfigService) {}

  private get timeout() {
    return this.cfg.get<number>('market.requestTimeoutMs');
  }

  static toInstId(symbol: string): string {
    const base = symbol.replace(/USDT$/i, '');
    return `${base}-USDT-SWAP`;
  }

  static fromInstId(instId: string): string | null {
    const m = instId.match(/^([A-Z0-9]+)-USDT-SWAP$/);
    return m ? `${m[1]}USDT` : null;
  }

  async ping(): Promise<boolean> {
    try {
      await httpJson(`${this.base}/api/v5/public/time`, this.timeout);
      return true;
    } catch (e) {
      this.log.warn(`OKX erişilemedi: ${e.message}`);
      return false;
    }
  }

  async getTickers(): Promise<Ticker[]> {
    const res = await httpJson(`${this.base}/api/v5/market/tickers?instType=SWAP`, this.timeout);
    if (res.code !== '0') throw new Error(`OKX API hatası: ${res.code} ${res.msg}`);
    const out: Ticker[] = [];
    for (const t of res.data) {
      const symbol = OkxProvider.fromInstId(t.instId);
      if (!symbol) continue;
      const price = parseFloat(t.last);
      const open24 = parseFloat(t.open24h);
      // volCcy24h swaplerde baz coin cinsindendir → quote hacim ≈ volCcy24h * fiyat
      const volBase = parseFloat(t.volCcy24h);
      if (!isFinite(price) || price <= 0 || !isFinite(open24) || open24 <= 0) continue;
      out.push({
        symbol,
        price,
        change24hPct: ((price - open24) / open24) * 100,
        quoteVolume: isFinite(volBase) ? volBase * price : 0,
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        source: this.name,
        isPerp: true,
      });
    }
    return out;
  }

  async getCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
    const bar = interval === '15m' ? '15m' : interval === '1h' ? '1H' : '4H';
    const res = await httpJson(
      `${this.base}/api/v5/market/candles?instId=${OkxProvider.toInstId(symbol)}&bar=${bar}&limit=${Math.min(limit, 300)}`,
      this.timeout,
    );
    if (res.code !== '0') throw new Error(`OKX candles hatası: ${res.code} ${res.msg}`);
    // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] — YENİDEN ESKİYE gelir → çevir
    const rows: Candle[] = res.data.map((k: any[]) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[6]) || parseFloat(k[5]) || 0,
    }));
    rows.reverse();
    return rows;
  }

  async getFundingRate(symbol: string): Promise<number | null> {
    try {
      const res = await httpJson(
        `${this.base}/api/v5/public/funding-rate?instId=${OkxProvider.toInstId(symbol)}`,
        this.timeout,
      );
      if (res.code !== '0' || !res.data?.[0]) return null;
      const r = parseFloat(res.data[0].fundingRate);
      return isFinite(r) ? r : null;
    } catch {
      return null;
    }
  }
}
