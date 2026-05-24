interface SectorItem { niche: string; pnlUsd: number | null; pnlPct: number | null; }

interface Props { sectors: SectorItem[]; }

export default function SectorPnLWidget({ sectors }: Props) {
  const maxAbs = Math.max(...sectors.map(s => Math.abs(s.pnlPct ?? 0)), 0.01);

  return (
    <div className="bg-panel border border-rim rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink mb-4">Sector Performance</h2>
      <div className="space-y-3">
        {sectors.map(s => {
          const noPos = s.pnlPct == null;
          const up    = (s.pnlPct ?? 0) > 0;
          const barW  = noPos ? 0 : (Math.abs(s.pnlPct!) / maxAbs) * 100;

          return (
            <div key={s.niche} className="flex items-center gap-3">
              <span className="text-xs text-dim w-44 shrink-0 truncate">{s.niche}</span>
              <div className="flex-1 flex items-center gap-2">
                {noPos ? (
                  <span className="text-xs text-dim/40 italic">no position</span>
                ) : (
                  <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${up ? 'bg-gain' : 'bg-loss'}`} style={{ width: `${barW}%` }} />
                  </div>
                )}
              </div>
              {!noPos && (
                <div className="flex items-baseline gap-1.5 min-w-[100px] justify-end">
                  <span className={`font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
                    {up ? '+' : ''}{s.pnlPct!.toFixed(2)}%
                  </span>
                  <span className="font-mono text-xs text-dim">
                    {up ? '+' : '−'}${Math.abs(s.pnlUsd!).toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
