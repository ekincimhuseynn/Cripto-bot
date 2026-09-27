import { baseAsset, escapeHtml, fmtDateTime, fmtNum, fmtPct, fmtPctPlain, fmtPrice, fmtQty, fmtUsdt } from '../common/format';
import { ValidatedCard } from '../common/types';

/**
 * İşlem kartını Telegram HTML mesajına çevirir.
 * Kullanıcının istediği 9 alanın TAMAMI her kartta bulunur:
 * parite+yön, kaldıraç+ISOLATED uyarısı, margin, giriş, SL, TP, güven, potansiyel kazanç, gerekçe.
 */

const DIR_EMOJI = { LONG: '🟢', SHORT: '🔴' };

export function renderTradeCard(card: ValidatedCard, opts: { source?: string; title?: string } = {}): string {
  const d = card.direction;
  const title = opts.title || '🎯 İŞLEM KARTI';
  const L: string[] = [];

  L.push(`${title} — <b>${card.symbol}</b> <b>${DIR_EMOJI[d]} ${d}</b>`);
  L.push('━━━━━━━━━━━━━━━━━━━━');
  L.push(`📊 <b>Parite / Yön:</b> ${card.symbol} (${baseAsset(card.symbol)}/USDT) — <b>${d === 'LONG' ? 'LONG (Yükseliş)' : 'SHORT (Düşüş)'}</b>`);
  L.push(`⚙️ <b>Kaldıraç:</b> ${card.leverage}x — ⚠️ <b>ISOLATED MARJ</b> (cross ASLA)`);
  L.push(`💰 <b>Margin:</b> ${fmtUsdt(card.marginUsdt)} <i>(bakiyenin ${fmtPctPlain(card.marginPctOfBalance)} kadarı)</i>`);
  L.push(`📦 <b>Pozisyon:</b> ${fmtQty(card.quantity)} ${baseAsset(card.symbol)} <i>(~${fmtUsdt(card.notionalUsdt)} notional)</i>`);
  L.push(`🎯 <b>Giriş:</b> $${fmtPrice(card.entryPrice)}`);
  L.push(
    `🛑 <b>Stop-Loss:</b> $${fmtPrice(card.stopLoss)} <i>(${fmtPct(d === 'LONG' ? -card.stopDistancePct : card.stopDistancePct)} | −${fmtUsdt(card.riskUsdt)} risk)</i>`,
  );
  L.push(
    `✅ <b>Take-Profit:</b> $${fmtPrice(card.takeProfit)} <i>(${fmtPct(d === 'LONG' ? card.tpDistancePct : -card.tpDistancePct)})</i>`,
  );
  L.push(`🧠 <b>Güven Skoru:</b> ${'🔥'.repeat(Math.min(5, Math.ceil(card.confidence / 2)))} <b>${card.confidence}/10</b>`);
  L.push(`💵 <b>Potansiyel Kazanç:</b> <b>+${fmtUsdt(card.potentialProfitUsdt)}</b> <i>(margin üstüne ${fmtPct(card.potentialProfitPctOfMargin)})</i>`);
  L.push(`⚖️ <b>Risk/Ödül:</b> 1 : ${fmtNum(card.riskRewardRatio)}  |  💧 <b>Tahmini likidasyon:</b> ~$${fmtPrice(card.estimatedLiquidation)}`);
  L.push('');
  L.push(`📝 <b>Gerekçe:</b>`);
  L.push(escapeHtml(card.rationale));

  if (card.warnings.length) {
    L.push('');
    L.push(card.warnings.map((w) => `⚠️ ${escapeHtml(w)}`).join('\n'));
  }

  L.push('');
  const fg = card.market.fearGreed;
  L.push(
    `<i>🌡 Piyasa: K/A Endeksi ${fg ? `${fg.value}/100 (${fg.labelTr})` : '—'} | 24s: ${fmtPct(card.market.change24hPct)} | Kaynak: ${card.market.dataSource} | ${fmtDateTime()}</i>`,
  );
  L.push('<i>🛡 SL/TP sabit — genişletmek YOK. Martingale YOK. İzole marj ZORUNLU. Bu bir yatırım tavsiyesi değil, disiplinli bir plandır.</i>');

  return L.join('\n');
}

/** "Şu an işlem yok" mesajını Kaptan ağzıyla sarar */
export function renderNoTrade(reason: string): string {
  const r = escapeHtml(reason || 'Piyasa net sinyal vermiyor.');
  return (
    `🛡 <b>ŞU AN İŞLEM YOK</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${r}\n\n` +
    `<i>Kenarda durmak da bir pozisyondur Kaptan. Sermaye korunur, fırsat tekrar gelir. Disiplin = hayatta kalmak. 🧘</i>`
  );
}

/** Nöbet uyarı mesajı */
export function renderAlert(a: { symbol: string; severity: string; message: string }, summary?: string): string {
  const icon = a.severity === 'YUKSEK' ? '🚨' : '⚡';
  const L: string[] = [];
  if (summary) L.push(`👁 <b>NÖBET RAPORU</b> — ${escapeHtml(summary)}`);
  L.push(`${icon} <b>SERT HAREKET: ${a.symbol}</b> <i>(${escapeHtml(a.severity)})</i>`);
  L.push(escapeHtml(a.message));
  L.push(`<i>Detaylı kart için "tara" ya da "${baseAsset(a.symbol)} girilir mi?" yaz. ⏱ ${fmtDateTime()}</i>`);
  return L.join('\n');
}
