# Workflow 2 — Watchdog Blueprint (v2)

Runs every 30 minutes at :10 and :40, Monday–Friday, 10:10 AM–3:40 PM ET.
Single responsibility: detect thesis-changing news for open positions and trigger the orchestrator to decide whether to close.
Trailing stop monitoring is handled entirely by Alpaca natively — this workflow does NOT check prices.

**Why 10:10 AM start:** Main Analysis already fires at 9:30 AM open — the watchdog would be redundant at that time.
**Why :10 and :40 (not :00 and :30):** Avoids simultaneous execution with the 12:00 PM midday Main Analysis session.
**Why 3:40 PM end:** Main Analysis fires at 3:50 PM close — no watchdog run needed after that.

## Why v2 is different from v1

v1 loaded sector RSS feeds and compared signals across sessions.
v2 uses Alpaca's News API to fetch breaking headlines for the exact tickers we hold, then makes a single LLM call to assess whether any headline materially changes a position's thesis. This is faster, more precise, and doesn't duplicate the specialist analysis already running 3×/day.

## Entry condition

The watchdog only proceeds if:
1. Market is currently open within the watchdog window (10:00 AM–3:30 PM ET)
2. We have at least one open Alpaca position in our 80-stock universe

Both are checked via IF nodes that route to named terminal (NoOp) nodes — always a finished state.

## Node map

```
[1]  Schedule Trigger (every 30 min, weekdays)
      ↓
[2]  Fetch Market Status           (HTTP GET Finnhub /quote?symbol=SPY)
      ↓
[3]  Is Market Open?              (IF: $json.market_open ? 'true' : 'false' equals 'true')
      ↓ TRUE                         ↓ FALSE
[4]  Fetch Alpaca Positions       [N1] Market Closed - Done (NoOp)
     (HTTP GET /positions)
      ↓
[5]  Has Open Positions?          (Code: watchdog_has_open_positions.js)
      ↓
[6]  Positions in Universe?       (IF: $json.has_positions ? 'true' : 'false' equals 'true')
      ↓ TRUE                         ↓ FALSE
[7]  Fetch Alpaca News            [N2] No Positions - Done (NoOp)
     (HTTP GET /v1beta1/news?symbols={{ $json.tickers_csv }}&limit=10&sort=desc)
      ↓
[8]  Build News Prompt            (Code: watchdog_build_news_prompt.js)
      ↓
[9]  Call Watchdog LLM           (Native OpenAI node v1.3 — GPT-4o-mini)
      ↓
[10] Parse Flip Response         (Code: watchdog_parse_flip.js)
      ↓
      ├─ [11] Thesis Flip Detected?  (IF: $json.flips_detected ? 'true' : 'false' equals 'true')
      │         ↓ TRUE                         ↓ FALSE
      │  [12] Trigger Main v2             [N3] No Flips - Done (NoOp)
      │       (Execute Workflow)
      │         ↓
      │   [N4] Watchdog Done (NoOp)
      │
      └─ [13] IF Contradictions?     (IF: $json.contradictions_detected ? 'true' : 'false' equals 'true')
                ↓ TRUE                         ↓ FALSE
    [14a] Build Contradiction Email   [N5] No Contradictions - Done (NoOp)
    [14b] Split Contradiction Items
          ↓                   ↓
  [15a] Send Contradiction  [15b] Store Contradiction Events
        Alert (Gmail)             (Postgres INSERT → stocks.watchdog_events)
```

> **Node naming note**: `watchdog_build_news_prompt.js` reads positions via `$("Has Open Positions?")` — this name must match exactly.

---

## Node configurations

### [1] Schedule Trigger
- Mode: Cron
- Expression: `10,40 14-20 * * 1-5` (UTC — wide enough to cover both EDT and EST; exact 10:10–15:40 ET window enforced by [2])
- In EDT (UTC-4): fires 10:10 AM–4:40 PM ET — gate blocks anything after 3:40 PM
- In EST (UTC-5): fires 9:10 AM–3:40 PM ET — gate blocks anything before 10:10 AM

---

### [2] Fetch Market Status
- Node type: HTTP Request (Finnhub `/quote?symbol=SPY`)
- Output fed to [3] Is Market Open? IF node which checks Finnhub `isOpen` field

---

### [3] Is Market Open?
- Node type: IF
- Condition: `{{ $json.market_open ? 'true' : 'false' }}` equals `true`
- TRUE → Fetch Alpaca Positions
- FALSE → Market Closed - Done (NoOp)

---

### [4] Fetch Alpaca Positions
- Method: GET
- URL: `https://paper-api.alpaca.markets/v2/positions`
- Authentication: Alpaca Trading API credential
- Response format: JSON

---

### [5] Has Open Positions?
- Node type: Code (`watchdog_has_open_positions.js`)
- Output on positions found: `{ has_positions: true, open_niches, positions_by_niche, position_count, tickers_csv, raw_positions }`
- Output when none: `{ has_positions: false, reason }`
- `tickers_csv` is used in the Fetch Alpaca News URL query string
- `raw_positions` is used by `watchdog_build_news_prompt.js` to show position context to the LLM

---

### [6] Positions in Universe?
- Node type: IF
- Condition: `{{ $json.has_positions ? 'true' : 'false' }}` equals `true`
- TRUE → Fetch Alpaca News
- FALSE → No Positions - Done (NoOp)

---

