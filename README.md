# ⚓ KriptoKaptan — Telegram Kripto Trading Asistanı

NestJS tabanlı, Telegram üzerinden konuşabildiğin **"trading beyni"**. Binance Futures'taki en yüksek hacimli 50 coini canlı tarar, disiplinli işlem kartları üretir, 10 dakikada bir otomatik nöbet tutar ve talimatlarını **kalıcı olarak** hatırlar.

> ⚠️ **Yasal uyarı:** Bu bot bir yatırım danışmanı değildir. Ürettiği kartlar disiplinli birer işlem *planıdır*, tavsiye değildir. Kaldıraçlı vadeli işlemler sermayenin tamamını kaybettirebilir. Sorumluluk kullanıcıya aittir.

---

## ✨ Özellikler

### 🎯 İşlem Kartı (her öneride 9 alanın tamamı)
```
🎯 İŞLEM KARTI — SOONUSDT 🟢 LONG
━━━━━━━━━━━━━━━━━━━━
📊 Parite / Yön: SOONUSDT (SOON/USDT) — LONG (Yükseliş)
⚙️ Kaldıraç: 5x — ⚠️ ISOLATED MARJ (cross ASLA)
💰 Margin: 150 USDT (bakiyenin %15 kadarı)
📦 Pozisyon: 2.306,3 SOON (~750 USDT notional)
🎯 Giriş: $0,3252
🛑 Stop-Loss: $0,28761 (-%11,56 | -86,7 USDT risk)
✅ Take-Profit: $0,40039 (+%23,12)
🧠 Güven Skoru: 🔥🔥🔥🔥🔥 9/10
💵 Potansiyel Kazanç: +173,4 USDT (margin üstüne +%115,6)
⚖️ Risk/Ödül: 1 : 2  |  💧 Tahmini likidasyon: ~$0,26016
📝 Gerekçe: ...
🛡 SL/TP sabit — genişletmek YOK. Martingale YOK. İzole marj ZORUNLU.
```

### 🛡 Değişmez Kurallar (kod seviyesinde zorlanır — LLM istese de çiğneyemez)
Risk motoru (`RiskService`), LLM'den gelen her kartı doğrular:

| Kural | Uygulama |
|---|---|
| SL + TP zorunlu | Eksik/ters taraftaysa kart **reddedilir**, LLM'e 1 düzeltme turu verilir, olmazsa "işlem yok" |
| ISOLATED marj | Her kartta zorunlu uyarı basılır |
| Martingale yasak | Motor böyle bir kavram tanımaz |
| KILL SWITCH | Bakiye < eşik → hiçbir kart geçmez, tek seferlik bildirim |
| Kaldıraç 1x–10x | Üstü otomatik **tavana kısılır** + kartta uyarı |
| Pozisyon ≤ bakiye %50 | Üstü otomatik **tavana kısılır** + kartta uyarı |
| Belirsizse işlem yok | Güven < minimum → "şu an işlem yok" (geçerli cevap) |
| Stop-likidasyon çakışması | Stop mesafesi × kaldıraç ≥ %90 ise kart reddedilir |

### 📡 Canlı Piyasa Verisi (senden veri istemez)
- **BTC/ETH/SOL** fiyatları
- **En yüksek hacimli 50 coin** (fiyat + 24s değişim + hacim)
- Shortlist'e girenlere **detaylı teknik analiz**: RSI, EMA 20/50/200, ATR, MACD, Bollinger, hacim oranı, funding rate (1s + 15dk mumlar)
- **Korku/Açgözlülük endeksi** (alternative.me)

**Fallback zinciri** (Binance Futures bazı sunuculardan 451 ile engelli — otomatik geçiş yapılır):
```
BINANCE_FUTURES → OKX (perpetual) → BYBIT → BINANCE_VISION (spot)
```
Sıra `.env`'deki `DATA_SOURCE_PRIORITY` ile değiştirilebilir. Hangi kaynağın aktif olduğu her kartın altında ve `/durum`'da yazar.

### 🧠 3 Davranış Modu
1. **Komut/Soru** — "tara", "var mı?", "SOL girilir mi?" → anında 50 coin taraması → **tek işlem kartı** (veya dürüstçe "şu an işlem yok")
2. **Otomatik nöbet** — 10 dakikada bir cron: sert hareket varsa 🚨 uyarı, güçlü fırsat varsa hazır kart otomatik gönderilir. **Spam önleme:** aynı coin+yön 6 saat içinde (ayarlanabilir) tekrar gönderilmez; uyarılarda 60 dk cooldown.
3. **Serbest sohbet + kalıcı hafıza** — normal konuşursun; *"bundan sonra kaldıracı 5x geçme"* dersen LLM bunu yapılandırılmış kısıta çevirir (`max_leverage=5`), SQLite'a yazar ve **her kararda risk motoru zorunlu uygular**.

