// Node: Check Market Open (Watchdog)
// Returns empty (stops execution) if market is closed, weekend, or outside watchdog window.
// Watchdog runs: 10:00 AM – 3:30 PM ET (cron handles scheduling; gate catches holidays/weekends).
// Uses America/New_York timezone — DST-safe (no hardcoded UTC offsets).

const now = new Date();
const dow = now.getUTCDay(); // 0=Sun, 6=Sat — UTC day is fine for weekday check

if (dow < 1 || dow > 5) {
  return [{ json: { market_open: false, reason: 'Weekend', checked_at: now.toISOString() } }];
}

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
}).formatToParts(now);

const etHour   = parseInt(parts.find(p => p.type === 'hour').value);
const etMinute = parseInt(parts.find(p => p.type === 'minute').value);
const etMin    = etHour * 60 + etMinute;

// Watchdog window: 10:00 AM (600) – 3:30 PM (930) ET
if (etMin < 600 || etMin >= 930) {
  return [{ json: { market_open: false, reason: 'Outside watchdog window (10:00–15:30 ET)', checked_at: now.toISOString() } }];
}

return [{ json: { market_open: true, checked_at: now.toISOString() } }];
