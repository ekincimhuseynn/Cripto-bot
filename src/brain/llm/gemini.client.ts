import { Logger } from '@nestjs/common';
import { LlmClient, LlmError, LlmRequest, llmFetch } from './llm.types';

/** Ana model yoğun (503/429) veya yok (404) ise sırayla denenecek yedek modeller */
const GEMINI_FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

/** Google Gemini generateContent istemcisi (vision destekli, model yedek zincirli) */
export class GeminiClient implements LlmClient {
  readonly providerName = 'gemini';
  readonly supportsVision = true;

  private readonly log = new Logger('GeminiClient');
  /** Deneme sırası: en başta aktif model */
  private chain: string[];
  private activeModel: string;

  /** Şu an fiilen kullanılan model (sağlık ucu bunu gösterir) */
  get model(): string {
    return this.activeModel;
  }

  constructor(
    private readonly apiKey: string,
    model?: string,
    private readonly timeoutMs = 60000,
  ) {
    const primary = model || 'gemini-3.8-flash';
    this.activeModel = primary;
    this.chain = [primary, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primary)];
  }

  async chat(req: LlmRequest): Promise<string> {
    const contents = req.messages.map((m) => {
      const parts: any[] = [{ text: m.text }];
      for (const img of m.images || []) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxTokens ?? 2500,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    });

    let lastErr: LlmError | null = null;
    for (const model of this.chain) {
      try {
        const data = await llmFetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          },
          this.timeoutMs,
        );

        if (data?.promptFeedback?.blockReason) {
          throw new LlmError(`Gemini içeriği engelledi: ${data.promptFeedback.blockReason}`, false);
        }
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.map((p: any) => p.text || '').join('\n');
        if (!text) throw new LlmError('Gemini boş yanıt döndürdü', true);

        if (model !== this.activeModel) {
          this.log.warn(`'${this.activeModel}' geçici olarak yanıt vermiyor → '${model}' devraldı`);
          this.activeModel = model;
          // Çalışan modeli zincirin başına al; sonraki çağrılar önce onu dener
          this.chain = [model, ...this.chain.filter((m) => m !== model)];
        }
        return text;
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError(String((e as Error)?.message || e), false);
        if (!err.retriable) throw err; // içerik engeli vb. → başka model de aynı sonucu verir
        lastErr = err;
        this.log.warn(`Model '${model}' geçici hata (yedek denenecek): ${err.message.slice(0, 160)}`);
      }
    }
    throw lastErr ?? new LlmError('Gemini yanıt üretmedi (tüm modeller denendi)', true);
  }
}
