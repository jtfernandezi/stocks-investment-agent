import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { sql } from '@/lib/db';
import { START_CAPITAL } from '@/lib/constants';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const SESSION_TIMES = [
  { mins: 9 * 60 + 30,  label: '9:30 AM ET',  slug: 'morning' },
  { mins: 12 * 60,       label: '12:00 PM ET', slug: 'midday'  },
  { mins: 15 * 60 + 50,  label: '3:50 PM ET',  slug: 'close'   },
];

function computeNextSession(): string {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();

  if (day === 0 || day === 6) return 'Mon 9:30 AM ET';
  const next = SESSION_TIMES.find(s => s.mins > mins);
  if (next) return next.label;
  return day === 5 ? 'Mon 9:30 AM ET' : 'Tomorrow 9:30 AM ET';
}

function formatLastRun(session: string): string {
  // session format: "2026-05-23_close" | "2026-05-23_morning" | "2026-05-23_midday"
  const idx = session.indexOf('_');
  if (idx < 0) return session;
  const datePart = session.slice(0, idx);
  const slug     = session.slice(idx + 1).split('_')[0];

  const timeLabel = SESSION_TIMES.find(s => s.slug === slug)?.label ?? slug;

  const sessionDate = new Date(`${datePart}T00:00:00Z`);
  const today       = new Date();
  const etToday     = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayStr    = `${etToday.getFullYear()}-${String(etToday.getMonth() + 1).padStart(2, '0')}-${String(etToday.getDate()).padStart(2, '0')}`;

  if (datePart === todayStr) return timeLabel;

  const dayLabel = sessionDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${dayLabel} ${timeLabel}`;
}

export default async function Header() {
  const [[lastSessionRow], [snap]] = await Promise.all([
    safe(() => sql`
      SELECT session FROM stocks.specialist_signals
      ORDER BY created_at DESC LIMIT 1
    `, [] as Record<string, unknown>[]),
    safe(() => sql`
      SELECT portfolio_value_usd, spy_cumulative_pct
      FROM stocks.portfolio_snapshots
      ORDER BY created_at DESC LIMIT 1
    `, [] as Record<string, unknown>[]),
  ]);

  const lastRun     = lastSessionRow ? formatLastRun(String(lastSessionRow.session)) : '—';
  const nextSession = computeNextSession();

  const spyCumPct      = snap ? parseFloat(String(snap.spy_cumulative_pct)) : NaN;
  const portfolioValue = snap ? parseFloat(String(snap.portfolio_value_usd)) : NaN;
  const totalReturnPct = !isNaN(portfolioValue) ? (portfolioValue - START_CAPITAL) / START_CAPITAL * 100 : NaN;
  const alphaPct       = !isNaN(totalReturnPct) && !isNaN(spyCumPct) ? totalReturnPct - spyCumPct : NaN;

  const spyStr   = isNaN(spyCumPct)  ? '—' : `${spyCumPct  >= 0 ? '+' : ''}${spyCumPct.toFixed(2)}%`;
  const alphaStr = isNaN(alphaPct)   ? '—' : `${alphaPct   >= 0 ? '+' : ''}${alphaPct.toFixed(2)}%`;
  const alphaUp  = isNaN(alphaPct) || alphaPct >= 0;

  return (
    <header className="h-14 border-b border-rim bg-panel/60 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4 text-xs text-dim">
        <Clock size={13} />
        <span>Next session: <span className="text-ink">{nextSession}</span></span>
        <span className="text-rim">|</span>
        <span>Last run: <span className="text-ink">{lastRun}</span></span>
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
              {alphaStr} {isNaN(alphaPct) ? '' : alphaPct >= 0 ? 'above' : 'below'}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
