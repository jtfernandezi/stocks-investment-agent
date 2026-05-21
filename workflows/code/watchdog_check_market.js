// Node: Check Market Open (Watchdog)
// Returns empty (stops execution) if market is closed or weekend.
// Market hours: 9:30 AM – 4:00 PM ET (EDT = UTC-4)

const now = new Date();
const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
const dow    = now.getUTCDay(); // 0=Sun, 6=Sat

// 9:30 AM ET = 13:30 UTC | 4:00 PM ET = 20:00 UTC
if (dow < 1 || dow > 5 || utcMin < 810 || utcMin >= 1200) {
  return [{ json: { market_open: false, reason: 'Market closed', checked_at: now.toISOString() } }];
}

return [{ json: { market_open: true, checked_at: now.toISOString() } }];
