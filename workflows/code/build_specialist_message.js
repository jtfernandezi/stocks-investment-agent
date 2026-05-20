// Node: Build [Niche] Message  (8 instances — one per specialist branch)
// Position: After Merge [Niche] RSS  →  Specialist [Niche] LLM
// Input: $input.all() = merged RSS items from 2 feeds for this niche
// Output: 1 item — { niche, session_id, system_prompt, user_prompt }
//
// Each instance has these 3 constants set to the specific niche:
//   const NICHE         = 'cybersecurity';
//   const NICHE_DISPLAY = 'Cybersecurity';
//   const TICKERS       = ['CRWD','PANW',...];
//
// Everything else is identical across all 8 nodes.

const NICHE         = '{niche_id}';          // SET PER INSTANCE
const NICHE_DISPLAY = '{niche_display}';      // SET PER INSTANCE
const TICKERS       = {tickers_json};         // SET PER INSTANCE

const ctx = $("Compute Derived Metrics").first().json;

function formatStockData(tickers, priceMap, fundamentalsMap, earningsRows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return tickers.map(ticker => {
    const p    = priceMap[ticker]        || {};
    const f    = fundamentalsMap[ticker] || {};
    const earn = earningsRows.find(e => e.ticker === ticker);
    let earningsTag = 'NONE';
    if (earn && earn.earnings_date) {
      const days = Math.round((new Date(earn.earnings_date) - today) / 86400000);
      if      (days >= 0 && days <= 3) earningsTag = `HIGH (${days}d — ${earn.earnings_date})`;
      else if (days >= 4 && days <= 7) earningsTag = `MEDIUM (${days}d — ${earn.earnings_date})`;
    }
    const pctFrom52H = p.week_52_high ? ((p.current - p.week_52_high) / p.week_52_high * 100).toFixed(1) : 'N/A';
    const pctFrom52L = p.week_52_low  ? ((p.current - p.week_52_low)  / p.week_52_low  * 100).toFixed(1) : 'N/A';
    const analystStr = (f.analyst_buy || f.analyst_hold || f.analyst_sell)
      ? `${f.analyst_buy||0}B / ${f.analyst_hold||0}H / ${f.analyst_sell||0}S` : 'N/A';
    const ptStr = f.price_target_avg
      ? `$${f.price_target_avg} (H: $${f.price_target_high||'N/A'} / L: $${f.price_target_low||'N/A'})` : 'N/A';
    const revGrowth   = f.revenue_growth_yoy != null ? (f.revenue_growth_yoy * 100).toFixed(1) + '%' : 'N/A';
    const grossMargin = f.gross_margin       != null ? (f.gross_margin       * 100).toFixed(1) + '%' : 'N/A';
    const netMargin   = f.net_margin         != null ? (f.net_margin         * 100).toFixed(1) + '%' : 'N/A';
    return [
      `${ticker}:`,
      `  Price: $${p.current||'N/A'} | 1D: ${p.chg_1d_pct||0}% | 5D: ${p.chg_5d_pct||0}% | 30D: ${p.chg_30d_pct||0}%`,
      `  52W Range: $${p.week_52_low||'N/A'} – $${p.week_52_high||'N/A'} (${pctFrom52H}% from high / +${pctFrom52L}% from low)`,
      `  P/E: ${f.pe_ratio||'N/A'} | P/S: ${f.ps_ratio||'N/A'} | P/B: ${f.pb_ratio||'N/A'}`,
      `  Rev Growth YoY: ${revGrowth} | Gross Margin: ${grossMargin} | Net Margin: ${netMargin}`,
      `  Beta: ${f.beta||'N/A'} | Analyst Consensus: ${analystStr} | Price Target: ${ptStr}`,
      `  Earnings Risk: ${earningsTag}`,
    ].join('\n');
  }).join('\n\n');
}

function formatNews(allItems) {
  if (!allItems || allItems.length === 0) return 'No recent news retrieved.';
  return allItems.slice(0, 10).map((item, i) => {
    const a = item.json;
    const date = (a.isoDate || a.pubDate || '').substring(0, 10);
    return `[${i+1}] ${a.title||''}${date ? ` (${date})` : ''}\n${(a.contentSnippet||a.content||'').substring(0, 400)}`;
  }).join('\n\n');
}

function formatAccuracyHistory(niche, specialistEffectiveConf) {
  const acc = specialistEffectiveConf[niche];
  if (!acc || !acc.total_signals) return 'No accuracy history yet. Treat your confidence calibration as unconstrained for now.';
  const calLabel = acc.scaling_factor < 0.85
    ? '⚠️ YOU ARE OVERCONFIDENT — discount your stated confidence'
    : acc.scaling_factor > 1.15 ? '✅ You have been underconfident — you may state slightly higher confidence'
    : '✅ Well-calibrated';
  return [
    `30-Day Performance: ${(acc.hit_rate * 100).toFixed(1)}% directional accuracy across ${acc.total_signals} signals`,
    `Confidence Calibration: You stated avg ${(acc.avg_reported_confidence * 100).toFixed(1)}% confidence → scaling factor ${acc.scaling_factor}x (${calLabel})`,
    `Best pattern: ${acc.best_pattern||'N/A'} | Worst pattern: ${acc.worst_pattern||'N/A'}`,
    acc.scaling_factor < 0.85 ? `ACTION: If your raw conviction is 0.85, your effective confidence is ~${(0.85 * acc.scaling_factor).toFixed(2)}. Calibrate your stated confidence downward.` : '',
  ].filter(Boolean).join('\n');
}

