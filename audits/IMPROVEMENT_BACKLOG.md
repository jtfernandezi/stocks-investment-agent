# Improvement Backlog

Living, ranked list of **Type B structural ideas** for making the fund better. Maintained by the weekly audit (`automation/weekly_audit_prompt.md`) — it adds evidence-grounded ideas, re-ranks each week, dedups, and tracks whether applied ideas actually worked. Nothing here is auto-implemented; each item is a proposal for the human to decide on and build deliberately in a normal session.

**Status legend:** `proposed` → `applied` → `worked` / `didn't` / `dropped`

| Rank | Idea | Evidence (what data motivated it) | Impact | Effort | Risk | Status | First raised |
|------|------|-----------------------------------|--------|--------|------|--------|--------------|
| 1 | **Rewire `Store Open Trade`/`Store Position Entry` to post-execution branch** — Currently wired from `Process Post-Trade` (parallel to trade execution), so all orchestrator-proposed BUY/SHORTs are written to DB even if `08_prepare_trade_actions.js` blocks them at execution time. Produces phantom OPEN trades for every session where any hard limit fires. | SMR+SNPS orphaned as OPEN in `trades`/`position_metadata` (2026-06-08) — never executed in Alpaca; `Find TS Exits` detects them every Watchdog run but can't close them (no orders exist). Confirmed via GET /v2/orders — zero SMR/SNPS entries. | High | Medium | Low | `proposed` | 2026-06-10 |
| 2 | **Encourage orchestrator to deploy into uncorrelated niches when 8+ niches BULLISH** — System prompt could explicitly note that deploying into low-correlation niches (healthcare, financials) is preferred over holding cash when high-conviction signals are sustained across most sectors. | 74% cash with 8/10 niches BULLISH and ≥3 consecutive BULLISH sessions; healthcare (conf 0.90) and financials (conf 0.89) both above trading threshold but zero positions in either. | Medium | Low | Low | `proposed` | 2026-06-10 |
| 3 | **Earnings calendar deduplication** — Add `ON CONFLICT (ticker, earnings_date) DO NOTHING` to `Store Earnings Calendar` SQL; add UNIQUE constraint `(ticker, earnings_date)` to `earnings_calendar` table. | ORCL appears in calendar with two dates (Jun 10 + Jun 16) from same fetch cycle, indicating duplicate inserts on rolling-window refetches. | Low | Low | Low | `proposed` | 2026-06-10 |
| 4 | **Execution audit log table** — New table `execution_log` (session_id, ticker, proposed_action, executed bool, block_reason text), written by `08_prepare_trade_actions.js` for every proposed trade. Makes cap/limit firings visible in future audits instead of discoverable only by cross-referencing DB vs Alpaca orders. | SMR/SNPS phantom trade was only caught by manually diffing `trades` against Alpaca GET /v2/orders — fully invisible in normal monitoring. | Medium | Medium | Low | `proposed` | 2026-06-10 |
| 5 | **Expand position cap to 14 when 10 niches active** ⛔ outside operating envelope (requires prompt + code change; needs 20+ closed trades for calibration before tuning) | 12 positions across 10 niches = 1.2 trades/niche; limits sector pair coverage when all niches BULLISH. | Medium | High | Medium | `proposed` | 2026-06-10 |

---

### Notes for the auditor
- **Dedup:** before adding an idea, check it isn't already a row above (even reworded). If it is, update its evidence/rank instead of adding a duplicate.
- **Promote from evidence:** an idea earns a higher rank as more weeks of data support it.
- **Close the loop:** when an item has been applied, the next audits must judge whether the targeted metric improved and set status to `worked` / `didn't`.
- **Tag honestly:** Risk = risk-to-stability of the live fund if implemented. High-impact + low-risk rises to the top.
