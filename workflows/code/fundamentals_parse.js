// Node: Parse Fundamentals
// Workflow: Fundamentals Refresh (8hHaG6U0ToaHRAei)
// Position: After Fetch Recommendations (which follows Fetch Metric)
// Input: Finnhub /stock/metric + /stock/recommendation per ticker
// Output: { ticker, sql } for Upsert Fundamentals postgres node

const ticker = $('Loop Over Tickers').first().json.ticker;
const metric = $('Fetch Metric').first().json.metric || {};

// Analyst recommendations from Finnhub — most recent period first in the array
let totalBuy = 0, totalHold = 0, totalSell = 0;
try {
  // n8n's HTTP node splits a JSON array response into one item per element, so
  // $('Fetch Recommendations').first().json is a single period object — NOT the
  // full array. The old Array.isArray() check therefore always failed and left
  // analyst consensus at 0/0/0 for all 80 stocks. Reconstruct the list with
  // .all() and take the most recent period (Finnhub returns one row per month).
  const recArr = $('Fetch Recommendations').all()
    .map(i => i.json)
    .filter(x => x && x.period);
  recArr.sort((a, b) => String(b.period).localeCompare(String(a.period)));  // newest first
  const r = recArr[0];
  if (r) {
    totalBuy  = (r.buy  || 0) + (r.strongBuy  || 0);
    totalHold = (r.hold || 0);
    totalSell = (r.sell || 0) + (r.strongSell || 0);
  }
} catch (_) {}

const val = v => {
  const n = Number(v);
  return (v !== null && v !== undefined && v !== '' && !isNaN(n)) ? n : null;
};
const intVal = v => {
  const n = Number(v);
  return (v !== null && v !== undefined && v !== '' && !isNaN(n)) ? Math.round(n) : null;
};
const s  = v => val(v)    !== null ? val(v)    : 'NULL';
const si = v => intVal(v) !== null ? intVal(v) : 'NULL';

const sql = `INSERT INTO stocks.stock_fundamentals (
  ticker, pe_ratio, pb_ratio, ps_ratio,
  revenue_growth_yoy, gross_margin, net_margin,
  beta, week_52_high, week_52_low, last_eps_surprise_pct,
  analyst_buy, analyst_hold, analyst_sell,
  fetched_at
) VALUES (
  '${ticker}',
  ${s(metric.peTTM)}, ${s(metric.pbAnnual)}, ${s(metric.psTTM)},
  ${s(metric.revenueGrowthTTMYoy)}, ${s(metric.grossMarginTTM)}, ${s(metric.netProfitMarginTTM)},
  ${s(metric.beta)}, ${s(metric['52WeekHigh'])}, ${s(metric['52WeekLow'])},
  ${s(metric.epsGrowthQuarterlyYoy)},
  ${si(totalBuy)}, ${si(totalHold)}, ${si(totalSell)},
  NOW()
)
ON CONFLICT (ticker) DO UPDATE SET
  pe_ratio             = EXCLUDED.pe_ratio,
  pb_ratio             = EXCLUDED.pb_ratio,
  ps_ratio             = EXCLUDED.ps_ratio,
  revenue_growth_yoy   = EXCLUDED.revenue_growth_yoy,
  gross_margin         = EXCLUDED.gross_margin,
  net_margin           = EXCLUDED.net_margin,
  beta                 = EXCLUDED.beta,
  week_52_high         = EXCLUDED.week_52_high,
  week_52_low          = EXCLUDED.week_52_low,
  last_eps_surprise_pct= EXCLUDED.last_eps_surprise_pct,
  analyst_buy          = EXCLUDED.analyst_buy,
  analyst_hold         = EXCLUDED.analyst_hold,
  analyst_sell         = EXCLUDED.analyst_sell,
  fetched_at           = NOW()`;

return [{ json: { ticker, sql } }];
