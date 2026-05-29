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
    <div className="bg-panel border border-rim rounded-xl p-3 md:p-4">
      <p className="text-[10px] md:text-xs text-dim uppercase tracking-wider mb-1.5 leading-tight">{label}</p>
      <p className={`font-mono text-base md:text-xl font-semibold leading-tight ${valueColor}`}>{value}</p>
      {subtext && <p className="text-[10px] md:text-xs text-dim mt-1 leading-tight">{subtext}</p>}
    </div>
  );
}
