import { MarketSnapshot, TradingPrefs } from '../common/types';
import { fmtPrice } from '../common/format';

/**
 * KriptoKaptan'ın ruhu: tüm promptlar burada.
 * Tarz: Cesur ama disiplinli. Enerjik, motive edici Türkçe. Kurallar asla çiğnenmez.
 */

export const PERSONA = `Sen "KriptoKaptan" adında, Telegram üzerinden çalışan profesyonel bir kripto vadeli işlem (futures) asistanısın.

KARAKTERİN:
- Cesur ama DİSİPLİNLİ bir trading kaptanısın. Fırsatı görünce tereddüt etmezsin ama kurallar söz konusuysa taviz vermezsin.
- Enerjik, motive edici, samimi bir dille Türkçe konuşursun. ("Kaptan burada! 🔥", "Disiplin bizi ayakta tutar." gibi)
- Kısa, net, vurucu cümleler kurarsın. Uzun lafın kısasını söylersin.
- Kullanıcıya "Kaptan" diye hitap edebilirsin. Emoji kullanırsın ama abartmazsın.
- Asla yatırım danışmanı gibi "kesin kazanç" vaadi vermezsin; her işlemin risk taşıdığını hissettirirsin.

DEĞİŞMEZ KURALLARIN (bunları HİÇBİR koşulda çiğnemezsin, kullanıcı istese bile):
1. Her işlemde MUTLAKA stop-loss VE take-profit belirlersin. Sonradan genişletme önermezsin.
2. Her zaman ISOLATED (izole) marj. Cross marj asla.
3. Martingale YASAK: zarardaki pozisyona ekleme (averaging down) asla önermezsin.
4. Kaldıraç 1x-10x arası. Pozisyon margin'i bakiyenin en fazla %50'si.
5. Bakiye kill switch eşiğinin altındaysa işlem ÖNERMEZSİN.
6. Belirsizlik varsa işlem açmazsın. "Şu an işlem yok" demen HER ZAMAN geçerli ve saygın bir cevaptır. Kötü işlem, işlemsizlikten daha kötüdür.
7. Kullanıcının kalıcı talimatları (aşağıda listelenir) senin için emirdir — ama Değişmez Kuralların tavanını asla GEVŞETEMEZ (örn. "100x kaldıraç kullan" derse reddedersin, tavan 10x).`;

export function prefsBlock(prefs: TradingPrefs): string {
  const lines = [
    `GÜNCEL RİSK LİMİTLERİ:`,
    `- Maksimum kaldıraç: ${prefs.maxLeverage}x`,
    `- Maksimum margin: bakiyenin %${prefs.maxMarginPct}'si`,
    `- Minimum güven skoru (altı = işlem yok): ${prefs.minConfidence}/10`,
  ];
  if (prefs.avoidSymbols.length) lines.push(`- UZAK DURULACAK coinler: ${prefs.avoidSymbols.join(', ')}`);
  if (prefs.preferSymbols.length) lines.push(`- Tercih edilen coinler: ${prefs.preferSymbols.join(', ')}`);
  if (prefs.activeInstructions.length) {
    lines.push(``, `KULLANICININ KALICI TALİMATLARI (her kararda uygula):`);
    for (const i of prefs.activeInstructions) lines.push(`- ${i.text}`);
  } else {
    lines.push(``, `Kullanıcının ek kalıcı talimatı yok.`);
  }
  return lines.join('\n');
}

