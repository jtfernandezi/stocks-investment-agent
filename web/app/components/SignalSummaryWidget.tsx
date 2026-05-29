import { ALL_NICHES, NICHE_DISPLAY } from '@/lib/constants';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SignalRow {
  niche: string;
  direction: string;
  conviction: string;
  confidence: number;
  session: string;
}

interface Props {
  signals: SignalRow[];
}

const SHORT: Record<string, string> = {
  cybersecurity:   'Cyber',
  defense:         'Defense',
  nuclear_uranium: 'Nuclear',
  copper_minerals: 'Copper',
  semiconductors:  'Semis',
  enterprise_saas: 'SaaS',
  oil_gas:         'Oil & Gas',
  data_centers:    'Data Ctrs',
};

// Same colour function as the Research heatmap for visual consistency
function tileBg(direction: string, n: number): string {
  const sat = Math.round(25 + n * 55);   // 25 – 80 %
  const lit = Math.round(65 - n * 43);   // 65 – 22 %
  if (direction === 'BULLISH') return `hsl(142,${sat}%,${lit}%)`;
  if (direction === 'BEARISH') return `hsl(4,${sat}%,${lit}%)`;
  return `hsl(45,${Math.round(30 + n * 40)}%,${Math.round(60 - n * 35)}%)`;
}

// White text on dark tiles, dark text on light ones
function textLight(direction: string, n: number): boolean {
  const lit = Math.round(65 - n * 43);
  if (direction === 'NEUTRAL') return Math.round(60 - n * 35) < 45;
  return lit < 45;
}

function sessionLabel(session: string): string {
  const m = session.match(/^(\d{4}-\d{2}-\d{2})[_-](.+)$/);
  if (!m) return session;
  const d = new Date(m[1]);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const slug = m[2].split('_')[0];
  const label = slug === 'morning' ? 'AM' : slug === 'midday' ? 'PM' : 'Close';
  return `${date} · ${label}`;
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === 'BULLISH') return <TrendingUp  size={20} />;
  if (direction === 'BEARISH') return <TrendingDown size={20} />;
  return <Minus size={20} />;
}

export default function SignalSummaryWidget({ signals }: Props) {
  // Normalise confidence across this batch for full colour range
  const confs = signals.map(s => s.confidence);
  const minC  = confs.length ? Math.min(...confs) : 0;
  const maxC  = confs.length ? Math.max(...confs) : 1;
  const span  = maxC - minC > 0.02 ? maxC - minC : 1;
  const norm  = (c: number) => Math.max(0, Math.min(1, (c - minC) / span));

  // Sort by ALL_NICHES order
  const lookup = new Map(signals.map(s => [s.niche, s]));

  const bullish = signals.filter(s => s.direction === 'BULLISH').length;
  const bearish = signals.filter(s => s.direction === 'BEARISH').length;
  const neutral = signals.length - bullish - bearish;
  const latest  = signals[0]?.session ?? null;

  return (
    <div className="bg-panel border border-rim rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-rim flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Specialist Signals</h2>
          {signals.length > 0 && (
            <p className="text-xs text-dim mt-0.5">
              <span className="text-gain">{bullish} bullish</span>
              {' · '}
              <span className="text-dim">{neutral} neutral</span>
              {' · '}
              <span className="text-loss">{bearish} bearish</span>
            </p>
          )}
        </div>
        {latest && (
          <span className="text-xs text-dim shrink-0">{sessionLabel(latest)}</span>
        )}
      </div>

      {/* Tile grid */}
      <div className="p-3">
        {signals.length === 0 ? (
          <div className="py-8 text-xs text-dim text-center">
            No signals yet — waiting for first workflow run.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {ALL_NICHES.map(niche => {
              const s = lookup.get(niche);

              // No data for this niche yet
              if (!s) {
                return (
                  <div
                    key={niche}
                    className="rounded-xl bg-surface border border-rim/30 flex flex-col justify-between p-3"
                    style={{ minHeight: 90 }}
                  >
                    <span className="text-[10px] text-dim/50 leading-tight">
                      {SHORT[niche] ?? NICHE_DISPLAY[niche] ?? niche}
                    </span>
                    <Minus size={18} className="text-dim/30 my-1" />
                    <span className="text-[10px] text-dim/30">—</span>
                  </div>
                );
              }

              const n      = norm(s.confidence);
              const bg     = tileBg(s.direction, n);
              const light  = textLight(s.direction, n);
              const txt    = light ? 'rgba(255,255,255,0.95)' : 'rgba(15,17,23,0.90)';
              const txtSub = light ? 'rgba(255,255,255,0.65)' : 'rgba(15,17,23,0.55)';

              return (
                <div
                  key={niche}
                  className="rounded-xl flex flex-col justify-between p-3 transition-transform hover:scale-[1.02] cursor-default"
                  style={{ backgroundColor: bg, minHeight: 90 }}
                >
                  <span className="text-[10px] font-medium leading-tight" style={{ color: txtSub }}>
                    {SHORT[niche] ?? NICHE_DISPLAY[niche] ?? niche}
                  </span>

                  <span style={{ color: txt }} className="my-0.5">
                    <DirectionIcon direction={s.direction} />
                  </span>

                  <span className="text-[10px] font-semibold tracking-wide" style={{ color: txt }}>
                    {s.conviction}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
