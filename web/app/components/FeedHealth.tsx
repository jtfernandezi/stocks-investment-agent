'use client';

import { useEffect, useState } from 'react';
import { NICHE_DISPLAY } from '@/lib/constants';
import type { FeedStatus } from '@/app/api/feed-health/route';

function Dot({ ok, error }: { ok: boolean; error: string | null }) {
  return (
    <span
      title={ok ? 'Feed OK' : (error ?? 'Failed')}
      className={`inline-block w-2 h-2 rounded-full cursor-default ${ok ? 'bg-gain' : 'bg-loss'}`}
    />
  );
}

export default function FeedHealth() {
  const [feeds,     setFeeds]     = useState<FeedStatus[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    fetch('/api/feed-health')
      .then(r => r.json())
      .then(d => {
        setFeeds(d.feeds ?? []);
        setStartedAt(d.startedAt ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const lastRun = startedAt
    ? new Date(startedAt).toLocaleString('en-US', {
        weekday: 'short', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: 'America/New_York', timeZoneName: 'short',
      })
    : '—';

  const failCount = feeds.filter(f => !f.feed1.ok || !f.feed2.ok).length;

  return (
    <div className="bg-panel border border-rim rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Feed Health</h2>
          <p className="text-xs text-dim mt-0.5">Last run: {lastRun}</p>
        </div>
        {!loading && failCount > 0 && (
          <span className="text-xs bg-loss/10 text-loss border border-loss/20 px-2 py-0.5 rounded-full">
            {failCount} niche{failCount > 1 ? 's' : ''} degraded
          </span>
        )}
        {!loading && failCount === 0 && feeds.length > 0 && (
          <span className="text-xs bg-gain/10 text-gain border border-gain/20 px-2 py-0.5 rounded-full">
            All feeds healthy
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-dim">Loading…</p>
      ) : feeds.length === 0 ? (
        <p className="text-xs text-dim">No executions found.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {feeds.map(f => (
            <div key={f.niche} className="flex items-center justify-between">
              <span className="text-xs text-dim truncate">
                {NICHE_DISPLAY[f.niche] ?? f.niche}
              </span>
              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                <Dot ok={f.feed1.ok} error={f.feed1.error} />
                <Dot ok={f.feed2.ok} error={f.feed2.error} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
