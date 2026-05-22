// Node: Set Session
// Position: Right after Schedule Trigger or When Called by Watchdog
// Output: 1 item with session metadata used by all downstream nodes

const now = new Date();

// Detect watchdog-triggered run — watchdog passes session_type: 'watchdog_flip'
const inputJson = $input.first()?.json || {};
const isWatchdog = inputJson.session_type === 'watchdog_flip';

// Get ET time — DST-safe via America/New_York (no hardcoded UTC offsets)
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
}).formatToParts(now);

const etHour   = parseInt(parts.find(p => p.type === 'hour').value);
const etMinute = parseInt(parts.find(p => p.type === 'minute').value);
const etMin    = etHour * 60 + etMinute;

// Session boundaries (ET) — matches schedule: 9:30 AM, 12:00 PM, 3:50 PM
// morning:  9:30 AM (570) – 12:00 PM (720)
// midday:  12:00 PM (720) – 3:50 PM  (950)
// close:    3:50 PM (950)+
let session_type;
if (etMin >= 570 && etMin < 720) {
  session_type = 'morning';
} else if (etMin >= 720 && etMin < 950) {
  session_type = 'midday';
} else {
  session_type = 'close';
}

const dateStr  = now.toISOString().split('T')[0];  // YYYY-MM-DD

// Watchdog runs get a distinct session_id to avoid colliding with scheduled sessions
const session_id = isWatchdog
  ? `${dateStr}_${session_type}_watchdog`
  : `${dateStr}_${session_type}`;

return [{
  json: {
    session_type,          // 'morning' | 'midday' | 'close'
    session_id,            // e.g. '2026-05-19_morning' or '2026-05-19_midday_watchdog'
    session_date: dateStr,
    utc_timestamp: now.toISOString(),
    is_morning:  session_type === 'morning',
    is_watchdog: isWatchdog,
  }
}];
