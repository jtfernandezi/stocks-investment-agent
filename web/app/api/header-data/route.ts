import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { START_CAPITAL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const SESSION_TIMES = [
  { mins: 9 * 60 + 30,  label: '9:30 AM ET',  slug: 'morning' },
  { mins: 12 * 60,       label: '12:00 PM ET', slug: 'midday'  },
  { mins: 15 * 60 + 50,  label: '3:50 PM ET',  slug: 'close'   },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function computeNextSession(): Promise<string> {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();

  if (day === 0 || day === 6) return 'Mon 9:30 AM ET';

  // During regular hours on a weekday, check Finnhub for holidays
  if (mins >= 570 && mins < 960) {
    try {
      const res  = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${process.env.FINNHUB_API_KEY}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.isOpen) {
        const nextDayLabel = day === 5 ? 'Mon' : DAY_LABELS[day + 1];
        return `${nextDayLabel} 9:30 AM ET`;
      }
    } catch { /* fall through to clock logic */ }
  }

  const next = SESSION_TIMES.find(s => s.mins > mins);
  if (next) return next.label;
  return day === 5 ? 'Mon 9:30 AM ET' : 'Tomorrow 9:30 AM ET';
}

function formatLastRun(session: string): string {
  const idx = session.indexOf('_');
  if (idx < 0) return session;
  const datePart = session.slice(0, idx);
  const slug     = session.slice(idx + 1).split('_')[0];
  const timeLabel = SESSION_TIMES.find(s => s.slug === slug)?.label ?? slug;

  const etToday  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayStr = `${etToday.getFullYear()}-${String(etToday.getMonth() + 1).padStart(2, '0')}-${String(etToday.getDate()).padStart(2, '0')}`;

  if (datePart === todayStr) return timeLabel;
  const dayLabel = new Date(`${datePart}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${dayLabel} ${timeLabel}`;
}

export async function GET() {
  try {
    const [[lastSessionRow], [snap]] = await Promise.all([
      sql`SELECT session FROM stocks.specialist_signals ORDER BY created_at DESC LIMIT 1`,
      sql`SELECT portfolio_value_usd, spy_cumulative_pct FROM stocks.portfolio_snapshots ORDER BY created_at DESC LIMIT 1`,
    ]);

    const lastRun     = lastSessionRow ? formatLastRun(String(lastSessionRow.session)) : '—';
    const nextSession = await computeNextSession();

    const spyCumPct      = snap ? parseFloat(String(snap.spy_cumulative_pct)) : NaN;
    const portfolioValue = snap ? parseFloat(String(snap.portfolio_value_usd)) : NaN;
    const totalReturnPct = !isNaN(portfolioValue) ? (portfolioValue - START_CAPITAL) / START_CAPITAL * 100 : NaN;
    const alphaPct       = !isNaN(totalReturnPct) && !isNaN(spyCumPct) ? totalReturnPct - spyCumPct : NaN;

    return NextResponse.json({ lastRun, nextSession, spyCumPct, alphaPct });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
