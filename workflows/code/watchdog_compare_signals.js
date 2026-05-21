// Node: Compare Watchdog Signals
// Position: After all 8 watchdog specialist branches merge
// Reads open positions context (from Has Open Positions?) and fresh watchdog signals.
// Flip logic: LONG + BEARISH/NEUTRAL → flip | SHORT + BULLISH/NEUTRAL → flip
// Threshold: confidence ≥ 0.60 AND materiality != LOW
// Returns empty (stops execution) if no actionable flips.
// Output: 1 item with flip list → triggers orchestrator via Execute Workflow.

const signals = $input.all().map(i => i.json);
const posCtx  = $("Has Open Positions?").first().json;

const signalByNiche = {};
for (const s of signals) {
  signalByNiche[s.niche] = s;
}

const flips = [];

for (const niche of (posCtx.open_niches || [])) {
  const signal = signalByNiche[niche];
  const pos    = posCtx.positions_by_niche?.[niche];

  if (!signal || !pos) continue;

  // Apply thresholds before flip check
  if (signal.confidence < 0.60)        continue;
  if (signal.materiality === 'LOW')     continue;

  let flipType = null;
  if (pos.has_long  && (signal.direction === 'BEARISH' || signal.direction === 'NEUTRAL')) {
    flipType = 'long_thesis_broken';
  }
  if (pos.has_short && (signal.direction === 'BULLISH' || signal.direction === 'NEUTRAL')) {
    flipType = flipType ? 'both_sides_broken' : 'short_thesis_broken';
  }

  if (!flipType) continue;

  flips.push({
    niche,
    flip_type:    flipType,
    direction:    signal.direction,
    confidence:   signal.confidence,
    materiality:  signal.materiality,
    key_headline: signal.key_headline || null,
    reasoning:    signal.reasoning    || null,
    tickers:      pos.tickers,
    has_long:     pos.has_long,
    has_short:    pos.has_short,
  });
}

if (flips.length === 0) return [];

return [{
  json: {
    flip_count:       flips.length,
    flips,
    checked_at:       new Date().toISOString(),
    open_niche_count: posCtx.open_niches.length,
    trigger_reason:   `Thesis flip detected in: ${flips.map(f => f.niche).join(', ')}`,
    session_type:     'watchdog_flip',
  }
}];
