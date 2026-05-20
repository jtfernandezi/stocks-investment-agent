// Node: Parse & Save All Signals
// Position: After Merge All Signals (receives 8 items — one per niche)
// Input: 8 items, each { niche, session_id, message: { content: "..." } }
// Output: 8 items with parsed signal data for Build Orchestrator Input
// Side output: also feeds Store All Signals (Postgres INSERT per item)

const inputs = $input.all();
const ctx    = $("Compute Derived Metrics").first().json;

return inputs.map(item => {
  const niche      = item.json.niche;
  const session_id = item.json.session_id;

  let parsedSignal = null, parseError = null, rawContent = '';
  try {
    rawContent    = item.json.message?.content ?? '';
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsedSignal  = JSON.parse(cleaned);
  } catch (err) {
    parseError   = `JSON parse failed: ${err.message}. Raw: ${String(rawContent).substring(0, 200)}`;
    parsedSignal = {
      niche,
      direction:        'NEUTRAL',
      conviction:       'LOW',
      confidence:       0.40,
      materiality:      'LOW',
      macro_assessment: 'Parse error — signal unavailable this session.',
      long_picks:       [],
      short_picks:      [],
      summary:          `Parse error for ${niche}. Raw response stored for debugging.`,
    };
  }

  // Normalize conviction
  const validConvictions = ['HIGH', 'MEDIUM', 'LOW'];
  if (!validConvictions.includes(parsedSignal.conviction)) parsedSignal.conviction = 'LOW';

  // Apply confidence scaling
  const acc = ctx.specialistEffectiveConf[niche];
  let effective_confidence = parsedSignal.confidence || 0;
  let scaling_factor       = 1.0;
  if (acc && acc.scaling_factor && acc.total_signals >= 5) {
    scaling_factor       = acc.scaling_factor;
    effective_confidence = parseFloat((parsedSignal.confidence * scaling_factor).toFixed(3));
    effective_confidence = Math.min(1.0, Math.max(0.0, effective_confidence));
  }

  // Downgrade conviction if confidence too low
  let effective_conviction = parsedSignal.conviction;
  if (effective_confidence < 0.60) {
    effective_conviction   = 'LOW';
    parsedSignal.direction = 'NEUTRAL';
  } else if (effective_confidence < 0.75 && parsedSignal.conviction === 'HIGH') {
    effective_conviction = 'MEDIUM';
  }

  // SQL escape for Postgres string interpolation
  const sqlEsc = s => (s || '').replace(/'/g, "''");

  return {
    json: {
      // For Postgres INSERT (Store All Signals node)
      niche,
      session:     session_id,
      direction:   parsedSignal.direction,
      conviction:  effective_conviction,
      confidence:  parsedSignal.confidence,
      materiality: parsedSignal.materiality,
      top_picks:   sqlEsc(JSON.stringify({
        long_picks:  parsedSignal.long_picks  || [],
        short_picks: parsedSignal.short_picks || [],
      })),
      summary:  sqlEsc(parsedSignal.summary),
      raw_json: sqlEsc(JSON.stringify(parsedSignal)),

      // For orchestrator consumption
      effective_confidence,
      effective_conviction,
      scaling_factor,
      macro_assessment: parsedSignal.macro_assessment,
      long_picks:       parsedSignal.long_picks  || [],
      short_picks:      parsedSignal.short_picks || [],

      // Metadata
      parse_error:  parseError,
      usage_tokens: item.json.usage?.total_tokens ?? null,
    }
  };
});
