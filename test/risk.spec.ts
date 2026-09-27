import { RiskService } from '../src/risk/risk.service';
import { MarketSnapshot, TradeCardDraft, TradingPrefs } from '../src/common/types';

/** Sahte bağımlılıklarla RiskService kurar */
function makeService(opts: { balance?: number; threshold?: number; prefs?: Partial<TradingPrefs> } = {}) {
  const balance = opts.balance ?? 1000;
  const threshold = opts.threshold ?? 700;
  const prefs: TradingPrefs = {
    maxLeverage: 10,
    maxMarginPct: 50,
    minConfidence: 6,
    avoidSymbols: [],
    preferSymbols: [],
    activeInstructions: [],
    ...(opts.prefs || {}),
  };
  const cfg = {
    get: (key: string) => {
      if (key === 'risk.minMarginUsdt') return 5;
      if (key === 'patrol.minConfidence') return 7;
      return undefined;
    },
  };
  const settings = {
    getBalance: async () => balance,
    getKillThreshold: async () => threshold,
    isKillSwitchTripped: async () => balance < threshold,
  };
  const memory = { getPrefs: async () => prefs };
  const svc = new RiskService(cfg as any, settings as any, memory as any);
  return svc;
}

function snapshot(price = 84000): MarketSnapshot {
  const btc = { symbol: 'BTCUSDT', price, change24hPct: 1.2, quoteVolume: 5e9, source: 'TEST', isPerp: true };
  return {
    time: new Date().toISOString(),
    source: 'TEST',
    fearGreed: { value: 55, label: 'Neutral', labelTr: 'Nötr', source: 'test' },
    majors: { btc, eth: null, sol: null },
    top50: [btc],
    detailed: [],
    movers: [],
  };
}

function goodDraft(over: Partial<TradeCardDraft> = {}): TradeCardDraft {
  return {
    action: 'TRADE',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    leverage: 3,
    margin_usdt: 100,
    entry_price: 84000,
    stop_loss: 82500,
    take_profit: 87000,
    confidence: 8,
    rationale: 'Test gerekçesi',
    ...over,
  };
}

