// Node: Compute Correlation Matrix
// Parallel branch from Fetch Price Bars — runs every session.
// Computes 90-day Pearson correlations for all ticker pairs.
// Outputs one item with bulk UPSERT SQL for pairs with |corr| >= 0.50.

const bars = $('Fetch Price Bars').first().json.bars || {};
const LOOKBACK  = 90;
const MIN_CORR  = 0.50;

// Build 90-day daily return series per ticker
const returns = {};
for (const [ticker, barList] of Object.entries(bars)) {
  if (!Array.isArray(barList) || barList.length < LOOKBACK + 1) continue;
  const recent = barList.slice(-(LOOKBACK + 1));
  const rets = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].c, curr = recent[i].c;
    if (prev > 0) rets.push((curr - prev) / prev);
  }
  if (rets.length >= LOOKBACK - 5) returns[ticker] = rets;
}

const tickers = Object.keys(returns).sort();

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const mA = sumA / n, mB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - mA, db = b[i] - mB;
    num += da * db; denA += da * da; denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

const pairs = [];
for (let i = 0; i < tickers.length; i++) {
  for (let j = i + 1; j < tickers.length; j++) {
    const a = tickers[i], b = tickers[j];
    const corr = pearson(returns[a], returns[b]);
    if (Math.abs(corr) >= MIN_CORR) {
      pairs.push([a, b, Math.round(corr * 10000) / 10000]);
    }
  }
}

if (pairs.length === 0) return [{ json: { pairs_upserted: 0, sql: 'SELECT 1' } }];

const values = pairs.map(([a, b, c]) => `('${a}','${b}',${c})`).join(',\n');
const sql = `INSERT INTO stocks.correlation_matrix (ticker_a, ticker_b, correlation, calculated_at)\nVALUES\n${values}\nON CONFLICT (ticker_a, ticker_b) DO UPDATE SET\n  correlation = EXCLUDED.correlation,\n  calculated_at = NOW()`;

return [{ json: { pairs_upserted: pairs.length, sql } }];
