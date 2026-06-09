// Node: Build Session Email
// Position: parallel branch off Parse Orchestrator Output (Option A — fires every scheduled session)
// Reads orchestrator decisions (07) + derived metrics (02). Read-only. No DB writes.
// Returns { subject, html } — or [] to suppress (watchdog-triggered runs).
// onError: continueRegularOutput — email is best-effort, never blocks trading.

const orch = $("Parse Orchestrator Output").first().json;
const ctx  = $("Compute Derived Metrics").first().json;

// ── GATE: scheduled sessions only (suppress watchdog flip runs) ───────────────
if (orch.orchestrator_session_type === 'watchdog_flip') return [];

// ── METRICS ───────────────────────────────────────────────────────────────────
const acct       = orch.account || {};
const pv         = parseFloat(acct.portfolio_value || 0);
const cash       = parseFloat(acct.cash || 0);
const longV      = parseFloat(acct.long_market_value || 0);
const shortV     = Math.abs(parseFloat(acct.short_market_value || 0));
const unreal     = parseFloat(acct.unrealized_pl || 0);
const netPct     = pv > 0 ? ((longV - shortV) / pv * 100) : 0;
const grossPct   = pv > 0 ? ((longV + shortV) / pv * 100) : 0;
const portCum    = parseFloat(ctx.portfolioCumulativePct ?? 0);
const spyCum     = parseFloat(ctx.spyCumulativePct ?? orch.spyCumulativePct ?? 0);
const alpha      = portCum - spyCum;
const sessType   = (orch.session_type || 'session').toUpperCase();
const marketOpen = !!orch.is_market_open;

