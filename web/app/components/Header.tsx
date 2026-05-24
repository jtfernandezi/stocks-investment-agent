import { TrendingUp, Clock } from 'lucide-react';

export default function Header() {
  return (
    <header className="h-14 border-b border-rim bg-panel/60 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4 text-xs text-dim">
        <Clock size={13} />
        <span>Next session: <span className="text-ink">3:50 PM ET</span></span>
        <span className="text-rim">|</span>
        <span>Last run: <span className="text-ink">12:00 PM ET</span></span>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="text-xs text-dim">SPY return</p>
          <p className="font-mono text-sm text-ink">+3.21%</p>
        </div>
        <div className="w-px h-6 bg-rim" />
        <div className="text-right flex items-center gap-2">
          <TrendingUp size={14} className="text-gain" />
          <div>
            <p className="text-xs text-dim">vs SPY</p>
            <p className="font-mono text-sm text-gain font-medium">+2.54% above</p>
          </div>
        </div>
      </div>
    </header>
  );
}
