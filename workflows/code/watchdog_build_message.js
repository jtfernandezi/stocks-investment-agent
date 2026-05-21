// Node: Build [Niche] Watchdog Message  (8 instances — one per niche branch)
// Position: After Merge [Niche] RSS (Watchdog)
// Input: $input.all() = merged RSS items from 2 feeds for this niche
// Output: 1 item — { niche, system_prompt, user_prompt }
//
// Each instance sets these 3 constants to the specific niche:
//   const NICHE_ID      = 'cybersecurity';
//   const NICHE_DISPLAY = 'Cybersecurity';
//   const TICKERS       = ['CRWD','PANW',...];

const NICHE_ID      = '{niche_id}';          // SET PER INSTANCE
const NICHE_DISPLAY = '{niche_display}';      // SET PER INSTANCE
const TICKERS       = {tickers_json};         // SET PER INSTANCE

function formatNews(allItems) {
  if (!allItems || allItems.length === 0) return 'No recent news retrieved.';
  return allItems.slice(0, 12).map((item, i) => {
    const a    = item.json;
    const date = (a.isoDate || a.pubDate || '').substring(0, 10);
    return `[${i+1}] ${a.title || ''}${date ? ` (${date})` : ''}\n${(a.contentSnippet || a.content || '').substring(0, 500)}`;
  }).join('\n\n');
}

const SYSTEM_PROMPT = `You are a breaking-news analyst monitoring the {NICHE_DISPLAY} sector for an AI-driven investment fund. Open positions in this sector exist.

Your job: scan the latest headlines and determine whether breaking news has materially changed the near-term directional outlook for the sector.

## YOUR UNIVERSE
Stocks covered: {STOCKS}

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks.

{
  "niche": "{NICHE_ID}",
  "direction": "BULLISH | BEARISH | NEUTRAL",
  "confidence": 0.00,
  "materiality": "HIGH | MEDIUM | LOW",
  "key_headline": "The single most market-moving headline, or null if no significant news",
  "reasoning": "1-2 sentences explaining the directional call"
}

## CALIBRATION RULES
- HIGH materiality only for a clear market-moving event: earnings surprise, major contract win/loss, regulatory action, geopolitical shock, earnings guidance change.
- LOW materiality for routine news, product announcements, or analyst price target adjustments.
- NEUTRAL if news is mixed, inconclusive, or lacks a decisive directional signal.
- confidence < 0.60 → output NEUTRAL regardless.
- Assess news impact only — do not factor in price action or technicals.`;

const systemPrompt = SYSTEM_PROMPT
  .replace(/{NICHE_DISPLAY}/g, NICHE_DISPLAY)
  .replace(/{NICHE_ID}/g,      NICHE_ID)
  .replace(/{STOCKS}/g,        TICKERS.join(', '));

const news = formatNews($input.all());

const userPrompt = `## BREAKING NEWS SCAN — ${NICHE_DISPLAY.toUpperCase()}

${news}

Based on the above news, is the ${NICHE_DISPLAY} sector outlook BULLISH, BEARISH, or NEUTRAL right now?`;

return [{ json: { niche: NICHE_ID, system_prompt: systemPrompt, user_prompt: userPrompt } }];
