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
  return [];  // parse error → treat as no flips → stop execution
}

const assessments = parsed.position_assessments || [];

// Flip threshold: LLM says thesis broken + confidence ≥ 0.60 + not LOW materiality
const flips = assessments.filter(a =>
  a.thesis_intact === false &&
  (a.confidence  || 0) >= 0.60 &&
  a.materiality !== 'LOW'
);

if (flips.length === 0) return [];

return [{
  json: {
    flip_count:     flips.length,
    flips,
    checked_at:     new Date().toISOString(),
    trigger_reason: `Thesis flip detected: ${flips.map(f => `${f.ticker} (${f.side})`).join(', ')}`,
    session_type:   'watchdog_flip',
    llm_summary:    parsed.summary || null,
  }
}];
