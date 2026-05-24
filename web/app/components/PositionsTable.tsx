interface Position {
  ticker: string;
  side: 'LONG' | 'SHORT';
  shares: number;
  entry: number;
  current: number;
  pnl: number;
  pnlPct: number;
  stop: number;
  conviction: number;
  niche: string;
}

interface PositionsTableProps {
  positions: Position[];
}

function usd(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(n: number) {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

export default function PositionsTable({ positions }: PositionsTableProps) {
  return (
    <div className="bg-panel border border-rim rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-rim flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Open Positions</h2>
          <p className="text-xs text-dim mt-0.5">{positions.length} active trades</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rim">
              {[
                'Ticker',
                'Side',
                'Shares',
                'Entry',
                'Current',
                'P&L',
                'P&L %',
                'Stop',
                'Conviction',
              ].map((h) => (
                <th
                  key={h}
                  className="text-left text-xs text-dim font-medium uppercase tracking-wider px-5 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const up = p.pnl >= 0;
              return (
                <tr
                  key={p.ticker}
                  className="border-b border-rim/40 hover:bg-ink/[0.03] transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="font-semibold text-ink">{p.ticker}</div>
                    <div className="text-xs text-dim">{p.niche}</div>
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        p.side === 'LONG'
                          ? 'bg-gain/10 text-gain'
                          : 'bg-loss/10 text-loss'
                      }`}
                    >
                      {p.side}
                    </span>
                  </td>

                  <td className="px-5 py-4 font-mono text-ink">{p.shares}</td>
                  <td className="px-5 py-4 font-mono text-dim">{usd(p.entry)}</td>
                  <td className="px-5 py-4 font-mono text-ink">{usd(p.current)}</td>

                  <td className={`px-5 py-4 font-mono font-medium ${up ? 'text-gain' : 'text-loss'}`}>
                    {up ? '+' : '−'}{usd(p.pnl)}
                  </td>

                  <td className={`px-5 py-4 font-mono font-medium ${up ? 'text-gain' : 'text-loss'}`}>
                    {pct(p.pnlPct)}
                  </td>

                  <td className="px-5 py-4 font-mono text-dim">{p.stop.toFixed(1)}%</td>

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 min-w-[80px]">
                      <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full"
                          style={{ width: `${p.conviction * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-dim w-8 text-right">
                        {p.conviction.toFixed(2)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
