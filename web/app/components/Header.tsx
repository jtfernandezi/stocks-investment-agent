'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';

interface HeaderData {
  lastRun: string;
  nextSession: string;
  spyCumPct: number;
  alphaPct: number;
}

export default function Header() {
  const [data, setData] = useState<HeaderData | null>(null);

  useEffect(() => {
    fetch('/api/header-data')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const spyStr   = !data || data.spyCumPct == null || isNaN(data.spyCumPct)  ? '—' : `${data.spyCumPct  >= 0 ? '+' : ''}${data.spyCumPct.toFixed(2)}%`;
  const alphaStr = !data || data.alphaPct  == null || isNaN(data.alphaPct)   ? '—' : `${data.alphaPct   >= 0 ? '+' : ''}${data.alphaPct.toFixed(2)}%`;
  const alphaUp  = !data || data.alphaPct  == null || isNaN(data.alphaPct) || data.alphaPct >= 0;

  return (
    <header className="h-14 border-b border-rim bg-panel/60 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4 text-xs text-dim">
        <Clock size={13} />
        <span>Next session: <span className="text-ink">{data?.nextSession ?? '—'}</span></span>
        <span className="text-rim">|</span>
        <span>Last run: <span className="text-ink">{data?.lastRun ?? '—'}</span></span>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="text-xs text-dim">SPY return</p>
          <p className="font-mono text-sm text-ink">{spyStr}</p>
        </div>
        <div className="w-px h-6 bg-rim" />
        <div className="text-right flex items-center gap-2">
          {alphaUp
            ? <TrendingUp size={14} className="text-gain" />
            : <TrendingDown size={14} className="text-loss" />}
          <div>
            <p className="text-xs text-dim">vs SPY</p>
            <p className={`font-mono text-sm font-medium ${alphaUp ? 'text-gain' : 'text-loss'}`}>
              {alphaStr}{data && data.alphaPct != null && !isNaN(data.alphaPct) ? (data.alphaPct >= 0 ? ' above' : ' below') : ''}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
