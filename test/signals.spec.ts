import { SignalLogService } from '../src/scanner/signal-log.service';
import { renderAlert, renderNoTrade, renderTradeCard } from '../src/risk/trade-card';
import { ValidatedCard } from '../src/common/types';

/** Sahte repository ile dedupe mantığı */
function makeSignalService(rows: Array<{ type: string; symbol?: string; direction?: string; createdAt: Date }>) {
  const repo = {
    create: (x: any) => x,
    save: async (x: any) => {
      rows.push({ ...x, createdAt: new Date() });
      return x;
    },
    count: async ({ where }: any) => {
      // Basit eşleştirme: type(In), symbol, direction, createdAt(MoreThan)
      const types: string[] = where.type?._value || [where.type];
      const since: Date = where.createdAt?._value;
      return rows.filter(
        (r) =>
          types.includes(r.type) &&
          (!where.symbol || r.symbol === where.symbol) &&
          (!where.direction || r.direction === where.direction) &&
          (!since || r.createdAt > since),
      ).length;
    },
    find: async () => rows.slice(0, 12),
  };
  return new SignalLogService(repo as any);
}

describe('SignalLogService — spam önleme (dedupe)', () => {
  test('aynı coin+yön 6 saat içinde gönderildiyse duplicate=true', async () => {
    const svc = makeSignalService([
      { type: 'TRADE', symbol: 'BTCUSDT', direction: 'LONG', createdAt: new Date(Date.now() - 2 * 3600_000) },
    ]);
    expect(await svc.isDuplicateTrade('BTCUSDT', 'LONG', 6)).toBe(true);
  });

  test('aynı coin TERS yönse duplicate=false (yeni fırsat)', async () => {
    const svc = makeSignalService([
      { type: 'TRADE', symbol: 'BTCUSDT', direction: 'LONG', createdAt: new Date(Date.now() - 2 * 3600_000) },
    ]);
    expect(await svc.isDuplicateTrade('BTCUSDT', 'SHORT', 6)).toBe(false);
  });

  test('pencere dışında kaldıysa duplicate=false', async () => {
    const svc = makeSignalService([
      { type: 'TRADE', symbol: 'SOLUSDT', direction: 'SHORT', createdAt: new Date(Date.now() - 8 * 3600_000) },
    ]);
    expect(await svc.isDuplicateTrade('SOLUSDT', 'SHORT', 6)).toBe(false);
  });

  test('manuel kartlar da nöbet dedupesini besler (MANUAL_TRADE)', async () => {
    const svc = makeSignalService([
      { type: 'MANUAL_TRADE', symbol: 'ETHUSDT', direction: 'LONG', createdAt: new Date(Date.now() - 1 * 3600_000) },
    ]);
    expect(await svc.isDuplicateTrade('ETHUSDT', 'LONG', 6)).toBe(true);
  });

  test('uyarı cooldown', async () => {
    const svc = makeSignalService([
      { type: 'ALERT', symbol: 'DOGEUSDT', createdAt: new Date(Date.now() - 10 * 60_000) },
    ]);
    expect(await svc.isDuplicateAlert('DOGEUSDT', 60)).toBe(true);
    expect(await svc.isDuplicateAlert('SHIBUSDT', 60)).toBe(false);
  });

  test('log() yeni kayıt ekler', async () => {
    const rows: any[] = [];
    const svc = makeSignalService(rows);
    await svc.log({ type: 'TRADE', symbol: 'XRPUSDT', direction: 'SHORT', confidence: 7 });
    expect(rows.length).toBe(1);
    expect(rows[0].symbol).toBe('XRPUSDT');
  });
});

describe('İşlem kartı render — 9 zorunlu alan', () => {
  const card: ValidatedCard = {
    draft: {} as any,
    symbol: 'BTCUSDT',
    direction: 'LONG',
    leverage: 3,
    marginUsdt: 100,
    marginPctOfBalance: 10,
    entryPrice: 84000,
    stopLoss: 82500,
    takeProfit: 87000,
    confidence: 8,
    rationale: 'EMA kesişimi + hacim artışı.',
    quantity: 0.00357,
    notionalUsdt: 300,
    potentialProfitUsdt: 10.71,
    potentialProfitPctOfMargin: 10.7,
    riskUsdt: 5.36,
    riskRewardRatio: 2,
    stopDistancePct: 1.79,
    tpDistancePct: 3.57,
    estimatedLiquidation: 56000,
    marketPriceAtValidation: 84000,
    warnings: ['Test uyarısı'],
    market: { fearGreed: { value: 70, label: 'Greed', labelTr: 'Açgözlülük', source: 'x' }, dataSource: 'OKX', change24hPct: 1.2 },
  };

  test('kartta 9 alanın tamamı görünür', () => {
    const t = renderTradeCard(card);
    expect(t).toContain('BTCUSDT'); // 1. parite
    expect(t).toContain('LONG'); // 1. yön
    expect(t).toContain('3x'); // 2. kaldıraç
    expect(t).toContain('ISOLATED'); // 2. isolated uyarısı
    expect(t).toContain('100,00 USDT'.replace('100,00', '100')); // 3. margin (esnek eşleşme aşağıda)
    expect(t).toMatch(/Margin/); // 3.
    expect(t).toMatch(/Giriş/); // 4.
    expect(t).toMatch(/Stop-Loss/); // 5.
    expect(t).toMatch(/Take-Profit/); // 6.
    expect(t).toContain('8/10'); // 7. güven
    expect(t).toMatch(/Potansiyel Kazanç/); // 8.
    expect(t).toContain('EMA kesişimi'); // 9. gerekçe
    expect(t).toContain('Martingale YOK'); // değişmez kurallar hatırlatması
  });

  test('"işlem yok" mesajı kaptan ağzıyla', () => {
    const t = renderNoTrade('Piyasa yatay, sinyal zayıf.');
    expect(t).toContain('ŞU AN İŞLEM YOK');
    expect(t).toContain('yatay');
  });

  test('uyarı mesajı sembol ve ciddiyet içerir', () => {
    const t = renderAlert({ symbol: 'SOLUSDT', severity: 'YUKSEK', message: '15dk %4 pump!' }, 'Piyasa hareketli.');
    expect(t).toContain('SOLUSDT');
    expect(t).toContain('YUKSEK');
    expect(t).toContain('NÖBET RAPORU');
  });

  test('HTML enjeksiyonu gerekçede escape edilir', () => {
    const evil = { ...card, rationale: '<script>hack</script>' };
    const t = renderTradeCard(evil);
    expect(t).not.toContain('<script>');
  });
});
