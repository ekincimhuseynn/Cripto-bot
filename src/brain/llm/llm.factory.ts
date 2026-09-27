import { ConfigService } from '@nestjs/config';
import { AnthropicClient } from './anthropic.client';
import { GeminiClient } from './gemini.client';
import { LlmClient } from './llm.types';
import { OpenAiClient } from './openai.client';

export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
  // 2.5-flash yeni hesaplara kapatıldı (Eyl 2026); Google'ın güncel ücretsiz Flash modeli:
  gemini: 'gemini-3.8-flash',
};

/** .env'deki LLM_PROVIDER'a göre doğru istemciyi kurar */
export function createLlmClient(cfg: ConfigService): LlmClient {
  const provider = (cfg.get<string>('llm.provider') || 'openai').toLowerCase();
  const timeout = cfg.get<number>('llm.timeoutMs');

  switch (provider) {
    case 'openai': {
      const key = cfg.get<string>('llm.openaiKey');
      if (!key) throw new Error('LLM_PROVIDER=openai ama OPENAI_API_KEY tanımlı değil (.env dosyasını kontrol et)');
      const baseUrl = cfg.get<string>('llm.baseUrl');
      // Alternatif uç nokta (Groq/OpenRouter/DeepSeek) kullanılacaksa model adı zorunlu
      const model = cfg.get<string>('llm.model') || (baseUrl ? DEFAULT_MODELS.openai : DEFAULT_MODELS.openai);
      return new OpenAiClient(key, model, timeout, baseUrl);
    }
    case 'anthropic': {
      const key = cfg.get<string>('llm.anthropicKey');
      if (!key) throw new Error('LLM_PROVIDER=anthropic ama ANTHROPIC_API_KEY tanımlı değil (.env dosyasını kontrol et)');
      const model = cfg.get<string>('llm.model') || DEFAULT_MODELS.anthropic;
      return new AnthropicClient(key, model, timeout);
    }
    case 'gemini': {
      const key = cfg.get<string>('llm.geminiKey');
      if (!key) throw new Error('LLM_PROVIDER=gemini ama GEMINI_API_KEY tanımlı değil (.env dosyasını kontrol et)');
      const model = cfg.get<string>('llm.model') || DEFAULT_MODELS.gemini;
      return new GeminiClient(key, model, timeout);
    }
    default:
      throw new Error(`Bilinmeyen LLM_PROVIDER: ${provider} (openai | anthropic | gemini olmalı)`);
  }
}
