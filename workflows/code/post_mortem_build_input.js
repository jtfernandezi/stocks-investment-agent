// Node: Build Post-Mortem Input
// Position: After Load Historical Context (node 2 in post-mortem workflow)
// Input: webhook payload + Postgres query results
// Output: 1 item with full post-mortem prompt for GPT-4o-mini

// ── GATHER DATA ───────────────────────────────────────────────────────────────
const webhook  = $("Workflow Trigger").first().json;
const sigRows  = $("Load Signals During Hold").all().map(i => i.json);

// Actual entry date and price from Neon position_metadata (stored at BUY/SHORT time)
let posEntry = {};
try { posEntry = $("Load Position Entry").first().json || {}; } catch (_) {}

// ETF return for hold period from Compute ETF Return node
let sectorEtfReturn = null;
try {
  const etfCtx = $("Compute ETF Return").first().json || {};
  sectorEtfReturn = (etfCtx.etf_return != null) ? etfCtx.etf_return : null;
} catch (_) {}

// ── COMPUTE P&L ───────────────────────────────────────────────────────────────
// Prefer entry_price from position_metadata (recorded at execution time) over webhook value
const entryPrice  = parseFloat(posEntry.entry_price || webhook.entry_price  || 0);
const exitPrice   = parseFloat(webhook.exit_price   || 0);
// webhook.side is 'LONG'/'SHORT'; webhook.direction is 'long'/'short' — accept either
const direction   = (webhook.side === 'LONG' || webhook.direction === 'long') ? 'long' : 'short';
const isLong      = direction === 'long';

let pnlPct;
if (isLong) {
  pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
} else {
  pnlPct = entryPrice > 0 ? ((entryPrice - exitPrice) / entryPrice) * 100 : 0;
}

// Actual entry date from position_metadata; fallback to 30-day approximation until backfilled
const exitDate    = webhook.exit_date || new Date().toISOString().split('T')[0];
const actualEntryDate = posEntry.entry_date
  ? posEntry.entry_date.toString().substring(0, 10)
  : new Date(new Date(exitDate).getTime() - 30 * 86400000).toISOString().split('T')[0];

// Hold days from actual dates
const holdDays = Math.round(
  (new Date(exitDate) - new Date(actualEntryDate)) / 86400000
);

const sizeUsd  = webhook.size_usd || 5000;
const pnlUsd   = sizeUsd * (pnlPct / 100);
const outcome  = pnlPct > 0.5 ? 'WIN' : pnlPct < -0.5 ? 'LOSS' : 'BREAKEVEN';

// ── FORMAT SIGNAL HISTORY DURING HOLD ────────────────────────────────────────
const holdSignals = sigRows.map(s => {
  const c = s.conviction === 'HIGH' ? 'H' : s.conviction === 'MEDIUM' ? 'M' : 'L';
  return `${s.created_at ? s.created_at.substring(0, 10) : '?'}: ${s.direction}(${s.confidence}/${c})`;
}).join(' → ');

// ── SECTOR ETF PERFORMANCE (Attribution Component A) ─────────────────────────
const SECTOR_ETF = {
  cybersecurity:     'HACK',
  defense:           'ITA',
  nuclear_uranium:   'URA',
  copper_minerals:   'COPX',
  semiconductors:    'SOXX',
  enterprise_saas:   'SKYY',
  oil_gas:           'XLE',
  data_centers:      'DTCR',
};
const etfTicker     = SECTOR_ETF[webhook.niche] || 'SPY';
// sectorEtfReturn populated from Compute ETF Return node (see top of file)

