'use client';

import { useState, useEffect } from 'react';
import PageShell from '../components/PageShell';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Letter {
  session: string;
  body: string;
  created_at: string;
}

function parseSession(session: string): { date: string; time: string } | null {
  const m = session.match(/^(\d{4}-\d{2}-\d{2})[_-](.+)$/);
  if (!m) return null;
  return { date: m[1], time: m[2] };
}

function sessionToLabel(session: string): string {
  const p = parseSession(session);
  if (!p) return session;
  const d = new Date(p.date);
  const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const label = p.time.charAt(0).toUpperCase() + p.time.slice(1);
  return `${label}, ${dateStr}`;
}

function sessionToShort(session: string): string {
  const p = parseSession(session);
  if (!p) return session;
  const d = new Date(p.date);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const label = p.time.charAt(0).toUpperCase() + p.time.slice(1);
  return `${dateStr} · ${label}`;
}

export default function LetterPage() {
  const [letters,  setLetters]  = useState<Letter[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/letter')
      .then(r => r.json())
      .then(d => {
        setLetters(d.letters ?? []);
        if (d.letters?.length > 0) setSelected(d.letters[0].session);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const idx            = letters.findIndex(l => l.session === selected);
  const selectedLetter = letters[idx] ?? null;

  const paragraphs: string[] = selectedLetter
    ? selectedLetter.body.split(/\n\n+/).filter(Boolean)
    : loading
    ? []
    : ['No letters yet. The AI writes one after each market close session.'];

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold text-ink">Investor Letter</h1>
        <p className="text-xs md:text-sm text-dim mt-1">Daily LP update · written by GPT after each close session</p>
      </div>

      {/* Mobile session picker — horizontal pill strip, hidden on desktop */}
      {!loading && letters.length > 0 && (
        <div className="lg:hidden overflow-x-auto -mx-4 px-4">
          <div className="flex gap-2 pb-1 min-w-max">
            {letters.map((l, i) => (
              <button
                key={l.session}
                onClick={() => setSelected(l.session)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
                  l.session === selected
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'text-dim border-rim hover:text-ink'
                }`}
              >
                {i === 0 && <span className="text-gain mr-1">●</span>}
                {sessionToShort(l.session)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Archive sidebar — desktop only */}
        <div className="hidden lg:block lg:col-span-1">
          <div className="bg-panel border border-rim rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-rim">
              <h2 className="text-xs font-semibold text-dim uppercase tracking-wider">Archive</h2>
            </div>
            {loading ? (
              <div className="px-4 py-4 text-xs text-dim">Loading…</div>
            ) : letters.length === 0 ? (
              <div className="px-4 py-4 text-xs text-dim">No letters yet.</div>
            ) : (
              <div className="divide-y divide-rim/40">
                {letters.map((l, i) => (
                  <button
                    key={l.session}
                    onClick={() => setSelected(l.session)}
                    className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                      l.session === selected
                        ? 'bg-accent/10 text-accent'
                        : 'text-dim hover:text-ink hover:bg-ink/5'
                    }`}
                  >
                    {i === 0 && <span className="text-gain text-xs mr-1">●</span>}
                    {sessionToShort(l.session)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Letter body */}
        <div className="lg:col-span-3">
          <div className="bg-panel border border-rim rounded-xl">

            {/* Header strip */}
            <div className="px-4 md:px-8 py-4 md:py-5 border-b border-rim flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-dim uppercase tracking-wider">Alpha Agent Capital</p>
                <p className="text-sm text-ink mt-0.5 truncate">
                  {selected ? sessionToLabel(selected) : '—'}
                </p>
              </div>
              {/* Prev/next — desktop only; mobile uses pill strip above */}
              <div className="hidden lg:flex items-center gap-2 shrink-0">
                <button
                  onClick={() => idx < letters.length - 1 && setSelected(letters[idx + 1].session)}
                  disabled={idx >= letters.length - 1}
                  className="p-1.5 rounded-lg border border-rim text-dim hover:text-ink hover:border-dim disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => idx > 0 && setSelected(letters[idx - 1].session)}
                  disabled={idx <= 0}
                  className="p-1.5 rounded-lg border border-rim text-dim hover:text-ink hover:border-dim disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* Letter content */}
            <div className="px-4 md:px-8 py-6 md:py-8">
              {loading ? (
                <p className="text-sm text-dim">Loading…</p>
              ) : (
                <div className="space-y-5 max-w-2xl">
                  {paragraphs.map((para, i) => (
                    <p key={i} className={`text-sm leading-relaxed whitespace-pre-line ${
                      i === 0 ? 'text-ink font-medium' : 'text-dim'
                    }`}>
                      {para}
                    </p>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </PageShell>
  );
}