### 📸 Ekran Görüntüsü Analizi (Vision)
Binance ekran görüntünü at → model grafiği okur (parite, fiyat, formasyon), canlı veriyle birleştirir: ya işlem kartı üretir (aynı risk doğrulamasından geçer) ya da dürüst yorum verir.

---

## 🚀 Kurulum

### Gereksinimler
- Node.js 20+
- Bir Telegram bot token'ı ([@BotFather](https://t.me/BotFather))
- Bir LLM API anahtarı: OpenAI **veya** Anthropic **veya** Google Gemini (görsel okuma üçününde de var)
- Kendi Telegram chat ID'n ([@userinfobot](https://t.me/userinfobot))

### 🆓 Ücretsiz API anahtarı (kart gerekmez)
En pratik yol **Google Gemini ücretsiz katmanı**: [aistudio.google.com](https://aistudio.google.com) → *Get API key* → anahtarı `.env` içindeki `GEMINI_API_KEY` alanına yapıştır, `LLM_PROVIDER=gemini` yap. Ücretsiz katman Flash modellerinde ~1.500 istek/gün verir; bu botun tüketimi (10 dk'lık nöbet ≈ 144/gün + manuel taramalar) rahat sığar.

Alternatifler (OpenAI-uyumlu uç — `LLM_PROVIDER=openai` + `LLM_BASE_URL`):
- **Groq:** `LLM_BASE_URL=https://api.groq.com/openai/v1` + `LLM_MODEL=llama-3.3-70b-versatile` (ücretsiz katmanda token/dk limiti düşüktür, nöbet turları ara sıra 429 yiyebilir)
- **OpenRouter:** `LLM_BASE_URL=https://openrouter.ai/api/v1` + ücretsiz modeller
- **DeepSeek:** `LLM_BASE_URL=https://api.deepseek.com/v1` (çok ucuz; vision yoksa ekran görüntüsü analizi devre dışı kalır)

### Adımlar
```bash
cd crypto-trade-bot
npm install
cp .env.example .env
# .env dosyasını düzenle: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, LLM_PROVIDER + API anahtarı,
# START_BALANCE (bütçen) ve KILL_SWITCH_THRESHOLD
npm run build
npm start
```

Bot token'ı olmadan da açılır (**dry-run**): piyasa verisi + cron çalışır, Telegram pasif kalır — logları izleyerek test edebilirsin.

### Docker (opsiyonel)
```bash
docker build -t kriptokaptan .
docker run -d --name kaptan --env-file .env -v $(pwd)/data:/app/data -p 3000:3000 kriptokaptan
# veya:
docker compose up -d
```
`data/` klasörü SQLite veritabanını içerir — volume olarak bağla, kaybolmasın.

### ☁️ Railway'e Deploy (7/24 bulutta çalıştırma)
Railway sürekli çalışan konteyner verir (uyku/yok) → Telegram polling + 10 dk'lık nöbet cron'u sorunsuz işler.

1. **Repoyu GitHub'a yükle** (`.env` ve `data/` zaten gitignore'da — sakın commit'leme).
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → repoyu seç. Dockerfile otomatik algılanır.
3. **Volume ekle:** Service → Settings → **Attach Volume** → mount path: `/app/data`
   (SQLite oraya yazılır; `DB_PATH` varsayılanı `data/bot.sqlite` konteynerde `/app/data/bot.sqlite`'e denk gelir — ek ayar gerekmez.)
4. **Variables sekmesine** `.env` içindekileri tek tek gir:
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `START_BALANCE`, `KILL_SWITCH_THRESHOLD`, `PATROL_CRON` (istersen `MAX_LEVERAGE`, `MAX_MARGIN_PCT`).
   `PORT` girme — Railway otomatik enjekte eder, uygulama zaten okuyor.
5. **Deploy tamam** → Settings → Networking → **Generate Domain** ile panele (`/` dashboard, `/health`) dışarıdan erişim alırsın.
6. Loglardan doğrula: `Telegram botu CANLI` + `Karar modeli hazır` satırlarını gör.

⚠️ **Altın kural — aynı anda TEK örnek:** Telegram, bir token için aynı anda tek long-polling istemcisine izin verir. Railway'deki bot ayağa kalkınca başka bir yerde (kendi PC'n, başka sunucu) aynı tokenla çalışan örneği **durdur**; yoksa iki örnek birbirini `409 Conflict` ile düşürür.

💰 **Maliyet (2026):** Yeni hesap $5 deneme kredisi (30 gün, kart gerekmez); sonrası Hobby $5/ay ($5 kullanım dahil). Bu bot ~200-300MB RAM ile o kotanın içinde kalır; volume (birkaç MB) ihmal edilebilir.

📡 **Veri kaynağı notu:** Binance Futures, Railway'in ABD/AB bölgelerinden de 451 (geo-block) dönebilir — sorun değil, bot otomatik OKX'e düşer (zincir: BINANCE_FUTURES → OKX → BYBIT → BINANCE_VISION).

### Doğrulama
```bash
npm test          # 56 birim testi (risk kuralları, indikatörler, dedupe, kart formatı)
npm run smoke     # canlı piyasa verisi katmanı testi (Telegram/LLM gerekmez)
npm run smoke:e2e # uçtan uca simülasyon: canlı veri → karar → risk → kart (sahte LLM ile)
curl localhost:3000/health
```

---

## 💬 Telegram Komutları

| Komut | İşlev |
|---|---|
| `/start`, `/help` | Tanışma + komut listesi |
| `/tara [COIN]` | 50 coini tarar, tek kart üretir (`/tara SOL` → odaklı) |
| `/fiyat` | BTC/ETH/SOL + K/A endeksi + en hareketli 5 coin |
| `/bakiye [miktar]` | Bakiyeyi göster/güncelle (kill switch otomatik hesaplanır) |
| `/pnl +45` / `/pnl -120.5` | Gerçekleşen kâr/zararı bakiyeye işle |
| `/killswitch [eşik\|sıfırla]` | Kill switch durumu/eşiği |
| `/nöbet aç\|kapat\|durum` | Otomatik nöbet kontrolü (cron: `*/10 * * * *`) |
| `/kurallar` | Değişmez kurallar + senin kalıcı talimatların |
| `/kural ekle <metin>` | Talimatı elle kalıcı hafızaya yaz |
| `/kural liste` / `sil <id>` / `temizle` | Hafıza yönetimi |
| `/durum` | Model, veri kaynağı, bakiye, nöbet durumu |
| 📸 fotoğraf | Görsel analizi (vision) |
| düz mesaj | Serbest sohbet (+ otomatik talimat yakalama) |

Doğal dil de çalışır: *"fırsat var mı?"*, *"ETH girilir mi?"*, *"baksana"* → tarama tetiklenir.

---

## ⚙️ Yapılandırma (.env)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | **Zorunlu.** BotFather token'ı |
| `TELEGRAM_CHAT_ID` | — | Yetkili chat ID'ler (virgüllü). **Boşsa bot herkese açık olur!** |
| `LLM_PROVIDER` | `openai` | `openai` \| `anthropic` \| `gemini` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | — | Seçtiğin sağlayıcının anahtarı |
| `LLM_MODEL` | sağlayıcı varsayılanı | `gpt-4o` / `claude-sonnet-4-5` / `gemini-3.8-flash` |
| `START_BALANCE` | `1000` | Başlangıç bütçesi (USDT) |
| `KILL_SWITCH_THRESHOLD` | `700` | Bakiye bu değerin **altına** düşerse işlemler durur |
| `MAX_MARGIN_PCT` | `50` | Pozisyon tavanı (kodda 50 ile mühürlü — üstüne çıkılamaz) |
| `MAX_LEVERAGE` | `10` | Kaldıraç tavanı (kodda 10 ile mühürlü) |
| `MIN_CONFIDENCE` | `6` | Altındaki öneriler karta dönüşmez |
| `PATROL_CRON` | `*/10 * * * *` | Nöbet sıklığı |
| `PATROL_DEDUPE_HOURS` | `6` | Aynı fırsatın tekrar gönderilmeme penceresi |
| `PATROL_ALERT_COOLDOWN_MIN` | `60` | Aynı coin için uyarı arası |
| `PATROL_MIN_CONFIDENCE` | `7` | Nöbetin otomatik kart gönderme eşiği (manuel: `MIN_CONFIDENCE`) |
| `ALERT_1H_PCT` / `ALERT_15M_PCT` / `ALERT_24H_PCT` | `2.5/1.8/10` | Sert hareket eşikleri |
| `SCAN_SHORTLIST` | `10` | Detaylı analiz edilen coin sayısı |
| `DATA_SOURCE_PRIORITY` | `BINANCE_FUTURES,OKX,BYBIT,BINANCE_VISION` | Kaynak zinciri |
| `DB_PATH` | `data/bot.sqlite` | SQLite dosyası |

---

## 🏗 Mimari

```
src/
├── main.ts                    # dotenv önyükleme + NestFactory
├── app.module.ts
├── config/configuration.ts    # tipli .env şeması (sert tavanlar burada mühürlü)
├── database/                  # TypeORM + SQLite (better-sqlite3)
│   └── entities/              # settings, chat_messages, instructions, signal_log
├── settings/                  # bakiye, kill switch, nöbet durumu (kalıcı)
├── memory/                    # KALICI talimatlar + sohbet geçmişi → TradingPrefs
├── market/
│   ├── providers/             # binance-futures, okx, bybit, binance-vision, fear-greed
│   ├── indicators.ts          # RSI/EMA/ATR/MACD/Bollinger (saf fonksiyonlar)
│   └── market.service.ts      # fallback zinciri + önbellek + 2 aşamalı tarama
├── brain/
│   ├── llm/                   # OpenAI/Anthropic/Gemini istemcileri (vision dahil)
│   ├── prompts.ts             # Kaptan'ın ruhu: persona + kurallar + JSON şemaları
│   └── brain.service.ts       # karar/nöbet/sohbet/görsel/talimat-çıkarımı
├── risk/
│   ├── risk.service.ts        # DEĞİŞMEZ KURALLARIN BEKÇİSİ + pozisyon matematiği
│   └── trade-card.ts          # kart/uyarı/işlem-yok render (Telegram HTML)
├── scanner/                   # tarama hattı + signal_log (spam önleme dedupe)
├── patrol/                    # 10 dk cron: uyarı + otomatik kart + kill switch bildirimi
├── telegram/                  # grammY bot: komutlar, doğal dil, foto, sohbet + sender
└── health/                    # GET /health
```

**Karar akışı:**
```
Telegram (komut/soru/foto)          Cron (10 dk)
        │                               │
        ▼                               ▼
  MarketService ── kaynak zinciri ──► Canlı snapshot (50 coin + detay + FNG)
        │                               │
        ▼                               ▼
  BrainService (LLM + hafıza + kalıcı talimatlar) ──► JSON taslak
        │
        ▼
  RiskService (değişmez kurallar) ── red → düzeltme turu → yine red → "işlem yok"
        │ onay
        ▼
  TradeCard render → Telegram → signal_log (dedupe kaydı)
```

### Güvenlik notları
- `TELEGRAM_CHAT_ID` **mutlaka** doldur — yoksa botu keşfeden herkes kullanır.
- Yetkisiz chat'lerden gelen mesajlar loglanır ve sessizce yok sayılır.
- `.env` dosyasını asla paylaşma/commit'leme (`.gitignore`'da).
- Bot **salt okunur** piyasaya bağlanır: hiçbir borsa API anahtarı istemez, senin adına emir İLETEMEZ. Kararlar öneridir; emri sen girersin.

