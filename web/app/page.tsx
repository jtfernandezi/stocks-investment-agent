import Link from 'next/link';
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatCard from './components/StatCard';
import MarketClock from './components/MarketClock';
import MiniEquityChart from './components/MiniEquityChart';
import SectorPnLWidget from './components/SectorPnLWidget';
import { alpacaFetch } from '@/lib/alpaca';
import { sql } from '@/lib/db';
import { TICKER_NICHE, NICHE_DISPLAY, ALL_NICHES, START_CAPITAL } from '@/lib/constants';

interface AlpacaAccount { equity: string; cash: string; buying_power: string; last_equity: string; long_market_value: string; short_market_value: string; }
interface AlpacaPos    { symbol: string; qty: string; side: string; avg_entry_price: string; current_price: string; market_value: string; cost_basis: string; unrealized_pl: string; unrealized_plpc: string; }

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function Dashboard() {
  const [account, positions, snapshots] = await Promise.all([
    safe(() => alpacaFetch<AlpacaAccount>('/account'), null),
    safe(() => alpacaFetch<AlpacaPos[]>('/positions'), [] as AlpacaPos[]),
    safe(() => sql`
      SELECT DISTINCT ON (DATE(created_at AT TIME ZONE 'America/New_York'))
        DATE(created_at AT TIME ZONE 'America/New_York') AS date,
        portfolio_value_usd,
        spy_price,
        spy_cumulative_pct
      FROM stocks.portfolio_snapshots
      ORDER BY DATE(created_at AT TIME ZONE 'America/New_York') ASC, created_at DESC
    `, [] as Record<string, unknown>[]),
  ]);

  // ── Account metrics ──────────────────────────────────────────
  const equity     = account ? parseFloat(account.equity)      : START_CAPITAL;
  const cash       = account ? parseFloat(account.buying_power) : 0;  // buying_power = usable cash
  const lastEquity = account ? parseFloat(account.last_equity)  : equity;
  const longUsd    = account ? parseFloat(account.long_market_value)  : 0;
  const shortUsd   = account ? parseFloat(account.short_market_value) : 0;
  const dayPnL     = equity - lastEquity;
  const dayPnLPct  = lastEquity ? (dayPnL / lastEquity) * 100 : 0;
  const totalReturn    = equity - START_CAPITAL;
  const totalReturnPct = (totalReturn / START_CAPITAL) * 100;
  const netExposurePct   = equity ? ((longUsd - shortUsd) / equity * 100) : 0;
  const grossExposurePct = equity ? ((longUsd + shortUsd) / equity * 100) : 0;
  const openCount = positions.length;

  // ── SPY alpha from latest snapshot ───────────────────────────
  const latestSnap   = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const spyCumPct    = latestSnap ? parseFloat(String(latestSnap.spy_cumulative_pct)) : 0;
  const alphaPct     = totalReturnPct - spyCumPct;

  // ── Equity curve data ─────────────────────────────────────────
  const spyRef      = [...snapshots].reverse().find(r => parseFloat(String(r.spy_cumulative_pct)) !== 0);
  const spyRefPrice = spyRef ? parseFloat(String(spyRef.spy_price))          : null;
  const spyRefCum   = spyRef ? parseFloat(String(spyRef.spy_cumulative_pct)) : null;
  const equityData  = [
    { date: 'Start', portfolio: START_CAPITAL, spy: START_CAPITAL },
    ...snapshots.map(row => {
      const portfolio = parseFloat(String(row.portfolio_value_usd));
      let spy = START_CAPITAL;
      if (spyRefPrice && spyRefCum != null) {
        const p = parseFloat(String(row.spy_price));
        spy = START_CAPITAL * (1 + spyRefCum / 100) * (p / spyRefPrice);
      }
      const d = new Date(String(row.date));
      return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), portfolio, spy };
    }),
  ];

  // ── Sector P&L from open positions ───────────────────────────
  const sectorMap: Record<string, { pnlUsd: number; costBasis: number }> = {};
  for (const p of positions) {
    const niche = TICKER_NICHE[p.symbol];
    if (!niche) continue;
    if (!sectorMap[niche]) sectorMap[niche] = { pnlUsd: 0, costBasis: 0 };
    sectorMap[niche].pnlUsd    += parseFloat(p.unrealized_pl);
    sectorMap[niche].costBasis += parseFloat(p.cost_basis || '0');
  }
  const sectorData = ALL_NICHES.map(n => ({
    niche:  NICHE_DISPLAY[n],
    pnlUsd: sectorMap[n] ? sectorMap[n].pnlUsd    : null,
    pnlPct: sectorMap[n] ? sectorMap[n].pnlUsd / sectorMap[n].costBasis * 100 : null,
  }));

  // ── Top positions (largest by market value) ───────────────────
  const topPositions = [...positions]
    .sort((a, b) => Math.abs(parseFloat(b.market_value)) - Math.abs(parseFloat(a.market_value)))
    .slice(0, 3)
    .map(p => ({
      ticker:    p.symbol,
      side:      p.side === 'long' ? 'LONG' : 'SHORT',
      niche:     NICHE_DISPLAY[TICKER_NICHE[p.symbol]] ?? '—',
      pnlPct:    parseFloat(p.unrealized_plpc) * 100,
      marketVal: Math.abs(parseFloat(p.market_value)),
    }));

  const dayUp = dayPnL >= 0;

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Header />

        <main className="flex-1 p-6 space-y-6">
          {/* Market clock */}
          <MarketClock />

          {/* Portfolio hero */}
          <div>
            <p className="text-xs text-dim uppercase tracking-wider mb-1">Total Portfolio Value</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="font-mono text-4xl font-semibold text-ink">
                ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </h1>
              <span className={`font-mono text-sm font-medium flex items-center gap-1 ${dayUp ? 'text-gain' : 'text-loss'}`}>
                {dayUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {dayUp ? '+' : ''}${dayPnL.toFixed(2)} ({dayUp ? '+' : ''}{dayPnLPct.toFixed(2)}%) today
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard
              label="Buying Power"
              value={`$${cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              subtext="Available margin"
            />
            <StatCard
              label="Open Positions"
              value={String(openCount)}
              subtext="of 12 max"
            />
            <StatCard
              label="Total Return"
              value={`${totalReturn >= 0 ? '+' : ''}$${Math.abs(totalReturn).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              subtext={`${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% since start`}
              trend={totalReturn >= 0 ? 'up' : 'down'}
            />
            <StatCard
              label="vs SPY"
              value={`${alphaPct >= 0 ? '+' : ''}${alphaPct.toFixed(2)}%`}
              subtext={`SPY: ${spyCumPct >= 0 ? '+' : ''}${spyCumPct.toFixed(2)}%`}
              trend={alphaPct >= 0 ? 'up' : 'down'}
            />
            <StatCard
              label="Net Exposure"
              value={`${netExposurePct >= 0 ? '+' : ''}${netExposurePct.toFixed(1)}%`}
              subtext="(Long − Short) ÷ NAV"
            />
            <StatCard
              label="Gross Exposure"
              value={`${grossExposurePct.toFixed(1)}%`}
              subtext="(Long + Short) ÷ NAV"
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MiniEquityChart data={equityData} startCapital={START_CAPITAL} />
            <SectorPnLWidget sectors={sectorData} />
          </div>

          {/* Positions preview */}
          <div className="bg-panel border border-rim rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-rim flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Top Positions</h2>
              <Link href="/portfolio" className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                View all {openCount} <ArrowRight size={12} />
              </Link>
            </div>
            {topPositions.length === 0 ? (
              <div className="px-5 py-8 text-xs text-dim text-center">No open positions</div>
            ) : (
              <div className="divide-y divide-rim/40">
                {topPositions.map(p => {
                  const up = p.pnlPct >= 0;
                  return (
                    <div key={p.ticker} className="px-5 py-3.5 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-ink text-sm">{p.ticker}</span>
                        <span className="text-xs text-dim ml-2">{p.niche}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.side === 'LONG' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                          {p.side}
                        </span>
                        <span className={`font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
                          {up ? '+' : ''}{p.pnlPct.toFixed(2)}%
                        </span>
                        <span className="font-mono text-xs text-dim">
                          ${p.marketVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
