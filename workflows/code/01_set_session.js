// Node: Set Session
// Position: Right after Schedule Trigger
// Output: 1 item with session metadata used by all downstream nodes

const now = new Date();
const utcHour = now.getUTCHours();
const utcMinute = now.getUTCMinutes();
const totalUTCMinutes = utcHour * 60 + utcMinute;

// EDT = UTC-4 (summer). Adjust to UTC-5 in winter.
// Morning:  8:30 AM ET = 12:30 UTC → range 720–840 min
// Midday:  12:00 PM ET = 16:00 UTC → range 840–1230 min
// Close:    4:30 PM ET = 20:30 UTC → range 1230+ min
let session_type;
if (totalUTCMinutes >= 720 && totalUTCMinutes < 840) {
  session_type = 'morning';
} else if (totalUTCMinutes >= 840 && totalUTCMinutes < 1230) {
  session_type = 'midday';
} else {
  session_type = 'close';
}

const dateStr = now.toISOString().split('T')[0];  // YYYY-MM-DD
const session_id = `${dateStr}_${session_type}`;

return [{
  json: {
    session_type,          // 'morning' | 'midday' | 'close'
    session_id,            // e.g. '2026-05-19_morning'
    session_date: dateStr,
    utc_timestamp: now.toISOString(),
    is_morning: session_type === 'morning',
  }
}];
