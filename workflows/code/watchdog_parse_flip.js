// Node: Parse Flip Response (Watchdog)
// Position: After watchdog LLM call (OpenAI v1.3 — { message: { content: "..." } })
// Parses LLM output, filters for actionable thesis flips.
// Returns empty (stops execution) if no flips meet the threshold.
// Output: 1 item with flip list → triggers orchestrator via Execute Workflow.

const raw     = $input.first().json;
const content = raw?.message?.content || raw?.choices?.[0]?.message?.content || '';

let parsed;
try {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
} catch (e) {
  return [{ json: { flips_detected: false, reason: 'LLM parse error', checked_at: new Date().toISOString() } }];
}

const assessments = parsed.position_assessments || [];

// Contradiction detection: thesis_intact: false but news_assessment: CONFIRMS
// is a logical impossibility — the LLM internally contradicted itself.
// These are suppressed from flip triggering and flagged for alerting.
const contradictions = assessments.filter(a =>
  a.thesis_intact === false &&
  a.news_assessment === 'CONFIRMS'
).map(a => ({
  ticker:          a.ticker,
  side:            a.side,
  direction:       a.direction       || null,
  news_assessment: a.news_assessment || null,
  key_headline:    a.key_headline    || null,
  reasoning:       a.reasoning       || null,
}));

// Flip threshold: LLM says thesis broken + confidence ≥ 0.60 + not LOW materiality
// + news_assessment must not be CONFIRMS (contradictions already separated above).
const flips = assessments.filter(a =>
  a.thesis_intact === false &&
  (a.confidence  || 0) >= 0.60 &&
  a.materiality !== 'LOW' &&
  a.news_assessment !== 'CONFIRMS'
);

const checkedAt               = new Date().toISOString();
const contradictions_detected = contradictions.length > 0;

if (flips.length === 0) {
  return [{ json: {
    flips_detected:           false,
    contradictions_detected,
    contradictions,
    checked_at:               checkedAt,
    llm_summary:              parsed.summary || null,
  }}];
}

return [{
  json: {
    flips_detected:           true,
    flip_count:               flips.length,
    flips,
    contradictions_detected,
    contradictions,
    checked_at:               checkedAt,
    trigger_reason: `Thesis flip detected: ${flips.map(f => `${f.ticker} (${f.side})`).join(', ')}`,
    session_type:   'watchdog_flip',
    llm_summary:    parsed.summary || null,
  }
}];
