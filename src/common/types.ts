/**
 * Ortak tip tanımları — tüm modüller arası veri sözleşmeleri.
 */

/** Tek bir coin'in anlık piyasa özeti (hangi borsadan gelirse gelsin normalize edilir) */
export interface Ticker {
  /** Kanonik sembol: BTCUSDT, ETHUSDT... (Binance formatı) */
  symbol: string;
  price: number;
  change24hPct: number;
  /** 24 saatlik hacim (USDT cinsinden) */
  quoteVolume: number;
  high24h?: number;
  low24h?: number;
  /** Verinin geldiği kaynak */
  source: string;
  /** Bu bir vadeli (perpetual) sözleşme mi, spot mu? */
  isPerp: boolean;
}

/** OHLCV mumu */
export interface Candle {
  time: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Bir zaman dilimi için hesaplanan teknik gösterge seti */
export interface IndicatorSet {
  rsi14: number;
  ema20: number;
  ema50: number;
  ema200: number | null;
  atr14: number;
  atrPct: number; // ATR / fiyat * 100
  macd: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  bbPctB: number; // 0..1 (bant içindeki konum)
  volRatio: number; // son hacim / 20 periyot ortalaması
  changePct: number; // setin kapsadığı son mum değişimi (%)
  trendUp: boolean; // fiyat > ema50 > ema200 (200 yoksa ema50)
}

/** Detaylı analiz edilen varlık */
export interface AssetContext {
  symbol: string;
  price: number;
  change24hPct: number;
  quoteVolume: number;
  fundingRate: number | null;
  tf: {
    '15m'?: IndicatorSet;
    '1h': IndicatorSet;
    '4h'?: IndicatorSet;
  };
  change1hPct: number | null;
  change15mPct: number | null;
}

/** Korku/Açgözlülük endeksi */
export interface FearGreed {
  value: number; // 0-100
  label: string; // Fear, Greed...
  labelTr: string;
  source: string;
}

/** Sert hareket uyarısı adayı */
export interface Mover {
  symbol: string;
  reason: string; // "1s: +4.2%" gibi
  severity: 'ORTA' | 'YUKSEK';
}

/** Botun bir tarama anında topladığı tüm piyasa verisi */
export interface MarketSnapshot {
  time: string; // ISO
  source: string; // Ana veri kaynağı adı
  fearGreed: FearGreed | null;
  majors: {
    btc: Ticker | null;
    eth: Ticker | null;
    sol: Ticker | null;
  };
  /** Binance Futures'taki en yüksek hacimli 50 coin */
  top50: Ticker[];
  /** Detaylı teknik analiz yapılanlar (shortlist) */
  detailed: AssetContext[];
  /** Sert hareket edenler */
  movers: Mover[];
}

/** LLM'in üretmesi beklenen ham işlem kartı taslağı */
export interface TradeCardDraft {
  action: 'TRADE' | 'NO_TRADE';
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  leverage?: number;
  margin_usdt?: number;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  confidence?: number;
  rationale?: string;
  note?: string;
}

/** Nöbet (patrol) modunda LLM çıktısı */
export interface PatrolDecision {
  market_summary: string;
  alerts: Array<{
    symbol: string;
    severity: 'ORTA' | 'YUKSEK';
    message: string;
  }>;
  trade: TradeCardDraft | null;
}

/** Risk servisinin hesaplayıp doğruladığı nihai işlem kartı */
export interface ValidatedCard {
  draft: TradeCardDraft;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  leverage: number;
  marginUsdt: number;
  marginPctOfBalance: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  rationale: string;
  quantity: number;
  notionalUsdt: number;
  potentialProfitUsdt: number;
  potentialProfitPctOfMargin: number;
  riskUsdt: number;
  riskRewardRatio: number;
  stopDistancePct: number;
  tpDistancePct: number;
  estimatedLiquidation: number;
  marketPriceAtValidation: number;
  warnings: string[];
  market: {
    fearGreed: FearGreed | null;
    dataSource: string;
    change24hPct: number;
  };
}

export type CardBuildResult =
  | { status: 'ok'; card: ValidatedCard }
  | { status: 'none'; reason: string; userMessage: string } // "şu an işlem yok"
  | { status: 'reject'; reason: string; userMessage: string; retryHint?: string }; // kural ihlali → LLM'e düzeltme ipucu

/** Kalıcı kullanıcı talimatı (hafıza) */
export interface InstructionRecord {
  id: number;
  text: string;
  constraintType: string | null; // max_leverage | max_margin_pct | min_confidence | avoid_symbols | prefer_symbols | other
  constraintValue: number | null;
  constraintSymbols: string[] | null;
  createdAt: Date;
}

/** Kullanıcı talimatlarından türetilen, kararları etkileyen tercihler */
export interface TradingPrefs {
  maxLeverage: number;
  maxMarginPct: number;
  minConfidence: number;
  avoidSymbols: string[];
  preferSymbols: string[];
  activeInstructions: InstructionRecord[];
}
