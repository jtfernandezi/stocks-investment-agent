# Workflow 3 — Post-Mortem Blueprint

Triggered via Execute Workflow from Main Analysis v2 after every SELL or COVER action.
Runs a 4-component attribution analysis and stores results for the feedback learning system.

## Critical: Node naming

The Code nodes reference other nodes by exact name:

| Code file | References node named |
|-----------|----------------------|
| post_mortem_build_input.js | `Workflow Trigger`, `Load Signals During Hold` |
| post_mortem_store.js | `Build Post-Mortem Input` |

## Node map

```
[1] Workflow Trigger                   (Execute Workflow Trigger — called by Main v2 after SELL/COVER)
      ↓
[2] Load Signals During Hold           (Postgres SELECT — specialist signals during the hold period)
      ↓
[3] Build Post-Mortem Input            (Code: post_mortem_build_input.js)
      ↓
[4] Call Post-Mortem LLM              (Native OpenAI node v1.3 — GPT-4o-mini)
      ↓
[5] Parse & Store Post-Mortem          (Code: post_mortem_store.js)
      ↓
[6] Insert Trade Lesson                (Postgres INSERT into trade_lessons)
      ↓
[7] Update Specialist Accuracy         (Postgres INSERT OR UPDATE specialist_accuracy)
      ↓
[8] Update Pattern Performance         (Postgres INSERT OR UPDATE pattern_performance)
```

---

## Node configurations

### [1] Workflow Trigger
Node name: **`Workflow Trigger`** (exact — referenced by `post_mortem_build_input.js`)
- Node type: **Execute Workflow Trigger** (NOT a Webhook — this workflow is called directly by Main v2 via Execute Workflow node, not via HTTP)
- Receives the closed trade payload as input items

---

### [2] Load Signals During Hold
Node name: **`Load Signals During Hold`** (exact — referenced by `post_mortem_build_input.js`)

```sql
SELECT direction, conviction, confidence, created_at
FROM stocks.specialist_signals
WHERE niche = '{{ $json.niche }}'
  AND created_at BETWEEN '{{ $json.entry_date }}' AND '{{ $json.exit_date }}'
ORDER BY created_at ASC;
```

> **Note on entry_date**: Alpaca's positions API does not expose when a position was opened. Until entry date is stored in Neon at BUY/SHORT execution time, `entry_date` is approximated as `exit_date - 30 days` by `07_parse_orchestrator_output.js`. This is a known limitation — the SQL query still executes correctly with this value.

---

### [3] Build Post-Mortem Input
Node name: **`Build Post-Mortem Input`** (exact — referenced by `post_mortem_store.js`)
- Node type: Code (`post_mortem_build_input.js`)
- Computes P&L (short P&L = `(entry - exit) / entry × 100`), hold days, formats signal history during hold
- Sector ETF return (Component A) defaults to `null` — a `Fetch Sector ETF Return` node would need to be added to populate it

---

### [4] Call Post-Mortem LLM
- Node type: **Native OpenAI node v1.3**
- Model: `gpt-4o-mini`
- System prompt: `{{ $json.system_prompt }}`
- User prompt: `{{ $json.user_prompt }}`
- Temperature: 0.3
- Max tokens: 1500
- Response format: JSON object
- Output shape per item: `{ message: { content: "..." } }` (v1.3 format — used by `post_mortem_store.js`)

---

### [5] Parse & Store Post-Mortem
Node name: **`Parse & Store Post-Mortem`**
- Node type: Code (`post_mortem_store.js`)
- Parses LLM JSON output; falls back to context values if parse fails
- `sqlEsc` applied to all string fields before SQL interpolation

---

### [6] Insert Trade Lesson
> **Important**: Set `alwaysOutputData: true` on this node. `ON CONFLICT DO NOTHING` returns 0 rows — without this flag n8n sees no output and stops execution, preventing [7] and [8] from running.

```sql
INSERT INTO stocks.trade_lessons (
  ticker, niche, direction, outcome, pnl_pct, pnl_usd, hold_days,
  entry_date, exit_date, entry_pattern, exit_reason,
  sector_accuracy, stock_selection_quality, entry_timing, exit_timing,
  key_lesson, pattern_tag, alternative_picks,
  entry_specialist_confidence, entry_effective_confidence
) VALUES (
  '{{ $json.ticker }}', '{{ $json.niche }}', '{{ $json.direction }}',
  '{{ $json.outcome }}', {{ $json.pnl_pct }}, {{ $json.pnl_usd }},
  {{ $json.hold_days }}, '{{ $json.entry_date }}', '{{ $json.exit_date }}',
  '{{ $json.entry_pattern }}', '{{ $json.exit_reason }}',
  '{{ $json.sector_accuracy }}', '{{ $json.stock_selection_quality }}',
  '{{ $json.entry_timing }}', '{{ $json.exit_timing }}',
  '{{ $json.key_lesson }}', '{{ $json.pattern_tag }}',
  '{{ $json.alternative_picks }}'::jsonb,
  {{ $json.entry_specialist_confidence }}, {{ $json.entry_effective_confidence }}
)
ON CONFLICT DO NOTHING;
```

