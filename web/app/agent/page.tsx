'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, ReferenceLine, Cell,
} from 'recharts';
import PageShell from '../components/PageShell';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Accuracy {
  niche: string; nicheDisplay: string;
  hit_rate_30d: number | null;
  scaling_factor: number | null;
  calibration_error: number | null;
  total_signals: number | null;
  avg_reported_confidence_30d: number | null;
}
interface Pattern {
  pattern_tag: string;
  ev: number; win_rate: number;
  avg_win_pct: number; avg_loss_pct: number;
  sample_count: number | null;
}
interface Session {
  session: string;
  orchestrator_summary: string | null;
  created_at: string;
  action_count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatSession(session: string): string {
  const m = session.match(/^(\d{4}-\d{2}-\d{2})[_-](.+)$/);
  if (!m) return session;
  const d = new Date(m[1]);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const label   = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return `${dateStr} · ${label}`;
}

function ScalingIcon({ v }: { v: number | null }) {
  if (v == null) return <Minus size={13} className="text-dim" />;
  if (v > 1.01)  return <TrendingUp  size={13} className="text-gain" />;
  if (v < 0.99)  return <TrendingDown size={13} className="text-loss" />;
  return <Minus size={13} className="text-dim" />;
}

const tooltipStyle = { background: '#1A1F2E', border: '1px solid #2D3748', borderRadius: 8, fontSize: 12 };
const labelStyle   = { color: '#9CA3AF' };

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [accuracy, setAccuracy] = useState<Accuracy[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch('/api/agent')
      .then(r => r.json())
      .then(d => {
        setAccuracy(d.accuracy ?? []);
        setPatterns(d.patterns ?? []);
        setSessions(d.sessions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Shorten niche names for the bar chart x-axis
  const scalingChartData = accuracy.map(a => ({
    name:          (a.nicheDisplay ?? a.niche).replace(' / ', '/').replace(' & ', '/').replace('Cloud Hyperscalers', 'Cloud').replace('Data Centers & AI Infrastructure', 'Data Centers'),
    scaling:       a.scaling_factor ?? 1,
    hit_rate:      a.hit_rate_30d,
    calibration:   a.calibration_error,
  }));

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64 text-dim text-sm">Loading agent data…</div>
      </PageShell>
    );
  }

  const hasAccuracy = accuracy.length > 0;
  const hasPatterns = patterns.length > 0;
  const hasSessions = sessions.length > 0;

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold text-ink">Agent Intelligence</h1>
        <p className="text-sm text-dim mt-1">Specialist accuracy, pattern performance, and session history</p>
      </div>

      {/* Specialist leaderboard */}
      <div className="bg-panel border border-rim rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-rim">
          <h2 className="text-sm font-semibold text-ink">Specialist Accuracy Leaderboard</h2>
          <p className="text-xs text-dim mt-0.5">30-day rolling hit rate · sorted by accuracy</p>
        </div>
        {!hasAccuracy ? (
          <div className="px-5 py-8 text-center text-xs text-dim">
            No accuracy data yet — requires at least 5 closed trades per specialist.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rim">
                  {['Rank', 'Specialist', 'Hit Rate', 'Signals', 'Calib. Error', 'Scaling ×', 'Trend'].map(h => (
                    <th key={h} className="text-left text-xs text-dim font-medium uppercase tracking-wider px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accuracy.map((s, i) => {
                  const hr = s.hit_rate_30d;
                  const sf = s.scaling_factor;
                  const ce = s.calibration_error;
                  return (
                    <tr key={s.niche} className="border-b border-rim/40">
                      <td className="px-5 py-3.5 font-mono text-dim text-xs">#{i + 1}</td>
                      <td className="px-5 py-3.5 text-ink font-medium">{s.nicheDisplay}</td>
                      <td className="px-5 py-3.5">
                        {hr != null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-surface rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${hr >= 0.65 ? 'bg-gain' : hr >= 0.55 ? 'bg-yellow-400' : 'bg-loss'}`}
                                style={{ width: `${hr * 100}%` }}
                              />
                            </div>
                            <span className="font-mono text-sm font-semibold text-ink">{(hr * 100).toFixed(0)}%</span>
                          </div>
                        ) : <span className="text-dim text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-dim">{s.total_signals ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        {ce != null ? (
                          <span className={`font-mono text-sm ${ce <= 0.07 ? 'text-gain' : ce <= 0.12 ? 'text-yellow-400' : 'text-loss'}`}>
                            {ce.toFixed(3)}
                          </span>
                        ) : <span className="text-dim text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {sf != null ? (
                          <span className={`font-mono text-sm ${sf >= 1 ? 'text-gain' : 'text-loss'}`}>
                            ×{sf.toFixed(2)}
                          </span>
                        ) : <span className="text-dim text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5"><ScalingIcon v={sf} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pattern performance + scaling factor chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pattern EV table */}
        <div className="bg-panel border border-rim rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-rim">
            <h2 className="text-sm font-semibold text-ink">Pattern Performance</h2>
            <p className="text-xs text-dim mt-0.5">Negative EV patterns are blocked from new entries</p>
          </div>
          {!hasPatterns ? (
            <div className="px-5 py-8 text-center text-xs text-dim">
              No pattern data yet — builds up as trades close.
            </div>
          ) : (
            <div className="divide-y divide-rim/40">
              {patterns.map(p => {
                const active = p.ev >= 0;
                return (
                  <div key={p.pattern_tag} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-ink">{p.pattern_tag}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${active ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                        {active ? 'Active' : 'Blocked'}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-dim">EV</div>
                        <div className={`font-mono font-semibold ${p.ev >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {p.ev >= 0 ? '+' : ''}{p.ev.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-dim">Win %</div>
                        <div className="font-mono text-ink">{(p.win_rate * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-dim">Avg Win</div>
                        <div className="font-mono text-gain">+{p.avg_win_pct?.toFixed(1) ?? '—'}%</div>
                      </div>
                      <div>
                        <div className="text-dim">Avg Loss</div>
                        <div className="font-mono text-loss">{p.avg_loss_pct?.toFixed(1) ?? '—'}%</div>
                      </div>
                    </div>
                    {p.sample_count != null && (
                      <p className="text-xs text-dim/50 mt-1">{p.sample_count} sample{p.sample_count !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scaling factor bar chart */}
        <div className="bg-panel border border-rim rounded-xl p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Confidence Scaling Factors</h2>
          <p className="text-xs text-dim mb-4">
            {hasAccuracy ? 'Values above 1× boost confidence; below 1× penalise it' : 'No data yet'}
          </p>
          {!hasAccuracy ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-dim">
              Builds up as the system accumulates signal history.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={scalingChartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <XAxis
                    type="number" domain={[0.7, 1.3]}
                    tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `×${v.toFixed(1)}`}
                  />
                  <YAxis
                    type="category" dataKey="name" width={100}
                    tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle} labelStyle={labelStyle}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [`×${Number(v).toFixed(3)}`, 'Scaling Factor'] as any}
                  />
                  <ReferenceLine x={1} stroke="#2D3748" strokeWidth={1} />
                  <Bar dataKey="scaling" radius={[0, 3, 3, 0]}>
                    {scalingChartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.scaling >= 1 ? '#22C55E' : '#EF4444'}
                        fillOpacity={0.7}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 text-xs text-dim mt-2">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-gain/70" />Boosted (×&gt;1)</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-loss/70" />Penalised (×&lt;1)</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Session log */}
      <div className="bg-panel border border-rim rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-rim">
          <h2 className="text-sm font-semibold text-ink">Session Log</h2>
          <p className="text-xs text-dim mt-0.5">Orchestrator summary per session · most recent first</p>
        </div>
        {!hasSessions ? (
          <div className="px-5 py-8 text-center text-xs text-dim">No sessions recorded yet.</div>
        ) : (
          <div className="divide-y divide-rim/40">
            {sessions.map((s, i) => {
              const count = Number(s.action_count ?? 0);
              return (
                <div key={i} className="px-5 py-4 flex gap-5">
                  <div className="shrink-0 w-36">
                    <p className="text-xs font-mono text-dim">{formatSession(s.session)}</p>
                    {count > 0 && (
                      <span className="mt-1.5 inline-block text-xs px-1.5 py-0.5 rounded bg-gain/10 text-gain">
                        {count} action{count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dim leading-relaxed">
                    {s.orchestrator_summary || 'No summary recorded.'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
