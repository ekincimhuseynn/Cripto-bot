import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/**
 * Kalıcı ayarlar: bakiye, kill switch eşiği/durumu, nöbet açık-kapalı.
 * SQLite'ta saklanır, yeniden başlatmalarda korunur.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(Setting) private readonly repo: Repository<Setting>,
    private readonly cfg: ConfigService,
  ) {}

  async onModuleInit() {
    // İlk açılışta .env varsayılanlarını tohumla (var olan değerlerin ÜZERİNE YAZMAZ)
    await this.seed('balance', String(this.cfg.get('risk.startBalance')));
    await this.seed('kill_threshold', String(this.cfg.get('risk.killSwitchThreshold')));
    await this.seed('kill_tripped', 'false');
    await this.seed('kill_notified', 'false');
    await this.seed('patrol_enabled', String(this.cfg.get('patrol.enabled')));
    const rows = await this.repo.find();
    for (const r of rows) this.cache.set(r.key, r.value);
    const balance = await this.getBalance();
    const threshold = await this.getKillThreshold();
    this.logger.log(`Ayarlar yüklendi | Bakiye: ${balance} USDT | Kill switch eşiği: ${threshold} USDT`);
  }

  private async seed(key: string, value: string) {
    const exists = await this.repo.findOne({ where: { key } });
    if (!exists) await this.repo.save(this.repo.create({ key, value }));
  }

  async get(key: string, def = ''): Promise<string> {
    if (this.cache.has(key)) return this.cache.get(key);
    const row = await this.repo.findOne({ where: { key } });
    const v = row?.value ?? def;
    this.cache.set(key, v);
    return v;
  }

  async set(key: string, value: string): Promise<void> {
    this.cache.set(key, value);
    await this.repo.save(this.repo.create({ key, value }));
  }

  // ---------------- Bakiye & Kill Switch ----------------

  async getBalance(): Promise<number> {
    return parseFloat(await this.get('balance', String(this.cfg.get('risk.startBalance'))));
  }

  async setBalance(n: number): Promise<void> {
    await this.set('balance', String(n));
    await this.refreshKillSwitch();
  }

  async getKillThreshold(): Promise<number> {
    return parseFloat(await this.get('kill_threshold', String(this.cfg.get('risk.killSwitchThreshold'))));
  }

  async setKillThreshold(n: number): Promise<void> {
    await this.set('kill_threshold', String(n));
    await this.refreshKillSwitch();
  }

  /** Bakiye eşiğin altına düştüyse true — DEĞİŞMEZ KURAL */
  async isKillSwitchTripped(): Promise<boolean> {
    const balance = await this.getBalance();
    const threshold = await this.getKillThreshold();
    return balance < threshold;
  }

  /** Bakiye/eşik değişince trip durumunu ve bildirim bayrağını günceller. Trip YENİ olduysa true döner (bildirim göndermek için) */
  async refreshKillSwitch(): Promise<{ tripped: boolean; newlyTripped: boolean }> {
    const tripped = await this.isKillSwitchTripped();
    const was = (await this.get('kill_tripped')) === 'true';
    await this.set('kill_tripped', String(tripped));
    if (!tripped && was) {
      // Eşik üstüne geri çıkıldı → bildirim bayrağını sıfırla
      await this.set('kill_notified', 'false');
    }
    return { tripped, newlyTripped: tripped && !was };
  }

  /** Kill switch bildirimi gönderildi mi? (tekrar tekrar bağırmasın) */
  async shouldNotifyKillSwitch(): Promise<boolean> {
    const tripped = await this.isKillSwitchTripped();
    if (!tripped) return false;
    return (await this.get('kill_notified')) !== 'true';
  }

  async markKillSwitchNotified(): Promise<void> {
    await this.set('kill_notified', 'true');
  }

  // ---------------- Nöbet (Patrol) ----------------

  async isPatrolEnabled(): Promise<boolean> {
    return (await this.get('patrol_enabled')) === 'true';
  }

  async setPatrolEnabled(v: boolean): Promise<void> {
    await this.set('patrol_enabled', String(v));
  }
}