---

### [7] Update Specialist Accuracy
> **Important**: Set `alwaysOutputData: true` on this node as well (same reason as [6]).

```sql
INSERT INTO stocks.specialist_accuracy (niche, period_days, total_signals, high_conviction_signals,
  correct_signals, hit_rate, avg_reported_confidence, scaling_factor, calibration_error,
  best_pattern, worst_pattern)
SELECT
  niche,
  30 AS period_days,
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE entry_effective_confidence >= 0.75) AS high_conviction_signals,
  COUNT(*) FILTER (WHERE
    (direction = 'long'  AND outcome = 'WIN') OR
    (direction = 'short' AND outcome = 'WIN')
  ) AS correct_signals,
  AVG(CASE WHEN
    (direction = 'long'  AND outcome = 'WIN') OR
    (direction = 'short' AND outcome = 'WIN')
    THEN 1.0 ELSE 0.0 END) AS hit_rate,
  AVG(entry_specialist_confidence) AS avg_reported_confidence,
  AVG(CASE WHEN
    (direction = 'long'  AND outcome = 'WIN') OR
    (direction = 'short' AND outcome = 'WIN')
    THEN 1.0 ELSE 0.0 END) / NULLIF(AVG(entry_specialist_confidence), 0) AS scaling_factor,
  ABS(AVG(entry_specialist_confidence) - AVG(CASE WHEN
    (direction = 'long'  AND outcome = 'WIN') OR
    (direction = 'short' AND outcome = 'WIN')
    THEN 1.0 ELSE 0.0 END)) AS calibration_error,
  NULL AS best_pattern,
  NULL AS worst_pattern
FROM stocks.trade_lessons
WHERE niche = '{{ $json.niche }}'
  AND exit_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY niche
ON CONFLICT (niche, period_days)
DO UPDATE SET
  total_signals            = EXCLUDED.total_signals,
  high_conviction_signals  = EXCLUDED.high_conviction_signals,
  correct_signals          = EXCLUDED.correct_signals,
  hit_rate                 = EXCLUDED.hit_rate,
  avg_reported_confidence  = EXCLUDED.avg_reported_confidence,
  scaling_factor           = EXCLUDED.scaling_factor,
  calibration_error        = EXCLUDED.calibration_error,
  updated_at               = NOW();
```

---

### [8] Update Pattern Performance

```sql
INSERT INTO stocks.pattern_performance (
  pattern_type, niche, total_trades, winning_trades, win_rate,
  avg_win_pct, avg_loss_pct, expected_value)
SELECT
  entry_pattern AS pattern_type,
  'ALL' AS niche,
  COUNT(*) AS total_trades,
  COUNT(*) FILTER (WHERE outcome = 'WIN') AS winning_trades,
  AVG(CASE WHEN outcome = 'WIN' THEN 1.0 ELSE 0.0 END) AS win_rate,
  AVG(CASE WHEN outcome = 'WIN'  THEN pnl_pct ELSE NULL END) AS avg_win_pct,
  AVG(CASE WHEN outcome = 'LOSS' THEN pnl_pct ELSE NULL END) AS avg_loss_pct,
  AVG(CASE WHEN outcome = 'WIN'  THEN 1.0 ELSE 0.0 END) *
    AVG(CASE WHEN outcome = 'WIN'  THEN pnl_pct ELSE NULL END) +
  AVG(CASE WHEN outcome = 'LOSS' THEN 1.0 ELSE 0.0 END) *
    AVG(CASE WHEN outcome = 'LOSS' THEN pnl_pct ELSE NULL END) AS expected_value
FROM stocks.trade_lessons
WHERE exit_date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY entry_pattern
ON CONFLICT (pattern_type, niche)
DO UPDATE SET
  total_trades   = EXCLUDED.total_trades,
  winning_trades = EXCLUDED.winning_trades,
  win_rate       = EXCLUDED.win_rate,
  avg_win_pct    = EXCLUDED.avg_win_pct,
  avg_loss_pct   = EXCLUDED.avg_loss_pct,
  expected_value = EXCLUDED.expected_value,
  updated_at     = NOW();
```
