import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { baseAsset, fmtPrice, fmtQty, round } from '../common/format';
import {
  CardBuildResult,
  MarketSnapshot,
  TradeCardDraft,
  TradingPrefs,
  ValidatedCard,
} from '../common/types';
import { MemoryService } from '../memory/memory.service';
import { SettingsService } from '../settings/settings.service';

/**
 * RİSK MOTORU — Değişmez kuralların BEKÇİSİ.
 * LLM ne derse desin, buradan geçmeyen kart kullanıcıya GİTMEZ.
 *
 *  - Her işlemde SL + TP zorunlu (yoksa/ters taraftaysa → düzeltme turu, olmazsa iptal)
 *  - ISOLATED marj zorunlu (kartta her zaman uyarı basılır)
 *  - Martingale yok (zarardaki pozisyona ekleme diye bir kavram bu motorda yok)
 *  - Kaldıraç 1-10x ve kullanıcı tavanı
 *  - Margin ≤ bakiyenin %50'si ve kullanıcı tavanı
 *  - Bakiye < eşik → KILL SWITCH, hiçbir kart geçmez
 *  - Güven < minimum → "şu an işlem yok"
 */
@Injectable()
export class RiskService {
  private readonly log = new Logger(RiskService.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly settings: SettingsService,
    private readonly memory: MemoryService,
  ) {}

  async getPrefs(): Promise<TradingPrefs> {
    return this.memory.getPrefs();
  }

