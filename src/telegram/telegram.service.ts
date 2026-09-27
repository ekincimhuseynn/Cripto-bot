import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Context, GrammyError, HttpError } from 'grammy';
import { escapeHtml, fmtDateTime, fmtPrice, fmtPct } from '../common/format';
import { BrainService } from '../brain/brain.service';
import { MemoryService } from '../memory/memory.service';
import { MarketService } from '../market/market.service';
import { RiskService } from '../risk/risk.service';
import { ScannerService } from '../scanner/scanner.service';
import { SignalLogService } from '../scanner/signal-log.service';
import { SettingsService } from '../settings/settings.service';
import { renderNoTrade, renderTradeCard } from '../risk/trade-card';
import { QUICK_MARKET_LINE } from '../brain/prompts';

/** Tarama tetikleyen doğal dil kalıpları */
const SCAN_INTENT =
  /(tara|tarat|scan|var\s*m[ıi]|f[ıi]rsat\s*(var\s*m[ıi])?|girilir\s*mi|al[ıi]n[ıi]r\s*m[ıi]|ne\s*alal[ıi]m|ne\s*yapal[ıi]m|pozisyon\s*var\s*m[ıi]|[iı]şlem\s*var\s*m[ıi]|baksana|ön eri|oneri|öneri)/i;

/** Talimat çıkarma sezgiseli (LLM çağrısını gereksiz yere tetiklememek için) */
const INSTRUCTION_HINT =
  /(bundan sonra|bu andan itibaren|art[ıi]k|her zaman|asla|hiçbir zaman|hat[ıi]rla|unutma|kural|geçme|gecmе|aşma|asma|kullanma|yasak|serbest|en fazla|en az|maksimum|minimum|\bmax\b|\bmin\b|tercih|istemiyo|önerme|onerme|gösterme|gosterme|s[ıi]n[ıi]r|limit|tavan)/i;

/** Mesajdaki coin kısaltmalarını yakala */
const KNOWN_BASES = [
  'BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','MATIC','POL','SHIB','LTC','BCH','NEAR','APT','ARB','OP','SUI','SEI','TIA','INJ','FET','RNDR','WIF','PEPE','BONK','FIL','ATOM','UNI','AAVE','MKR','LDO','ETC','XLM','TRX','ALGO','ICP','RENDER','JUP','PYTH','WLD','ORDI','GALA','SAND','MANA','AXS','IMX','BLUR','ENA','STX','RUNE','ONDO','W','ZK','NOT','TON','KAS','FLOKI','BOME','AR','MINA','EOS','CRV','COMP','SNX','1INCH','DYDX','GMT','APE','CHZ','BARCA'
];

function detectSymbol(text: string): string | undefined {
  if (!text) return undefined;
  const tokens = text.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/);
  for (const t of tokens) {
    if (/USDT$/.test(t) && t.length >= 5) return t;
    if (KNOWN_BASES.includes(t)) return `${t}USDT`;
  }
  return undefined;
}

const HELP_TEXT = `🧠 <b>KriptoKaptan — Komutlar</b>
━━━━━━━━━━━━━━━━━━━━
<b>Tarama & Karar</b>
/tara <i>[COIN]</i> — 50 coini tarar, tek işlem kartı üretir
/fiyat — BTC/ETH/SOL + Korku/Açgözlülük hızlı bakış
📸 Ekran görüntüsü at — grafiğini okur, yorumlar/kart üretir

<b>Sermaye & Güvenlik</b>
/bakiye <i>[miktar]</i> — bakiyeni gör/güncelle
/pnl <i>+45 | -120.5</i> — gerçekleşen kâr/zararı işle (kill switch otomatik hesaplanır)
/killswitch <i>[eşik | sıfırla]</i> — kill switch durumu/eşiği
/nöbet <i>aç|kapat|durum</i> — 10 dakikalık otomatik nöbet

<b>Hafıza & Kurallar</b>
/kurallar — Değişmez kurallar + senin kalıcı talimatların
/kural <i>ekle &lt;metin&gt; | liste | sil &lt;id&gt; | temizle</i>
/durum — sistem durumu (model, veri kaynağı, bakiye)

<b>Serbest Sohbet</b>
Normal mesaj yaz — seninle konuşurum. "Bundan sonra kaldıracı 5x geçme" dersen KALICI olarak hatırlarım.

<i>⚠️ Yatırım tavsiyesi değildir. Disiplin her şeydir. 🛡</i>`;

