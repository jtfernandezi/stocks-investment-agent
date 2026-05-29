export const dynamic = 'force-dynamic';

import PageShell from '../components/PageShell';
import SignalHeatmap from '../components/SignalHeatmap';
import FeedHealth from '../components/FeedHealth';
import { sql } from '@/lib/db';
import { NICHE_DISPLAY } from '@/lib/constants';

interface WatchItem { ticker: string; niche: string; nicheDisplay: string; direction: string; reason: string; }

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const watchDirStyle: Record<string, string> = {
  BULLISH: 'text-gain', BEARISH: 'text-loss', NEUTRAL: 'text-dim',
};

export default async function ResearchPage() {
  const watchlistRows = await safe(() => sql`
    SELECT ticker, niche, direction, reason
    FROM stocks.watchlist
    ORDER BY direction DESC, niche ASC, ticker ASC
  `, [] as Record<string, unknown>[]);

  const watchlist: WatchItem[] = watchlistRows.map(r => ({
    ticker:       String(r.ticker),
    niche:        String(r.niche),
    nicheDisplay: NICHE_DISPLAY[String(r.niche)] ?? String(r.niche),
    direction:    String(r.direction ?? 'NEUTRAL'),
    reason:       String(r.reason   ?? ''),
  }));

  return (
    <PageShell>
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-ink">Research</h1>
        <p className="text-sm text-dim mt-1">Signal trend across all sessions · click any column to view details</p>
      </div>

      {/* Feed health */}
      <FeedHealth />

      {/* Heatmap + session detail (client) */}
      <SignalHeatmap />

      {/* Orchestrator Watchlist (server) */}
      <section>
        <h2 className="text-sm font-semibold text-ink mb-3">Orchestrator Watchlist</h2>
        {watchlist.length === 0 ? (
          <div className="bg-panel border border-rim rounded-xl px-5 py-6 text-center text-xs text-dim">
            Watchlist is empty — the orchestrator hasn&apos;t flagged any stocks for monitoring this session.
          </div>
        ) : (
          <div className="bg-panel border border-rim rounded-xl divide-y divide-rim/40">
            {watchlist.map(w => (
              <div key={`${w.ticker}-${w.niche}`} className="px-4 md:px-5 py-3.5 md:py-4 flex flex-col md:flex-row md:items-start gap-1 md:gap-4">
                {/* Ticker + direction + niche — stacks on mobile, fixed-width column on desktop */}
                <div className="flex items-center gap-2 flex-wrap md:shrink-0 md:w-52">
                  <span className="font-mono text-sm font-semibold text-ink">{w.ticker}</span>
                  <span className={`text-xs font-medium ${watchDirStyle[w.direction] ?? 'text-dim'}`}>
                    {w.direction === 'BULLISH' ? '↑' : w.direction === 'BEARISH' ? '↓' : '·'} {w.direction}
                  </span>
                  <span className="text-xs text-accent w-full md:w-auto">{w.nicheDisplay}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-dim leading-relaxed">{w.reason || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
