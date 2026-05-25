'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const SESSION_TIMES = [
  { mins: 9 * 60 + 30,  label: '9:30 AM ET' },
  { mins: 12 * 60,       label: '12:00 PM ET' },
  { mins: 15 * 60 + 50,  label: '3:50 PM ET' },
];

function getNextSession(day: number, mins: number): string {
  if (day === 0 || day === 6) {
    return day === 6 ? 'Mon 9:30 AM ET' : 'Mon 9:30 AM ET';
  }
  const next = SESSION_TIMES.find(s => s.mins > mins);
  if (next) return next.label;
  return day === 5 ? 'Mon 9:30 AM ET' : 'Tomorrow 9:30 AM ET';
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function holidayNextSession(day: number): string {
  if (day === 5) return 'Mon 9:30 AM ET';
  return `${DAY_LABELS[day + 1]} 9:30 AM ET`;
}

function getClockState() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const nextSession = getNextSession(day, mins);

  const isWeekend = day === 0 || day === 6;
  const isRegularHours = !isWeekend && mins >= 570 && mins < 960;
  const isPreMarket = !isWeekend && mins < 570;

  let sublabel: string;
  if (isWeekend) sublabel = 'Weekend';
  else if (isPreMarket) sublabel = `Opens in ${Math.floor((570 - mins) / 60)}h ${(570 - mins) % 60}m`;
  else if (isRegularHours) sublabel = 'Closes at 4:00 PM ET';
  else sublabel = 'Opens tomorrow 9:30 AM ET';

  return { clockOpen: isRegularHours, sublabel, nextSession, day };
}

export default function MarketClock() {
  const [clock, setClock] = useState(getClockState());
  // null = loading, true/false = Finnhub result
  const [finnhubOpen, setFinnhubOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const tick = () => setClock(getClockState());
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fetchStatus = () =>
      fetch('/api/market-status')
        .then(r => r.json())
        .then(d => { if (d.isOpen !== null) setFinnhubOpen(d.isOpen); })
        .catch(() => {});
    fetchStatus();
    // Re-check every 5 minutes
    const id = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Use Finnhub if available, else fall back to clock
  const isOpen = finnhubOpen !== null ? finnhubOpen : clock.clockOpen;
  // Holiday: Finnhub says closed during what should be regular hours
  const isHoliday = finnhubOpen === false && clock.clockOpen;

  const label       = isOpen ? 'Market Open' : 'Market Closed';
  const sublabel    = isOpen ? 'Closes at 4:00 PM ET'
                    : isHoliday ? 'Market holiday'
                    : clock.sublabel;
  const nextSession = isHoliday ? holidayNextSession(clock.day) : clock.nextSession;
  const color       = isOpen ? 'text-gain' : 'text-dim';

  return (
    <div className="bg-panel border border-rim rounded-xl p-4 flex items-center gap-3">
      <div className={`flex items-center gap-1.5 ${color}`}>
        <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-gain animate-pulse' : 'bg-dim'}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="w-px h-4 bg-rim" />
      <div className="flex items-center gap-1.5 text-xs text-dim">
        <Clock size={12} />
        {sublabel}
      </div>
      <div className="w-px h-4 bg-rim" />
      <span className="text-xs text-dim">Next session: <span className="text-ink">{nextSession}</span></span>
    </div>
  );
}