---

## 🧪 Testler

```
npm test        → 56 test: risk kuralları (kill switch, %50 tavanı, 10x tavanı,
                  SL/TP zorunluluğu, ters taraf reddi, stop-likidasyon çakışması,
                  düzeltme turu), indikatör matematiği, JSON ayrıştırma,
                  dedupe/spam önleme, kart render (9 zorunlu alan), HTML escape
```

---

## 📋 SSS

**Binance Futures'ım engelli mi?** `/durum` veya kart altındaki "Kaynak" alanına bak. `OKX` görüyorsan vadeli veri OKX'ten geliyordur — fiyatlar Binance ile ~%0,01 fark eder, karar mantığı aynıdır.

**Bakiyeyi nereden biliyor?** Borsadan çekmez (API anahtarı istemez). `START_BALANCE` ile başlar, sen `/pnl -50` ya da `/bakiye 900` ile güncellersin. Kill switch bu değere göre hesaplanır.

**LLM kural çiğnerse?** Çiğneyemez — son söz `RiskService`'indir. LLM 25x kaldıraç derse kart 10x'e kısılır ve uyarı basılır; SL/TP vermeyi reddederse kart iptal olur.

**Aynı fırsat tekrar gelirse?** Nöbet, `signal_log`'a bakar: aynı coin + aynı yön 6 saat içinde (ayarlanabilir) gönderildiyse sessizce atlar.