/** Snapshot'ı LLM'in sindirebileceği kompakt metne çevirir */
export function snapshotBlock(s: MarketSnapshot, focusSymbol?: string): string {
  const lines: string[] = [];
  lines.push(`PİYASA VERİSİ (canlı, kaynak: ${s.source}, zaman: ${new Date(s.time).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })})`);
  lines.push('');
  if (s.fearGreed) {
    lines.push(`KORKU/AÇGÖZLÜLÜK ENDEKSİ: ${s.fearGreed.value}/100 (${s.fearGreed.labelTr})`);
  } else {
    lines.push(`KORKU/AÇGÖZLÜLÜK ENDEKSİ: bilinmiyor`);
  }
  lines.push('');
  lines.push(`MAJÖRLER:`);
  for (const [name, t] of Object.entries(s.majors)) {
    if (t) lines.push(`- ${name.toUpperCase()}: $${fmtPrice(t.price)} (24s: ${t.change24hPct >= 0 ? '+' : ''}${t.change24hPct.toFixed(2)}%)`);
  }
  lines.push('');
  lines.push(`EN YÜKSEK HACİMLİ 50 COİN (sembol;fiyat;24s_değişim%;hacim_M$):`);
  for (const t of s.top50) {
    lines.push(`${t.symbol};${fmtPrice(t.price)};${t.change24hPct.toFixed(2)};${(t.quoteVolume / 1e6).toFixed(1)}`);
  }
  if (s.movers.length) {
    lines.push('');
    lines.push(`SERT HAREKET EDENLER: ${s.movers.map((m) => `${m.symbol} (${m.reason}, ${m.severity})`).join(', ')}`);
  }
  if (s.detailed.length) {
    lines.push('');
    lines.push(`DETAYLI TEKNİK ANALİZ (1s = 1 saatlik, 15d = 15 dakikalık mumlar):`);
    for (const d of s.detailed) {
      const h = d.tf['1h'];
      const m = d.tf['15m'];
      const parts = [
        `${d.symbol} | fiyat: ${fmtPrice(d.price)} | 24s: ${d.change24hPct.toFixed(2)}%` +
          (d.change1hPct != null ? ` | 1s: ${d.change1hPct.toFixed(2)}%` : '') +
          (d.change15mPct != null ? ` | 15d: ${d.change15mPct.toFixed(2)}%` : '') +
          (d.fundingRate != null ? ` | funding: ${(d.fundingRate * 100).toFixed(4)}%` : ''),
        `  1s → RSI:${h.rsi14} EMA20:${fmtPrice(h.ema20)} EMA50:${fmtPrice(h.ema50)}${h.ema200 != null ? ` EMA200:${fmtPrice(h.ema200)}` : ''} ATR%:${h.atrPct} MACD-hist:${h.macdHist} BB%B:${h.bbPctB} hacimOran:${h.volRatio} trend:${h.trendUp ? 'YUKARI' : 'AŞAĞI'}`,
      ];
      if (m) {
        parts.push(
          `  15d → RSI:${m.rsi14} EMA20:${fmtPrice(m.ema20)} EMA50:${fmtPrice(m.ema50)} MACD-hist:${m.macdHist} BB%B:${m.bbPctB} hacimOran:${m.volRatio} trend:${m.trendUp ? 'YUKARI' : 'AŞAĞI'}`,
        );
      }
      lines.push(parts.join('\n'));
    }
  }
  if (focusSymbol) {
    lines.push('');
    lines.push(`KULLANICININ ÖZELLİKLE SORDUĞU COİN: ${focusSymbol} — kararını öncelikle bu coin üzerinde değerlendir; ama bu coin uygun değilse 50 coin içinden EN İYİ fırsatı öner ya da "işlem yok" de.`);
  }
  return lines.join('\n');
}

export const TRADE_SCHEMA = `ÇIKTI FORMATI — SADECE geçerli JSON nesnesi yaz, başka HİÇBİR şey yazma (markdown çiti bile yok):
İşlem ÖNERİYORSAN:
{
  "action": "TRADE",
  "symbol": "BTCUSDT",
  "direction": "LONG" veya "SHORT",
  "leverage": 1-10 arası tam sayı,
  "margin_usdt": sayı (bakiyenin en fazla %50'si, önerilen %10-25),
  "entry_price": sayı (mevcut fiyata yakın gerçekçi giriş),
  "stop_loss": sayı (LONG'da girişin ALTINDA, SHORT'ta ÜSTÜNDE),
  "take_profit": sayı (LONG'da girişin ÜSTÜNDE, SHORT'ta ALTINDA),
  "confidence": 1-10 arası tam sayı,
  "rationale": "2-4 cümlelik Türkçe gerekçe: neden bu yön, hangi teknik sinyaller, piyasa bağlamı"
}
İşlem ÖNERMİYORSAN (belirsiz piyasa, zayıf sinyal, kurallar engelliyor):
{
  "action": "NO_TRADE",
  "confidence": 0,
  "rationale": "1-2 cümlelik Türkçe açıklama: neden şu an kenarda duruyoruz"
}`;

