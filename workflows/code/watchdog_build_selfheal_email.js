// Node: Build Self-Heal Email (Watchdog)
// Fires only when Find Missing Stops detects >=1 naked position. Composes
// one summary alert (not one per ticker) so the real question — why did
// Main Analysis's own Submit Trailing Stop not cover this position — gets
// investigated, not just silently patched every time.

const missing = $json.missing || [];
const lines = missing.map(
  m => `- ${m.ticker} (${m.side}, ${m.qty} shares) — auto-attached a 12% GTC trailing stop`
);

const subject = `Watchdog self-heal: attached ${missing.length} missing trailing stop${missing.length === 1 ? '' : 's'}`;
const body = `Watchdog found ${missing.length} open position(s) with no trailing-stop order and auto-attached one at the 12% flat fallback:

${lines.join('\n')}

This is a safety net, not a fix. The 12% fallback is not the ATR-based stop this position would normally get from Main Analysis — find out why the original Submit Trailing Stop didn't cover ${missing.length === 1 ? 'it' : 'them'} (Wait For Fill race, a rejected entry order, etc.) and consider replacing the fallback stop with a properly sized one.`;

return [{ json: { subject, body } }];