  /**
   * LLM taslağını doğrula, pozisyon matematiğini hesapla, nihai kartı üret.
   */
  async buildCard(draft: TradeCardDraft, snapshot: MarketSnapshot, source: 'manual' | 'patrol' | 'photo'): Promise<CardBuildResult> {
    const prefs = await this.getPrefs();
    const balance = await this.settings.getBalance();
    const threshold = await this.settings.getKillThreshold();

    // ---------- KILL SWITCH (her şeyden önce) ----------
    if (balance < threshold) {
      return {
        status: 'none',
        reason: 'kill_switch',
        userMessage:
          `🛑 <b>KILL SWITCH AKTİF</b> — Bakiye ${fmtPrice(balance)} USDT, eşik ${fmtPrice(threshold)} USDT.\n` +
          `Disiplin her şeyden önemli Kaptan. Bakiye eşiğin altındayken işlem önermiyorum.\n` +
          `Bakiyeni güncellemek için: <code>/bakiye 1000</code>`,
      };
    }

    // ---------- NO_TRADE ----------
    if (!draft || draft.action !== 'TRADE') {
      return {
        status: 'none',
        reason: draft?.rationale || 'LLM işlem önermedi',
        userMessage: draft?.rationale || 'Piyasa belirsiz, kenarda bekliyoruz.',
      };
    }

    const warnings: string[] = [];

    // ---------- Sembol doğrulama ----------
    const symbol = String(draft.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{2,15}USDT$/.test(symbol)) {
      return { status: 'reject', reason: `Geçersiz sembol: ${draft.symbol}`, userMessage: '', retryHint: `symbol alanı geçerli bir USDT paritesi olmalı (örn. BTCUSDT). Veri setindeki sembollerden seç.` };
    }
    const known = snapshot.top50.find((t) => t.symbol === symbol) || snapshot.detailed.find((d) => d.symbol === symbol);
    if (!known) {
      return { status: 'reject', reason: `Sembol veri setinde yok: ${symbol}`, userMessage: '', retryHint: `Sadece verilen 50 coinlik listedeki sembollerden seç. ${symbol} listede yok.` };
    }
    if (prefs.avoidSymbols.includes(symbol)) {
      return {
        status: 'none',
        reason: `Kullanıcı talimatı: ${symbol} yasaklı`,
        userMessage: `📌 ${baseAsset(symbol)} senin kalıcı talimatın gereği uzak durulan coinler listesinde. Fırsat başka yerde — şu an bu coinle işlem yok.`,
      };
    }
    const marketPrice = known.price;

    // ---------- Yön ----------
    const direction = String(draft.direction || '').toUpperCase();
    if (direction !== 'LONG' && direction !== 'SHORT') {
      return { status: 'reject', reason: `Geçersiz yön: ${draft.direction}`, userMessage: '', retryHint: 'direction alanı "LONG" veya "SHORT" olmalı.' };
    }

    // ---------- Kaldıraç (1-10x + kullanıcı tavanı) ----------
    let leverage = Math.round(Number(draft.leverage));
    if (!isFinite(leverage) || leverage < 1) leverage = 1;
    const levCap = Math.min(10, prefs.maxLeverage); // DEĞİŞMEZ TAVAN: 10
    if (leverage > levCap) {
      warnings.push(`Kaldıraç ${draft.leverage}x istendi → kural gereği ${levCap}x ile sınırlandı.`);
      leverage = levCap;
    }

    // ---------- Margin (≤ %50 + kullanıcı tavanı) ----------
    let margin = Number(draft.margin_usdt);
    if (!isFinite(margin) || margin <= 0) {
      return { status: 'reject', reason: 'Geçersiz margin', userMessage: '', retryHint: `margin_usdt pozitif bir sayı olmalı (bakiye: ${balance.toFixed(2)} USDT).` };
    }
    const marginCap = Math.min(50, prefs.maxMarginPct); // DEĞİŞMEZ TAVAN: %50
    const maxMarginUsdt = (balance * marginCap) / 100;
    if (margin > maxMarginUsdt) {
      warnings.push(`Margin ${margin.toFixed(2)} USDT istendi → tavan uygulandı: ${maxMarginUsdt.toFixed(2)} USDT (bakiyenin en fazla %${marginCap} kadarı).`);
      margin = maxMarginUsdt;
    }
    const minMargin = this.cfg.get<number>('risk.minMarginUsdt');
    if (margin < minMargin) {
      return { status: 'reject', reason: `Margin çok düşük: ${margin}`, userMessage: '', retryHint: `margin_usdt en az ${minMargin} USDT olmalı (bakiye ${balance.toFixed(2)} USDT, tavan %${marginCap}).` };
    }
    margin = round(margin, 2);

    // ---------- Giriş fiyatı (bayat giriş → canlı fiyat) ----------
    let entry = Number(draft.entry_price);
    if (!isFinite(entry) || entry <= 0) entry = marketPrice;
    const drift = Math.abs(entry - marketPrice) / marketPrice;
    if (drift > 0.02) {
      warnings.push(`Giriş ${fmtPrice(entry)} istendi ama canlı fiyat ${fmtPrice(marketPrice)} → giriş canlı fiyata güncellendi.`);
      entry = marketPrice;
    }
    entry = round(entry, 8);

    // ---------- STOP-LOSS & TAKE-PROFIT (DEĞİŞMEZ: MUTLAKA OLACAK) ----------
    const sl = Number(draft.stop_loss);
    const tp = Number(draft.take_profit);
    if (!isFinite(sl) || sl <= 0 || !isFinite(tp) || tp <= 0) {
      return {
        status: 'reject',
        reason: 'SL/TP eksik — değişmez kural ihlali',
        userMessage: '',
        retryHint:
          'DEĞİŞMEZ KURAL: Her işlemde stop_loss VE take_profit ZORUNLU. ' +
          (direction === 'LONG'
            ? `LONG için: stop_loss < entry_price < take_profit. Canlı fiyat: ${marketPrice}.`
            : `SHORT için: take_profit < entry_price < stop_loss. Canlı fiyat: ${marketPrice}.`),
      };
    }
    if (direction === 'LONG' && !(sl < entry && tp > entry)) {
      return { status: 'reject', reason: 'LONG için SL/TP ters tarafta', userMessage: '', retryHint: `LONG işlemde stop_loss (${sl}) girişin (${entry}) ALTINDA, take_profit (${tp}) ÜSTÜNDE olmalı.` };
    }
    if (direction === 'SHORT' && !(sl > entry && tp < entry)) {
      return { status: 'reject', reason: 'SHORT için SL/TP ters tarafta', userMessage: '', retryHint: `SHORT işlemde stop_loss (${sl}) girişin (${entry}) ÜSTÜNDE, take_profit (${tp}) ALTINDA olmalı.` };
    }

    // ---------- Stop mesafesi × kaldıraç = likidasyon güvenliği ----------
    const stopDistPct = direction === 'LONG' ? ((entry - sl) / entry) * 100 : ((sl - entry) / entry) * 100;
    const tpDistPct = direction === 'LONG' ? ((tp - entry) / entry) * 100 : ((entry - tp) / entry) * 100;
    if (stopDistPct * leverage >= 90) {
      return {
        status: 'reject',
        reason: 'Stop, likidasyondan sonra kalıyor',
        userMessage: '',
        retryHint: `Stop mesafesi (%${stopDistPct.toFixed(2)}) × kaldıraç (${leverage}x) = %${(stopDistPct * leverage).toFixed(0)} — pozisyon stop'a gelmeden likide olur. Kaldıracı düşür veya stop'u yaklaştır. ATR(1s) referans al.`,
      };
    }
    if (stopDistPct <= 0.05) {
      return { status: 'reject', reason: 'Stop mesafesi gerçekçi değil', userMessage: '', retryHint: `Stop mesafesi %${stopDistPct.toFixed(3)} — mum gürültüsünde anlık patlar. ATR bazlı makul bir stop koy (örn. %0.5+).` };
    }
    if (tpDistPct <= 0) {
      return { status: 'reject', reason: 'TP mesafesi sıfır/negatif', userMessage: '', retryHint: 'take_profit girişe göre kârlı tarafta ve makul uzaklıkta olmalı.' };
    }

    // ---------- Güven skoru ----------
    let confidence = Math.round(Number(draft.confidence));
    if (!isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(10, confidence));
    if (confidence < prefs.minConfidence) {
      return {
        status: 'none',
        reason: `Güven ${confidence}/10 < minimum ${prefs.minConfidence}/10`,
        userMessage: draft.rationale || 'Sinyal yeterince güçlü değil — disiplinli duruyoruz.',
      };
    }
    // Nöbet modunda ek eşik
    if (source === 'patrol' && confidence < this.cfg.get<number>('patrol.minConfidence')) {
      return { status: 'none', reason: `Patrol güven eşiği altında: ${confidence}`, userMessage: '' };
    }

    // ---------- Pozisyon matematiği ----------
    const notional = margin * leverage;
    const quantity = notional / entry;
    const potentialProfit = quantity * (tpDistPct / 100) * entry;
    const risk = quantity * (stopDistPct / 100) * entry;
    const rr = risk > 0 ? potentialProfit / risk : 0;
    // İzole marj yaklaşık likidasyon (basitleştirilmiş; bakım marjı ihmal)
    const liq = direction === 'LONG' ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);

