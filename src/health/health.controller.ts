import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrainService } from '../brain/brain.service';
import { escapeHtml, fmtDateTime, fmtPct, fmtPrice } from '../common/format';
import { MarketService } from '../market/market.service';
import { SignalLogService } from '../scanner/signal-log.service';
import { SettingsService } from '../settings/settings.service';

/** İzleme/uptime için basit HTTP sağlık ucu + canlı durum paneli */
@Controller()
export class HealthController {
  constructor(
    private readonly brain: BrainService,
    private readonly market: MarketService,
    private readonly settings: SettingsService,
    private readonly signals: SignalLogService,
    private readonly cfg: ConfigService,
  ) {}

  @Get('health')
  async health() {
    const [balance, threshold, tripped, patrol, src] = await Promise.all([
      this.settings.getBalance(),
      this.settings.getKillThreshold(),
      this.settings.isKillSwitchTripped(),
      this.settings.isPatrolEnabled(),
      this.market.status(),
    ]);
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      llm: this.brain.llmStatus,
      market: src,
      balance: fmtPrice(balance),
      killSwitch: { threshold: fmtPrice(threshold), tripped },
      patrolEnabled: patrol,
      time: new Date().toISOString(),
    };
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async dashboard(): Promise<string> {
    const [balance, threshold, tripped, patrol, src, recent] = await Promise.all([
      this.settings.getBalance(),
      this.settings.getKillThreshold(),
      this.settings.isKillSwitchTripped(),
      this.settings.isPatrolEnabled(),
      this.market.status(),
      this.signals.recent(8),
    ]);
    const llm = this.brain.llmStatus;
    const tgReady = !!this.cfg.get<string>('telegram.token');
    const tgChats = this.cfg.get<number[]>('telegram.allowedChatIds');

    let quick: any = null;
    try {
      quick = await this.market.getQuickSummary();
    } catch {
      quick = null;
    }

    const pill = (ok: boolean | null, okText: string, badText: string) =>
      ok === null
        ? `<span class="pill warn">?</span>`
        : ok
          ? `<span class="pill ok">${okText}</span>`
          : `<span class="pill bad">${badText}</span>`;

    const majors = quick
      ? [
          ['BTC', quick.majors.btc],
          ['ETH', quick.majors.eth],
          ['SOL', quick.majors.sol],
        ]
          .map(
            ([name, t]: any) =>
              t
                ? `<div class="coin"><span class="csym">${name}</span><span class="cprice">$${fmtPrice(t.price)}</span><span class="cchg ${t.change24hPct >= 0 ? 'up' : 'down'}">${fmtPct(t.change24hPct)}</span></div>`
                : '',
          )
          .join('')
      : '';

    const movers = quick
      ? [...quick.top50]
          .sort((a: any, b: any) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
          .slice(0, 6)
          .map(
            (m: any) =>
              `<tr><td>${m.symbol}</td><td class="num">$${fmtPrice(m.price)}</td><td class="num ${m.change24hPct >= 0 ? 'up' : 'down'}">${fmtPct(m.change24hPct)}</td><td class="num">${(m.quoteVolume / 1e6).toFixed(0)}M$</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">Piyasa verisi alınamadı</td></tr>';

    const signalRows = recent.length
      ? recent
          .map((r) => {
            const icon =
              r.type === 'TRADE' || r.type === 'MANUAL_TRADE' || r.type === 'PHOTO_TRADE'
                ? '🎯'
                : r.type === 'ALERT'
                  ? '🚨'
                  : '🛡';
            return `<tr><td>${icon} ${r.type}</td><td>${escapeHtml(r.symbol || '—')}${r.direction ? ' ' + r.direction : ''}</td><td class="num">${r.confidence ?? '—'}</td><td class="num">${new Date(r.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="4">Henüz sinyal yok — bot çalıştıkça burada birikecek</td></tr>';

    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>⚓ KriptoKaptan — Durum Paneli</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0b0f17; color: #dbe4ee; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 24px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  h1 { font-size: 22px; color: #fff; }
  .sub { color: #7d8ea3; font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #121826; border: 1px solid #1f2a3d; border-radius: 12px; padding: 14px 16px; }
  .card h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #7d8ea3; margin-bottom: 8px; }
  .card .big { font-size: 20px; font-weight: 700; color: #fff; }
  .card .small { font-size: 12px; color: #9db0c5; margin-top: 4px; word-break: break-word; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: #0d3320; color: #3ddc84; }
  .pill.bad { background: #3a1220; color: #ff5d73; }
  .pill.warn { background: #3a2f12; color: #ffc94d; }
  .coins { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  .coin { flex: 1; min-width: 180px; background: #121826; border: 1px solid #1f2a3d; border-radius: 12px; padding: 12px 16px; display: flex; align-items: baseline; gap: 10px; }
  .csym { font-weight: 700; color: #fff; }
  .cprice { font-size: 16px; }
  .cchg { margin-left: auto; font-weight: 600; }
  .up { color: #3ddc84; } .down { color: #ff5d73; }
  section { background: #121826; border: 1px solid #1f2a3d; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
  section h2 { font-size: 14px; color: #fff; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #7d8ea3; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 6px 8px; border-bottom: 1px solid #1f2a3d; }
  td { padding: 7px 8px; border-bottom: 1px solid #161f30; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  code { background: #0b0f17; border: 1px solid #1f2a3d; border-radius: 6px; padding: 1px 6px; font-size: 12px; color: #8fd3ff; }
  .note { color: #7d8ea3; font-size: 12px; margin-top: 10px; }
  footer { color: #51617a; font-size: 12px; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>⚓ KriptoKaptan</h1>
    ${pill(tgReady, 'TELEGRAM CANLI', 'DRY-RUN — token yok')}
    ${pill(llm.ready, 'LLM HAZIR', 'LLM EKSİK')}
    ${pill(tripped ? false : true, 'İŞLEM SERBEST', 'KILL SWITCH AKTİF')}
  </header>
  <p class="sub">Trading asistanı durum paneli · Bot Telegram üzerinden konuşur; bu sayfa yalnızca izleme içindir. Her 20 sn'de bir tazelenir. · ${fmtDateTime()}</p>

  <div class="coins">${majors || '<div class="coin"><span class="csym">Piyasa verisi yüklenemedi</span></div>'}</div>

  <div class="grid">
    <div class="card">
      <h3>💰 Bakiye</h3>
      <div class="big">${fmtPrice(balance)} USDT</div>
      <div class="small">Kill switch eşiği: ${fmtPrice(threshold)} USDT ${tripped ? '🚨 <b>AKTİF</b>' : '✅'}</div>
    </div>
    <div class="card">
      <h3>🧠 Karar Modeli</h3>
      <div class="big">${llm.ready ? escapeHtml(llm.model!) : 'Yapılandırılmamış'}</div>
      <div class="small">${llm.ready ? `Sağlayıcı: ${escapeHtml(llm.provider!)}` : escapeHtml(llm.error || '.env dosyasına API anahtarı gir')}</div>
    </div>
    <div class="card">
      <h3>📡 Veri Kaynağı</h3>
      <div class="big">${src.active ? escapeHtml(src.active) : '⏳ seçilmedi'}</div>
      <div class="small">Zincir: ${src.chain.map(escapeHtml).join(' → ')}</div>
    </div>
    <div class="card">
      <h3>⏱ Otomatik Nöbet</h3>
      <div class="big">${patrol ? '✅ Açık' : '😴 Kapalı'}</div>
      <div class="small">Cron: <code>${escapeHtml(this.cfg.get<string>('patrol.cron'))}</code> · dedupe: ${this.cfg.get('patrol.dedupeHours')}s</div>
    </div>
  </div>

  <section>
    <h2>🔥 En Hareketliler (24s) — hacme göre ilk 50'den</h2>
    <table>
      <thead><tr><th>Coin</th><th class="num">Fiyat</th><th class="num">24s</th><th class="num">Hacim</th></tr></thead>
      <tbody>${movers}</tbody>
    </table>
    ${quick?.fg ? `<p class="note">🌡 Korku/Açgözlülük Endeksi: <b>${quick.fg.value}/100 (${escapeHtml(quick.fg.labelTr)})</b> · Kaynak: ${escapeHtml(quick.fg.source)}</p>` : ''}
  </section>

  <section>
    <h2>📋 Son Sinyaller (spam önleme kaydı)</h2>
    <table>
      <thead><tr><th>Tip</th><th>Coin / Yön</th><th class="num">Güven</th><th class="num">Zaman</th></tr></thead>
      <tbody>${signalRows}</tbody>
    </table>
  </section>

  <section>
    <h2>💬 Telegram'dan Kullanım</h2>
    <p class="note" style="margin-top:0">
      <code>/tara</code> 50 coini tarar · <code>/fiyat</code> hızlı bakış · <code>/bakiye 1000</code> · <code>/pnl -50</code> ·
      <code>/killswitch</code> · <code>/nöbet aç|kapat</code> · <code>/kurallar</code> · <code>/kural ekle bundan sonra 5x geçme</code> ·
      <code>/durum</code> · 📸 ekran görüntüsü at → vision analizi
    </p>
    <p class="note">Telegram durumu: ${tgReady ? `✅ token tanımlı, yetkili chat: ${tgChats.length ? tgChats.join(', ') : '<b>HERKES (TELEGRAM_CHAT_ID boş!)</b>'}` : '❌ <b>TELEGRAM_BOT_TOKEN tanımlı değil</b> — .env dosyasına token ve chat ID girip yeniden başlat.'}</p>
  </section>

  <footer>KriptoKaptan v1.0 · Yatırım tavsiyesi değildir · <a style="color:#51617a" href="/health">/health (JSON)</a></footer>
</div>
</body>
</html>`;
  }
}
