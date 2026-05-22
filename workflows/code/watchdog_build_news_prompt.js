// Node: Build News Prompt (Watchdog)
// Position: After Fetch Alpaca News HTTP node
// Input: N items — one per ticker (each { news: [...] } from per-ticker Alpaca fetch)
// Reads position context from $("Has Open Positions?") by name.
// Output: 1 item — { system_prompt, user_prompt } for the watchdog LLM call.

const articles  = $input.all().flatMap(i => i.json.news || []);
const posCtx    = $("Has Open Positions?").first().json;
const positions = posCtx.raw_positions || [];

// ── Format open positions ─────────────────────────────────────────────────────
function formatPositions(positions) {
  return positions.map(pos => {
    const qty     = parseFloat(pos.qty);
    const side    = qty > 0 ? 'LONG' : 'SHORT';
    const entry   = parseFloat(pos.avg_entry_price).toFixed(2);
    const current = parseFloat(pos.current_price).toFixed(2);
    const pnlPct  = (parseFloat(pos.unrealized_plpc) * 100).toFixed(2);
    const pnlAbs  = parseFloat(pos.unrealized_pl).toFixed(0);
    const sign    = parseFloat(pos.unrealized_pl) >= 0 ? '+' : '';
    return `${pos.symbol} (${side}) — Entry: $${entry} | Current: $${current} | P&L: ${sign}${pnlPct}% (${sign}$${pnlAbs})`;
  }).join('\n');
}

// ── Group headlines by ticker ─────────────────────────────────────────────────
function formatNews(articles, positions) {
  const byTicker = {};
  for (const pos of positions) byTicker[pos.symbol] = [];

  for (const a of articles) {
    for (const sym of (a.symbols || [])) {
      if (byTicker[sym] !== undefined) byTicker[sym].push(a);
    }
  }

  return Object.entries(byTicker).map(([ticker, arts]) => {
    if (arts.length === 0) return `=== ${ticker} ===\n  No recent headlines.`;
    const lines = arts.slice(0, 5).map((a, i) => {
      const ts = (a.created_at || '').substring(0, 16).replace('T', ' ');
      return `  [${i+1}] ${a.headline} (${ts})`;
    }).join('\n');
    return `=== ${ticker} ===\n${lines}`;
  }).join('\n\n');
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a real-time news monitor for an AI-driven investment fund. You review breaking news headlines every 30 minutes and determine whether any headline materially changes the investment thesis for an open position.

## WHAT COUNTS AS THESIS-CHANGING
- Earnings results, revenue guidance revision, or profit warning
- Major contract win or loss (>5% of revenue impact)
- Regulatory action, government investigation, or sanctions
- CEO/CFO departure, fraud allegation, or accounting restatement
- Significant product failure, recall, or ban
- Acquisition, merger, or major strategic pivot announcement
- Geopolitical event directly targeting the company or its primary market

## WHAT DOES NOT CHANGE A THESIS
- Analyst price target adjustments (routine sell-side noise)
- General market commentary or macro outlook pieces
- Minor product announcements or conference participation
- Stock movement articles ("NVDA up 3% today") — price action alone is not a thesis change
- Repetitive earnings call headline fragments (already priced in)

## CALIBRATION — err on the side of thesis_intact: true
- confidence < 0.60 → thesis_intact: true (not enough signal to act)
- materiality: LOW → thesis_intact: true (not actionable)
- Triggering a false positive causes an unnecessary trade. When in doubt, leave it alone.

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks.

{
  "position_assessments": [
    {
      "ticker": "NVDA",
      "side": "LONG",
      "thesis_intact": true,
      "direction": "BULLISH | BEARISH | NEUTRAL",
      "confidence": 0.00,
      "materiality": "HIGH | MEDIUM | LOW",
      "key_headline": "The single most relevant headline, or null if none",
      "reasoning": "1-2 sentences"
    }
  ],
  "summary": "1 sentence — overall finding across all positions"
}`;

const userPrompt = `## OPEN POSITIONS
${formatPositions(positions)}

## BREAKING NEWS (last 30 min)
${formatNews(articles, positions)}

Review each position. For each, does any headline materially change the investment thesis?`;

return [{ json: { system_prompt: SYSTEM_PROMPT, user_prompt: userPrompt } }];
