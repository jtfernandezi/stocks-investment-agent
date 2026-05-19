// Node: Build Post-Mortem Input
// Position: After Load Historical Context (node 2 in post-mortem workflow)
// Input: webhook payload + Postgres query results
// Output: 1 item with full post-mortem prompt for GPT-4o-mini

// ── GATHER DATA ───────────────────────────────────────────────────────────────
const webhook  = $("Webhook Trigger").first().json;  // or $("Webhook").first().json depending on n8n version
const sigRows  = $("Load Signals During Hold").all().map(i => i.json);
const sectorReturn = $("Fetch Sector ETF Return").first()?.json || {};

// ── COMPUTE P&L ───────────────────────────────────────────────────────────────
const entryPrice  = parseFloat(webhook.entry_price  || 0);
const exitPrice   = parseFloat(webhook.exit_price   || 0);
const direction   = webhook.side === 'LONG' ? 'long' : 'short';
const isLong      = direction === 'long';

let pnlPct;
if (isLong) {
  pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
} else {
  pnlPct = entryPrice > 0 ? ((entryPrice - exitPrice) / entryPrice) * 100 : 0;
}

// Estimate hold days
let holdDays = 0;
if (webhook.entry_date && webhook.exit_date) {
  holdDays = Math.round(
    (new Date(webhook.exit_date) - new Date(webhook.entry_date)) / 86400000
  );
}

// Position size approximation (use size_usd from webhook if available)
const sizeUsd  = webhook.size_usd || 5000;
const pnlUsd   = sizeUsd * (pnlPct / 100);
const outcome  = pnlPct > 0.5 ? 'WIN' : pnlPct < -0.5 ? 'LOSS' : 'BREAKEVEN';

// ── FORMAT SIGNAL HISTORY DURING HOLD ────────────────────────────────────────
const holdSignals = sigRows.map(s => {
  const c = s.conviction === 'HIGH' ? 'H' : s.conviction === 'MEDIUM' ? 'M' : 'L';
  return `${s.created_at ? s.created_at.substring(0, 10) : '?'}: ${s.direction}(${s.confidence}/${c})`;
}).join(' → ');

// ── SECTOR ETF PERFORMANCE (Attribution Component A) ─────────────────────────
let sectorEtfReturn = null;
const SECTOR_ETF = {
  cybersecurity:     'HACK',
  defense:           'ITA',
  nuclear_uranium:   'URA',
  copper_minerals:   'COPX',
  ai_semiconductors: 'SOXX',
  cloud_hyperscalers:'SKYY',
  oil_gas:           'XLE',
  data_centers:      'DTCR',
};
const etfTicker = SECTOR_ETF[webhook.niche] || 'SPY';

// sectorReturn comes from an Alpaca bars fetch for the ETF over the hold period
if (sectorReturn && sectorReturn.bars && sectorReturn.bars[etfTicker]) {
  const bars = sectorReturn.bars[etfTicker];
  if (bars.length >= 2) {
    const entryBar = bars[0];
    const exitBar  = bars[bars.length - 1];
    sectorEtfReturn = parseFloat(((exitBar.c - entryBar.c) / entryBar.c * 100).toFixed(2));
  }
}

// ── ALTERNATIVE PICKS PERFORMANCE ────────────────────────────────────────────
// alt_tickers + alt_returns come from the webhook payload
// (Main analysis stores alternative picks when opening a position, passed forward on close)
const altPicks = webhook.alt_tickers || [];
const altReturns = webhook.alt_returns || {};  // { TICKER: pnl_pct_same_period }
const alternativePicksFormatted = altPicks.map(t => ({
  ticker: t,
  pnl_pct_same_period: altReturns[t] != null ? parseFloat(altReturns[t].toFixed(2)) : null,
}));