const SPECIALIST_SYSTEM_PROMPT = `You are a specialist equity analyst covering the {NICHE_NAME} sector for an AI-driven investment fund. Your sole responsibility is to analyze your sector and produce actionable, high-conviction signals that will be used by a Portfolio Manager to allocate capital in a $60,000 paper trading portfolio benchmarked against the S&P 500.

## YOUR UNIVERSE
You cover 10 stocks: {STOCKS}.
These are the ONLY stocks you can recommend. Do not suggest stocks outside this list.

## YOUR INPUTS
You receive five types of information:

1. SECTOR NEWS — Recent RSS articles from {NICHE_NAME} publications. Read them critically. Not all news is market-moving. Ask yourself: does this news change the earnings trajectory, competitive positioning, or risk profile of companies in my universe? Distinguish between macro catalysts, company-specific catalysts, and noise.

2. PRICE & MOMENTUM DATA — Current price and performance (1d/5d/30d) for each stock. Use this to assess relative strength within the sector, whether a stock is near 52-week highs or lows, and divergences between price action and news.

3. FUNDAMENTAL DATA — P/E, P/B, P/S, revenue growth YoY, gross margin, net margin, beta, analyst consensus, price target average, and 52-week high/low. Use this to assess valuation and quality. Do not treat analyst price targets as signals — they are reference points only.

4. EARNINGS CALENDAR — Next earnings date for each stock. Earnings ≤3 days: flag as HIGH earnings risk — do not recommend initiating new positions. Earnings 4–7 days: flag as MEDIUM earnings risk.

5. YOUR OWN ACCURACY HISTORY — Your 30-day track record. Use this to calibrate your stated confidence. If scaling_factor < 0.85, you have been overconfident — reduce stated confidence accordingly. If hit_rate < 0.50, output NEUTRAL unless the catalyst is exceptionally clear.

## ANALYTICAL FRAMEWORK

### Step 1 — Sector Macro Assessment
Determine the current macro environment: BULLISH / NEUTRAL / BEARISH with 2-3 sentences of reasoning.

### Step 2 — Stock-Level Analysis
For each of the 10 stocks: news impact, price action consistency, valuation vs growth, 52W range position, analyst consensus signal.

### Step 3 — Long Candidates (2–3 stocks)
Why this stock specifically. What the specific catalyst is. Why the timing is right. Key risk.

### Step 4 — Short Candidates (1–2 stocks)
Fundamental or structural reason the stock goes lower. Do NOT recommend a short solely because the stock is down. Do NOT short a stock already down >20% from 52W high without a specific new negative catalyst.

### Step 5 — Sector Signal
BULLISH / NEUTRAL / BEARISH with conviction (HIGH / MEDIUM / LOW) and confidence (0.00–1.00).
HIGH conviction requires confidence ≥ 0.75 and multiple independent confirming signals.
If confidence < 0.60, output NEUTRAL regardless of apparent direction.

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no backticks, no explanation outside the JSON object.

{
  "niche": "{NICHE_ID}",
  "direction": "BULLISH | BEARISH | NEUTRAL",
  "conviction": "HIGH | MEDIUM | LOW",
  "confidence": 0.00,
  "materiality": "HIGH | MEDIUM | LOW",
  "macro_assessment": "2-3 sentence sector macro summary",
  "long_picks": [{"ticker": "TICKER", "thesis": "...", "catalyst": "...", "key_risk": "...", "earnings_risk": "NONE | MEDIUM | HIGH"}],
  "short_picks": [{"ticker": "TICKER", "thesis": "...", "catalyst": "...", "key_risk": "...", "earnings_risk": "NONE | MEDIUM | HIGH"}],
  "summary": "3-4 sentence synthesis for the Portfolio Manager"
}`;

const stockData = formatStockData(TICKERS, ctx.priceMap, ctx.fundamentalsMap, ctx.earningsRows);
const news      = formatNews($input.all());
const accuracy  = formatAccuracyHistory(NICHE, ctx.specialistEffectiveConf);

const systemPrompt = SPECIALIST_SYSTEM_PROMPT
  .replace(/{NICHE_NAME}/g, NICHE_DISPLAY)
  .replace(/{NICHE_ID}/g,   NICHE)
  .replace(/{STOCKS}/g,     TICKERS.join(', '));

const userPrompt = `## SESSION: ${ctx.session_id}

### 1. SECTOR NEWS (${NICHE_DISPLAY})
${news}

### 2. PRICE & MOMENTUM DATA
${stockData}

### 3. YOUR OWN ACCURACY HISTORY (last 30 days)
${accuracy}

Analyze ${NICHE_DISPLAY} and produce your signal.`;

return [{ json: { niche: NICHE, session_id: ctx.session_id, system_prompt: systemPrompt, user_prompt: userPrompt } }];
