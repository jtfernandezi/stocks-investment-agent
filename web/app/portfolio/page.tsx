'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, ShieldCheck } from 'lucide-react';
import PageShell from '../components/PageShell';
import CorrelationHeatmap from '../components/CorrelationHeatmap';

// ── Types ────────────────────────────────────────────────────────────────────

interface Position {
  ticker: string;
  side: 'LONG' | 'SHORT';
  shares: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  changeToday: number;
  nicheDisplay: string;
  thesis: string | null;
  conviction: string | null;
  effectiveConfidence: number | null;
  stopPct: number | null;
  stopPrice: number | null;
  distToStop: number | null;
  thesisIntact: boolean | null;
  stopProximity: string | null;
}

interface CorrPair { ticker_a: string; ticker_b: string; correlation: number; }

// ── Sector treemap ────────────────────────────────────────────────────────────

interface SectorCell {
  niche: string;
  longUsd: number;
  shortUsd: number;
  total: number;
  pct: number;
}

function shortLabel(niche: string): string {
  return niche
    .replace('Data Centers & AI Infrastructure', 'Data Centers')
    .replace('AI & Semiconductors', 'AI & Semis')
    .replace('Cloud Hyperscalers', 'Cloud')
    .replace('Copper / Critical Minerals', 'Copper')
    .replace('Nuclear / Uranium', 'Nuclear');
}

function SectorBlock({ cell, rowTotal }: { cell: SectorCell; rowTotal: number }) {
  const hasLong  = cell.longUsd  > 0;
  const hasShort = cell.shortUsd > 0;
  const longFrac  = cell.total > 0 ? cell.longUsd  / cell.total : 0;
  const shortFrac = cell.total > 0 ? cell.shortUsd / cell.total : 0;

  const dominantColor = !hasShort ? 'bg-gain/[0.08]'
                      : !hasLong  ? 'bg-loss/[0.08]'
                      : longFrac >= 0.5 ? 'bg-gain/[0.05]'
                      : 'bg-loss/[0.05]';

  return (
    <div
      className={`relative flex flex-col justify-between rounded-lg border border-rim/30 overflow-hidden p-2.5 ${dominantColor}`}
      style={{ flex: cell.total / rowTotal, minWidth: 0 }}
    >
      {/* Sector label + total % */}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-dim leading-tight truncate">{shortLabel(cell.niche)}</p>
        <p className="text-xl font-bold font-mono text-ink mt-0.5 leading-none">{cell.pct.toFixed(1)}%</p>
      </div>

      {/* Long / short amounts */}
      <div className="mt-2 space-y-0.5">
        {hasLong  && <p className="text-[11px] font-mono text-gain">L ${(cell.longUsd  / 1000).toFixed(1)}k</p>}
        {hasShort && <p className="text-[11px] font-mono text-loss">S ${(cell.shortUsd / 1000).toFixed(1)}k</p>}

        {/* Long / short split bar */}
        <div className="flex h-1 mt-1 rounded-full overflow-hidden gap-px">
          {hasLong  && <div className="bg-gain/60" style={{ flex: longFrac }}  />}
          {hasShort && <div className="bg-loss/60" style={{ flex: shortFrac }} />}
        </div>
      </div>
    </div>
  );
}

