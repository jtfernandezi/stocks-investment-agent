export const dynamic = 'force-dynamic';

import PageShell from '../components/PageShell';
import SignalHeatmap from '../components/SignalHeatmap';
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
              <div key={`${w.ticker}-${w.niche}`} className="px-5 py-4 flex items-start gap-4">
                <div className="flex items-center gap-3 shrink-0 w-52">
                  <span className="font-mono text-sm font-semibold text-ink">{w.ticker}</span>
                  <span className={`text-xs font-medium ${watchDirStyle[w.direction] ?? 'text-dim'}`}>
                    {w.direction === 'BULLISH' ? '↑' : w.direction === 'BEARISH' ? '↓' : '·'} {w.direction}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-accent mb-0.5">{w.nicheDisplay}</p>
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
