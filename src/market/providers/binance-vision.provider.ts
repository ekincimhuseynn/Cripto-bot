import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Candle, Ticker } from '../../common/types';
import { httpJson, Interval, isUsdtPair, MarketDataProvider } from './provider.interface';

/**
 * SON ÇARE: Binance SPOT genel veri aynası (data-api.binance.vision).
 * Coğrafi kısıtı yoktur; vadeli değil spot fiyat verir (kaldıraçlı kart
 * üretilirken fiyat referansı olarak yine güvenilirdir, funding yoktur).
 */
@Injectable()
export class BinanceVisionProvider implements MarketDataProvider {
  readonly name = 'BINANCE_VISION';
  readonly isPerp = false;
  private readonly log = new Logger(this.name);
  private readonly base = 'https://data-api.binance.vision';

  constructor(private readonly cfg: ConfigService) {}

  private get timeout() {
    return this.cfg.get<number>('market.requestTimeoutMs');
  }

  async ping(): Promise<boolean> {
    try {
      await httpJson(`${this.base}/api/v3/ping`, this.timeout);
      return true;
    } catch (e) {
      this.log.warn(`Binance Vision erişilemedi: ${e.message}`);
      return false;
    }
  }

  async getTickers(): Promise<Ticker[]> {
    const data = await httpJson(`${this.base}/api/v3/ticker/24hr`, this.timeout);
    const out: Ticker[] = [];
    for (const t of data) {
      if (!isUsdtPair(t.symbol)) continue;
      const price = parseFloat(t.lastPrice);
      const qv = parseFloat(t.quoteVolume);
      if (!isFinite(price) || price <= 0 || !isFinite(qv)) continue;
      out.push({
        symbol: t.symbol.toUpperCase(),
        price,
        change24hPct: parseFloat(t.priceChangePercent) || 0,
        quoteVolume: qv,
        high24h: parseFloat(t.highPrice),
        low24h: parseFloat(t.lowPrice),
        source: this.name,
        isPerp: false,
      });
    }
    return out;
  }

  async getCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
    const data = await httpJson(
      `${this.base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      this.timeout,
    );
    return data.map((k: any[]) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async getFundingRate(): Promise<number | null> {
    return null; // spot — funding yok
  }
}
