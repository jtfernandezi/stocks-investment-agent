interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export default function StatCard({ label, value, subtext, trend }: StatCardProps) {
  const valueColor =
    trend === 'up' ? 'text-gain' : trend === 'down' ? 'text-loss' : 'text-ink';

  return (
    <div className="bg-panel border border-rim rounded-xl p-4">
      <p className="text-xs text-dim uppercase tracking-wider mb-2">{label}</p>
      <p className={`font-mono text-xl font-semibold ${valueColor}`}>{value}</p>
      {subtext && <p className="text-xs text-dim mt-1">{subtext}</p>}
    </div>
  );
}
