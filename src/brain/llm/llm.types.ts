/** LLM istemci soyutlaması — OpenAI/Anthropic/Gemini ortak arayüzü */

export interface LlmImage {
  /** base64 veri (data: öneki YOK) */
  data: string;
  mimeType: string; // image/jpeg | image/png | image/webp
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: LlmImage[];
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  /** JSON modu: sağlayıcıya göre response_format / responseMimeType ayarlanır */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmClient {
  readonly providerName: string;
  readonly model: string;
  /** Görsel okuma (vision) destekleniyor mu */
  readonly supportsVision: boolean;
  chat(req: LlmRequest): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Ortak fetch sarmalayıcı: timeout + artan bekleme süreli yeniden denemeler */
export async function llmFetch(url: string, init: RequestInit, timeoutMs: number, attempts = 2): Promise<any> {
  const delays = [2000, 6000, 10000];
  let lastErr: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const body = await res.text();
      if (!res.ok) {
        const retriable = res.status >= 500 || res.status === 429;
        throw new LlmError(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`, retriable);
      }
      try {
        return JSON.parse(body);
      } catch {
        throw new LlmError('LLM yanıtı JSON değil', false);
      }
    } catch (e) {
      lastErr = e;
      const retriable = e instanceof LlmError ? e.retriable : true; // ağ hatası → tekrar dene
      if (!retriable || attempt === attempts - 1) throw e instanceof LlmError ? e : new LlmError(`LLM ağ hatası: ${e.message}`, false);
      await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
