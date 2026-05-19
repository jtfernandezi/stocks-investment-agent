// Node: Check Signal Flip (Watchdog)
// Checks each open position against the latest specialist signal.
// Closes positions where the specialist has flipped direction.
// Output: 0–N items, each representing a position to close.

const signalItems  = $("Fetch Latest Specialist Signals").all().map(i => i.json);
const positionItems = $("Fetch Open Positions").all().map(i => i.json);

// Build signal lookup by niche: { cybersecurity: { direction, conviction, created_at }, ... }
const signalByNiche = {};
for (const row of signalItems) {
  signalByNiche[row.niche] = row;
}

// Niche for each ticker (must match what's stored in Alpaca positions metadata or tracked separately)
// Since Alpaca doesn't store niche, we use a static map.
const TICKER_NICHE = {
  CRWD:'cybersecurity', PANW:'cybersecurity', ZS:'cybersecurity', OKTA:'cybersecurity',
  FTNT:'cybersecurity', S:'cybersecurity', CYBR:'cybersecurity', TMUS:'cybersecurity',
  QLYS:'cybersecurity', TENB:'cybersecurity',
  LMT:'defense', RTX:'defense', NOC:'defense', GD:'defense', HII:'defense',
  LHX:'defense', KTOS:'defense', RCAT:'defense', PLTR:'defense', AXON:'defense',
  CCJ:'nuclear_uranium', UEC:'nuclear_uranium', NXE:'nuclear_uranium', DNN:'nuclear_uranium',
  SMR:'nuclear_uranium', OKLO:'nuclear_uranium', CEG:'nuclear_uranium', VST:'nuclear_uranium',
  ETR:'nuclear_uranium', NEE:'nuclear_uranium',
  FCX:'copper_minerals', SCCO:'copper_minerals', TECK:'copper_minerals', HBM:'copper_minerals',
  VALE:'copper_minerals', MP:'copper_minerals', LTHM:'copper_minerals', ALB:'copper_minerals',
  SQM:'copper_minerals', LAC:'copper_minerals',
  NVDA:'ai_semiconductors', AMD:'ai_semiconductors', AVGO:'ai_semiconductors',
  QCOM:'ai_semiconductors', MRVL:'ai_semiconductors', AMAT:'ai_semiconductors',
  KLAC:'ai_semiconductors', LRCX:'ai_semiconductors', MU:'ai_semiconductors', ARM:'ai_semiconductors',
  MSFT:'cloud_hyperscalers', AMZN:'cloud_hyperscalers', GOOGL:'cloud_hyperscalers',
  META:'cloud_hyperscalers', ORCL:'cloud_hyperscalers', SNOW:'cloud_hyperscalers',
  MDB:'cloud_hyperscalers', DDOG:'cloud_hyperscalers', NET:'cloud_hyperscalers', CRM:'cloud_hyperscalers',
  XOM:'oil_gas', CVX:'oil_gas', COP:'oil_gas', SLB:'oil_gas', HAL:'oil_gas',
  MPC:'oil_gas', PSX:'oil_gas', VLO:'oil_gas', OXY:'oil_gas', EOG:'oil_gas',
  EQIX:'data_centers', DLR:'data_centers', AMT:'data_centers', IREN:'data_centers',
  CORZ:'data_centers', VRT:'data_centers', SMCI:'data_centers', DELL:'data_centers',
  HPE:'data_centers', WDC:'data_centers',
};

const positionsToClose = [];

for (const pos of positionItems) {
  const ticker = pos.symbol;
  const qty    = parseFloat(pos.qty);
  const isLong = qty > 0;
  const niche  = TICKER_NICHE[ticker];

  if (!niche) continue;  // ticker not in our universe — skip
  const signal = signalByNiche[niche];
  if (!signal) continue;  // no signal for this niche yet — skip

  const direction    = signal.direction;   // BULLISH | BEARISH | NEUTRAL
  const conviction   = signal.conviction;  // HIGH | MEDIUM | LOW

  // Thesis flip logic (same as orchestrator EXIT RULES):
  // LONG position: close if specialist is now BEARISH or NEUTRAL
  // SHORT position: close if specialist is now BULLISH or NEUTRAL
  let shouldClose = false;
  let flipReason  = '';

  if (isLong  && (direction === 'BEARISH' || direction === 'NEUTRAL')) {
    shouldClose = true;
    flipReason  = `Specialist flipped ${direction} — long thesis invalidated`;
  }
  if (!isLong && (direction === 'BULLISH' || direction === 'NEUTRAL')) {
    shouldClose = true;
    flipReason  = `Specialist flipped ${direction} — short thesis invalidated`;
  }

  if (shouldClose) {
    // Use Alpaca's DELETE /positions/{ticker} which closes AND cancels orders atomically
    positionsToClose.push({
      json: {
        ticker,
        niche,
        qty:           Math.abs(qty),
        side:          isLong ? 'LONG' : 'SHORT',
        action:        isLong ? 'SELL' : 'COVER',
        exit_reason:   'thesis_flip',
        flip_reason:   flipReason,
        signal_direction: direction,
        signal_conviction: conviction,
        signal_timestamp:  signal.created_at,
        current_price: parseFloat(pos.current_price),
        entry_price:   parseFloat(pos.avg_entry_price),
        unrealized_pnl_pct: parseFloat(pos.unrealized_plpc) * 100,
        // Alpaca close-position endpoint (atomic)
        close_url: `/v2/positions/${ticker}`,
        // For post-mortem webhook
        post_mortem_trigger: true,
      }
    });
  }
}

if (positionsToClose.length === 0) {
  // Return a sentinel item so the IF node can route to the NO-OP branch
  return [{ json: { items_to_close: 0, no_flips_detected: true } }];
}

return positionsToClose;