const fmt$  = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtP  = n => (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const col   = n => n >= 0 ? '#16a34a' : '#dc2626';

// ── TRADES (honor is_market_open; close sessions never execute) ───────────────
const actions = marketOpen ? (orch.portfolio_actions || []) : [];
const opens   = actions.filter(a => a.action === 'BUY' || a.action === 'SHORT');
const closes  = actions.filter(a => a.action === 'SELL' || a.action === 'COVER');
const tradeCount = actions.length;

// ── DATE / SUBJECT ────────────────────────────────────────────────────────────
const dateStr = new Date().toLocaleDateString('en-US',
  { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const subject = `[${sessType}] ${fmtP(portCum)} vs SPY ${fmtP(spyCum)} (alpha ${fmtP(alpha)}) · `
  + (marketOpen ? `${tradeCount} trade${tradeCount === 1 ? '' : 's'}` : 'markets closed');

// ── HTML HELPERS ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function statCell(label, value, color) {
  return `<td style="padding:10px 14px;border:1px solid #e5e7eb;background:#fafafa;">
    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">${label}</div>
    <div style="font-size:18px;font-weight:600;font-family:ui-monospace,Menlo,monospace;color:${color||'#0f172a'};margin-top:2px;">${value}</div>
  </td>`;
}

function tradeCard(a) {
  const isOpen = a.action === 'BUY' || a.action === 'SHORT';
  const accent = a.action === 'BUY' ? '#16a34a' : a.action === 'SHORT' ? '#dc2626'
              : a.action === 'SELL' ? '#6b7280' : '#0891b2';
  const conf = a.effective_confidence != null ? ` · conf ${Number(a.effective_confidence).toFixed(2)}` : '';
  const stop = a.stop_pct_used != null ? ` · stop ${Number(a.stop_pct_used).toFixed(1)}%` : '';
  const meta = isOpen
    ? `${fmt$(a.size_usd || 0)} · ${a.shares ?? '?'} sh${conf}${stop}`
    : `${a.exit_reason || 'close'}`;
  return `<div style="border-left:3px solid ${accent};background:#fafafa;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;">
    <div style="font-weight:600;color:#0f172a;">${a.action} ${esc(a.ticker)}
      <span style="font-weight:400;color:#6b7280;font-size:13px;">${esc(a.niche || '')}</span></div>
    <div style="font-size:12px;color:#6b7280;font-family:ui-monospace,Menlo,monospace;margin:2px 0;">${meta}</div>
    <div style="font-size:13px;color:#374151;">${esc(a.thesis || '')}</div>
  </div>`;
}

function section(title, inner) {
  return `<tr><td style="padding:18px 24px 0;">
    <div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px;">${title}</div>
    ${inner}
  </td></tr>`;
}

// ── TRADES SECTION ────────────────────────────────────────────────────────────
let tradesHtml;
if (!marketOpen) {
  tradesHtml = `<div style="color:#6b7280;font-size:13px;">Markets closed for new orders this session (close-session review).</div>`;
} else if (tradeCount === 0) {
  const why = orch.cash_deployment_rationale || 'No HIGH-conviction signals cleared the trading threshold.';
  tradesHtml = `<div style="color:#6b7280;font-size:13px;">No trades executed. ${esc(why)}</div>`;
} else {
  tradesHtml = [...closes, ...opens].map(tradeCard).join('');
}

// ── REVIEW SECTION ────────────────────────────────────────────────────────────
const review = orch.portfolio_review || [];
const reviewHtml = review.length === 0
  ? `<div style="color:#6b7280;font-size:13px;">No open positions.</div>`
  : `<table width="100%" style="border-collapse:collapse;font-size:13px;">
      <tr style="color:#6b7280;font-size:11px;text-transform:uppercase;">
        <td style="padding:4px 6px;">Ticker</td><td>Action</td><td>Thesis</td><td>Stop</td><td>Days</td></tr>
      ${review.map(p => `<tr style="border-top:1px solid #f0f0f0;">
        <td style="padding:6px;font-weight:600;color:#0f172a;">${esc(p.ticker)}</td>
        <td style="color:${p.current_action === 'HOLD' ? '#6b7280' : '#dc2626'};font-weight:600;">${esc(p.current_action)}</td>
        <td>${p.thesis_intact === false ? '<span style="color:#dc2626;">✗ broken</span>' : '<span style="color:#16a34a;">✓ intact</span>'}</td>
        <td style="color:${p.stop_proximity === 'CRITICAL' ? '#dc2626' : p.stop_proximity === 'WARNING' ? '#d97706' : '#6b7280'};">${esc(p.stop_proximity || '—')}</td>
        <td style="color:#6b7280;">${p.hold_days ?? '?'}d</td></tr>`).join('')}
    </table>`;

// ── WATCHLIST SECTION ─────────────────────────────────────────────────────────
const wl = orch.watchlist || [];
const wlHtml = wl.length === 0
  ? `<div style="color:#6b7280;font-size:13px;">Watchlist empty.</div>`
  : wl.map(w => `<div style="font-size:13px;margin:4px 0;">
      <span style="font-weight:600;color:#0f172a;">${esc(w.ticker)}</span>
      <span style="color:${w.direction === 'BEARISH' ? '#dc2626' : '#16a34a'};font-size:11px;font-weight:600;"> ${esc(w.direction)}</span>
      <span style="color:#6b7280;"> — ${esc(w.trigger || w.reason || '')}</span></div>`).join('');

// ── RISK FLAGS (only if present) ──────────────────────────────────────────────
const earn = ctx.earningsAtRisk || [];
const stops = (ctx.stopProximity || []).filter(s => s.risk === 'CRITICAL' || s.risk === 'WARNING');
let riskHtml = '';
if (earn.length || stops.length) {
  const parts = [];
  earn.forEach(e => parts.push(`<div style="font-size:13px;color:#d97706;">⚠️ ${esc(e.ticker)} earnings in ${e.days_until}d (${e.risk_level})</div>`));
  stops.forEach(s => parts.push(`<div style="font-size:13px;color:${s.risk === 'CRITICAL' ? '#dc2626' : '#d97706'};">${s.risk === 'CRITICAL' ? '🔴' : '⚠️'} ${esc(s.ticker)} stop ${s.distance_pct}% away (${s.risk})</div>`));
  riskHtml = section('Risk Flags', parts.join(''));
}

// ── ASSEMBLE ──────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;padding:20px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="600" align="center" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
  <tr><td style="background:#0f172a;padding:22px 24px;">
    <div style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">${sessType} Session · ${dateStr} ET</div>
    <div style="color:#ffffff;font-size:26px;font-weight:700;font-family:ui-monospace,Menlo,monospace;margin-top:4px;">${fmt$(pv)}</div>
    <div style="font-size:14px;margin-top:4px;">
      <span style="color:${col(alpha)};font-weight:600;">alpha ${fmtP(alpha)}</span>
      <span style="color:#94a3b8;"> · port ${fmtP(portCum)} · SPY ${fmtP(spyCum)}</span></div>
  </td></tr>

  <tr><td style="padding:18px 24px 0;">
    <table width="100%" style="border-collapse:collapse;"><tr>
      ${statCell('Cash', fmt$(cash))}
      ${statCell('Net Exp', netPct.toFixed(0) + '%')}
      ${statCell('Unrealized', fmtP(unreal === 0 ? 0 : (unreal / pv * 100)), col(unreal))}
    </tr></table>
  </td></tr>

  ${section(marketOpen ? `Trades This Session (${tradeCount})` : 'Trades This Session', tradesHtml)}
  ${section('Portfolio Review', reviewHtml)}
  ${section('Orchestrator Summary', `<div style="font-size:13px;color:#374151;line-height:1.6;">${esc(orch.orchestrator_summary || 'No summary recorded.')}</div>`)}
  ${section('Watchlist', wlHtml)}
  ${riskHtml}

  <tr><td style="padding:20px 24px;color:#9ca3af;font-size:11px;border-top:1px solid #f0f0f0;margin-top:12px;">
    ${esc(orch.session_id)} · automated by stocks-investment-agent
  </td></tr>
</table></body></html>`;

return [{ json: { subject, html } }];
