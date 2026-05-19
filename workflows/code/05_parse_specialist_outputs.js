// Node: Parse Specialist Outputs
// Position: After Call Specialist LLM (OpenAI HTTP Request — 8 items)
// Input: 8 items, each is the raw OpenAI API response for one niche
// Output: 8 items with parsed specialist signal + metadata for Neon insert

const inputs     = $input.all();
const niches     = $("Build Specialist Inputs").all().map(i => i.json);
const ctx        = $("Compute Derived Metrics").first().json;

return inputs.map((item, idx) => {
  const nicheData    = niches[idx];
  const niche        = nicheData.niche;
  const session_id   = nicheData.session_id;
  const rawResponse  = item.json;

  // Extract the content from OpenAI response
  let parsedSignal = null;
  let parseError   = null;
  let rawContent   = '';

  try {
    rawContent = rawResponse.choices[0].message.content;
    // Strip any accidental markdown fences (defensive — model was told not to use them)
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsedSignal  = JSON.parse(cleaned);
  } catch (err) {
    parseError = `JSON parse failed: ${err.message}. Raw: ${rawContent.substring(0, 200)}`;
    // Fallback signal — marks the niche as unreliable this session
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

  // Apply effective confidence scaling (do not let the specialist bypass calibration)
  const acc = ctx.specialistEffectiveConf[niche];
  let effective_confidence = parsedSignal.confidence || 0;
  let scaling_factor       = 1.0;

  if (acc && acc.scaling_factor && acc.total_signals >= 5) {
    scaling_factor       = acc.scaling_factor;
    effective_confidence = parseFloat((parsedSignal.confidence * scaling_factor).toFixed(3));
    // Clamp to [0, 1]
    effective_confidence = Math.min(1.0, Math.max(0.0, effective_confidence));
  }

  // Downgrade conviction if effective_confidence falls below thresholds
  let effective_conviction = parsedSignal.conviction;
  if (effective_confidence < 0.60) {
    effective_conviction = 'LOW';
    parsedSignal.direction = 'NEUTRAL';  // insufficient confidence → NEUTRAL
  } else if (effective_confidence < 0.75 && parsedSignal.conviction === 'HIGH') {
    effective_conviction = 'MEDIUM';
  }

  return {
    json: {
      // For Postgres insert
      niche,
      session:     session_id,
      direction:   parsedSignal.direction,
      conviction:  effective_conviction,
      confidence:  parsedSignal.confidence,   // raw reported
      materiality: parsedSignal.materiality,
      top_picks:   JSON.stringify({
        long_picks:  parsedSignal.long_picks  || [],
        short_picks: parsedSignal.short_picks || [],
      }),
      summary:     parsedSignal.summary,
      raw_json:    JSON.stringify(parsedSignal),

      // For orchestrator consumption
      effective_confidence,
      effective_conviction,
      scaling_factor,
      macro_assessment: parsedSignal.macro_assessment,
      long_picks:       parsedSignal.long_picks  || [],
      short_picks:      parsedSignal.short_picks || [],

      // Metadata
      parse_error:  parseError,
      usage_tokens: rawResponse.usage ? rawResponse.usage.total_tokens : null,
    }
  };
});
