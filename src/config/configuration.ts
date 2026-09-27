/**
 * Ortam değişkenlerinden tipli konfigürasyon üretir.
 */

function num(v: string | undefined, def: number): number {
  const n = parseFloat(v);
  return isFinite(n) ? n : def;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v == null || v === '') return def;
  return ['1', 'true', 'yes', 'on', 'evet'].includes(v.toLowerCase());
}

export default () => ({
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    /** Yetkili chat ID listesi (boşsa herkes — uyarı loglanır) */
    allowedChatIds: (process.env.TELEGRAM_CHAT_ID || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => isFinite(n)),
  },

  llm: {
    provider: (process.env.LLM_PROVIDER || 'openai').toLowerCase(),
    apiKey:
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GEMINI_API_KEY ||
      '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    geminiKey: process.env.GEMINI_API_KEY || '',
    model:
      process.env.LLM_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      process.env.GEMINI_MODEL ||
      '',
    /** OpenAI-uyumlu alternatif uç nokta (Groq, OpenRouter, DeepSeek...) — boşsa api.openai.com */
    baseUrl: (process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || '').replace(/\/+$/, ''),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 60000),
    temperature: num(process.env.LLM_TEMPERATURE, 0.4),
  },

  risk: {
    startBalance: num(process.env.START_BALANCE, 1000),
    killSwitchThreshold: num(process.env.KILL_SWITCH_THRESHOLD, 700),
    maxMarginPct: Math.min(50, num(process.env.MAX_MARGIN_PCT, 50)), // DEĞİŞMEZ: %50 tavan
    maxLeverage: Math.min(10, num(process.env.MAX_LEVERAGE, 10)), // DEĞİŞMEZ: 10x tavan
    minConfidence: num(process.env.MIN_CONFIDENCE, 6),
    minMarginUsdt: 5,
  },

  patrol: {
    cron: process.env.PATROL_CRON || '*/10 * * * *',
    enabled: bool(process.env.PATROL_ENABLED, true),
    dedupeHours: num(process.env.PATROL_DEDUPE_HOURS, 6),
    alertCooldownMin: num(process.env.PATROL_ALERT_COOLDOWN_MIN, 60),
    minConfidence: num(process.env.PATROL_MIN_CONFIDENCE, 7),
    maxAlertsPerRun: 3,
    alert1hPct: num(process.env.ALERT_1H_PCT, 2.5),
    alert15mPct: num(process.env.ALERT_15M_PCT, 1.8),
    alert24hPct: num(process.env.ALERT_24H_PCT, 10),
  },

  scan: {
    shortlist: num(process.env.SCAN_SHORTLIST, 10),
    /** Ticker önbellek süresi (ms) */
    tickerCacheMs: 45_000,
    /** FNG önbellek süresi (ms) */
    fngCacheMs: 10 * 60_000,
    /** Snapshot önbellek süresi (ms) — arka arkaya komutlarda tekrar taramayı önler */
    snapshotCacheMs: 30_000,
    concurrency: 6,
  },

  market: {
    sourcePriority: (process.env.DATA_SOURCE_PRIORITY || 'BINANCE_FUTURES,OKX,BYBIT,BINANCE_VISION')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    /** Bir kaynak başarısız olursa tekrar denemeden önce bekleme (ms) */
    providerCooldownMs: 5 * 60_000,
    requestTimeoutMs: 10_000,
  },

  db: {
    path: process.env.DB_PATH || 'data/bot.sqlite',
  },
});

export type AppConfig = ReturnType<typeof import('./configuration').default>;
