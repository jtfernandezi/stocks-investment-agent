// Node: Tag [Niche] Watchdog Signal  (8 instances — one per niche branch)
// Position: After Specialist [Niche] LLM (Watchdog)
// Re-attaches niche (OpenAI node drops input context) and parses JSON response.
// OpenAI node version: v1.3 → output shape: { message: { content: "..." } }
//
// Each instance sets:
//   const NICHE_ID = 'cybersecurity';

const NICHE_ID = '{niche_id}';   // SET PER INSTANCE

const raw     = $input.first().json;
const content = raw?.message?.content || raw?.choices?.[0]?.message?.content || '';

let parsed;
try {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
} catch (e) {
  parsed = {
    direction:    'NEUTRAL',
    confidence:   0,
    materiality:  'LOW',
    key_headline: null,
    reasoning:    'Parse error — treating as NEUTRAL',
    parse_error:  true,
  };
}

return [{ json: { ...parsed, niche: NICHE_ID } }];
