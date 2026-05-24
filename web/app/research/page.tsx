export const dynamic = 'force-dynamic';

import PageShell from '../components/PageShell';
import { sql } from '@/lib/db';
import { NICHE_DISPLAY } from '@/lib/constants';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pick   { ticker: string; thesis?: string; key_risk?: string; }
interface Signal {
  niche: string; nicheDisplay: string;
  direction: string; conviction: string;
  confidence: number; materiality: string;
  summary: string; session: string;
  hit_rate: number | null; total_signals: number | null;
  picks: { long_picks: Pick[]; short_picks: Pick[] };
}
interface WatchItem { ticker: string; niche: string; nicheDisplay: string; direction: string; reason: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

function formatSession(session: string | null): string {
  if (!session) return '—';
  const parts = session.split('-');
  if (parts.length >= 4) {
    const [year, month, day, ...rest] = parts;
    const timePart = rest.join(' ');
    const label    = timePart.charAt(0).toUpperCase() + timePart.slice(1);
    const d = new Date(`${year}-${month}-${day}`);
    const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${label} · ${dateStr}`;
  }
  return session;
}

const directionStyle: Record<string, string> = {
  BULLISH: 'bg-gain/10 text-gain border border-gain/20',
  BEARISH: 'bg-loss/10 text-loss border border-loss/20',
  NEUTRAL: 'bg-dim/10 text-dim  border border-rim',
};

const convictionStyle: Record<string, string> = {
  HIGH:   'text-gain',
  MEDIUM: 'text-ink',
  LOW:    'text-dim',
};

const watchDirStyle: Record<string, string> = {
  BULLISH: 'text-gain',
  BEARISH: 'text-loss',
  NEUTRAL: 'text-dim',
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ResearchPage() {
  const [signalRows, watchlistRows] = await Promise.all([
    safe(() => sql`
      SELECT
        ss.niche, ss.direction, ss.conviction,
        ss.confidence::float, ss.materiality,
        ss.top_picks, ss.summary, ss.session,
        sa.hit_rate::float      AS hit_rate,
        sa.total_signals
      FROM stocks.specialist_signals ss
      LEFT JOIN stocks.specialist_accuracy sa ON sa.niche = ss.niche
      WHERE ss.session = (
        SELECT session FROM stocks.specialist_signals ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY ss.niche ASC
    `, [] as Record<string, unknown>[]),
    safe(() => sql`
      SELECT ticker, niche, direction, reason
      FROM stocks.watchlist
      ORDER BY direction DESC, niche ASC, ticker ASC
    `, [] as Record<string, unknown>[]),
  ]);

  const signals: Signal[] = signalRows.map(r => {
    let picks: { long_picks: Pick[]; short_picks: Pick[] } = { long_picks: [], short_picks: [] };
    try { picks = JSON.parse(String(r.top_picks || '{}')); } catch { /* keep empty */ }
    return {
      niche:        String(r.niche),
      nicheDisplay: NICHE_DISPLAY[String(r.niche)] ?? String(r.niche),
      direction:    String(r.direction ?? 'NEUTRAL'),
      conviction:   String(r.conviction ?? 'LOW'),
      confidence:   parseFloat(String(r.confidence ?? 0)),
      materiality:  String(r.materiality ?? '—'),
      summary:      String(r.summary ?? ''),
      session:      String(r.session ?? ''),
      hit_rate:     r.hit_rate != null ? parseFloat(String(r.hit_rate)) : null,
      total_signals: r.total_signals != null ? parseInt(String(r.total_signals)) : null,
      picks,
    };
  });

  const watchlist: WatchItem[] = watchlistRows.map(r => ({
    ticker:      String(r.ticker),
    niche:       String(r.niche),
    nicheDisplay: NICHE_DISPLAY[String(r.niche)] ?? String(r.niche),
    direction:   String(r.direction ?? 'NEUTRAL'),
    reason:      String(r.reason ?? ''),
  }));

  const latestSession = signals[0]?.session ?? null;

  // Summarise overall stance
  const bullishCount = signals.filter(s => s.direction === 'BULLISH').length;
  const bearishCount = signals.filter(s => s.direction === 'BEARISH').length;
  const neutralCount = signals.filter(s => s.direction === 'NEUTRAL').length;

  return (
    <PageShell>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink">Research</h1>
          <p className="text-sm text-dim mt-1">
            {signals.length > 0
              ? `${signals.length} specialist signals · ${formatSession(latestSession)}`
              : 'No signals yet — waiting for first workflow run'}
          </p>
        </div>
        {signals.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-gain">
              <span className="w-2 h-2 rounded-full bg-gain" />{bullishCount} Bullish
            </span>
            <span className="flex items-center gap-1.5 text-dim">
              <span className="w-2 h-2 rounded-full bg-dim" />{neutralCount} Neutral
            </span>
            <span className="flex items-center gap-1.5 text-loss">
              <span className="w-2 h-2 rounded-full bg-loss" />{bearishCount} Bearish
            </span>
          </div>
        )}
      </div>

      {/* Specialist signals */}
      {signals.length === 0 ? (
        <div className="bg-panel border border-rim rounded-xl px-5 py-12 text-center text-sm text-dim">
          No specialist signals found. The workflow hasn&apos;t run yet or the DB is unreachable.
        </div>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">Specialist Signals</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {signals.map(s => (
              <div key={s.niche} className="bg-panel border border-rim rounded-xl p-5 space-y-3">
                {/* Top bar */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{s.nicheDisplay}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${directionStyle[s.direction] ?? directionStyle.NEUTRAL}`}>
                        {s.direction}
                      </span>
                      {s.materiality && s.materiality !== '—' && (
                        <span className="text-xs text-dim">{s.materiality} materiality</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs font-semibold ${convictionStyle[s.conviction] ?? 'text-dim'}`}>
                      {s.conviction} conviction
                    </span>
                    <span className="text-xs text-dim">
                      {s.hit_rate != null
                        ? `${(s.hit_rate * 100).toFixed(0)}% hit rate`
                        : s.total_signals != null ? `${s.total_signals} signals` : 'no history'}
                    </span>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dim w-20 shrink-0">Confidence</span>
                  <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        s.direction === 'BULLISH' ? 'bg-gain' :
                        s.direction === 'BEARISH' ? 'bg-loss' : 'bg-dim'
                      }`}
                      style={{ width: `${s.confidence * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-dim w-8 text-right">{s.confidence.toFixed(2)}</span>
                </div>

                {/* Summary */}
                {s.summary && (
                  <p className="text-xs text-dim leading-relaxed">{s.summary}</p>
                )}

                {/* Picks */}
                {(s.picks.long_picks.length > 0 || s.picks.short_picks.length > 0) && (
                  <div className="pt-2 border-t border-rim/40 space-y-2">
                    {s.picks.long_picks.length > 0 && (
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gain shrink-0 mt-0.5">LONG</span>
                        <div className="flex flex-wrap gap-1.5">
                          {s.picks.long_picks.map((p, i) => (
                            <span key={i} className="text-xs font-mono bg-gain/10 text-gain px-2 py-0.5 rounded" title={p.thesis}>
                              {p.ticker}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.picks.short_picks.length > 0 && (
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-xs font-medium text-loss shrink-0 mt-0.5">SHORT</span>
                        <div className="flex flex-wrap gap-1.5">
                          {s.picks.short_picks.map((p, i) => (
                            <span key={i} className="text-xs font-mono bg-loss/10 text-loss px-2 py-0.5 rounded" title={p.thesis}>
                              {p.ticker}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Orchestrator Watchlist */}
      {watchlist.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">Orchestrator Watchlist</h2>
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
        </section>
      )}

      {watchlist.length === 0 && signals.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">Orchestrator Watchlist</h2>
          <div className="bg-panel border border-rim rounded-xl px-5 py-6 text-center text-xs text-dim">
            Watchlist is empty — the orchestrator hasn&apos;t flagged any stocks for monitoring this session.
          </div>
        </section>
      )}
    </PageShell>
  );
}
