import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Telegram'a mesaj GÖNDERME katmanı (bot polling'den bağımsız).
 * Otomatik nöbet ve kill switch bildirimleri bunu kullanır.
 */
@Injectable()
export class TelegramSender {
  private readonly log = new Logger(TelegramSender.name);
  private readonly token: string;
  private readonly chatIds: number[];

  constructor(private readonly cfg: ConfigService) {
    this.token = cfg.get<string>('telegram.token');
    this.chatIds = cfg.get<number[]>('telegram.allowedChatIds');
  }

  get isReady(): boolean {
    return !!this.token;
  }

  get targets(): number[] {
    return this.chatIds;
  }

  private api<T>(method: string, body: any): Promise<T> {
    return fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j: any = await r.json();
      if (!j.ok) throw new Error(`Telegram API ${method} hatası: ${j.description}`);
      return j.result as T;
    });
  }

  async send(chatId: number, text: string): Promise<void> {
    if (!this.isReady) {
      this.log.warn(`TELEGRAM_BOT_TOKEN yok — mesaj gönderilemedi (dry-run): ${text.slice(0, 80)}...`);
      return;
    }
    // 4096 karakter limiti → gerekirse böl
    const chunks = this.split(text, 4000);
    for (const chunk of chunks) {
      await this.api('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }
  }

  /** Yetkili tüm sohbetlere yayın (chat id tanımlı değilse loglar) */
  async broadcast(text: string): Promise<number> {
    if (!this.isReady) {
      this.log.warn(`TOKEN yok — broadcast atlandı: ${text.slice(0, 80)}`);
      return 0;
    }
    if (!this.chatIds.length) {
      this.log.warn('TELEGRAM_CHAT_ID tanımlı değil — nöbet mesajları gönderilemiyor. .env dosyasına chat ID ekle!');
      return 0;
    }
    let sent = 0;
    for (const id of this.chatIds) {
      try {
        await this.send(id, text);
        sent++;
      } catch (e) {
        this.log.error(`Chat ${id}'ye gönderilemedi: ${e.message}`);
      }
    }
    return sent;
  }

  private split(text: string, max: number): string[] {
    if (text.length <= max) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > max) {
      let cut = rest.lastIndexOf('\n', max);
      if (cut < max * 0.5) cut = max;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest) parts.push(rest);
    return parts;
  }
}