function SectorTreemap({ cells }: { cells: SectorCell[] }) {
  if (cells.length === 0) return null;

  const sorted  = [...cells].sort((a, b) => b.total - a.total);
  const grand   = sorted.reduce((s, c) => s + c.total, 0) || 1;
  const mid     = Math.ceil(sorted.length / 2);
  const rows    = sorted.length <= 3
    ? [sorted]
    : [sorted.slice(0, mid), sorted.slice(mid)];
  const rowTotals = rows.map(r => r.reduce((s, c) => s + c.total, 0));

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col gap-1.5 min-w-[480px]" style={{ height: 280 }}>
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex gap-1.5"
            style={{ flex: rowTotals[ri] / grand }}
          >
            {row.map(cell => (
              <SectorBlock key={cell.niche} cell={cell} rowTotal={rowTotals[ri]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildMatrix(tickers: string[], pairs: CorrPair[]): number[][] {
  const n = tickers.length;
  const idx: Record<string, number> = {};
  tickers.forEach((t, i) => { idx[t] = i; });
  const m: number[][] = Array.from<unknown, number[]>({ length: n }, (_, i) =>
    Array.from<unknown, number>({ length: n }, (_, j) => i === j ? 1 : 0)
  );
  for (const pair of pairs) {
    const i = idx[pair.ticker_a], j = idx[pair.ticker_b];
    if (i != null && j != null) { const c = Number(pair.correlation); m[i][j] = c; m[j][i] = c; }
  }
  return m;
}

// ── Expandable row ─────────────────────────────────────────────────────────────

function ExpandableRow({ p }: { p: Position }) {
  const [open, setOpen] = useState(false);
  const up = p.pnl >= 0;

  const thesisValid = p.thesisIntact ?? true;
  const nearStop    = p.stopProximity === 'CRITICAL' || p.stopProximity === 'WARNING';

  return (
    <>
      <tr
        className="border-b border-rim/40 hover:bg-ink/[0.03] transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 py-2 w-4">
          {open ? <ChevronDown size={12} className="text-dim" /> : <ChevronRight size={12} className="text-dim" />}
        </td>
        <td className="px-3 py-2">
          <div className="font-semibold text-ink">{p.ticker}</div>
          <div className="text-[10px] text-dim">{p.nicheDisplay}</div>
        </td>
        <td className="px-3 py-2">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.side === 'LONG' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
            {p.side}
          </span>
        </td>
        <td className="px-3 py-2 font-mono text-ink">{p.shares.toFixed(2)}</td>
        <td className="px-3 py-2 font-mono text-dim">{usd(p.entryPrice)}</td>
        <td className="px-3 py-2 font-mono text-ink">{usd(p.currentPrice)}</td>
        <td className="px-3 py-2 font-mono text-dim">{usd(p.marketValue)}</td>
        <td className={`px-3 py-2 font-mono font-medium ${up ? 'text-gain' : 'text-loss'}`}>
          {up ? '+' : '−'}{usd(p.pnl)}
        </td>
        <td className={`px-3 py-2 font-mono font-medium ${up ? 'text-gain' : 'text-loss'}`}>
          {up ? '+' : ''}{p.pnlPct.toFixed(2)}%
        </td>
        <td className="px-3 py-2 font-mono text-dim">
          {p.stopPct != null ? `${p.stopPct.toFixed(1)}%` : '—'}
        </td>
        <td className="px-3 py-2 font-mono text-dim">
          {p.stopPrice != null ? usd(p.stopPrice) : '—'}
        </td>
        <td className={`px-3 py-2 font-mono ${nearStop ? 'text-yellow-400 font-semibold' : 'text-dim'}`}>
          {p.distToStop != null ? usd(p.distToStop) : '—'}
        </td>
        <td className="px-3 py-2 font-mono text-dim">
          {p.changeToday >= 0 ? '+' : ''}{p.changeToday.toFixed(2)}%
        </td>
        <td className="px-3 py-2">
          {p.effectiveConfidence != null ? (
            <div className="flex items-center gap-1.5 min-w-[64px]">
              <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${p.effectiveConfidence * 100}%` }} />
              </div>
              <span className="font-mono text-[10px] text-dim">{p.effectiveConfidence.toFixed(2)}</span>
            </div>
          ) : <span className="text-dim">—</span>}
        </td>
        <td className="px-3 py-2">
          {thesisValid
            ? <ShieldCheck size={12} className="text-gain" />
            : <AlertTriangle size={12} className="text-yellow-400" />}
        </td>
        {nearStop ? (
          <td className="px-3 py-2">
            <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
              {p.stopProximity}
            </span>
          </td>
        ) : <td className="px-3 py-2" />}
      </tr>

      {open && (
        <tr className="border-b border-rim/40 bg-surface/60">
          <td colSpan={17} className="px-8 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-2">
                <p className="text-xs text-dim uppercase tracking-wider font-medium">Orchestrator Entry Reasoning</p>
                {p.thesis
                  ? <p className="text-sm text-ink leading-relaxed">{p.thesis}</p>
                  : <p className="text-xs text-dim italic">No entry reasoning recorded for this position.</p>}
                <div className="flex items-center gap-2 mt-3">
                  {thesisValid
                    ? <span className="flex items-center gap-1.5 text-xs text-gain"><ShieldCheck size={12} /> Thesis intact as of last session</span>
                    : <span className="flex items-center gap-1.5 text-xs text-yellow-400"><AlertTriangle size={12} /> Thesis weakening — under review</span>}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-dim uppercase tracking-wider font-medium">Position Details</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { l: 'Stop %',      v: p.stopPct  != null ? `${p.stopPct.toFixed(1)}%`  : '—' },
                    { l: 'Stop Price',  v: p.stopPrice != null ? usd(p.stopPrice)            : '—' },
                    { l: 'Conviction',  v: p.conviction ?? '—' },
                    { l: 'Conf Score',  v: p.effectiveConfidence != null ? p.effectiveConfidence.toFixed(2) : '—' },
                    { l: 'Today Δ',     v: `${p.changeToday >= 0 ? '+' : ''}${p.changeToday.toFixed(2)}%` },
                    { l: 'Market Val',  v: usd(p.marketValue) },
                  ].map(({ l, v }) => (
                    <div key={l} className="bg-panel rounded-lg p-2">
                      <div className="text-dim">{l}</div>
                      <div className="text-ink font-mono font-medium">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Mobile position card ──────────────────────────────────────────────────────

function MobilePositionCard({ p }: { p: Position }) {
  const [open, setOpen] = useState(false);
  const up = p.pnl >= 0;
  const nearStop    = p.stopProximity === 'CRITICAL' || p.stopProximity === 'WARNING';
  const thesisValid = p.thesisIntact ?? true;

  return (
    <div className="border-b border-rim/40 last:border-0">
      <button
        className="w-full text-left px-4 py-3.5 active:bg-ink/5 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {/* Row 1: ticker + side badge | P&L % */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink text-sm">{p.ticker}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.side === 'LONG' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
              {p.side}
            </span>
            {nearStop && (
              <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
                {p.stopProximity}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
              {up ? '+' : ''}{p.pnlPct.toFixed(2)}%
            </span>
            {open ? <ChevronDown size={13} className="text-dim" /> : <ChevronRight size={13} className="text-dim" />}
          </div>
        </div>

        {/* Row 2: niche | market value */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-dim truncate mr-4">{p.nicheDisplay}</span>
          <span className="font-mono text-xs text-dim shrink-0">{usd(p.marketValue)}</span>
        </div>

        {/* Row 3: entry → current | stop */}
        <div className="flex items-center justify-between mt-1.5 text-xs font-mono">
          <span className="text-dim">
            {usd(p.entryPrice)} <span className="text-rim">→</span> <span className="text-ink">{usd(p.currentPrice)}</span>
            <span className={`ml-1.5 ${p.changeToday >= 0 ? 'text-gain' : 'text-loss'}`}>
              {p.changeToday >= 0 ? '+' : ''}{p.changeToday.toFixed(2)}%
            </span>
          </span>
          {p.stopPct != null && (
            <span className={nearStop ? 'text-yellow-400 font-semibold' : 'text-dim'}>
              Stop {p.stopPct.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Thesis status */}
        {!thesisValid && (
          <div className="flex items-center gap-1 mt-1.5">
            <AlertTriangle size={11} className="text-yellow-400 shrink-0" />
            <span className="text-[10px] text-yellow-400">Thesis weakening — under review</span>
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 pt-2 bg-surface/50 border-t border-rim/30">
          <p className="text-[10px] text-dim uppercase tracking-wider font-medium mb-2">Entry Reasoning</p>
          {p.thesis
            ? <p className="text-xs text-ink leading-relaxed">{p.thesis}</p>
            : <p className="text-xs text-dim italic">No entry reasoning recorded.</p>}

          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
            {[
              { l: 'Stop $',     v: p.stopPrice != null ? usd(p.stopPrice) : '—' },
              { l: 'Conviction', v: p.conviction ?? '—' },
              { l: 'Confidence', v: p.effectiveConfidence != null ? p.effectiveConfidence.toFixed(2) : '—' },
            ].map(({ l, v }) => (
              <div key={l} className="bg-panel rounded-lg p-2">
                <div className="text-dim text-[10px]">{l}</div>
                <div className="text-ink font-mono font-medium">{v}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 mt-3">
            {thesisValid
              ? <><ShieldCheck size={12} className="text-gain" /><span className="text-xs text-gain">Thesis intact</span></>
              : <><AlertTriangle size={12} className="text-yellow-400" /><span className="text-xs text-yellow-400">Thesis weakening</span></>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [corrPairs, setCorrPairs] = useState<CorrPair[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetch('/api/positions')
      .then(r => r.json())
      .then(data => setPositions((data.positions ?? []) as Position[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (positions.length === 0) return;
    const tickers = positions.map(p => p.ticker).join(',');
    fetch(`/api/correlation?tickers=${tickers}`)
      .then(r => r.json())
      .then(data => setCorrPairs((data.pairs ?? []) as CorrPair[]))
      .catch(() => {});
  }, [positions]);

  // ── Computed aggregates ────────────────────────────────────────
  const totalLong      = positions.filter(p => p.side === 'LONG').reduce((s, p) => s + p.marketValue, 0);
  const totalShort     = positions.filter(p => p.side === 'SHORT').reduce((s, p) => s + Math.abs(p.marketValue), 0);
  const unrealizedPnL  = positions.reduce((s, p) => s + p.pnl, 0);
  const investedCap    = positions.reduce((s, p) => s + Math.abs(p.marketValue), 0) || 1;

  const posWeights = [...positions]
    .map(p => ({ ticker: p.ticker, side: p.side, weight: Math.abs(p.marketValue) / investedCap * 100, pnlPct: p.pnlPct }))
    .sort((a, b) => b.weight - a.weight);
  const top3Conc = posWeights.slice(0, 3).reduce((s, p) => s + p.weight, 0);
  const hhi      = posWeights.reduce((s, p) => s + (p.weight / 100) ** 2, 0);

  // ── Correlation heatmap ────────────────────────────────────────
  const heatTickers = positions.map(p => ({ ticker: p.ticker, side: p.side === 'LONG' ? 'L' : 'S' as 'L' | 'S' }));
  const heatMatrix  = buildMatrix(heatTickers.map(t => t.ticker), corrPairs);

  // ── Sector exposure bars ───────────────────────────────────────
  const sectorMap: Record<string, { long: number; short: number }> = {};
  for (const p of positions) {
    if (!sectorMap[p.nicheDisplay]) sectorMap[p.nicheDisplay] = { long: 0, short: 0 };
    if (p.side === 'LONG') sectorMap[p.nicheDisplay].long  += p.marketValue;
    else                   sectorMap[p.nicheDisplay].short += Math.abs(p.marketValue);
  }
  const sectorExposure = Object.entries(sectorMap).map(([niche, v]) => ({
    niche,
    longUsd:  v.long,
    shortUsd: v.short,
    total:    v.long + v.short,
    pct:      (v.long + v.short) / (investedCap || 1) * 100,
  }));

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-20">
          <p className="text-dim text-sm">Loading live positions…</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 md:gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Portfolio</h1>
          <p className="text-xs md:text-sm text-dim mt-1">
            {positions.filter(p => p.side === 'LONG').length} long ·{' '}
            {positions.filter(p => p.side === 'SHORT').length} short · P&amp;L:{' '}
            <span className={unrealizedPnL >= 0 ? 'text-gain' : 'text-loss'}>
              {unrealizedPnL >= 0 ? '+' : '−'}${Math.abs(unrealizedPnL).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
        <div className="flex gap-4 md:gap-6 text-sm">
          <div>
            <p className="text-xs text-dim">Long</p>
            <p className="font-mono text-ink text-sm">${totalLong.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
          </div>
          <div>
            <p className="text-xs text-dim">Short</p>
            <p className="font-mono text-loss text-sm">${totalShort.toLocaleString('en-US', { maximumFractionDigits: 0 })}<span className="text-dim text-xs hidden md:inline"> / $12k max</span></p>
          </div>
        </div>
      </div>

      {/* Positions table */}
      <div className="bg-panel border border-rim rounded-xl overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-rim">
          <p className="text-xs text-dim hidden md:block">Click any row to see orchestrator reasoning · Live data from Alpaca</p>
          <p className="text-xs text-dim md:hidden">Tap a position to see reasoning · Live data</p>
        </div>
        {positions.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-dim">No open positions</div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="md:hidden divide-y divide-rim/40">
              {positions.map(p => <MobilePositionCard key={p.ticker} p={p} />)}
            </div>

            {/* Desktop: full table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-rim">
                    <th className="px-3 py-2 w-4" />
                    {['Ticker', 'Side', 'Shares', 'Entry', 'Current', 'Size', 'P&L', 'P&L %', 'Stop %', 'Stop $', 'Dist to Stop', 'Day Δ', 'Conf', 'Thesis', 'Alert'].map(h => (
                      <th key={h} className="text-left text-[10px] text-dim font-medium uppercase tracking-wider px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => <ExpandableRow key={p.ticker} p={p} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Concentration Analysis */}
      {positions.length > 0 && (
        <div className="bg-panel border border-rim rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">Concentration Analysis</h2>
            <p className="text-xs text-dim mt-0.5">Weights relative to invested capital · lower HHI = more diversified</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-dim mb-1">Largest Position</p>
              <p className="font-mono text-base font-semibold text-ink">
                {posWeights[0]?.ticker}{' '}
                <span className="text-dim font-normal text-sm">{posWeights[0]?.weight.toFixed(1)}%</span>
              </p>
              <p className="text-xs text-dim/60 mt-0.5">of invested capital</p>
            </div>
            <div>
              <p className="text-xs text-dim mb-1">Top 3 Concentration</p>
              <p className={`font-mono text-base font-semibold ${top3Conc > 70 ? 'text-yellow-400' : 'text-ink'}`}>
                {top3Conc.toFixed(1)}%
              </p>
              <p className="text-xs text-dim/60 mt-0.5">{posWeights.slice(0, 3).map(p => p.ticker).join(' + ')}</p>
            </div>
            <div>
              <p className="text-xs text-dim mb-1">Herfindahl Index</p>
              <p className={`font-mono text-base font-semibold ${hhi > 0.25 ? 'text-yellow-400' : 'text-ink'}`}>
                {hhi.toFixed(3)}
              </p>
              <p className="text-xs text-dim/60 mt-0.5">
                {hhi > 0.25 ? 'high concentration' : hhi > 0.10 ? 'moderate concentration' : 'well diversified'}
              </p>
            </div>
            <div>
              <p className="text-xs text-dim mb-1">Position Count</p>
              <p className="font-mono text-base font-semibold text-ink">{positions.length}</p>
              <p className="text-xs text-dim/60 mt-0.5">
                of 12 max · {positions.filter(p => p.side === 'LONG').length}L / {positions.filter(p => p.side === 'SHORT').length}S
              </p>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-rim/40 space-y-2">
            {posWeights.map(p => (
              <div key={p.ticker} className="flex items-center gap-3">
                <span className="font-mono text-xs text-ink w-10 shrink-0">{p.ticker}</span>
                <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${p.side === 'LONG' ? 'bg-gain/70' : 'bg-loss/70'}`}
                    style={{ width: `${p.weight}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-dim w-10 text-right shrink-0">{p.weight.toFixed(1)}%</span>
                <span className={`font-mono text-xs w-12 text-right shrink-0 ${p.pnlPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector exposure treemap */}
      {sectorExposure.length > 0 && (
        <div className="bg-panel border border-rim rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Sector Exposure</h2>
              <p className="text-xs text-dim mt-0.5">Block size = % of invested capital · bar = long / short split</p>
            </div>
            <div className="flex gap-3 text-xs text-dim">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-gain/60" />Long</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-loss/60" />Short</span>
            </div>
          </div>
          <SectorTreemap cells={sectorExposure} />
        </div>
      )}

      {/* Correlation heatmap — only when we have ≥2 positions */}
      {heatTickers.length >= 2 && (
        <CorrelationHeatmap tickers={heatTickers} matrix={heatMatrix} />
      )}
    </PageShell>
  );
}
