// Node: Parse Earnings
// Filters Finnhub earningsCalendar response to 80 tracked tickers.
// Outputs UPSERT SQL for stocks.earnings_calendar.

const TICKERS = new Set([
  'CRWD','PANW','ZS','OKTA','FTNT','S','CYBR','TMUS','QLYS','TENB',
  'LMT','RTX','NOC','GD','HII','LHX','KTOS','RCAT','PLTR','AXON',
  'CCJ','UEC','NXE','DNN','SMR','OKLO','CEG','VST','ETR','NEE',
  'FCX','SCCO','TECK','HBM','VALE','MP','LTHM','ALB','SQM','LAC',
  'ARM','AMAT','LRCX','KLAC','ON','TER','NXPI','MCHP','MPWR','SNPS',
  'ORCL','NOW','CRM','DDOG','SNOW','ADBE','NET','TEAM','WDAY','MDB',
  'XOM','CVX','COP','SLB','HAL','MPC','PSX','VLO','OXY','EOG',
  'EQIX','DLR','AMT','IREN','CORZ','VRT','SMCI','DELL','HPE','WDC',
]);

const earningsArr = ($input.first().json.earningsCalendar || []).filter(
  e => TICKERS.has(e.symbol) && e.date
);

if (earningsArr.length === 0) {
  return [{ json: { rows_upserted: 0, sql: 'SELECT 1' } }];
}

const rows = earningsArr.map(e => {
  const epsEst = e.epsEstimate != null ? e.epsEstimate : 'NULL';
  return `('${e.symbol}','${e.date}',${epsEst})`;
});

const sql = `INSERT INTO stocks.earnings_calendar (ticker, earnings_date, eps_estimate)
VALUES
${rows.join(',\n')}
ON CONFLICT (ticker, earnings_date) DO UPDATE SET
  eps_estimate = EXCLUDED.eps_estimate,
  fetched_at = NOW()`;

return [{ json: { rows_upserted: earningsArr.length, sql } }];
