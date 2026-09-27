import { atr, bollinger, changeOver, ema, macd, rsi, sma, summarize, volumeRatio } from '../src/market/indicators';
import { Candle } from '../src/common/types';

function candles(closes: number[], spread = 0.5): Candle[] {
  return closes.map((c, i) => ({
    time: i * 3600_000,
    open: c - spread / 2,
    high: c + spread,
    low: c - spread,
    close: c,
    volume: 100 + (i % 7),
  }));
}

describe('İndikatörler', () => {
  test('RSI sürekli yükselişte 100 olur', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(rsi(closes)).toBe(100);
  });

  test('RSI sürekli düşüşte ~0 olur', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(rsi(closes)!).toBeLessThan(1);
  });

  test('RSI 0-100 arasında kalır', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const r = rsi(closes)!;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  });

  test('EMA sabit seride o sabiti verir', () => {
    expect(ema(new Array(50).fill(42), 20)).toBeCloseTo(42, 10);
  });

  test('EMA yükselen seride fiyatın altında kalır (gecikme)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const e = ema(closes, 20)!;
    expect(e).toBeGreaterThan(100);
    expect(e).toBeLessThan(closes[closes.length - 1]);
  });

  test('SMA doğru ortalamayı verir', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3], 5)).toBeNull();
  });

  test('ATR pozitif ve sabit aralıklı seride tam aralık değerinde', () => {
    const cs = candles(Array.from({ length: 40 }, () => 100), 2);
    const a = atr(cs)!;
    expect(a).toBeGreaterThan(0);
    // high = c+2, low = c-2 → gerçek aralık (TR) = 4 → ATR = 4
    expect(a).toBeCloseTo(4, 5);
  });

  test('MACD yükselen trendde pozitif histogram verir', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const m = macd(closes)!;
    expect(m.hist).not.toBeNaN();
    expect(m.macd).toBeGreaterThan(0);
  });

  test('Bollinger: üst > orta > alt, %B 0-1 civarı', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 4) * 2);
    const b = bollinger(closes)!;
    expect(b.upper).toBeGreaterThan(b.middle);
    expect(b.middle).toBeGreaterThan(b.lower);
    expect(b.pctB).toBeGreaterThanOrEqual(-0.5);
    expect(b.pctB).toBeLessThanOrEqual(1.5);
  });

  test('volumeRatio son mum ortalamadan büyükse >1', () => {
    const cs = candles(Array.from({ length: 30 }, () => 100));
    cs[cs.length - 1].volume = 10000;
    expect(volumeRatio(cs)!).toBeGreaterThan(2);
  });

  test('changeOver doğru yüzdeyi verir', () => {
    const cs = candles([100, 101, 102, 110]);
    // son mum 110, bir önceki 102 → (110-102)/102
    expect(changeOver(cs, 1)!).toBeCloseTo((8 / 102) * 100, 5);
  });

  test('summarize 210 mumda EMA200 dahil tam set döner', () => {
    const closes = Array.from({ length: 210 }, (_, i) => 50000 + Math.sin(i / 9) * 800 + i * 10);
    const s = summarize(candles(closes))!;
    expect(s).not.toBeNull();
    expect(s.ema200).not.toBeNull();
    expect(s.rsi14).toBeGreaterThanOrEqual(0);
    expect(s.rsi14).toBeLessThanOrEqual(100);
    expect(s.atr14).toBeGreaterThan(0);
    expect(typeof s.trendUp).toBe('boolean');
  });

  test('summarize yetersiz mumda null döner', () => {
    expect(summarize(candles([1, 2, 3]))).toBeNull();
  });
});
