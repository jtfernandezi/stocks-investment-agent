'use client';

import { useState, useEffect } from 'react';
import { ALL_NICHES, NICHE_DISPLAY } from '@/lib/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pick { ticker: string; thesis?: string; }
interface Signal {
  niche: string; nicheDisplay: string;
  direction: string; conviction: string;
  confidence: number; materiality: string;
  summary: string; session: string;
  hit_rate: number | null; total_signals: number | null;
  picks: { long_picks: Pick[]; short_picks: Pick[] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellBg(direction: string, confidence: number): React.CSSProperties {
  const a = (0.2 + confidence * 0.75).toFixed(2);
  if (direction === 'BULLISH') return { backgroundColor: `rgba(34,197,94,${a})` };
  if (direction === 'BEARISH') return { backgroundColor: `rgba(239,68,68,${a})` };
  return { backgroundColor: `rgba(234,179,8,${(0.3 + confidence * 0.4).toFixed(2)})` };
}

function parseSession(session: string) {
  const parts = session.split('-');
  if (parts.length >= 4) {
    const [year, month, day, ...rest] = parts;
    const slug = rest.join('-');
    const d = new Date(`${year}-${month}-${day}`);
    return {
      dateKey: `${year}-${month}-${day}`,
      date:    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      label:   slug === 'morning' ? 'AM' : slug === 'midday' ? 'PM' : 'EOD',
    };
  }
  return { dateKey: session, date: session, label: session };
}

function formatSessionFull(session: string): string {
  const parts = session.split('-');
  if (parts.length >= 4) {
    const [year, month, day, ...rest] = parts;
    const slug  = rest.join(' ');
    const label = slug.charAt(0).toUpperCase() + slug.slice(1);
    const d     = new Date(`${year}-${month}-${day}`);
    return `${label} · ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  }
  return session;
}

function shortNiche(display: string): string {
  return display
    .replace('Data Centers & AI Infrastructure', 'Data Centers')
    .replace('AI & Semiconductors', 'AI & Semis')
    .replace('Cloud Hyperscalers', 'Cloud')
    .replace('Copper / Minerals', 'Copper')
    .replace('Nuclear / Uranium', 'Nuclear');
}

const directionStyle: Record<string, string> = {
  BULLISH: 'bg-gain/10 text-gain border border-gain/20',
  BEARISH: 'bg-loss/10 text-loss border border-loss/20',
  NEUTRAL: 'bg-dim/10 text-dim border border-rim',
};

const convictionStyle: Record<string, string> = {
  HIGH: 'text-gain', MEDIUM: 'text-ink', LOW: 'text-dim',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function SignalHeatmap() {
  const [signals,  setSignals]  = useState<Signal[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/signals/history')
      .then(r => r.json())
      .then(data => {
        setSignals(data.signals ?? []);
        const sess: string[] = data.sessions ?? [];
        setSessions(sess);
        setSelected(sess[sess.length - 1] ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Build lookup: session → niche → signal
  const lookup = new Map<string, Map<string, Signal>>();
  for (const s of signals) {
    if (!lookup.has(s.session)) lookup.set(s.session, new Map());
    lookup.get(s.session)!.set(s.niche, s);
  }

  // Date groups for the two-row header (date spanning colSpan, then AM/PM/EOD)
  const dateGroups: { dateKey: string; date: string; count: number }[] = [];
  for (const sess of sessions) {
    const { date, dateKey } = parseSession(sess);
    const last = dateGroups[dateGroups.length - 1];
    if (last?.dateKey === dateKey) last.count++;
    else dateGroups.push({ dateKey, date, count: 1 });
  }

  const selectedSignals: Signal[] = selected
    ? ALL_NICHES.map(n => lookup.get(selected)?.get(n)).filter(Boolean) as Signal[]
    : [];

  if (loading) {
    return (
      <div className="bg-panel border border-rim rounded-xl px-5 py-12 text-center text-sm text-dim">
        Loading signal history…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="bg-panel border border-rim rounded-xl px-5 py-12 text-center text-sm text-dim">
        No signal history yet — waiting for first workflow run.
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Heatmap ── */}
      <div className="bg-panel border border-rim rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Signal Trend</h2>
            <p className="text-xs text-dim mt-0.5">Intensity = confidence · click any session column to drill in</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-dim">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34,197,94,0.80)' }} />Bullish
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(234,179,8,0.55)' }} />Neutral
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239,68,68,0.80)' }} />Bearish
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              {/* Row 1 — date labels spanning multiple sessions */}
              <tr>
                <th className="w-28" />
                {dateGroups.map(g => (
                  <th
                    key={g.dateKey}
                    colSpan={g.count}
                    className="text-[11px] text-dim font-medium pb-1 text-center border-b border-rim/30"
                  >
                    {g.date}
                  </th>
                ))}
              </tr>
              {/* Row 2 — AM / PM / EOD labels, clickable */}
              <tr>
                <th className="w-28" />
                {sessions.map(sess => {
                  const { label } = parseSession(sess);
                  const isSelected = sess === selected;
                  return (
                    <th
                      key={sess}
                      onClick={() => setSelected(sess)}
                      className={`text-[11px] font-semibold pt-1 pb-2 text-center cursor-pointer select-none w-11 transition-colors border-b-2 ${
                        isSelected
                          ? 'text-accent border-accent'
                          : 'text-dim hover:text-ink border-transparent'
                      }`}
                    >
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ALL_NICHES.map(niche => (
                <tr key={niche}>
                  <td className="pr-3 py-1">
                    <span className="text-xs text-dim whitespace-nowrap">
                      {shortNiche(NICHE_DISPLAY[niche] ?? niche)}
                    </span>
                  </td>
                  {sessions.map(sess => {
                    const sig = lookup.get(sess)?.get(niche);
                    const isSelected = sess === selected;
                    return (
                      <td key={sess} className="py-1 px-0.5">
                        <div
                          onClick={() => setSelected(sess)}
                          style={sig
                            ? cellBg(sig.direction, sig.confidence)
                            : { backgroundColor: 'rgba(100,100,100,0.08)' }
                          }
                          className={`w-10 h-7 rounded cursor-pointer transition-transform hover:scale-110 hover:opacity-90 ${
                            isSelected ? 'ring-1 ring-white/30' : ''
                          }`}
                          title={sig
                            ? `${sig.nicheDisplay} · ${sig.direction} · ${sig.conviction} conviction · conf ${sig.confidence.toFixed(2)}`
                            : `${NICHE_DISPLAY[niche] ?? niche} · no data`
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Selected session detail ── */}
      {selected && (
        <section>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-sm font-semibold text-ink">{formatSessionFull(selected)}</h2>
            {selectedSignals.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gain">
                  {selectedSignals.filter(s => s.direction === 'BULLISH').length} Bullish
                </span>
                <span className="text-dim">
                  {selectedSignals.filter(s => s.direction === 'NEUTRAL').length} Neutral
                </span>
                <span className="text-loss">
                  {selectedSignals.filter(s => s.direction === 'BEARISH').length} Bearish
                </span>
              </div>
            )}
          </div>

          {selectedSignals.length === 0 ? (
            <div className="bg-panel border border-rim rounded-xl px-5 py-8 text-center text-xs text-dim">
              No signals recorded for this session.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {selectedSignals.map(s => (
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
                  {s.summary && <p className="text-xs text-dim leading-relaxed">{s.summary}</p>}

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
          )}
        </section>
      )}
    </div>
  );
}
