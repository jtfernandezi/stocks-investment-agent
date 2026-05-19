# Workflow 3 — Post-Mortem Blueprint

Triggered by webhook. Called by Main Analysis (node 37) and Watchdog (node 8) whenever a SELL or COVER is executed.

## Node map

```
[1] Webhook Trigger                    (receives closed trade context)
      ↓
[2] Load Historical Context            (Postgres — signals during hold, alt picks perf, sector ETF)
      ↓
[3] Build Post-Mortem Input            (Code: post_mortem_build_input.js)
      ↓
[4] Call Post-Mortem LLM              (HTTP POST OpenAI — GPT-4o-mini)
      ↓
[5] Parse & Store Post-Mortem          (Code: post_mortem_store.js)
      ↓
[6] Insert into trade_lessons          (Postgres INSERT)
      ↓
[7] Update specialist_accuracy         (Postgres INSERT OR UPDATE)
      ↓
[8] Update pattern_performance         (Postgres INSERT OR UPDATE)
```

## Node configurations

### [1] Webhook Trigger
- Method: POST
- Authentication: None (internal — called only by the other workflows)
- Path: `/post-mortem` (or any path, copy the full URL into POSTMORTEM_WEBHOOK_URL env var)

### [2] Load Historical Context

**2a — Signal history during hold:**
```sql
SELECT direction, conviction, confidence, created_at
FROM stocks.specialist_signals
WHERE niche = '{{ $json.niche }}'
  AND created_at BETWEEN '{{ $json.entry_date }}' AND '{{ $json.exit_date }}'
ORDER BY created_at ASC;
```

**2b — Alternative picks performance (same hold period):**
We need price returns for the other long/short picks the specialist offered at entry.
These tickers come from the webhook payload (field: `alt_tickers`).
Fetch from Alpaca bars: entry_date to exit_date for each alt ticker.

**2c — Sector ETF performance (for Attribution Component A):**
Fetch SPY or sector proxy ETF return for the same hold period.
Use Alpaca bars for the relevant sector ETF (or SPY as proxy).

Sector ETF proxies:
| Niche | Proxy ETF |
|-------|-----------|
| cybersecurity | HACK |
| defense | ITA |
| nuclear_uranium | URA |
| copper_minerals | COPX |
| ai_semiconductors | SOXX |
| cloud_hyperscalers | SKYY |
| oil_gas | XLE |
| data_centers | DTCR |

### [6] Insert into trade_lessons
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
);
```

### [7] Update specialist_accuracy
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

### [8] Update pattern_performance
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
  AVG(CASE WHEN outcome = 'WIN' THEN pnl_pct ELSE NULL END) AS avg_win_pct,
  AVG(CASE WHEN outcome = 'LOSS' THEN pnl_pct ELSE NULL END) AS avg_loss_pct,
  AVG(CASE WHEN outcome = 'WIN' THEN 1.0 ELSE 0.0 END) *
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
