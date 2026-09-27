import { Candle, Ticker } from '../../common/types';

export type Interval = '15m' | '1h' | '4h';

/**
 * Tüm piyasa verisi sağlayıcılarının ortak arayüzü.
 * Semboller kanonik formatta (BTCUSDT) alınır/döner.
 */
export interface MarketDataProvider {
  readonly name: string;
  /** Vadeli (perpetual) veri mi sunuyor? */
  readonly isPerp: boolean;

  /** Kaynak erişilebilir mi? */
  ping(): Promise<boolean>;

  /** Tüm USDT paritelerinin 24 saatlik özeti */
  getTickers(): Promise<Ticker[]>;

  /** Mum verisi (eskiden yeniye sıralı dönmeli) */
  getCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]>;

  /** Fonlama oranı (desteklemiyorsa null) */
  getFundingRate(symbol: string): Promise<number | null>;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Zaman aşımı + tarayıcı UA ile fetch. Bazı borsalar çıplak curl/node UA'sını 403'lüyor. */
export async function httpJson(url: string, timeoutMs = 10000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url.slice(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** USDT ile bitmeyen / anlamsız çiftleri ayıklar */
export function isUsdtPair(symbol: string): boolean {
  return /USDT$/i.test(symbol) && !/^(USDC|FDUSD|TUSD|BUSD|EUR|GBP)/i.test(symbol) && symbol.length <= 18;
}
