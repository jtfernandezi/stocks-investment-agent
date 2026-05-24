// Node: Build Letter Prompt
// Position: After Save Snapshot — close sessions only (guarded by IF "Is Close Session?")
// Assembles system + user prompt for GPT to write the institutional investor letter
// Output: 1 item with system_prompt + user_prompt + session_id

const orch     = $("Parse Orchestrator Output").first().json;
const orchInput = $("Build Orchestrator Input").first().json;
const ctx      = $("Compute Derived Metrics").first().json;

// ── Account metrics ───────────────────────────────────────────────────────────
const sessionId      = orch.session_id;
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
const grossExpPct    = portfolioValue > 0 ? (longValue + shortValue) / portfolioValue * 100 : 0;

const spyCumPct  = orch.spyCumulativePct || ctx.spyCumulativePct || 0;
const portCumPct = ctx.portfolioCumulativePct || 0;
const alpha      = (portCumPct - spyCumPct).toFixed(2);

// ── Date from session ─────────────────────────────────────────────────────────
const dateStr       = sessionId.split('_')[0]; // YYYY-MM-DD
const d             = new Date(dateStr + 'T12:00:00Z');
const formattedDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ── Open positions ────────────────────────────────────────────────────────────
const positions = orch.open_positions || [];
const longs  = positions.filter(p => parseFloat(p.qty) > 0);
const shorts = positions.filter(p => parseFloat(p.qty) < 0);

function fmtPos(p) {
  const unrealPct = (parseFloat(p.unrealized_plpc) * 100).toFixed(1);
  const unrealUsd = parseFloat(p.unrealized_pl).toFixed(0);
  const side      = parseFloat(p.qty) > 0 ? 'LONG' : 'SHORT';
  const sign      = parseFloat(p.unrealized_pl) >= 0 ? '+' : '';
  return `  ${p.symbol} (${side}): entry $${parseFloat(p.avg_entry_price).toFixed(2)}, current $${parseFloat(p.current_price).toFixed(2)}, P&L ${sign}${unrealPct}% (${sign}$${unrealUsd})`;
}

const positionsText = positions.length > 0
  ? [...longs, ...shorts].map(fmtPos).join('\n')
  : '  Flat — no open positions.';

// ── Trade actions ─────────────────────────────────────────────────────────────
const actions = orch.portfolio_actions || [];
const actionsText = actions.length > 0
  ? actions.map(a => {
      const reason = a.exit_reason || '';
      return `  ${a.action} ${a.ticker}: ${a.thesis || reason}. Size: $${a.size_usd || '—'}, eff. conf: ${a.effective_confidence || '—'}`;
    }).join('\n')
  : '  No trades executed this session.';

// ── Specialist signals ────────────────────────────────────────────────────────
const specialists = (orchInput.specialists_summary || []).map(s => {
  const longPicks  = (s.long_picks  || []).map(p => p.ticker).join(', ') || 'none';
  const shortPicks = (s.short_picks || []).map(p => p.ticker).join(', ') || 'none';
  const confPct    = ((s.effective_confidence || 0) * 100).toFixed(0);
  return `  ${s.niche}: ${s.direction} (conf: ${confPct}%) | Long: ${longPicks} | Short: ${shortPicks}`;
}).join('\n');

// ── Orchestrator session notes ────────────────────────────────────────────────
const orchSummary = orch.orchestrator_summary || '(none)';

// ── Prompts ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Chief Investment Officer of Alpha Agent Capital, an AI-driven paper trading fund. You are writing the daily investor letter to our limited partners after the close of today's session.

Your letter must sound like it was written by a seasoned hedge fund manager: precise, confident, data-driven, and with a clear narrative arc. Think Bill Ackman meets Ray Dalio in clarity and conviction.

Rules:
- Write in flowing prose. No bullet points, no section headers, no markdown.
- Begin with "Dear Limited Partners,"
- Embed numbers naturally (e.g., "the book closed at $63,400, up 55 basis points on the session")
- Reference specific positions and performance by name
- Explain the logic behind today's decisions in plain English
- Close with a forward-looking paragraph, then sign off:
  "Respectfully yours,\n\nAlpha Agent Investment Committee\nAutomated Systematic Equity Strategy — Paper Portfolio"
- Length: 4–6 paragraphs. Substantive but not verbose.`;

const USER_PROMPT = `DATE: ${formattedDate}
SESSION: ${sessionId}

--- PORTFOLIO METRICS ---
Portfolio value: $${portfolioValue.toFixed(0)}
Day P&L: ${dayPnl >= 0 ? '+' : ''}$${Math.abs(dayPnl).toFixed(0)} (${dayPnl >= 0 ? '+' : ''}${dayPnlPct.toFixed(2)}%, ${dayBps >= 0 ? '+' : ''}${dayBps} bps)
Cash: $${cash.toFixed(0)}
Net exposure: ${netExpPct.toFixed(1)}% | Gross: ${grossExpPct.toFixed(1)}%
Longs: ${longs.length} | Shorts: ${shorts.length}
Cumulative return: ${portCumPct >= 0 ? '+' : ''}${portCumPct.toFixed(2)}% vs SPY ${spyCumPct >= 0 ? '+' : ''}${spyCumPct.toFixed(2)}% | Alpha: ${parseFloat(alpha) >= 0 ? '+' : ''}${alpha}%

--- OPEN POSITIONS ---
${positionsText}

--- TRADES EXECUTED TODAY ---
${actionsText}

--- SPECIALIST SIGNALS ---
${specialists}

--- ORCHESTRATOR SESSION NOTES ---
${orchSummary}

---

Write the investor letter for today's close session.`;

return [{
  json: {
    system_prompt: SYSTEM_PROMPT,
    user_prompt:   USER_PROMPT,
    session_id:    sessionId,
  }
}];