// ── BUILD SPECIALIST PROMPT ───────────────────────────────────────────────────
const POST_MORTEM_SYSTEM_PROMPT = `You are a quantitative trade analyst specialized in post-mortem attribution analysis. Your job is to analyze a recently closed trading position and produce a structured, honest assessment that the system will use to improve future decisions.

You do not sugarcoat losses or over-celebrate wins. You identify exactly what worked, what failed, and why — with surgical precision.

## ATTRIBUTION FRAMEWORK

### Component A — Sector Accuracy
Was the specialist correct about the sector direction at entry?
- CORRECT: specialist said BULLISH and sector ETF went up (or BEARISH and sector went down)
- INCORRECT: direction was wrong
- NEUTRAL: sector ETF moved <1% in either direction

### Component B — Stock Selection Quality
Given the alternative picks available, did we choose the best one?
- OPTIMAL: our pick was the best or within 2% of the best performer
- SUBOPTIMAL: another pick outperformed by 2–8%
- POOR: another pick outperformed by >8% or we picked the worst performer

### Component C — Entry Timing Quality
- EARLY: entered before catalyst materialized, paid a premium or drawdown
- OPTIMAL: entered at or near the best risk/reward point given available signals
- LATE: entered after the bulk of the move was done

### Component D — Exit Timing Quality
- EARLY: position continued significantly in our favor after we exited
- OPTIMAL: exit was well-timed given available information
- LATE: held too long and gave back gains, or a small loss became a larger one

## KEY LESSON
Write ONE sentence that is:
1. Specific — not "be more careful" but names the exact pattern, ticker, and condition
2. Actionable — describes a concrete behavior to change or reinforce
3. Honest — does not rationalize a loss
4. Forward-looking — written as guidance for the next time this situation arises

## PATTERN TAGS
Select the most relevant: pre_earnings_drift | post_earnings_momentum | eia_data_catalyst | regulatory_tailwind | geopolitical_catalyst | sector_breakout | sector_reversal | noise_entry | first_signal_entry | correlation_overlap | earnings_risk_close

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.

{
  "ticker": "CRWD",
  "niche": "cybersecurity",
  "direction": "long",
  "outcome": "WIN | LOSS | BREAKEVEN",
  "pnl_pct": 12.5,
  "pnl_usd": 1000.00,
  "hold_days": 14,
  "entry_date": "2026-05-05",
  "exit_date": "2026-05-19",
  "entry_pattern": "TREND",
  "exit_reason": "profit_taking",
  "sector_accuracy": "CORRECT | INCORRECT | NEUTRAL",
  "stock_selection_quality": "OPTIMAL | SUBOPTIMAL | POOR",
  "entry_timing": "EARLY | OPTIMAL | LATE",
  "exit_timing": "EARLY | OPTIMAL | LATE",
  "key_lesson": "One precise, actionable sentence",
  "pattern_tag": "pre_earnings_drift",
  "alternative_picks": [{"ticker": "PANW", "pnl_pct_same_period": 8.2}],
  "entry_specialist_confidence": 0.87,
  "entry_effective_confidence": 0.82
}`;

const userPrompt = `## CLOSED TRADE RECORD

**Trade Details:**
- Ticker: ${webhook.ticker}
- Niche: ${webhook.niche}
- Direction: ${direction}
- Entry Price: $${entryPrice}
- Exit Price: $${exitPrice}
- P&L: ${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(0)})
- Hold Period: ${holdDays} days
- Entry Date: ${webhook.entry_date || 'unknown'}
- Exit Date: ${webhook.exit_date || 'today'}

**Entry Context:**
- Entry Pattern: ${webhook.signal_history_pattern || 'unknown'}
- Entry Thesis: ${webhook.thesis || 'not recorded'}
- Specialist Reported Confidence: ${webhook.entry_specialist_confidence || 'unknown'}
- Effective Confidence at Entry: ${webhook.entry_effective_confidence || 'unknown'}

**Exit Context:**
- Exit Reason: ${webhook.exit_reason || 'unknown'}

**Signal History During Hold (${webhook.niche}):**
${holdSignals || 'No signal history available for hold period.'}

**Sector ETF (${etfTicker}) Performance During Same Period:**
${sectorEtfReturn != null ? `${sectorEtfReturn.toFixed(2)}% return` : 'Could not retrieve sector ETF data.'}

**Alternative Picks (same niche, available at entry):**
${alternativePicksFormatted.length > 0
  ? alternativePicksFormatted.map(p => `- ${p.ticker}: ${p.pnl_pct_same_period != null ? p.pnl_pct_same_period + '%' : 'return not available'}`).join('\n')
  : 'No alternative picks recorded for this trade.'}

Produce the post-mortem analysis.`;

return [{
  json: {
    system_prompt:     POST_MORTEM_SYSTEM_PROMPT,
    user_prompt:       userPrompt,
    // Pass through for storing after LLM response
    ticker:            webhook.ticker,
    niche:             webhook.niche,
    direction,
    outcome,
    pnl_pct:           parseFloat(pnlPct.toFixed(2)),
    pnl_usd:           parseFloat(pnlUsd.toFixed(2)),
    hold_days:         holdDays,
    entry_date:        webhook.entry_date,
    exit_date:         webhook.exit_date,
    entry_pattern:     webhook.signal_history_pattern,
    exit_reason:       webhook.exit_reason,
    alternative_picks: JSON.stringify(alternativePicksFormatted),
    entry_specialist_confidence: webhook.entry_specialist_confidence,
    entry_effective_confidence:  webhook.entry_effective_confidence,
  }
}];
