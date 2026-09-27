import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FearGreed } from '../../common/types';
import { httpJson } from './provider.interface';

const LABEL_TR: Record<string, string> = {
  'Extreme Fear': 'Aşırı Korku',
  Fear: 'Korku',
  Neutral: 'Nötr',
  Greed: 'Açgözlülük',
  'Extreme Greed': 'Aşırı Açgözlülük',
};

/**
 * Korku/Açgözlülük Endeksi (alternative.me — CoinMarketCap/lookintobitcoin kaynaklı).
 * 10 dakikalık önbellek; hata durumunda son bilinen değer döner.
 */
@Injectable()
export class FearGreedProvider {
  private readonly log = new Logger('FEAR_GREED');
  private cached: { at: number; value: FearGreed } | null = null;
  private lastKnown: FearGreed | null = null;

  constructor(private readonly cfg: ConfigService) {}

  async get(): Promise<FearGreed | null> {
    const ttl = this.cfg.get<number>('scan.fngCacheMs');
    if (this.cached && Date.now() - this.cached.at < ttl) return this.cached.value;
    try {
      const res = await httpJson('https://api.alternative.me/fng/?limit=1', this.cfg.get('market.requestTimeoutMs'));
      const d = res?.data?.[0];
      if (!d) throw new Error('boş yanıt');
      const fg: FearGreed = {
        value: parseInt(d.value, 10),
        label: d.value_classification,
        labelTr: LABEL_TR[d.value_classification] || d.value_classification,
        source: 'alternative.me',
      };
      if (!isFinite(fg.value)) throw new Error('geçersiz değer');
      this.cached = { at: Date.now(), value: fg };
      this.lastKnown = fg;
      return fg;
    } catch (e) {
      this.log.warn(`Korku/Açgözlülük endeksi alınamadı: ${e.message}`);
      return this.lastKnown; // son bilinen değeri döndür (yoksa null)
    }
  }
}