// ── BUILD SPECIALIST PROMPT ───────────────────────────────────────────────────
const POST_MORTEM_SYSTEM_PROMPT = `You are a quantitative trade analyst specialized in post-mortem attribution analysis.
Your job is to analyze a recently closed trading position and produce a structured,
honest assessment that the system will use to improve future decisions.

You do not sugarcoat losses or over-celebrate wins. You identify exactly what worked,
what failed, and why — with surgical precision. Your analysis feeds directly into the
learning system, so accuracy and honesty are more valuable than optimism.

## YOUR INPUT
You receive the complete record of a closed position:

- TRADE DETAILS: ticker, niche, direction (long/short), entry price, exit price,
  P&L in % and $, hold period in days
- ENTRY CONTEXT: the original thesis written by the Portfolio Manager when opening
  the position, the signal pattern at entry (TREND/BIAS/NOISE/REVERSAL/FIRST_SIGNAL),
  the specialist's reported confidence, and the system's effective_confidence at entry
- EXIT CONTEXT: why the position was closed (thesis_flip / trailing_stop /
  earnings_risk / profit_taking / target_reached)
- SIGNAL HISTORY DURING HOLD: what the specialist said in each session while the
  position was open (direction + confidence per session)
- SECTOR PERFORMANCE: how the sector ETF benchmark performed during the same period

## YOUR ANALYTICAL FRAMEWORK

### Attribution Component A — Sector Accuracy
Was the specialist correct about the sector direction?
Compare the specialist's signal direction at entry against the actual sector
performance (sector ETF return) during the hold period.
- CORRECT: specialist said BULLISH and sector went up, or BEARISH and sector went down
- INCORRECT: specialist said BULLISH but sector went down, or BEARISH but sector went up
- NEUTRAL: sector movement was <1% in either direction (inconclusive)

This isolates whether the specialist's macro sector call was right, independently
of the specific stock outcome.

### Attribution Component B — Entry Timing Quality
Did we enter at a good point in the trend?
Analyze the signal history before our entry. Consider:
- Did we enter on a TREND pattern (4+/5 confirming sessions)?
  → Entry timing quality is measured by whether we caught the move early.
- Did we enter on a BIAS pattern?
  → Were there confirming signals building, or were we early?
- Did we enter on NOISE or FIRST_SIGNAL?
  → Regardless of outcome, note that the entry was premature by pattern standards.

Assessment:
- EARLY: we entered before the catalyst materialized — paid a premium or waited
  through drawdown before the thesis played out
- OPTIMAL: we entered at or near the best risk/reward point given available signals
- LATE: we entered after the bulk of the move was already done — limited upside,
  expanded downside

### Attribution Component C — Exit Timing Quality
Did we exit at the right time?
- For SELL/COVER via thesis_flip: was this the right call? Did the stock continue
  in our direction after we exited (we exited too early) or did it reverse further
  (we exited correctly)?
- For SELL/COVER via trailing_stop: the trailing stop protected us. Was the stop
  level appropriate? Did the stock recover significantly after stopping us out?
- For SELL/COVER via profit_taking: did we leave significant gains on the table?
  Or did the stock reverse after our exit (confirming the exit was optimal)?
- For SELL/COVER via earnings_risk: smart risk management regardless of outcome.
  Note what actually happened post-earnings for future reference.

Assessment:
- EARLY: the position continued significantly in our favor after we exited
  (left money on the table)
- OPTIMAL: the exit was well-timed given the information available
- LATE: we held too long and gave back gains, or a smaller loss became a larger one

### Pattern Tag Assignment
Categorize the trade into one of these setup archetypes:
- pre_earnings_drift: entered before earnings expecting a run-up, exited before report
- post_earnings_momentum: entered after earnings on strong results
- eia_data_catalyst: oil/energy trade driven by EIA weekly inventory data
- regulatory_tailwind: sector benefiting from specific legislation or government action
- geopolitical_catalyst: defense or energy trade driven by geopolitical event
- sector_breakout: entry on confirmed sector trend breakout to new highs
- sector_reversal: entry on confirmed trend reversal from extended downtrend
- noise_entry: entered despite mixed/noise signal pattern — use as warning tag
- first_signal_entry: entered without historical signal context — use as caution tag
- correlation_overlap: trade in a sector highly correlated with another open position
- earnings_risk_close: closed proactively before binary earnings event

### Key Lesson Generation
Write ONE sentence that is:
1. Specific — not "be more careful" but "NOISE pattern entries in cybersecurity
   have consistently failed when the catalyst is regulatory rather than a breach"
2. Actionable — describes a concrete behavior to change or reinforce
3. Honest — does not rationalize a loss or minimize a mistake
4. Forward-looking — written as guidance for the next time this situation arises

Bad lesson: "The trade didn't work out as expected."
Bad lesson: "We should be more selective."
Good lesson: "Entered OKTA on NOISE pattern despite penalty — sector was bullish but
OKTA specifically had earnings in 8 days and we ignored the MEDIUM earnings risk flag."
Good lesson: "Pre-earnings drift on CRWD worked perfectly — 14-day hold, entered
before catalyst, exited before binary event. This setup has now worked 3 consecutive times."

## WHAT YOU DO NOT DO
- Do not assign blame to market conditions outside the system's control (macro crashes,
  Fed surprise decisions) unless they were predictable from available inputs
- Do not call a loss a "learning experience" without specifying exactly what to learn
- Do not attribute a win entirely to good analysis if luck played a significant role
- Do not produce vague assessments — every component must have a specific justification
- Do not generate more than one key_lesson — one precise sentence is worth more than
  three vague ones

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.

{
  "ticker": "CRWD",
  "niche": "cybersecurity",
  "direction": "long",
  "outcome": "WIN" | "LOSS" | "BREAKEVEN",
  "pnl_pct": 12.5,
  "pnl_usd": 1000.00,
  "hold_days": 14,
  "entry_date": "2026-05-05",
  "exit_date": "2026-05-19",
  "entry_pattern": "TREND",
  "exit_reason": "profit_taking",
  "sector_accuracy": "CORRECT" | "INCORRECT" | "NEUTRAL",
  "entry_timing": "EARLY" | "OPTIMAL" | "LATE",
  "exit_timing": "EARLY" | "OPTIMAL" | "LATE",
  "key_lesson": "One precise, actionable sentence about what to replicate or avoid",
  "pattern_tag": "pre_earnings_drift",
  "entry_specialist_confidence": 0.87,
  "entry_effective_confidence": 0.87
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
- Entry Date: ${actualEntryDate}
- Exit Date: ${exitDate}

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
    entry_date:        actualEntryDate,
    exit_date:         exitDate,
    entry_pattern:     webhook.signal_history_pattern,
    exit_reason:       webhook.exit_reason,
    entry_specialist_confidence: webhook.entry_specialist_confidence,
    entry_effective_confidence:  webhook.entry_effective_confidence,
  }
}];