### [7] Fetch Alpaca News
- Method: GET
- URL expression: `https://data.alpaca.markets/v1beta1/news?symbols={{ $json.tickers_csv }}&limit=10&sort=desc`
- Authentication: Alpaca Data API credential (same keys as trading API)
- Response format: JSON
- Returns: `{ news: [...], next_page_token }` — articles have `headline`, `symbols[]`, `created_at`; `content`/`summary` are empty on free tier

---

### [8] Build News Prompt
- Node type: Code (`watchdog_build_news_prompt.js`)
- Reads positions from `$("Has Open Positions?").first().json.raw_positions`
- Groups articles by ticker using `symbols[]` array on each article
- Output: `{ system_prompt, user_prompt }` for the LLM

---

### [9] Call Watchdog LLM
- Node type: **Native OpenAI node v1.3**
- Model: `gpt-4o-mini`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Temperature: 0.2
- Max tokens: 1000
- Response format: JSON object
- Output shape: `{ message: { content: "..." } }` (v1.3 native format)

---

### [10] Parse Flip Response
- Node type: Code (`watchdog_parse_flip.js`)
- Flip threshold: `thesis_intact === false AND confidence ≥ 0.60 AND materiality !== 'LOW' AND news_assessment !== 'CONFIRMS'`
- Contradiction detection: `thesis_intact === false AND news_assessment === 'CONFIRMS'` — logical impossibility, suppressed from flip triggering
- Each contradiction object includes: `ticker`, `side`, `direction`, `news_assessment`, `key_headline`, `reasoning`, `confidence` (LLM's confidence on that assessment)
- `flip_triggered: flips.length > 0` stamped onto every contradiction before output (so the DB knows whether a contradiction co-occurred with a flip in the same run)
- Output on flips: `{ flips_detected: true, flips, flip_count, contradictions, contradictions_detected, trigger_reason, session_type: 'watchdog_flip' }`
- Output on no flips: `{ flips_detected: false, contradictions, contradictions_detected, checked_at, llm_summary }`

---

### [11] Thesis Flip Detected?
- Node type: IF
- Condition: `{{ $json.flips_detected ? 'true' : 'false' }}` equals `true`
- TRUE → Trigger Main v2
- FALSE → No Flips - Done (NoOp)

---

### [12] Trigger Main v2
- Node type: **Execute Workflow**
- Target workflow: Main Analysis v2 (ID: `l2d06hEvDlfLibms`)
- Entry point: **"When Called by Watchdog"** (Execute Workflow Trigger node)
- Passes flip context as input — the orchestrator receives `session_type: 'watchdog_flip'` and decides whether to close or hold each flagged position
- The watchdog does NOT close positions directly — it delegates to the orchestrator

---

### [13] IF Contradictions?
- Node type: IF
- Condition: `{{ $json.contradictions_detected ? 'true' : 'false' }}` equals `true`
- TRUE → Build Contradiction Email + Split Contradiction Items (parallel)
- FALSE → No Contradictions - Done (NoOp)

---

### [14a] Build Contradiction Email
- Node type: Code (inline, not a local file)
- Formats `$json.contradictions` into a readable email subject + body
- Output: `{ subject, body }`

---

### [14b] Split Contradiction Items
- Node type: Code (inline, not a local file)
- Splits `$json.contradictions` array into one item per contradiction for the Postgres INSERT
- Each item: `{ ticker, side, direction, news_assessment, key_headline, reasoning, confidence, flip_triggered, detected_at }`

---

### [15a] Send Contradiction Alert
- Node type: Gmail
- Sends the formatted email from [14a] to `jtfernandez1992@gmail.com`

---

### [15b] Store Contradiction Events
- Node type: Postgres — Execute Query
```sql
INSERT INTO stocks.watchdog_events
  (event_type, ticker, side, direction, news_assessment, key_headline,
   reasoning, detected_at, flip_triggered, watchdog_confidence)
VALUES
  ('contradiction', '{{ $json.ticker }}', '{{ $json.side }}', '{{ $json.direction }}',
   '{{ $json.news_assessment }}', '{{ $json.key_headline }}', '{{ $json.reasoning }}',
   '{{ $json.detected_at }}', {{ $json.flip_triggered }}, {{ $json.confidence }})
```

---

### Terminal (NoOp) nodes
All five terminal nodes are `n8n-nodes-base.noOp`. Name them descriptively:
- `Market Closed - Done`
- `No Positions - Done`
- `No Flips - Done`
- `No Contradictions - Done`
- `Watchdog Done`

---

## LLM output format expected by Parse Flip Response

```json
{
  "position_assessments": [
    {
      "ticker": "NVDA",
      "side": "LONG",
      "thesis_intact": true,
      "direction": "BULLISH",
      "confidence": 0.72,
      "materiality": "HIGH | MEDIUM | LOW",
      "key_headline": "The single most relevant headline, or null if none",
      "reasoning": "1-2 sentences"
    }
  ],
  "summary": "1 sentence — overall finding"
}
```

---

## What the watchdog does NOT do

- Does not check prices or stop proximity — Alpaca GTC trailing stops handle that natively
- Does not close positions directly — sends flip context to the orchestrator, which decides
- Does not run the full 8-specialist analysis — a single news-focused LLM call is enough
- Emergency manual close (outside the watchdog) via Alpaca: `DELETE /v2/positions/{ticker}` closes the position AND cancels all associated orders atomically