describe('RiskService — DEĞİŞMEZ KURALLAR', () => {
  test('geçerli LONG kartı onaylanır ve matematik doğru hesaplanır', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft(), snapshot(84000), 'manual');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const c = res.card;
    expect(c.notionalUsdt).toBeCloseTo(300, 2); // 100 * 3
    expect(c.quantity).toBeCloseTo(300 / 84000, 6);
    // TP: 87000 → %3.571 mesafe → kâr = 300 * 0.035714 ≈ 10.71
    expect(c.potentialProfitUsdt).toBeCloseTo(10.71, 1);
    // SL: 82500 → %1.786 → risk = 300 * 0.017857 ≈ 5.36
    expect(c.riskUsdt).toBeCloseTo(5.36, 1);
    expect(c.riskRewardRatio).toBeCloseTo(2, 1); // 3000/1500 = 2
    expect(c.marginPctOfBalance).toBeCloseTo(10, 1);
    expect(c.estimatedLiquidation).toBeCloseTo(84000 * (1 - 1 / 3), 0);
    expect(c.market.fearGreed?.value).toBe(55);
  });

  test('geçerli SHORT kartı onaylanır (SL üstte, TP altta)', async () => {
    const svc = makeService();
    const res = await svc.buildCard(
      goodDraft({ direction: 'SHORT', stop_loss: 85500, take_profit: 81000 }),
      snapshot(84000),
      'manual',
    );
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.card.estimatedLiquidation).toBeCloseTo(84000 * (1 + 1 / 3), 0);
      expect(res.card.potentialProfitUsdt).toBeGreaterThan(0);
    }
  });

  test('KILL SWITCH: bakiye < eşik → hiçbir kart geçmez', async () => {
    const svc = makeService({ balance: 650, threshold: 700 });
    const res = await svc.buildCard(goodDraft(), snapshot(), 'manual');
    expect(res.status).toBe('none');
    if (res.status === 'none') {
      expect(res.reason).toBe('kill_switch');
      expect(res.userMessage).toContain('KILL SWITCH');
    }
  });

  test('NO_TRADE taslağı "işlem yok" olarak geçer', async () => {
    const svc = makeService();
    const res = await svc.buildCard({ action: 'NO_TRADE', rationale: 'Piyasa çorba.' }, snapshot(), 'manual');
    expect(res.status).toBe('none');
    if (res.status === 'none') expect(res.userMessage).toContain('çorba');
  });

  test('kaldıraç 25x istenirse 10x tavanına KISITLANIR (değişmez kural)', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ leverage: 25 }), snapshot(), 'manual');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.card.leverage).toBe(10);
      expect(res.card.warnings.join(' ')).toContain('10x');
    }
  });

  test('kullanıcı talimatı max_leverage=5 ise 8x bile 5e indirilir', async () => {
    const svc = makeService({ prefs: { maxLeverage: 5 } });
    const res = await svc.buildCard(goodDraft({ leverage: 8 }), snapshot(), 'manual');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.card.leverage).toBe(5);
  });

  test('margin bakiyenin %50sini aşamaz (değişmez kural)', async () => {
    const svc = makeService({ balance: 1000 });
    const res = await svc.buildCard(goodDraft({ margin_usdt: 900 }), snapshot(), 'manual');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.card.marginUsdt).toBe(500);
      expect(res.card.marginPctOfBalance).toBeCloseTo(50, 5);
    }
  });

  test('SL/TP eksikse RED (değişmez kural) + düzeltme ipucu', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ stop_loss: undefined as any }), snapshot(), 'manual');
    expect(res.status).toBe('reject');
    if (res.status === 'reject') expect(res.retryHint).toContain('ZORUNLU');
  });

  test('LONG için SL girişin üstündeyse RED (ters taraf)', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ stop_loss: 85000 }), snapshot(), 'manual');
    expect(res.status).toBe('reject');
  });

  test('SHORT için TP girişin üstündeyse RED', async () => {
    const svc = makeService();
    const res = await svc.buildCard(
      goodDraft({ direction: 'SHORT', stop_loss: 85500, take_profit: 85000 }),
      snapshot(),
      'manual',
    );
    expect(res.status).toBe('reject');
  });

  test('güven < minimum → işlem yok', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ confidence: 4 }), snapshot(), 'manual');
    expect(res.status).toBe('none');
  });

  test('manuel modda güven 6 = geçerli, patrol modunda eşik 7 → yok', async () => {
    const svc = makeService();
    const manual = await svc.buildCard(goodDraft({ confidence: 6 }), snapshot(), 'manual');
    expect(manual.status).toBe('ok');
    const patrol = await svc.buildCard(goodDraft({ confidence: 6 }), snapshot(), 'patrol');
    expect(patrol.status).toBe('none');
  });

  test('listede olmayan sembol RED + düzeltme ipucu', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ symbol: 'FAKECOINUSDT' }), snapshot(), 'manual');
    expect(res.status).toBe('reject');
  });

  test('avoid_symbols talimatı → işlem yok', async () => {
    const svc = makeService({ prefs: { avoidSymbols: ['BTCUSDT'] } });
    const res = await svc.buildCard(goodDraft(), snapshot(), 'manual');
    expect(res.status).toBe('none');
    if (res.status === 'none') expect(res.userMessage).toContain('uzak durulan');
  });

  test('stop × kaldıraç ≥ %90 ise RED (stoptan önce likidasyon)', async () => {
    const svc = makeService();
    // %12 stop mesafesi × 10x = %120 → patlar
    const res = await svc.buildCard(goodDraft({ leverage: 10, stop_loss: 84000 * 0.88 }), snapshot(), 'manual');
    expect(res.status).toBe('reject');
  });

  test('bayat giriş fiyatı (> %2 sapma) canlı fiyatla değiştirilir + uyarı', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ entry_price: 80000 }), snapshot(84000), 'manual');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.card.entryPrice).toBe(84000);
      expect(res.card.warnings.join(' ')).toContain('canlı fiyata');
    }
  });

  test('çok düşük margin RED', async () => {
    const svc = makeService();
    const res = await svc.buildCard(goodDraft({ margin_usdt: 2 }), snapshot(), 'manual');
    expect(res.status).toBe('reject');
  });

  test('buildCardWithRetry: red durumunda düzeltme turu çağrılır ve düzeltilmiş kart geçer', async () => {
    const svc = makeService();
    let called = '';
    const res = await svc.buildCardWithRetry(
      goodDraft({ stop_loss: undefined as any }),
      snapshot(),
      'manual',
      async (hint) => {
        called = hint;
        return goodDraft(); // düzeltilmiş hali
      },
    );
    expect(called).toContain('ZORUNLU');
    expect(res.status).toBe('ok');
  });

  test('buildCardWithRetry: düzeltme de başarısızsa "işlem yok"a düşer', async () => {
    const svc = makeService();
    const res = await svc.buildCardWithRetry(goodDraft({ stop_loss: undefined as any }), snapshot(), 'manual', async () =>
      goodDraft({ take_profit: undefined as any }),
    );
    expect(res.status).toBe('none');
    if (res.status === 'none') expect(res.userMessage).toContain('iptal');
  });

  test('applyPnl bakiyeyi günceller ve kill switchi tetikler', async () => {
    const svc = makeService({ balance: 750, threshold: 700 });
    let stored = 750;
    (svc as any).settings = {
      getBalance: async () => stored,
      getKillThreshold: async () => 700,
      isKillSwitchTripped: async () => stored < 700,
      setBalance: async (n: number) => {
        stored = n;
      },
      refreshKillSwitch: async () => ({ tripped: stored < 700, newlyTripped: stored < 700 }),
    };
    const out = await svc.applyPnl(-60);
    expect(out.balance).toBeCloseTo(690, 2);
    expect(out.tripped).toBe(true);
  });
});
