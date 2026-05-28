// Node: Build Letter Prompt
// Position: After Save Snapshot — close sessions only (guarded by IF "Is Close Session?")
// Assembles system + user prompt for GPT to write the institutional investor letter
// Output: 1 item with system_prompt + user_prompt + session_id

const orch      = $("Parse Orchestrator Output").first().json;
const orchInput = $("Build Orchestrator Input").first().json;
const ctx       = $("Compute Derived Metrics").first().json;

// ── Session & date ────────────────────────────────────────────────────────────
const sessionId     = orch.session_id;
const dateStr       = sessionId.split('_')[0];
const d             = new Date(dateStr + 'T12:00:00Z');
const formattedDate = d.toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
});

// ── Account metrics ───────────────────────────────────────────────────────────
const account        = orch.account || {};
const portfolioValue = parseFloat(account.portfolio_value || 0);
const lastEquity     = parseFloat(account.last_equity || portfolioValue);
const cash           = parseFloat(account.cash || 0);
const longValue      = parseFloat(account.long_market_value || 0);
const shortValue     = Math.abs(parseFloat(account.short_market_value || 0));
const dayPnl         = portfolioValue - lastEquity;
const dayPnlPct      = lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;
const dayBps         = Math.round(dayPnlPct * 100);
const netExpPct      = portfolioValue > 0 ? (longValue - shortValue) / portfolioValue * 100 : 0;

const spyCumPct  = orch.spyCumulativePct  || ctx.spyCumulativePct  || 0;
const portCumPct = ctx.portfolioCumulativePct || 0;
const alpha      = (portCumPct - spyCumPct).toFixed(2);

// ── Open positions (thesis-focused) ──────────────────────────────────────────
const positions  = orch.open_positions || [];
const enriched   = ctx.positions || [];

// Build thesis map: metadata first, fall back to action thesis for new entries
const metaMap = {};
for (const p of enriched) {
  if (p.symbol) metaMap[p.symbol] = p;
}
const actionThesisMap = {};
for (const a of (orch.portfolio_actions || [])) {
  if (a.ticker && a.thesis) actionThesisMap[a.ticker] = a.thesis;
}

const longs  = positions.filter(p => parseFloat(p.qty) > 0);
const shorts = positions.filter(p => parseFloat(p.qty) < 0);

function fmtPos(p) {
  const side     = parseFloat(p.qty) > 0 ? 'Long' : 'Short';
  const pnlPct   = (parseFloat(p.unrealized_plpc) * 100).toFixed(1);
  const sign     = parseFloat(p.unrealized_pl) >= 0 ? '+' : '';
  const meta     = metaMap[p.symbol] || {};
  const daysHeld = meta.days_held != null ? `${meta.days_held}d` : '—';
  const thesis   = meta.entry_thesis || actionThesisMap[p.symbol] || '—';
  return `  ${p.symbol} (${side}, held ${daysHeld}, ${sign}${pnlPct}%): ${thesis}`;
}

const positionsText = positions.length > 0
  ? [...longs, ...shorts].map(fmtPos).join('\n')
  : '  Flat — no open positions.';

// ── Trades executed (plain English) ──────────────────────────────────────────
const actions     = orch.portfolio_actions || [];
const actionsText = actions.length > 0
  ? actions.map(a => {
      const dir = a.action === 'BUY'   ? 'Entered long'   :
                  a.action === 'SHORT' ? 'Entered short'  :
                  a.action === 'SELL'  ? 'Exited long'    : 'Covered short';
      return `  ${dir} ${a.ticker} ($${a.size_usd || '—'}): ${a.thesis || a.exit_reason || '—'}`;
    }).join('\n')
  : '  No trades executed this session.';

// ── Sector outlook (plain English rotation) ───────────────────────────────────
const rotation      = ctx.rotationSummary || [];
const sectorText    = rotation.length > 0
  ? rotation.map(r => {
      const niche    = r.niche.replace(/_/g, ' ');
      const dir      = r.current_direction || 'NEUTRAL';
      const momentum = r.momentum || 'STABLE';
      return `  ${niche}: ${dir}, momentum ${momentum}`;
    }).join('\n')
  : '  No sector data available.';

