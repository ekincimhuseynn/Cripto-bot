import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractJson } from '../common/format';
import { MarketSnapshot, PatrolDecision, TradeCardDraft, TradingPrefs } from '../common/types';
import { MemoryService } from '../memory/memory.service';
import { SettingsService } from '../settings/settings.service';
import { createLlmClient } from './llm/llm.factory';
import { LlmClient, LlmImage, LlmMessage } from './llm/llm.types';
import {
  buildChatPrompt,
  buildPatrolPrompt,
  buildScreenshotPrompt,
  buildTradePrompt,
  INSTRUCTION_EXTRACTION_PROMPT,
  PERSONA,
  QUICK_MARKET_LINE,
  snapshotBlock,
} from './prompts';
import { MarketService } from '../market/market.service';

export interface ExtractInstructionResult {
  is_instruction: boolean;
  text?: string;
  constraint_type?: string | null;
  constraint_value?: number | null;
  constraint_symbols?: string[] | null;
}

/**
 * KARAR MOTORU: LLM'i yönetir.
 * - İşlem kararı (manuel tarama / otomatik nöbet)
 * - Ekran görüntüsü analizi (vision)
 * - Serbest sohbet
 * - Kalıcı talimat çıkarımı
 * JSON yanıtlarını dayanıklı şekilde ayrıştırır; bozuk yanıtta bir kez düzeltme turu atar.
 */
@Injectable()
export class BrainService {
  private readonly log = new Logger(BrainService.name);
  private client: LlmClient | null = null;
  private clientError: string | null = null;

  constructor(
    private readonly cfg: ConfigService,
    private readonly memory: MemoryService,
    private readonly settings: SettingsService,
    private readonly market: MarketService,
  ) {
    try {
      this.client = createLlmClient(cfg);
      this.log.log(`Karar modeli hazır: ${this.client.providerName}/${this.client.model} (vision: ${this.client.supportsVision})`);
    } catch (e) {
      this.clientError = e.message;
      this.log.error(`Karar modeli KURULAMADI: ${e.message} — bot veri/sohbet hatası mesajı verecek.`);
    }
  }

  get llmStatus(): { ready: boolean; provider?: string; model?: string; error?: string } {
    return this.client
      ? { ready: true, provider: this.client.providerName, model: this.client.model }
      : { ready: false, error: this.clientError };
  }

  private ensureClient(): LlmClient {
    if (!this.client) {
      // Belki anahtar sonra eklendi → tekrar dene
      try {
        this.client = createLlmClient(this.cfg);
        this.clientError = null;
      } catch {
        throw new Error(this.clientError || 'LLM yapılandırılmamış');
      }
    }
    return this.client;
  }

  /** JSON modunda LLM çağrısı + dayanıklı ayrıştırma + 1 düzeltme turu */
  private async askJson<T>(system: string, userPrompt: string, images?: LlmImage[], repairInstruction?: string): Promise<T> {
    const client = this.ensureClient();
    const messages: LlmMessage[] = [{ role: 'user', text: userPrompt, images }];
    let raw = await client.chat({ system, messages, json: true, temperature: this.cfg.get('llm.temperature') });
    try {
      return extractJson(raw) as T;
    } catch (e) {
      this.log.warn(`JSON ayrıştırma başarısız (${e.message}), düzeltme turu... Ham yanıt: ${raw.slice(0, 200)}`);
      messages.push({ role: 'assistant', text: raw });
      messages.push({
        role: 'user',
        text:
          repairInstruction ||
          'Yanıtın geçerli JSON değildi. Lütfen AYNI içeriği SADECE geçerli bir JSON nesnesi olarak, hiçbir ek metin/markdown olmadan tekrar yaz.',
      });
      raw = await client.chat({ system, messages, json: true, temperature: 0.1 });
      return extractJson(raw) as T;
    }
  }

  // ---------------- İşlem kararı (manuel tarama) ----------------

  async decideTrade(opts: {
    snapshot: MarketSnapshot;
    prefs: TradingPrefs;
    focusSymbol?: string;
    userQuestion?: string;
  }): Promise<TradeCardDraft> {
    const balance = await this.settings.getBalance();
    const tripped = await this.settings.isKillSwitchTripped();
    const prompt = buildTradePrompt({
      snapshot: opts.snapshot,
      prefs: opts.prefs,
      balance,
      killSwitchTripped: tripped,
      focusSymbol: opts.focusSymbol,
      userQuestion: opts.userQuestion,
      mode: 'manual',
    });
    const draft = await this.askJson<TradeCardDraft>(PERSONA, prompt);
    this.log.log(`Karar: ${draft.action} ${draft.symbol || ''} ${draft.direction || ''} güven=${draft.confidence ?? '-'}`);
    return draft;
  }