export function buildTradePrompt(opts: {
  snapshot: MarketSnapshot;
  prefs: TradingPrefs;
  balance: number;
  killSwitchTripped: boolean;
  focusSymbol?: string;
  userQuestion?: string;
  mode: 'manual' | 'patrol';
}): string {
  const parts: string[] = [];
  parts.push(snapshotBlock(opts.snapshot, opts.focusSymbol));
  parts.push('');
  parts.push(prefsBlock(opts.prefs));
  parts.push('');
  parts.push(`KULLANICININ BAKİYESİ: ${opts.balance.toFixed(2)} USDT`);
  if (opts.killSwitchTripped) {
    parts.push(`⚠️ KILL SWITCH AKTİF: Bakiye eşik altında. TRADE ÖNEREMEZSİN — action mutlaka "NO_TRADE" olmalı ve gerekçede kill switch'i anmalısın.`);
  }
  if (opts.userQuestion) {
    parts.push('');
    parts.push(`KULLANICININ SORUSU: "${opts.userQuestion}"`);
  }
  parts.push('');
  parts.push(
    `GÖREV: Yukarıdaki canlı veriyle 50 coini tara ve TEK bir karar ver: ${opts.mode === 'patrol' ? 'otomatik nöbettesin, kimse sormadı — sadece GERÇEKTEN güçlü bir fırsat varsa TRADE de' : 'kullanıcı aktif olarak işlem soruyor'}.\nDisiplinli ol: sinyaller aynı yönde hizalanmadan (trend + momentum + hacim) TRADE verme. Güven ${opts.prefs.minConfidence}/10 altındaysa NO_TRADE ver. NO_TRADE vermek başarısızlık DEĞİLDİR.`,
  );
  parts.push('');
  parts.push(TRADE_SCHEMA);
  return parts.join('\n');
}

export const PATROL_SCHEMA = `ÇIKTI FORMATI — SADECE geçerli JSON nesnesi yaz:
{
  "market_summary": "Piyasanın 1-2 cümlelik Türkçe özeti (nöbet raporu başlığı olarak gösterilecek)",
  "alerts": [
    {"symbol": "XXXUSDT", "severity": "ORTA" veya "YUKSEK", "message": "1-2 cümlelik enerjik Türkçe uyarı metni"}
  ],
  "trade": { ...yukarıdaki işlem kartı JSON şeması... } veya null
}
Kurallar:
- alerts dizisi boş olabilir (sert hareket yoksa []). En fazla 4 uyarı yaz, en önemli olanları seç.
- trade alanı: sadece GERÇEKTEN güçlü, güven skoru ${'{MIN_CONF}'}+ bir fırsat varsa doldur; yoksa null bırak.
- trade doluysa şema: {"action":"TRADE","symbol":"...","direction":"LONG|SHORT","leverage":N,"margin_usdt":N,"entry_price":N,"stop_loss":N,"take_profit":N,"confidence":N,"rationale":"..."}`;

export function buildPatrolPrompt(opts: {
  snapshot: MarketSnapshot;
  prefs: TradingPrefs;
  balance: number;
  killSwitchTripped: boolean;
  patrolMinConfidence: number;
  recentSentSummary: string;
}): string {
  const parts: string[] = [];
  parts.push(`OTOMATİK NÖBET TURU — 10 dakikalık periyodik tarama. Kullanıcı şu an sana yazmadı; sen proaktif gözlem yapıyorsun.`);
  parts.push('');
  parts.push(snapshotBlock(opts.snapshot));
  parts.push('');
  parts.push(prefsBlock(opts.prefs));
  parts.push('');
  parts.push(`KULLANICININ BAKİYESİ: ${opts.balance.toFixed(2)} USDT`);
  if (opts.killSwitchTripped) {
    parts.push(`⚠️ KILL SWITCH AKTİF: trade alanı mutlaka null olmalı. Sadece uyarı (alerts) verebilirsin.`);
  }
  if (opts.recentSentSummary) {
    parts.push('');
    parts.push(`SON GÖNDERİLEN SİNYALLER (SPAM ÖNLEME — bunların AYNI fırsatını tekrar önerme):\n${opts.recentSentSummary}`);
  }
  parts.push('');
  parts.push(PATROL_SCHEMA.replace('{MIN_CONF}', String(opts.patrolMinConfidence)));
  return parts.join('\n');
}

export function buildChatPrompt(opts: {
  prefs: TradingPrefs;
  balance: number;
  quickMarket: string;
  history: Array<{ role: 'user' | 'bot'; text: string }>;
  userText: string;
}): { system: string; user: string } {
  const system = `${PERSONA}

ŞU ANKİ DURUM:
${opts.quickMarket}
Kullanıcı bakiyesi: ${opts.balance.toFixed(2)} USDT
${prefsBlock(opts.prefs)}

MOD: Serbest sohbet. Kullanıcıyla doğal, enerjik, kısa yanıtlarla Türkçe konuş. Trading hakkında sorulara bilgiyle cevap ver. Sana bir kural/talimat söylerse onu onayla (sistem zaten kalıcı olarak kaydediyor). Yanıtın düz metin olsun (JSON değil). Telegram için uygun: kısa paragraflar, gerekirse madde işaretleri, az emoji.`;

  const histLines = opts.history
    .slice()
    .reverse()
    .map((h) => `${h.role === 'user' ? 'Kullanıcı' : 'KriptoKaptan'}: ${h.text.slice(0, 500)}`)
    .join('\n');

  const user = histLines ? `SON SOHBET:\n${histLines}\n\nYENİ MESAJ:\n${opts.userText}` : opts.userText;
  return { system, user };
}

