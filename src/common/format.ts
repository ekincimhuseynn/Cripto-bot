/**
 * Sayı/metin biçimlendirme yardımcıları (Türkçe format).
 */

const trFmt = (maxDigits: number) =>
  new Intl.NumberFormat('tr-TR', { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 });

/** Fiyata göre uygun ondalıkla sayı biçimlendir (tr-TR: 84.565,94) */
export function fmtPrice(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return trFmt(1).format(n);
  if (abs >= 100) return trFmt(2).format(n);
  if (abs >= 1) return trFmt(3).format(n);
  if (abs >= 0.01) return trFmt(5).format(n);
  return trFmt(8).format(n);
}

/** USDT tutarı biçimlendir: 1.234,56 $ */
export function fmtUsdt(n: number): string {
  if (!isFinite(n)) return '—';
  return `${trFmt(2).format(n)} USDT`;
}

/** İşaretli yüzde biçimlendir: +%3,25 / −%1,80 */
export function fmtPct(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}%${trFmt(digits).format(Math.abs(n))}`;
}

/** İşaretsiz yüzde (oranlar için): %15 / %7,5 */
export function fmtPctPlain(n: number, digits = 1): string {
  if (!isFinite(n)) return '—';
  return `%${trFmt(digits).format(n)}`;
}

/** Düz sayı (tr-TR ondalık): 2,00 */
export function fmtNum(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  return trFmt(digits).format(n);
}

/** Miktar (coin adedi) biçimlendir */
export function fmtQty(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return trFmt(1).format(n);
  if (abs >= 1) return trFmt(3).format(n);
  return trFmt(6).format(n);
}

/** Telegram HTML için escape */
export function escapeHtml(s: string): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Kısa sembol: BTCUSDT → BTC */
export function baseAsset(symbol: string): string {
  return symbol.replace(/USDT$/i, '').toUpperCase();
}

/** Türkçe tarih-saat (Europe/Istanbul) */
export function fmtDateTime(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(d);
}

/** Basit eşzamanlılık sınırlayıcı (rate-limit koruması için) */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Sayıyı belirli basamağa yuvarla */
export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Metinden JSON bloğu çıkar (kod çiti, ön/son ek metne dayanıklı) */
export function extractJson(text: string): any {
  if (!text) throw new Error('Boş LLM yanıtı');
  let t = text.trim();
  // ```json ... ``` çitlerini temizle
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Doğrudan dene
  try {
    return JSON.parse(t);
  } catch {
    // İlk { ile son } arasını al (dengeli parantez taraması)
    const start = t.indexOf('{');
    if (start === -1) throw new Error('Yanıtta JSON bulunamadı');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const slice = t.slice(start, i + 1);
          return JSON.parse(slice); // hata fırlatırsa çağıran yakalar
        }
      }
    }
    throw new Error('JSON dengeli değil / sonlanmıyor');
  }
}