    if (rr < 1) {
      warnings.push(`Risk/Ödül oranı düşük (1:${rr.toFixed(2)}) — kâr potansiyeli, riske atılandan az. Kart yine de geçerli ama dikkat.`);
    }

    const card: ValidatedCard = {
      draft,
      symbol,
      direction: direction as 'LONG' | 'SHORT',
      leverage,
      marginUsdt: margin,
      marginPctOfBalance: (margin / balance) * 100,
      entryPrice: entry,
      stopLoss: round(sl, 8),
      takeProfit: round(tp, 8),
      confidence,
      rationale: String(draft.rationale || '').trim() || 'Gerekçe belirtilmedi.',
      quantity: round(quantity, 8),
      notionalUsdt: round(notional, 2),
      potentialProfitUsdt: round(potentialProfit, 2),
      potentialProfitPctOfMargin: round((potentialProfit / margin) * 100, 1),
      riskUsdt: round(risk, 2),
      riskRewardRatio: round(rr, 2),
      stopDistancePct: round(stopDistPct, 2),
      tpDistancePct: round(tpDistPct, 2),
      estimatedLiquidation: round(liq, 8),
      marketPriceAtValidation: marketPrice,
      warnings,
      market: {
        fearGreed: snapshot.fearGreed,
        dataSource: snapshot.source,
        change24hPct: known.change24hPct,
      },
    };

    this.log.log(
      `KART ONAYLANDI [${source}] ${symbol} ${direction} ${leverage}x margin=${margin}USDT giriş=${entry} SL=${card.stopLoss} TP=${card.takeProfit} güven=${confidence}`,
    );
    return { status: 'ok', card };
  }

  /**
   * Kural ihlalinde LLM'e düzeltme ipucuyla ikinci şans verir,
   * o da olmazsa "işlem yok" der. (Belirsizse işlem açma!)
   */
  async buildCardWithRetry(
    draft: TradeCardDraft,
    snapshot: MarketSnapshot,
    source: 'manual' | 'patrol' | 'photo',
    retryFn: (hint: string) => Promise<TradeCardDraft | null>,
  ): Promise<CardBuildResult> {
    let result = await this.buildCard(draft, snapshot, source);
    if (result.status === 'reject' && result.retryHint) {
      this.log.warn(`Kart reddedildi (${result.reason}) — düzeltme turu: ${result.retryHint.slice(0, 120)}`);
      const fixed = await retryFn(result.retryHint);
      if (fixed) result = await this.buildCard(fixed, snapshot, source);
    }
    if (result.status === 'reject') {
      // İkinci turda da geçemedi → disiplinli şekilde "işlem yok"
      return {
        status: 'none',
        reason: `Doğrulama 2 kez başarısız: ${result.reason}`,
        userMessage: 'Öneri risk kurallarımdan geçemedi, bu yüzden iptal ettim. Disiplin bizi ayakta tutar — şu an işlem yok. 🛡️',
      };
    }
    return result;
  }

  /** Pozisyon kapandığında bakiyeyi güncellemek için yardımcı (kullanıcı /bakiye ile de yapabilir) */
  async applyPnl(pnlUsdt: number): Promise<{ balance: number; tripped: boolean; newlyTripped: boolean }> {
    const balance = await this.settings.getBalance();
    const nb = Math.max(0, round(balance + pnlUsdt, 2));
    await this.settings.setBalance(nb);
    const ks = await this.settings.refreshKillSwitch();
    return { balance: nb, ...ks };
  }
}