  /**
   * DÜZELTME TURU: Risk motoru kartı reddettiğinde, ihlal sebebini LLM'e bildirip
   * aynı verilerle düzeltilmiş kart istenir. (Değişmez kurallar pazarlığa kapalı!)
   */
  async repairTrade(opts: {
    snapshot: MarketSnapshot;
    prefs: TradingPrefs;
    hint: string;
    previous: TradeCardDraft;
    focusSymbol?: string;
  }): Promise<TradeCardDraft | null> {
    try {
      const balance = await this.settings.getBalance();
      const tripped = await this.settings.isKillSwitchTripped();
      const base = buildTradePrompt({
        snapshot: opts.snapshot,
        prefs: opts.prefs,
        balance,
        killSwitchTripped: tripped,
        focusSymbol: opts.focusSymbol,
        mode: 'manual',
      });
      const prompt =
        `${base}\n\n` +
        `ÖNEMLİ — ÖNCEKİ DENEMEN RİSİKO MOTORUNDAN GEÇEMEDİ:\n` +
        `Önceki kartın: ${JSON.stringify(opts.previous)}\n` +
        `İhlal/düzeltme notu: ${opts.hint}\n` +
        `Aynı fırsatı koru ama bu notu TAM olarak uygula. Kurallara uymak mümkün değilse action="NO_TRADE" dön.`;
      return await this.askJson<TradeCardDraft>(PERSONA, prompt);
    } catch (e) {
      this.log.warn(`Düzeltme turu başarısız: ${e.message}`);
      return null;
    }
  }

  // ---------------- Otomatik nöbet kararı ----------------

  async decidePatrol(opts: { snapshot: MarketSnapshot; prefs: TradingPrefs; recentSentSummary: string }): Promise<PatrolDecision> {
    const balance = await this.settings.getBalance();
    const tripped = await this.settings.isKillSwitchTripped();
    const prompt = buildPatrolPrompt({
      snapshot: opts.snapshot,
      prefs: opts.prefs,
      balance,
      killSwitchTripped: tripped,
      patrolMinConfidence: this.cfg.get('patrol.minConfidence'),
      recentSentSummary: opts.recentSentSummary,
    });
    const res = await this.askJson<PatrolDecision>(PERSONA, prompt);
    // Normalizasyon: alanlar eksikse güvenli varsayılan
    if (!Array.isArray(res.alerts)) res.alerts = [];
    if (res.trade && res.trade.action !== 'TRADE') res.trade = null;
    if (!res.market_summary) res.market_summary = '';
    return res;
  }

  // ---------------- Ekran görüntüsü analizi ----------------

  async analyzeScreenshot(opts: {
    image: LlmImage;
    caption?: string;
    detectedSymbol?: string;
  }): Promise<{ type: 'card'; card: TradeCardDraft; detected_symbol?: string } | { type: 'comment'; comment: string; detected_symbol?: string }> {
    // Görsel için hafif snapshot (detaylı analiz, odak sembol varsa dahil)
    const snapshot = await this.market.getFullSnapshot({ focusSymbol: opts.detectedSymbol });
    const prefs = await this.memory.getPrefs();
    const balance = await this.settings.getBalance();
    const lite = snapshotBlock(snapshot, opts.detectedSymbol);
    const prompt = buildScreenshotPrompt({ snapshotLite: lite, prefs, balance, caption: opts.caption });
    const system = `${PERSONA}\n\nGÖREV MODU: Ekran görüntüsü analizi. Yanıtın SADECE geçerli JSON olmalı.`;
    return this.askJson(system, prompt, [opts.image]);
  }

  // ---------------- Serbest sohbet ----------------

  async chat(chatId: number, userText: string): Promise<string> {
    const client = this.ensureClient();
    const prefs = await this.memory.getPrefs();
    const balance = await this.settings.getBalance();
    const recent = await this.memory.getRecent(chatId, 16);
    let quick = 'Piyasa verisi henüz çekilmedi.';
    try {
      const q = await this.market.getQuickSummary();
      quick = QUICK_MARKET_LINE(
        q.majors.btc?.price ?? null,
        q.majors.eth?.price ?? null,
        q.majors.sol?.price ?? null,
        q.fg,
      );
    } catch {
      // sohbet için piyasa verisi şart değil
    }
    const { system, user } = buildChatPrompt({
      prefs,
      balance,
      quickMarket: quick,
      history: recent.map((m) => ({ role: m.role as 'user' | 'bot', text: m.content })),
      userText,
    });
    const reply = await client.chat({
      system,
      messages: [{ role: 'user', text: user }],
      temperature: this.cfg.get('llm.temperature'),
      maxTokens: 1200,
    });
    return reply.trim();
  }

  // ---------------- Kalıcı talimat çıkarımı ----------------

  async extractInstruction(userText: string): Promise<ExtractInstructionResult> {
    try {
      const client = this.ensureClient();
      const raw = await client.chat({
        system: 'Sen talimat sınıflandırma motorusun. Yanıtın SADECE geçerli JSON olmalı.',
        messages: [{ role: 'user', text: `${INSTRUCTION_EXTRACTION_PROMPT}\n"""${userText.slice(0, 1000)}"""` }],
        json: true,
        temperature: 0,
        maxTokens: 400,
      });
      return extractJson(raw);
    } catch (e) {
      this.log.warn(`Talimat çıkarımı başarısız: ${e.message}`);
      return { is_instruction: false };
    }
  }
}
