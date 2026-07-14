'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';

interface EquityPoint { date: string; portfolio: number; spy: number; }

interface Props { data: EquityPoint[]; startCapital?: number; }

function fmt(v: number) {
  return `$${(v / 1000).toFixed(1)}k`;
}

export default function MiniEquityChart({ data, startCapital = 60_000 }: Props) {
  return (
    <div className="bg-panel border border-rim rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-ink">Equity Curve</h2>
        <div className="flex items-center gap-4 text-xs text-dim">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-accent rounded" />Portfolio</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-dim rounded" />SPY</span>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="h-[160px] flex items-center justify-center text-xs text-dim">Loading chart…</div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
            <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
              interval={Math.max(1, Math.floor(data.length / 6))} />
            <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={40} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: '#1A1F2E', border: '1px solid #2D3748', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#9CA3AF' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any, name: any) => [`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, name === 'portfolio' ? 'Portfolio' : 'SPY'] as any}
            />
            <ReferenceLine y={startCapital} stroke="#2D3748" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="portfolio" stroke="#3B82F6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="spy" stroke="#9CA3AF" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
