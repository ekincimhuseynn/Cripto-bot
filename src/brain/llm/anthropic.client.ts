import { LlmClient, LlmError, LlmRequest, llmFetch } from './llm.types';

/** Anthropic Messages API istemcisi (Claude — vision destekli) */
export class AnthropicClient implements LlmClient {
  readonly providerName = 'anthropic';
  readonly supportsVision = true;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
    private readonly timeoutMs = 60000,
  ) {
    this.model = model || 'claude-sonnet-4-5';
  }

  async chat(req: LlmRequest): Promise<string> {
    const messages: any[] = req.messages.map((m) => {
      if (m.images?.length) {
        const content: any[] = [{ type: 'text', text: m.text }];
        for (const img of m.images) {
          content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.text };
    });

    let system = req.system;
    if (req.json) {
      system += '\n\nÖNEMLİ: Yanıtın SADECE geçerli bir JSON nesnesi olsun. Markdown, açıklama veya kod çiti EKLEME.';
    }

    const data = await llmFetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 2500,
          temperature: req.temperature ?? 0.4,
          system,
          messages,
        }),
      },
      this.timeoutMs,
    );
    const text = (data?.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    if (!text) throw new LlmError('Anthropic boş yanıt döndürdü', true);
    return text;
  }
}