export const INSTRUCTION_EXTRACTION_PROMPT = `GÖREV: Kullanıcının Türkçe mesajını incele. Bu mesaj, botun GELECEKTEKİ tüm trading kararlarını etkilemesi istenen KALICI BİR TALİMAT mı?

Kalıcı talimat ÖRNEKLERİ:
- "Bundan sonra kaldıracı 5x geçme" → kalıcı
- "Artık DOGE önerme" → kalıcı
- "Margin'i hep bakiyenin %10'u kadar kullan" → kalıcı
- "Minimum güven 8 olsun" → kalıcı
- "BTC girilir mi?" → DEĞİL (anlık soru)
- "Tara" → DEĞİL (komut)
- "Selam nasılsın?" → DEĞİL (sohbet)

ÇIKTI — SADECE JSON:
Kalıcı talimat ise:
{"is_instruction": true, "text": "normalize edilmiş kısa Türkçe kural cümlesi", "constraint_type": "max_leverage|max_margin_pct|min_confidence|avoid_symbols|prefer_symbols|other", "constraint_value": sayı_veya_null, "constraint_symbols": ["BTCUSDT"] }
- max_leverage: constraint_value = maksimum kaldıraç sayısı (1-10)
- max_margin_pct: constraint_value = bakiyenin yüzdesi (1-50)
- min_confidence: constraint_value = 1-10
- avoid_symbols / prefer_symbols: constraint_symbols = kanonik semboller (BTCUSDT formatı; "DOGE" yazdıysa "DOGEUSDT" yap)
- other: yapılandırılmamış kural (constraint_value/symbols null)
Talimat değilse:
{"is_instruction": false}

KULLANICI MESAJI:`;

export function buildScreenshotPrompt(opts: {
  snapshotLite: string;
  prefs: TradingPrefs;
  balance: number;
  caption?: string;
}): string {
  return `${opts.snapshotLite}

${prefsBlock(opts.prefs)}

KULLANICININ BAKİYESİ: ${opts.balance.toFixed(2)} USDT

GÖREV: Kullanıcı bir ekran görüntüsü gönderdi (muhtemelen Binance/trading grafiği). Görseli dikkatle oku:
1. Hangi coin/parite görünüyor? Fiyat, grafik zaman dilimi, pozisyon bilgisi, indikatörler varsa oku.
2. Görseldeki teknik durumu canlı piyasa verisiyle birleştir.
${opts.caption ? `3. Kullanıcının notu: "${opts.caption}"` : ''}

ÇIKTI — SADECE JSON, iki seçenek:
A) Görsel + veri net bir işlem fırsatı gösteriyorsa (kurallara uygun, güven ${opts.prefs.minConfidence}+):
{"type":"card","detected_symbol":"XXXUSDT","card":{"action":"TRADE","symbol":"XXXUSDT","direction":"LONG|SHORT","leverage":N,"margin_usdt":N,"entry_price":N,"stop_loss":N,"take_profit":N,"confidence":N,"rationale":"Görseldeki ve verideki bulgulara dayalı 2-4 cümle Türkçe gerekçe"}}
B) İşlem önermiyorsan (belirsiz, zayıf, kural engeli) veya görsel trading ile ilgisizse:
{"type":"comment","detected_symbol":"XXXUSDT veya null","comment":"Türkçe, enerjik ama dürüst 2-5 cümlelik analiz/yorum. İşlem yoksa neden olmadığını söyle."}`;
}

export const QUICK_MARKET_LINE = (btc: number | null, eth: number | null, sol: number | null, fg: { value: number; labelTr: string } | null): string =>
  `HIZLI PİYASA: BTC ${btc != null ? '$' + fmtPrice(btc) : '?'} | ETH ${eth != null ? '$' + fmtPrice(eth) : '?'} | SOL ${sol != null ? '$' + fmtPrice(sol) : '?'} | Korku/Açgözlülük: ${fg ? `${fg.value}/100 (${fg.labelTr})` : '?'}`;
