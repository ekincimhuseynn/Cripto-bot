import { LlmClient, LlmError, LlmRequest, llmFetch } from './llm.types';

/** OpenAI Chat Completions istemcisi (gpt-4o vb. — vision destekli).
 *  baseUrl verilirse Groq/OpenRouter/DeepSeek gibi OpenAI-UYUMLU uçlarla da çalışır. */
export class OpenAiClient implements LlmClient {
  readonly providerName = 'openai';
  readonly supportsVision = true;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
    private readonly timeoutMs = 60000,
    baseUrl?: string,
  ) {
    this.model = model || 'gpt-4o';
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async chat(req: LlmRequest): Promise<string> {
    const messages: any[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.images?.length) {
        const content: any[] = [{ type: 'text', text: m.text }];
        for (const img of m.images) {
          content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
        }
        messages.push({ role: m.role, content });
      } else {
        messages.push({ role: m.role, content: m.text });
      }
    }
    const body: any = {
      model: this.model,
      messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 2500,
    };
    if (req.json) body.response_format = { type: 'json_object' };

    const data = await llmFetch(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
    );
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new LlmError('OpenAI boş yanıt döndürdü', true);
    return text;
  }
}
