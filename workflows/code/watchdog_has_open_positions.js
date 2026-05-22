// Node: Has Open Positions? (Watchdog)
// Maps open Alpaca positions to niches.
// Returns empty (stops execution) if no positions in our universe.
// Output: { open_niches, positions_by_niche, position_count, tickers_csv, raw_positions }

const TICKER_NICHE = {
  CRWD:'cybersecurity',PANW:'cybersecurity',ZS:'cybersecurity',OKTA:'cybersecurity',
  FTNT:'cybersecurity',S:'cybersecurity',CYBR:'cybersecurity',TMUS:'cybersecurity',
  QLYS:'cybersecurity',TENB:'cybersecurity',
  LMT:'defense',RTX:'defense',NOC:'defense',GD:'defense',HII:'defense',
  LHX:'defense',KTOS:'defense',RCAT:'defense',PLTR:'defense',AXON:'defense',
  CCJ:'nuclear_uranium',UEC:'nuclear_uranium',NXE:'nuclear_uranium',DNN:'nuclear_uranium',
  SMR:'nuclear_uranium',OKLO:'nuclear_uranium',CEG:'nuclear_uranium',VST:'nuclear_uranium',
  ETR:'nuclear_uranium',NEE:'nuclear_uranium',
  FCX:'copper_minerals',SCCO:'copper_minerals',TECK:'copper_minerals',HBM:'copper_minerals',
  VALE:'copper_minerals',MP:'copper_minerals',LTHM:'copper_minerals',ALB:'copper_minerals',
  SQM:'copper_minerals',LAC:'copper_minerals',
  NVDA:'ai_semiconductors',AMD:'ai_semiconductors',AVGO:'ai_semiconductors',
  QCOM:'ai_semiconductors',MRVL:'ai_semiconductors',AMAT:'ai_semiconductors',
  KLAC:'ai_semiconductors',LRCX:'ai_semiconductors',MU:'ai_semiconductors',ARM:'ai_semiconductors',
  MSFT:'cloud_hyperscalers',AMZN:'cloud_hyperscalers',GOOGL:'cloud_hyperscalers',
  META:'cloud_hyperscalers',ORCL:'cloud_hyperscalers',SNOW:'cloud_hyperscalers',
  MDB:'cloud_hyperscalers',DDOG:'cloud_hyperscalers',NET:'cloud_hyperscalers',CRM:'cloud_hyperscalers',
  XOM:'oil_gas',CVX:'oil_gas',COP:'oil_gas',SLB:'oil_gas',HAL:'oil_gas',
  MPC:'oil_gas',PSX:'oil_gas',VLO:'oil_gas',OXY:'oil_gas',EOG:'oil_gas',
  EQIX:'data_centers',DLR:'data_centers',AMT:'data_centers',IREN:'data_centers',
  CORZ:'data_centers',VRT:'data_centers',SMCI:'data_centers',DELL:'data_centers',
  HPE:'data_centers',WDC:'data_centers',
};

const positions = $input.all().map(i => i.json);

if (positions.length === 0) {
  return [{ json: { has_positions: false, reason: 'No open Alpaca positions' } }];
}

const byNiche = {};
for (const pos of positions) {
  const niche = TICKER_NICHE[pos.symbol];
  if (!niche) continue;
  if (!byNiche[niche]) byNiche[niche] = { tickers: [], has_long: false, has_short: false };
  byNiche[niche].tickers.push(pos.symbol);
  if (parseFloat(pos.qty) > 0) byNiche[niche].has_long  = true;
  if (parseFloat(pos.qty) < 0) byNiche[niche].has_short = true;
}

const openNiches      = Object.keys(byNiche);
if (openNiches.length === 0) {
  return [{ json: { has_positions: false, reason: 'No positions in our 80-stock universe' } }];
}

const openPositions   = positions.filter(p => TICKER_NICHE[p.symbol]);
const tickers         = openPositions.map(p => p.symbol);

return [{ json: {
  has_positions:      true,
  open_niches:        openNiches,
  positions_by_niche: byNiche,
  position_count:     positions.length,
  tickers_csv:        tickers.join(','),  // used in Fetch Alpaca News URL: ?symbols=...
  raw_positions:      openPositions,      // full Alpaca objects for LLM context
} }];
