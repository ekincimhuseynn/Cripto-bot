import { escapeHtml, extractJson, fmtPct, fmtPrice, fmtUsdt, mapLimit, baseAsset } from '../src/common/format';

describe('extractJson — LLM yanıt ayrıştırma', () => {
  test('düz JSON', () => {
    expect(extractJson('{"action":"TRADE"}')).toEqual({ action: 'TRADE' });
  });

  test('markdown çitli JSON', () => {
    const raw = '```json\n{"action":"NO_TRADE","confidence":0}\n```';
    expect(extractJson(raw)).toEqual({ action: 'NO_TRADE', confidence: 0 });
  });

  test('önünde/sonunda metin olan JSON', () => {
    const raw = 'İşte kararım:\n{"action":"TRADE","symbol":"BTCUSDT"}\nUmarım işine yarar.';
    expect(extractJson(raw)).toEqual({ action: 'TRADE', symbol: 'BTCUSDT' });
  });

  test('string içinde süslü parantez varsa bozulmaz', () => {
    const raw = '{"rationale":"Formasyon {cup-handle} gibi görünüyor","confidence":7}';
    expect(extractJson(raw).rationale).toContain('{cup-handle}');
  });

  test('iç içe nesneler', () => {
    const raw = '{"trade":{"symbol":"ETHUSDT","leverage":3},"alerts":[]}';
    const j = extractJson(raw);
    expect(j.trade.symbol).toBe('ETHUSDT');
    expect(j.alerts).toEqual([]);
  });

  test('geçersiz metinde hata fırlatır', () => {
    expect(() => extractJson('selam nasılsın')).toThrow();
    expect(() => extractJson('')).toThrow();
  });
});

describe('Biçimlendirme', () => {
  test('fmtPrice büyük sayıyı tr-TR gruplar', () => {
    const s = fmtPrice(84565.94);
    expect(s).toMatch(/84[.\s]565/); // tr-TR: 84.565,9
  });

  test('fmtPrice küçük sayılarda hassasiyet korur', () => {
    expect(parseFloat(fmtPrice(0.00001234).replace(/\./g, '').replace(',', '.'))).toBeCloseTo(0.00001234, 10);
  });

  test('fmtUsdt birim ekler', () => {
    expect(fmtUsdt(1234.5)).toContain('USDT');
  });

  test('fmtPct işaret koyar', () => {
    expect(fmtPct(3.25)).toContain('+');
    expect(fmtPct(-1.5)).toContain('-');
  });

  test('escapeHtml', () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain('<script>');
  });

  test('baseAsset', () => {
    expect(baseAsset('BTCUSDT')).toBe('BTC');
    expect(baseAsset('1000SHIBUSDT')).toBe('1000SHIB');
  });
});

describe('mapLimit', () => {
  test('tüm sonuçları sırayla döner ve eşzamanlılığı sınırlar', async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
