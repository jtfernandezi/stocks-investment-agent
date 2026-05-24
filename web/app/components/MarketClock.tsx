'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

function getMarketStatus() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;

  if (day === 0 || day === 6) return { open: false, label: 'Market Closed', sublabel: 'Weekend', color: 'text-dim' };
  if (mins >= 570 && mins < 960) return { open: true, label: 'Market Open', sublabel: 'Closes at 4:00 PM ET', color: 'text-gain' };
  if (mins < 570) return { open: false, label: 'Pre-Market', sublabel: `Opens in ${Math.floor((570 - mins) / 60)}h ${(570 - mins) % 60}m`, color: 'text-yellow-400' };
  return { open: false, label: 'After Hours', sublabel: 'Opens tomorrow 9:30 AM ET', color: 'text-dim' };
}

export default function MarketClock() {
  const [status, setStatus] = useState(getMarketStatus());

  useEffect(() => {
    const id = setInterval(() => setStatus(getMarketStatus()), 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-panel border border-rim rounded-xl p-4 flex items-center gap-3">
      <div className={`flex items-center gap-1.5 ${status.color}`}>
        <span className={`w-2 h-2 rounded-full ${status.open ? 'bg-gain animate-pulse' : 'bg-dim'}`} />
        <span className="text-sm font-medium">{status.label}</span>
      </div>
      <div className="w-px h-4 bg-rim" />
      <div className="flex items-center gap-1.5 text-xs text-dim">
        <Clock size={12} />
        {status.sublabel}
      </div>
      <div className="w-px h-4 bg-rim" />
      <span className="text-xs text-dim">Next session: <span className="text-ink">3:50 PM ET</span></span>
    </div>
  );
}