// ── Watchlist ─────────────────────────────────────────────────────────────────
const watchlist     = (orch.watchlist || []).length > 0 ? orch.watchlist : (ctx.watchlist || []);
const watchlistText = watchlist.length > 0
  ? watchlist.map(w =>
      `  ${w.ticker} (${w.direction || '—'}): ${w.reason || '—'}${w.trigger ? ` — trigger: ${w.trigger}` : ''}`
    ).join('\n')
  : '  Nothing on watchlist this session.';

// ── Earnings at-risk (open positions only) ────────────────────────────────────
const earningsAtRisk = ctx.earningsAtRisk || [];
const earningsText   = earningsAtRisk.length > 0
  ? earningsAtRisk.map(e => `  ${e.ticker}: earnings in ${e.days_until} day(s) (${e.risk_level})`).join('\n')
  : '  None in the next 7 days.';

// ── Portfolio manager notes ───────────────────────────────────────────────────
const orchSummary = orch.orchestrator_summary || '(none)';

// ── Prompts ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the portfolio manager of Alpha Agent Capital, an AI-driven equity fund. Each trading day you write a close-of-day letter to your limited partners.

Write like a practitioner: clear thinking, genuine conviction, honest assessment. Think Howard Marks' clarity or Seth Klarman's directness — not a press release.

What the letter must cover, in prose:
1. The day's result and market backdrop in one or two sentences.
2. The key decision(s) this session — what was entered, exited, or deliberately held, and why. Lead with the thesis, not the numbers. This is the heart of the letter.
3. The current book — what we hold, where the conviction is strongest, how the stop discipline is protecting the portfolio.
4. The watchlist — what the fund is monitoring and what conditions would trigger an entry.
5. Forward posture — how we are positioned heading into the next session and what catalysts or risks we are watching.

Style rules:
- Flowing prose. A blank line between paragraphs is fine. No markdown, no bullet lists, no section titles.
- Numbers appear naturally within sentences — never as standalone data blocks.
- No internal jargon: never write "effective confidence", "signal patterns", "specialist LLM", or "orchestrator". Write as if these are your own views.
- Describe positions by their investment thesis, not their data fields.
- Length: 4–5 paragraphs. Substantive, not verbose.
- Begin: "Dear Limited Partners,"
- Close with a line break then: "Respectfully,\\n\\nAlpha Agent Investment Committee\\nAutomated Systematic Equity Strategy — Paper Portfolio"`;

const USER_PROMPT = `DATE: ${formattedDate}

--- PERFORMANCE ---
Portfolio: $${portfolioValue.toFixed(0)} | Day: ${dayPnl >= 0 ? '+' : ''}$${Math.abs(dayPnl).toFixed(0)} (${dayPnl >= 0 ? '+' : ''}${dayBps} bps)
Cumulative: ${portCumPct >= 0 ? '+' : ''}${portCumPct.toFixed(2)}% vs SPY ${spyCumPct >= 0 ? '+' : ''}${spyCumPct.toFixed(2)}% | Alpha: ${parseFloat(alpha) >= 0 ? '+' : ''}${alpha}%
Net exposure: ${netExpPct.toFixed(1)}% | Longs: ${longs.length} | Shorts: ${shorts.length} | Cash: $${cash.toFixed(0)}

--- CURRENT POSITIONS ---
${positionsText}

--- TRADES THIS SESSION ---
${actionsText}

--- SECTOR OUTLOOK ---
${sectorText}

--- WATCHLIST ---
${watchlistText}

--- EARNINGS AT RISK (next 7 days) ---
${earningsText}

--- PORTFOLIO MANAGER NOTES ---
${orchSummary}

Write the investor letter.`;

return [{
  json: {
    system_prompt: SYSTEM_PROMPT,
    user_prompt:   USER_PROMPT,
    session_id:    sessionId,
  }
}];
