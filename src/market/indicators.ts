import { Candle, IndicatorSet } from '../common/types';
import { round } from '../common/format';

export { round };

/**
 * Saf fonksiyonlarla teknik indikatör hesapları.
 * Mum dizisi ESKİDEN YENİYE sıralı kabul edilir.
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** EMA serisi üretir (SMA tohumlu). Dizi eskiden yeniye. */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  if (values.length < period) {
    // Yeterli veri yoksa SMA ile tek değer
    const s = values.reduce((a, b) => a + b, 0) / values.length;
    return new Array(values.length).fill(s);
  }
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(null as any);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function ema(values: number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

/** Wilder RSI (14) */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Wilder ATR (14) */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
  }
  return a;
}

export interface MacdResult {
  macd: number;
  signal: number;
  hist: number;
}

export function macd(closes: number[], fast = 12, slow = 26, signalP = 9): MacdResult | null {
  if (closes.length < slow + signalP) return null;
  const fastS = emaSeries(closes, fast);
  const slowS = emaSeries(closes, slow);
  const macdLine: number[] = [];
  for (let i = slow - 1; i < closes.length; i++) {
    macdLine.push(fastS[i] - slowS[i]);
  }
  const signalS = emaSeries(macdLine, signalP);
  const m = macdLine[macdLine.length - 1];
  const s = signalS[signalS.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  pctB: number;
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  const pctB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { upper, middle: mid, lower, pctB };
}

/** Son mum hacmi / önceki 20 mumun ortalaması */
export function volumeRatio(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null;
  const prev = candles.slice(-(period + 1), -1);
  const avg = prev.reduce((a, c) => a + c.volume, 0) / period;
  if (avg === 0) return null;
  return candles[candles.length - 1].volume / avg;
}

/** Bir mum dizisinden tam gösterge seti çıkarır */
export function summarize(candles: Candle[]): IndicatorSet | null {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = candles.length >= 200 ? ema(closes, 200) : null;
  const a = atr(candles, 14);
  const m = macd(closes);
  const bb = bollinger(closes);
  const vr = volumeRatio(candles);
  const r = rsi(closes);
  const prev = closes[closes.length - 2] ?? last;
  return {
    rsi14: r != null ? round(r, 1) : 50,
    ema20: round(e20, 8),
    ema50: round(e50, 8),
    ema200: e200 != null ? round(e200, 8) : null,
    atr14: a != null ? round(a, 8) : round(last * 0.01, 8),
    atrPct: a != null ? round((a / last) * 100, 2) : 1,
    macd: m ? round(m.macd, 8) : 0,
    macdSignal: m ? round(m.signal, 8) : 0,
    macdHist: m ? round(m.hist, 8) : 0,
    bbUpper: bb ? round(bb.upper, 8) : round(last * 1.02, 8),
    bbLower: bb ? round(bb.lower, 8) : round(last * 0.98, 8),
    bbMiddle: bb ? round(bb.middle, 8) : last,
    bbPctB: bb ? round(bb.pctB, 3) : 0.5,
    volRatio: vr != null ? round(vr, 2) : 1,
    changePct: round(((last - prev) / prev) * 100, 2),
    trendUp: e200 != null ? last > e50 && e50 > e200 : last > e50,
  };
}

/** Son N mumdaki değişim yüzdesi */
export function changeOver(candles: Candle[], n: number): number | null {
  if (candles.length < n + 1) return null;
  const now = candles[candles.length - 1].close;
  const then = candles[candles.length - 1 - n].close;
  if (!then) return null;
  return ((now - then) / then) * 100;
}