/**
 * Telegram botu: komutlar, doğal dil yönlendirme, ekran görüntüsü (vision),
 * serbest sohbet + kalıcı hafıza. Tüm mesajlar yetki kontrolünden geçer.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TelegramService.name);
  private bot: Bot | null = null;
  private stopping = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly scanner: ScannerService,
    private readonly brain: BrainService,
    private readonly market: MarketService,
    private readonly risk: RiskService,
    private readonly memory: MemoryService,
    private readonly settings: SettingsService,
    private readonly signals: SignalLogService,
  ) {}

  async onModuleInit() {
    const token = this.cfg.get<string>('telegram.token');
    if (!token) {
      this.log.warn('══════════════════════════════════════════════════');
      this.log.warn('TELEGRAM_BOT_TOKEN tanımlı DEĞİL → bot pasif (dry-run).');
      this.log.warn('.env dosyasına tokenını gir ve yeniden başlat.');
      this.log.warn('══════════════════════════════════════════════════');
      return;
    }

    this.bot = new Bot(token);

    // ---- Yetki katmanı: sadece TELEGRAM_CHAT_ID listesindeki sohbetler ----
    const allowed = this.cfg.get<number[]>('telegram.allowedChatIds');
    if (!allowed.length) {
      this.log.warn('TELEGRAM_CHAT_ID boş → bot HERKESE açık! Güvenlik için kendi chat ID\'ni .env\'e yaz.');
    }
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (chatId) {
        this.log.log(`📩 Gelen mesaj: chat=${chatId} user=${ctx.from?.username || ctx.from?.id || '?'} tip=${(ctx.update as any)?.message ? 'message' : (ctx.update as any)?.callback_query ? 'callback' : 'other'}`);
      }
      if (allowed.length && (!chatId || !allowed.includes(chatId))) {
        this.log.warn(`Yetkisiz erişim denemesi: chat=${chatId} user=${ctx.from?.username || ctx.from?.id}`);
        return; // sessizce yok say
      }
      await next();
    });

    this.registerHandlers(this.bot);

    this.bot.catch((err) => {
      const e: any = err.error;
      if (e instanceof GrammyError) this.log.error(`Telegram hatası (${e.error_code}): ${e.description}`);
      else if (e instanceof HttpError) this.log.error(`Ağ hatası: ${e.message}`);
      else this.log.error(`Bot hatası: ${e?.message || e}`);
    });

    // ÖNEMLİ: bot.start() polling döngüsü BİTENE kadar çözülmez — bu yüzden
    // await ETMİYORUZ (Nest açılışını bloklamaması için). Hata olursa
    // startPollingRetry sonsuz döngüde 5sn arayla yeniden dener.
    const me = await this.bot.api.getMe().catch((e) => {
      this.log.warn(`getMe başarısız (token yanlış olabilir?): ${e.message}`);
      return null;
    });
    if (me) {
      this.log.log(`🤖 Telegram botu CANLI: @${me.username} (chat izni: ${allowed.length ? allowed.join(', ') : 'herkes'})`);
    }
    if (!this.brain.llmStatus.ready) {
      this.log.warn(`Karar modeli hazır değil: ${this.brain.llmStatus.error} — /tara ve sohbet hata verir, /fiyat ve /durum çalışır.`);
    }
    void this.startPollingRetry();
  }

  /** Polling'i başlat; beklenmedik bitiş/hata olursa 5sn sonra tekrar dene */
  private async startPollingRetry(): Promise<void> {
    for (;;) {
      if (this.stopping || !this.bot) return;
      try {
        await this.bot.start(); // polling durana kadar çözülmez
        if (this.stopping) return;
        this.log.warn('Telegram polling beklenmedik şekilde bitti — 5sn içinde yeniden başlatılıyor...');
      } catch (e: any) {
        if (this.stopping) return;
        this.log.error(`Telegram polling hatası: ${e?.message || e} — 5sn içinde yeniden denenecek`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.bot?.isRunning()) {
      await this.bot.stop().catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------

  private registerHandlers(bot: Bot) {
    bot.command('start', async (ctx) => {
      await this.memory.addMessage(ctx.chat.id, 'user', '/start', 'command');
      const balance = await this.settings.getBalance();
      const threshold = await this.settings.getKillThreshold();
      const llm = this.brain.llmStatus;
      const welcome =
        `⚓ <b>KriptoKaptan göreve hazır!</b> 🔥\n\n` +
        `Ben senin trading beyninim: 50 coini tarar, disipline edilmiş işlem kartları üretirim.\n\n` +
        `🆔 Senin chat ID'n: <code>${ctx.chat.id}</code> <i>(güvenlik için .env'deki TELEGRAM_CHAT_ID alanına yaz)</i>\n` +
        `💰 Bakiye: <b>${fmtPrice(balance)} USDT</b>\n` +
        `🛑 Kill switch eşiği: <b>${fmtPrice(threshold)} USDT</b>\n` +
        `🧠 Karar modeli: <b>${llm.ready ? `${llm.provider}/${llm.model}` : `KURULUM EKSİK — ${escapeHtml(llm.error || '')}`}</b>\n` +
        `⏱ Nöbet: her 10 dakikada bir otomatik tarama\n\n` +
        `${HELP_TEXT}`;
      await ctx.reply(welcome, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      await this.memory.addMessage(ctx.chat.id, 'bot', welcome, 'text');
    });

    bot.command('help', async (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }));

    bot.command(['tara', 'scan'], async (ctx) => {
      const arg = ctx.match?.trim();
      const focus = arg ? (arg.toUpperCase().endsWith('USDT') ? arg.toUpperCase() : `${arg.toUpperCase()}USDT`) : undefined;
      await this.handleScan(ctx, focus, ctx.message.text);
    });

    bot.command('fiyat', async (ctx) => {
      await ctx.replyWithChatAction('typing');
      try {
        const q = await this.market.getQuickSummary();
        const movers = [...q.top50].sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct)).slice(0, 5);
        const lines = [
          `📈 <b>HIZLI PİYASA</b> — <i>${escapeHtml(q.source)} | ${fmtDateTime()}</i>`,
          QUICK_MARKET_LINE(q.majors.btc?.price ?? null, q.majors.eth?.price ?? null, q.majors.sol?.price ?? null, q.fg),
          '',
          '<b>En hareketli 5 (24s):</b>',
          ...movers.map((m) => `• ${m.symbol}: ${fmtPct(m.change24hPct)} — $${fmtPrice(m.price)}`),
          '',
          '<i>Derin analiz için: /tara veya "fırsat var mı?"</i>',
        ];
        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      } catch (e) {
        await ctx.reply(`⚠️ Piyasa verisi alınamadı: ${escapeHtml(e.message)}`);
      }
    });

    bot.command('bakiye', async (ctx) => {
      const arg = String(ctx.match || '').trim().replace(',', '.');
      if (arg) {
        const n = parseFloat(arg);
        if (!isFinite(n) || n < 0) {
          await ctx.reply('⚠️ Kullanım: /bakiye 950 (pozitif sayı, USDT)');
          return;
        }
        await this.settings.setBalance(n);
        const ks = await this.settings.refreshKillSwitch();
        const threshold = await this.settings.getKillThreshold();
        await ctx.reply(
          ks.tripped
            ? `💰 Bakiye güncellendi: <b>${fmtPrice(n)} USDT</b>\n🛑 <b>KILL SWITCH AKTİF!</b> Eşik: ${fmtPrice(threshold)} USDT — bakiye eşiğin altında, işlem önerileri DURDURULDU.`
            : `💰 Bakiye güncellendi: <b>${fmtPrice(n)} USDT</b>\n🛡 Kill switch eşiği: ${fmtPrice(threshold)} USDT — güvendesin, tam yol ileri! ⚓`,
          { parse_mode: 'HTML' },
        );
      } else {
        const balance = await this.settings.getBalance();
        const threshold = await this.settings.getKillThreshold();
        const tripped = await this.settings.isKillSwitchTripped();
        await ctx.reply(
          `💰 <b>Bakiye:</b> ${fmtPrice(balance)} USDT\n🛑 <b>Kill switch eşiği:</b> ${fmtPrice(threshold)} USDT\n` +
            `Durum: ${tripped ? '🚨 <b>AKTİF — işlemler durduruldu</b>' : '✅ Normal — işlem serbest'}\n\n<i>Güncellemek için: /bakiye 1000 veya /pnl +50</i>`,
          { parse_mode: 'HTML' },
        );
      }
    });

    bot.command('pnl', async (ctx) => {
      const arg = String(ctx.match || '').trim().replace(',', '.');
      const n = parseFloat(arg);
      if (!isFinite(n)) {
        await ctx.reply('⚠️ Kullanım: /pnl +45 veya /pnl -120.5 (gerçekleşen kâr/zarar, USDT)');
        return;
      }
      const res = await this.risk.applyPnl(n);
      const threshold = await this.settings.getKillThreshold();
      let msg = `${n >= 0 ? '💚' : '💔'} PnL işlendi: <b>${n >= 0 ? '+' : ''}${fmtPrice(n)} USDT</b> → Yeni bakiye: <b>${fmtPrice(res.balance)} USDT</b>\n🛡 Eşik: ${fmtPrice(threshold)} USDT`;
      if (res.newlyTripped) {
        msg += `\n\n🛑🚨 <b>KILL SWITCH AKTİF!</b> Bakiye eşiğin altına düştü — tüm işlem önerileri DURDURULDU. Nakit kraldır, dinlen Kaptan.`;
      } else if (!res.tripped) {
        msg += `\n✅ İşlemler serbest.`;
      }
      await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    bot.command('killswitch', async (ctx) => {
      const arg = String(ctx.match || '').trim().toLowerCase();
      if (arg === 'sifirla' || arg === 'sıfırla' || arg === 'reset') {
        const ks = await this.settings.refreshKillSwitch();
        await ctx.reply(
          ks.tripped
            ? `🛑 Kill switch HALA AKTİF — bakiye eşikten düşük. Önce /bakiye ile gerçek bakiyeni gir.`
            : `✅ Kill switch sıfırlandı — bakiye eşiğin üstünde, işlemler serbest! ⚓`,
        );
        return;
      }
      if (arg) {
        const n = parseFloat(arg.replace(',', '.'));
        if (isFinite(n) && n >= 0) {
          await this.settings.setKillThreshold(n);
          await ctx.reply(`🛑 Kill switch eşiği güncellendi: <b>${fmtPrice(n)} USDT</b>`, { parse_mode: 'HTML' });
          return;
        }
      }
      const balance = await this.settings.getBalance();
      const threshold = await this.settings.getKillThreshold();
      const tripped = await this.settings.isKillSwitchTripped();
      await ctx.reply(
        `🛑 <b>KILL SWITCH</b>\nBakiye: ${fmtPrice(balance)} USDT | Eşik: ${fmtPrice(threshold)} USDT\nDurum: ${tripped ? '🚨 AKTİF (işlem yok)' : '✅ Pasif (işlem serbest)'}\n\n<i>/killswitch 750 → eşiği değiştir | /killswitch sıfırla → durumu tazele</i>`,
        { parse_mode: 'HTML' },
      );
    });

    bot.command(['nobet', 'nöbet', 'patrol'], async (ctx) => {
      const arg = String(ctx.match || '').trim().toLowerCase();
      if (arg === 'ac' || arg === 'aç') {
        await this.settings.setPatrolEnabled(true);
        await ctx.reply(`⏱ Nöbet AÇIK — her 10 dakikada bir tarıyorum. Fırsat varsa kart, sert hareket varsa uyarı gelir. Spam yok, söz. 🤝`);
      } else if (arg === 'kapat') {
        await this.settings.setPatrolEnabled(false);
        await ctx.reply(`😴 Nöbet KAPALI — sadece sen yazınca tararım. Geri açmak için: /nöbet aç`);
      } else {
        const on = await this.settings.isPatrolEnabled();
        const cron = this.cfg.get<string>('patrol.cron');
        const recent = await this.signals.recent(5);
        const lines = [
          `⏱ <b>Otomatik Nöbet:</b> ${on ? '✅ AÇIK' : '😴 KAPALI'} <i>(cron: ${escapeHtml(cron)})</i>`,
          `🔁 Aynı fırsat tekrar süresi: ${this.cfg.get('patrol.dedupeHours')} saat | Uyarı cooldown: ${this.cfg.get('patrol.alertCooldownMin')} dk`,
        ];
        if (recent.length) {
          lines.push('', '<b>Son sinyaller:</b>');
          for (const r of recent) {
            lines.push(`• ${r.type} ${r.symbol || ''}${r.direction ? ' ' + r.direction : ''} — ${new Date(r.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
          }
        }
        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      }
    });

    bot.command('kurallar', async (ctx) => {
      const prefs = await this.risk.getPrefs();
      const balance = await this.settings.getBalance();
      const threshold = await this.settings.getKillThreshold();
      const lines = [
        `🛡 <b>DEĞİŞMEZ KURALLAR</b>`,
        `1️⃣ Her işlemde SL + TP ZORUNLU (genişletme yok)`,
        `2️⃣ Her zaman ISOLATED marj`,
        `3️⃣ Martingale YASAK (zarardaki pozisyona ekleme yok)`,
        `4️⃣ Bakiye <b>${fmtPrice(threshold)} USDT</b> altına düşerse KILL SWITCH (şu an: ${fmtPrice(balance)} USDT)`,
        `5️⃣ Kaldıraç 1x–10x, pozisyon ≤ bakiyenin %50'si`,
        `6️⃣ Belirsizse işlem yok — "şu an işlem yok" geçerli cevaptır`,
        '',
        `📌 <b>SENİN KALICI TALİMATLARIN</b>`,
        `Maks kaldıraç: ${prefs.maxLeverage}x | Maks margin: %${prefs.maxMarginPct} | Min güven: ${prefs.minConfidence}/10`,
      ];
      if (prefs.avoidSymbols.length) lines.push(`Uzak dur: ${prefs.avoidSymbols.join(', ')}`);
      if (prefs.preferSymbols.length) lines.push(`Tercih: ${prefs.preferSymbols.join(', ')}`);
      if (prefs.activeInstructions.length) {
        for (const i of prefs.activeInstructions) {
          lines.push(`• <i>(#${i.id})</i> ${escapeHtml(i.text)}`);
        }
        lines.push('', `<i>Silmek için: /kural sil &lt;id&gt;</i>`);
      } else {
        lines.push(`<i>Henüz kalıcı talimatın yok. Örnek: "Bundan sonra kaldıracı 5x geçme"</i>`);
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    });

    bot.command('kural', async (ctx) => {
      const raw = String(ctx.match || '').trim();
      const [sub, ...rest] = raw.split(/\s+/);
      const arg = rest.join(' ');
      if (sub === 'ekle' && arg) {
        const note = await this.saveInstruction(ctx.chat.id, arg, true);
        await ctx.reply(note || `📌 Talimat kaydedildi: "${escapeHtml(arg)}"`, { parse_mode: 'HTML' });
        return;
      }
      if (sub === 'liste' || sub === 'list' || sub === '') {
        const list = await this.memory.listInstructions();
        if (!list.length) {
          await ctx.reply('📌 Kayıtlı kalıcı talimat yok. Ekle: /kural ekle bundan sonra DOGE önerme');
          return;
        }
        const lines = ['📌 <b>KALICI TALİMATLARIN</b>'];
        for (const i of list) lines.push(`#${i.id} — ${escapeHtml(i.text)} <i>(${new Date(i.createdAt).toLocaleDateString('tr-TR')})</i>`);
        lines.push('', '<i>/kural sil 3 | /kural temizle</i>');
        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
        return;
      }
      if (sub === 'sil') {
        const id = parseInt(arg, 10);
        if (isFinite(id) && (await this.memory.removeInstruction(id))) {
          await ctx.reply(`🗑 Talimat #${id} silindi. Hafıza taze. 🧠`);
        } else {
          await ctx.reply(`⚠️ #${arg} bulunamadı. Liste için: /kural liste`);
        }
        return;
      }
      if (sub === 'temizle') {
        const n = await this.memory.clearInstructions();
        await ctx.reply(`🧹 ${n} talimat silindi — temiz sayfa!`);
        return;
      }
      await ctx.reply('⚠️ Kullanım: /kural ekle <metin> | /kural liste | /kural sil <id> | /kural temizle');
    });

    bot.command('durum', async (ctx) => {
      const llm = this.brain.llmStatus;
      const src = await this.market.status();
      const balance = await this.settings.getBalance();
      const threshold = await this.settings.getKillThreshold();
      const tripped = await this.settings.isKillSwitchTripped();
      const patrol = await this.settings.isPatrolEnabled();
      const prefs = await this.risk.getPrefs();
      await ctx.reply(
        [
          `⚙️ <b>SİSTEM DURUMU</b>`,
          `🧠 Model: ${llm.ready ? `✅ ${escapeHtml(llm.provider)}/${escapeHtml(llm.model)}` : `❌ ${escapeHtml(llm.error || 'tanımsız')}`}`,
          `📡 Veri zinciri: ${src.chain.join(' → ')}`,
          `📡 Aktif kaynak: ${src.active ? `✅ ${escapeHtml(src.active)}` : '⏳ seçilmedi'}`,
          `💰 Bakiye: ${fmtPrice(balance)} USDT | 🛑 Eşik: ${fmtPrice(threshold)} USDT ${tripped ? '(🚨 AKTİF)' : '(✅ pasif)'}`,
          `⏱ Nöbet: ${patrol ? '✅ açık' : '😴 kapalı'} (${escapeHtml(this.cfg.get('patrol.cron'))})`,
          `📌 Limitler: ${prefs.maxLeverage}x / %${prefs.maxMarginPct} margin / min güven ${prefs.minConfidence}`,
          `🕐 ${fmtDateTime()}`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    });

    // ---- Ekran görüntüsü (VISION) ----
    bot.on('message:photo', async (ctx) => {
      await this.handlePhoto(ctx);
    });

    // ---- Metin mesajları: komut değilse → tarama niyeti veya serbest sohbet ----
    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return; // komutlar yukarıda
      await this.memory.addMessage(ctx.chat.id, 'user', text, 'text');

      if (SCAN_INTENT.test(text)) {
        const focus = detectSymbol(text);
        await this.handleScan(ctx, focus, text);
        return;
      }
      await this.handleChat(ctx, text);
    });
  }

  // ------------------------------------------------------------------

  /** Farklı bir mesajı (yer tutucuyu) düzenlemek için yardımcı */
  private async editMsg(ctx: Context, messageId: number, text: string): Promise<void> {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  /** Talimatı çıkar → kaydet → onayla. force=true ise (/kural ekle) her koşulda kaydedilir */
  private async saveInstruction(chatId: number, text: string, force = false): Promise<string | null> {
    if (!force && !INSTRUCTION_HINT.test(text)) return null;
    const ex = await this.brain.extractInstruction(text);
    // LLM talimat demedi ama kullanıcı açıkça /kural ekle dedi → ham metni "other" olarak kaydet
    const effective =
      ex?.is_instruction && ex.text
        ? ex
        : force
          ? { is_instruction: true, text, constraint_type: 'other', constraint_value: null, constraint_symbols: null }
          : null;
    if (!effective) return null;
    const saved = await this.memory.addInstruction({
      text: effective.text!,
      constraintType: (effective.constraint_type as any) || null,
      constraintValue: effective.constraint_value ?? null,
      constraintSymbols: effective.constraint_symbols ?? null,
    });
    const prefs = await this.memory.getPrefs();
    this.log.log(`Kalıcı talimat kaydedildi #${saved.id}: ${saved.text}`);
    return (
      `📌 <b>KALICI OLARAK KAYDETTİM:</b> "${escapeHtml(saved.text)}"\n` +
      `Artık her kararımda uygulayacağım. Güncel limitler: ${prefs.maxLeverage}x maks kaldıraç, %${prefs.maxMarginPct} maks margin, min güven ${prefs.minConfidence}/10. 🧠⚓`
    );
  }

  /** Ortak tarama akışı: yer tutucu mesaj → tara → kartı/yok mesajını düzenle */
  private async handleScan(ctx: Context, focusSymbol?: string, userQuestion?: string) {
    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction('typing');
    const focusNote = focusSymbol ? ` (odak: ${focusSymbol})` : '';
    const placeholder = await ctx.reply(`🔍 <b>50 coin taranıyor${focusNote}...</b>\n<i>Veri çekiliyor, indikatörler hesaplanıyor, karar motoru çalışıyor. ~15-45sn ⏳</i>`, {
      parse_mode: 'HTML',
    });

    try {
      if (!this.brain.llmStatus.ready) throw new Error(this.brain.llmStatus.error || 'Karar modeli yapılandırılmamış');
      const res = await this.scanner.scan({ mode: 'manual', focusSymbol, userQuestion });

      if (res.result.status === 'ok') {
        const cardText = renderTradeCard(res.result.card);
        await this.editMsg(ctx, placeholder.message_id, cardText);
        await this.scanner.logSentCard(res, 'MANUAL_TRADE');
        await this.memory.addMessage(chatId, 'bot', cardText, 'text');
      } else {
        await this.scanner.logNoTrade(res, 'manual');
        const noText = renderNoTrade(res.result.userMessage);
        await this.editMsg(ctx, placeholder.message_id, noText);
        await this.memory.addMessage(chatId, 'bot', noText, 'text');
      }
    } catch (e) {
      this.log.error(`Tarama hatası: ${e.message}`);
      await this.editMsg(ctx, placeholder.message_id, `⚠️ <b>Tarama tamamlanamadı:</b> ${this.friendlyError(e)}\n<i>Kaynak/model bağlantısını kontrol et: /durum</i>`);
    }
  }

  /** LLM yoğunluk/kapasite hatalarını kullanıcı dostu Türkçe mesaja çevirir */
  private friendlyError(e: any): string {
    const msg = String(e?.message || e);
    if (/HTTP (503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg)) {
      return '🧠 <b>Karar modeli şu an çok yoğun.</b> Google tarafında geçici kapasite sorunu — ücretsiz katmanda ara sıra olur. Yedek modeller de denendi.\n⏳ <b>1-2 dakika sonra tekrar "tara" yaz</b>; büyük ihtimalle düzelmiş olur. Fırsat kaçarsa merak etme, nöbet 10 dakikada bir taramaya devam ediyor. 💪';
    }
    return escapeHtml(msg);
  }

  /** Serbest sohbet + paralel talimat çıkarımı */
  private async handleChat(ctx: Context, text: string) {
    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction('typing');
    try {
      const wantInstruction = INSTRUCTION_HINT.test(text);
      const [reply, instrNote] = await Promise.all([
        this.brain.chat(chatId, text).catch((e) => {
          this.log.error(`Sohbet hatası: ${e.message}`);
          return `⚠️ Sohbet modunda hata: ${this.friendlyError(e)} (/durum ile kontrol et)`;
        }),
        wantInstruction ? this.saveInstruction(chatId, text) : Promise.resolve(null),
      ]);
      const full = instrNote ? `${reply}\n\n${instrNote}` : reply;
      await ctx.reply(full, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(async () => {
        // HTML parse hatası olursa düz metin gönder
        await ctx.reply(full.replace(/<[^>]+>/g, ''));
      });
      await this.memory.addMessage(chatId, 'bot', full, 'text');
    } catch (e) {
      this.log.error(`handleChat hatası: ${e.message}`);
      await ctx.reply(`⚠️ Bir şeyler ters gitti: ${escapeHtml(e.message)}`);
    }
  }

  /** Ekran görüntüsü akışı: indir → sembol sez → vision analizi → kart veya yorum */
  private async handlePhoto(ctx: Context) {
    const chatId = ctx.chat.id;
    const caption = ctx.message.caption || '';
    await this.memory.addMessage(chatId, 'user', caption || '[ekran görüntüsü]', 'photo');
    await ctx.replyWithChatAction('typing');
    const placeholder = await ctx.reply(`🖼 <b>Ekran görüntün okunuyor...</b>\n<i>Görsel analiz + canlı veri karşılaştırması yapılıyor ⏳</i>`, { parse_mode: 'HTML' });
    try {
      if (!this.brain.llmStatus.ready) throw new Error(this.brain.llmStatus.error || 'Karar modeli yapılandırılmamış');
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const file = await ctx.getFile();
      const token = this.cfg.get<string>('telegram.token');
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Görsel indirilemedi (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (file.file_path || '').split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      if (buf.length > 4.5 * 1024 * 1024) throw new Error('Görsel çok büyük (max ~4.5MB)');

      const detected = detectSymbol(caption);
      const out = await this.brain.analyzeScreenshot({
        image: { data: buf.toString('base64'), mimeType },
        caption: caption || undefined,
        detectedSymbol: detected,
      });

      if (out.type === 'card' && out.card?.action === 'TRADE') {
        // Görsel analizi kart önerdi → aynı risk doğrulamasından geçir
        const snapshot = await this.market.getFullSnapshot({});
        const result = await this.risk.buildCardWithRetry(out.card, snapshot, 'photo', async (hint) =>
          this.brain.repairTrade({ snapshot, prefs: await this.memory.getPrefs(), hint, previous: out.card }),
        );
        if (result.status === 'ok') {
          const cardText = renderTradeCard(result.card, { title: '🖼🎯 GÖRSEL ANALİZİ — İŞLEM KARTI' });
          await this.editMsg(ctx, placeholder.message_id, cardText);
          await this.signals.log({
            type: 'PHOTO_TRADE',
            symbol: result.card.symbol,
            direction: result.card.direction,
            entryPrice: result.card.entryPrice,
            confidence: result.card.confidence,
            summary: 'görsel analizi',
            source: 'photo',
          });
          await this.memory.addMessage(chatId, 'bot', cardText, 'text');
          return;
        }
        // Kart doğrulanamadı → yok mesajı
        const noText = renderNoTrade(result.userMessage || (out as any).comment || 'Görsel analizi kural doğrulamasından geçemedi.');
        await this.editMsg(ctx, placeholder.message_id, noText);
        await this.memory.addMessage(chatId, 'bot', noText, 'text');
        return;
      }

      // Yorum modu
      const comment = (out as any).comment || 'Görseli okudum ama net bir şey çıkaramadım. Daha net bir grafik at ya da "tara" yaz.';
      const sym = (out as any).detected_symbol ? `\n<i>Tespit edilen parite: ${escapeHtml((out as any).detected_symbol)}</i>` : '';
      const full = `🖼 <b>GÖRSEL ANALİZİ</b>\n${escapeHtml(comment)}${sym}`;
      await this.editMsg(ctx, placeholder.message_id, full);
      await this.memory.addMessage(chatId, 'bot', full, 'text');
    } catch (e) {
      this.log.error(`Görsel analizi hatası: ${e.message}`);
      await this.editMsg(ctx, placeholder.message_id, `⚠️ Görsel analizi başarısız: ${this.friendlyError(e)}`);
    }
  }
}
