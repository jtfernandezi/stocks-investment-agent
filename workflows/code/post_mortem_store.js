// Node: Parse & Store Post-Mortem
// Position: After Call Post-Mortem LLM
// Parses GPT-4o-mini response and prepares the Neon INSERT payload.
// Output: 1 item ready for the Postgres INSERT node.

const llmResponse = $input.first().json;
const inputCtx    = $("Build Post-Mortem Input").first().json;

let parsed   = null;
let rawText  = '';

try {
  // native OpenAI v1.3 outputs each choice as an item: {message: {content: "..."}}
  rawText = llmResponse.message?.content ?? '';
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  parsed   = JSON.parse(cleaned);
} catch (err) {
  // Fallback — store what we know from the webhook context
  parsed = {
    ticker:                   inputCtx.ticker,
    niche:                    inputCtx.niche,
    direction:                inputCtx.direction,
    outcome:                  inputCtx.outcome,
    pnl_pct:                  inputCtx.pnl_pct,
    pnl_usd:                  inputCtx.pnl_usd,
    hold_days:                inputCtx.hold_days,
    entry_date:               inputCtx.entry_date,
    exit_date:                inputCtx.exit_date,
    entry_pattern:            inputCtx.entry_pattern,
    exit_reason:              inputCtx.exit_reason,
    sector_accuracy:          'NEUTRAL',
    stock_selection_quality:  'SUBOPTIMAL',
    entry_timing:             'OPTIMAL',
    exit_timing:              'OPTIMAL',
    key_lesson:               `Parse error — manual review needed for ${inputCtx.ticker} post-mortem.`,
    pattern_tag:              'noise_entry',
    alternative_picks:        [],
    entry_specialist_confidence: inputCtx.entry_specialist_confidence || 0,
    entry_effective_confidence:  inputCtx.entry_effective_confidence  || 0,
  };
}

// Ensure required fields have values (fill from context if LLM omitted them)
const final = {
  ticker:                   parsed.ticker       || inputCtx.ticker,
  niche:                    parsed.niche        || inputCtx.niche,
  direction:                parsed.direction    || inputCtx.direction,
  outcome:                  parsed.outcome      || inputCtx.outcome,
  pnl_pct:                  parsed.pnl_pct      ?? inputCtx.pnl_pct,
  pnl_usd:                  parsed.pnl_usd      ?? inputCtx.pnl_usd,
  hold_days:                parsed.hold_days    ?? inputCtx.hold_days,
  entry_date:               parsed.entry_date   || inputCtx.entry_date,
  exit_date:                parsed.exit_date    || inputCtx.exit_date,
  entry_pattern:            parsed.entry_pattern || inputCtx.entry_pattern,
  exit_reason:              parsed.exit_reason  || inputCtx.exit_reason,
  sector_accuracy:          parsed.sector_accuracy          || 'NEUTRAL',
  stock_selection_quality:  parsed.stock_selection_quality  || 'SUBOPTIMAL',
  entry_timing:             parsed.entry_timing             || 'OPTIMAL',
  exit_timing:              parsed.exit_timing              || 'OPTIMAL',
  key_lesson:               parsed.key_lesson               || '',
  pattern_tag:              parsed.pattern_tag              || 'noise_entry',
  alternative_picks:        JSON.stringify(parsed.alternative_picks || inputCtx.alternative_picks || []),
  entry_specialist_confidence: parsed.entry_specialist_confidence ?? inputCtx.entry_specialist_confidence ?? 0,
  entry_effective_confidence:  parsed.entry_effective_confidence  ?? inputCtx.entry_effective_confidence  ?? 0,
};

return [{ json: final }];
