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
    <header className="h-12 md:h-14 border-b border-rim bg-panel/60 px-4 md:px-6 flex items-center justify-between shrink-0 gap-4">
      {/* Left: session info — full on desktop, abbreviated on mobile */}
      <div className="flex items-center gap-2 text-xs text-dim min-w-0">
        <Clock size={13} className="shrink-0 hidden md:block" />
        <span className="hidden md:inline whitespace-nowrap">
          Next session: <span className="text-ink">{data?.nextSession ?? '—'}</span>
        </span>
        <span className="md:hidden whitespace-nowrap">
          Next: <span className="text-ink">{data?.nextSession ?? '—'}</span>
        </span>
        <span className="text-rim hidden md:inline">|</span>
        <span className="hidden md:inline whitespace-nowrap">
          Last run: <span className="text-ink">{data?.lastRun ?? '—'}</span>
        </span>
      </div>

      {/* Right: SPY + alpha */}
      <div className="flex items-center gap-3 md:gap-6 shrink-0">
        {/* SPY return — desktop only */}
        <div className="text-right hidden md:block">
          <p className="text-xs text-dim">SPY return</p>
          <p className="font-mono text-sm text-ink">{spyStr}</p>
        </div>
        <div className="w-px h-6 bg-rim hidden md:block" />

        {/* vs SPY — always visible */}
        <div className="text-right flex items-center gap-1.5">
          {alphaUp
            ? <TrendingUp size={14} className="text-gain" />
            : <TrendingDown size={14} className="text-loss" />}
          <div>
            <p className="text-xs text-dim">vs SPY</p>
            <p className={`font-mono text-sm font-medium ${alphaUp ? 'text-gain' : 'text-loss'}`}>
              {alphaStr}
              <span className="hidden md:inline">
                {data && data.alphaPct != null && !isNaN(data.alphaPct)
                  ? data.alphaPct >= 0 ? ' above' : ' below'
                  : ''}
              </span>
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
