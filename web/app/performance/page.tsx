'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Trophy, TrendingDown } from 'lucide-react';
import PageShell from '../components/PageShell';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts';
import MonthlyReturnsGrid from '../components/MonthlyReturnsGrid';
import { NICHE_DISPLAY, ALL_NICHES, START_CAPITAL } from '@/lib/constants';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SnapPoint  { date: string; portfolio: number; spy: number; }
interface AccountData { equity: number; long_market_value: number; short_market_value: number; }
interface OpenPos {
  ticker: string; side: string; pnl: number; pnlPct: number;
  entryPrice: number; currentPrice: number; costBasis: number;
  nicheDisplay: string; thesis: string; effectiveConfidence: number; stopPct: number;
}
interface ClosedTrade {
  ticker: string; niche: string; direction: string; outcome: string;
  pnl_pct: number; pnl_usd: number; hold_days: number;
  entry_date: string; exit_date: string; exit_reason: string; key_lesson: string;
  sector_accuracy: string; entry_timing: string; exit_timing: string;
  entry_effective_confidence: number;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const stddev = (arr: number[]) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
};
const fmt$ = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fmtPct = (v: number, decimals = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;

// ── Expandable trade row ───────────────────────────────────────────────────────

interface TradeRow {
  id: string; ticker: string; direction: 'LONG' | 'SHORT';
  date: string; holdDays: number | null; pnl: number; pnlPct: number;
  status: 'Open' | 'Closed'; outcome?: string;
  entryPrice?: number; currentPrice?: number; thesis?: string; confidence?: number;
  exitReason?: string; keyLesson?: string;
  sectorAccuracy?: string; entryTiming?: string; exitTiming?: string;
}

function qualityColor(q?: string) {
  if (!q) return 'text-dim';
  if (q === 'OPTIMAL' || q === 'STRONG')   return 'text-gain';
  if (q === 'SUBOPTIMAL' || q === 'WEAK')  return 'text-loss';
  return 'text-ink';
}

function ExpandableTradeRow({ t }: { t: TradeRow }) {
  const [open, setOpen] = useState(false);
  const up = t.pnl >= 0;

  return (
    <>
      <tr
        className="border-b border-rim/40 transition-colors cursor-pointer hover:bg-ink/[0.03]"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 md:px-4 py-3.5 w-4">
          {open ? <ChevronDown size={13} className="text-dim" /> : <ChevronRight size={13} className="text-dim" />}
        </td>
        <td className="hidden md:table-cell px-3 md:px-4 py-3.5 font-mono text-xs text-dim">{t.date}</td>
        <td className="px-3 md:px-4 py-3.5 font-semibold text-ink text-sm">{t.ticker}</td>
        <td className="px-3 md:px-4 py-3.5">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            t.direction === 'LONG' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
          }`}>{t.direction}</span>
        </td>
        <td className="hidden md:table-cell px-3 md:px-4 py-3.5 font-mono text-xs text-dim">
          {t.holdDays != null ? `${t.holdDays}d` : '—'}
        </td>
        <td className={`px-3 md:px-4 py-3.5 font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
          {up ? '+' : '−'}{fmt$(t.pnl)}
        </td>
        <td className={`px-3 md:px-4 py-3.5 font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
          {fmtPct(t.pnlPct)}
        </td>
        <td className="px-3 md:px-4 py-3.5">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            t.status === 'Open' ? 'bg-accent/10 text-accent' : 'bg-dim/10 text-dim'
          }`}>{t.status}</span>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-rim/40 bg-surface/60">
          <td colSpan={8} className="px-4 md:px-8 py-4 md:py-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                {t.status === 'Open' && t.thesis && (
                  <div>
                    <p className="text-xs text-dim uppercase tracking-wider font-medium mb-2">Entry Thesis</p>
                    <p className="text-sm text-ink leading-relaxed">{t.thesis}</p>
                  </div>
                )}
                {t.status === 'Open' && t.entryPrice != null && (
                  <div className="flex gap-8 text-xs">
                    <div><span className="text-dim">Entry Price</span><p className="font-mono text-ink mt-0.5">${t.entryPrice.toFixed(2)}</p></div>
                    <div><span className="text-dim">Current Price</span><p className="font-mono text-ink mt-0.5">${t.currentPrice?.toFixed(2)}</p></div>
                    <div><span className="text-dim">Confidence</span><p className="font-mono text-ink mt-0.5">{t.confidence != null ? (t.confidence * 100).toFixed(0) + '%' : '—'}</p></div>
                  </div>
                )}
                {t.status === 'Closed' && t.exitReason && (
                  <div>
                    <p className="text-xs text-dim uppercase tracking-wider font-medium mb-2">Exit Reasoning</p>
                    <p className="text-sm text-ink leading-relaxed">{t.exitReason}</p>
                  </div>
                )}
                {t.keyLesson && (
                  <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                    <p className="text-xs text-accent font-medium mb-1">Key Lesson</p>
                    <p className="text-xs text-dim leading-relaxed">{t.keyLesson}</p>
                  </div>
                )}
              </div>

              {t.status === 'Closed' ? (
                <div>
                  <p className="text-xs text-dim uppercase tracking-wider font-medium mb-3">Attribution Quality</p>
                  <div className="space-y-2">
                    {[
                      { l: 'Sector Analysis', v: t.sectorAccuracy },
                      { l: 'Entry Timing',    v: t.entryTiming },
                      { l: 'Exit Timing',     v: t.exitTiming },
                    ].map(({ l, v }) => (
                      <div key={l} className="flex items-center justify-between text-xs">
                        <span className="text-dim">{l}</span>
                        <span className={`font-medium ${qualityColor(v)}`}>{v ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                  {t.outcome && (
                    <div className="mt-4 pt-3 border-t border-rim/30">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        t.outcome === 'WIN' ? 'bg-gain/10 text-gain' :
                        t.outcome === 'LOSS' ? 'bg-loss/10 text-loss' : 'bg-dim/10 text-dim'
                      }`}>{t.outcome}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-dim uppercase tracking-wider font-medium mb-2">Position Status</p>
                  <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                    <p className="text-xs text-accent font-medium mb-1">Currently Open</p>
                    <p className="text-xs text-dim">Post-mortem attribution available after close.</p>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [snapshots,    setSnapshots]    = useState<SnapPoint[]>([]);
  const [account,      setAccount]      = useState<AccountData | null>(null);
  const [openPos,      setOpenPos]      = useState<OpenPos[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/snapshots').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/account').then(r => r.json()).catch(() => null),
      fetch('/api/positions').then(r => r.json()).catch(() => ({ positions: [] })),
      fetch('/api/trades').then(r => r.json()).catch(() => ({ trades: [] })),
    ]).then(([snapsData, acctData, posData, tradeData]) => {
      setSnapshots(snapsData.data ?? []);
      setAccount(acctData?.equity != null ? acctData : null);
      setOpenPos(posData.positions ?? []);
      setClosedTrades(tradeData.trades ?? []);
    }).finally(() => setLoading(false));
  }, []);

  // ── Build equity series ──────────────────────────────────────────────────────
  const rawPoints = snapshots.filter(s => s.date !== 'Start');
  const allPort   = [START_CAPITAL, ...rawPoints.map(s => s.portfolio)];
  const allSpy    = [START_CAPITAL, ...rawPoints.map(s => s.spy)];

  const portRet = allPort.slice(1).map((v, i) => (v - allPort[i]) / allPort[i]);
  const spyRet  = allSpy.slice(1).map((v,  i) => (v - allSpy[i])  / allSpy[i]);

  const latestEquity = account?.equity ?? allPort[allPort.length - 1] ?? START_CAPITAL;
  const totalReturn    = latestEquity - START_CAPITAL;
  const totalReturnPct = (totalReturn / START_CAPITAL) * 100;
  const spyCumPct      = allSpy.length > 1 ? (allSpy[allSpy.length - 1] / START_CAPITAL - 1) * 100 : 0;
  const alphaPct       = totalReturnPct - spyCumPct;

  // ── Sharpe / Sortino ─────────────────────────────────────────────────────────
  const sharpe  = portRet.length > 1 && stddev(portRet) > 0
    ? (mean(portRet) / stddev(portRet)) * Math.sqrt(252) : 0;
  const negRet  = portRet.filter(r => r < 0);
  const sortino = portRet.length > 1 && stddev(negRet) > 0
    ? (mean(portRet) / stddev(negRet)) * Math.sqrt(252) : 0;

  // ── Max Drawdown ─────────────────────────────────────────────────────────────
  let hwm = START_CAPITAL, maxDD = 0;
  let maxDDDate = '';
  rawPoints.forEach(s => {
    hwm = Math.max(hwm, s.portfolio);
    const dd = (s.portfolio - hwm) / hwm * 100;
    if (dd < maxDD) { maxDD = dd; maxDDDate = s.date; }
  });

  // ── Calmar / Annualized return ───────────────────────────────────────────────
  const days   = rawPoints.length;
  const annRet = days > 0 ? ((latestEquity / START_CAPITAL) ** (252 / days) - 1) * 100 : 0;
  const calmar = maxDD < 0 ? Math.abs(annRet / maxDD) : 0;

  // ── Beta / Jensen's Alpha ────────────────────────────────────────────────────
  const cov  = portRet.length > 1
    ? mean(portRet.map((r, i) => r * spyRet[i])) - mean(portRet) * mean(spyRet) : 0;
  const vSpy = stddev(spyRet) ** 2;
  const beta = vSpy > 0 ? cov / vSpy : 1;
  const annSpy = days > 0 && allSpy[allSpy.length - 1] > 0
    ? ((allSpy[allSpy.length - 1] / START_CAPITAL) ** (252 / days) - 1) * 100 : 0;
  const jensensAlpha = annRet - beta * annSpy;

  // ── Information Ratio ────────────────────────────────────────────────────────
  const excess  = portRet.map((r, i) => r - spyRet[i]);
  const infoRatio = stddev(excess) > 0 ? (mean(excess) / stddev(excess)) * Math.sqrt(252) : 0;

  // ── Up/Down Capture & Batting Average ────────────────────────────────────────
  const upPortDays   = portRet.filter((_, i) => spyRet[i] > 0);
  const downPortDays = portRet.filter((_, i) => spyRet[i] < 0);
  const upSpyDays    = spyRet.filter(r => r > 0);
  const downSpyDays  = spyRet.filter(r => r < 0);
  const upCapture    = upSpyDays.length > 0 && mean(upSpyDays) > 0
    ? (mean(upPortDays) / mean(upSpyDays)) * 100 : 0;
  const downCapture  = downSpyDays.length > 0 && mean(downSpyDays) < 0
    ? (mean(downPortDays) / mean(downSpyDays)) * 100 : 0;
  const battingAvg   = portRet.length > 0
    ? portRet.filter((r, i) => r > spyRet[i]).length / portRet.length * 100 : 0;

  // ── Profit Factor (day-level) ────────────────────────────────────────────────
  const grossGain = portRet.filter(r => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(portRet.filter(r => r < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossGain / grossLoss : 0;

  // ── Closed-trade stats ───────────────────────────────────────────────────────
  const wins    = closedTrades.filter(t => t.outcome === 'WIN').length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const avgHold = closedTrades.length > 0
    ? closedTrades.reduce((a, t) => a + (t.hold_days ?? 0), 0) / closedTrades.length : 0;

  // ── Drawdown chart data ──────────────────────────────────────────────────────
  let hwm2 = START_CAPITAL;
  const drawdownData = rawPoints.map(s => {
    hwm2 = Math.max(hwm2, s.portfolio);
    return { date: s.date, dd: (s.portfolio - hwm2) / hwm2 * 100 };
  });
  const ddMin = drawdownData.length ? Math.min(...drawdownData.map(d => d.dd)) : -1;

  // ── Rolling 3-day metrics ────────────────────────────────────────────────────
  const WINDOW = 3;
  const rollingData = portRet.slice(WINDOW - 1).map((_, idx) => {
    const w = portRet.slice(idx, idx + WINDOW);
    const s = stddev(w);
    return {
      date:   rawPoints[idx + WINDOW - 1]?.date ?? '',
      sharpe: s > 0 ? (mean(w) / s) * Math.sqrt(252) : 0,
      vol:    s * Math.sqrt(252) * 100,
    };
  });

  // ── Monthly returns ──────────────────────────────────────────────────────────
  const monthlyReturns = [{
    year: 2026, current: true,
    months: [null, null, null, null, parseFloat(totalReturnPct.toFixed(2)), null, null, null, null, null, null, null],
    annual: parseFloat(totalReturnPct.toFixed(2)),
  }];

  // ── Exposure (from open positions) ───────────────────────────────────────────
  const longUsd  = openPos.filter(p => p.side.toLowerCase() === 'long').reduce((a, p) => a + Math.abs(p.costBasis), 0);
  const shortUsd = openPos.filter(p => p.side.toLowerCase() === 'short').reduce((a, p) => a + Math.abs(p.costBasis), 0);
  const netExp   = latestEquity > 0 ? (longUsd - shortUsd) / latestEquity * 100 : 0;
  const grossExp = latestEquity > 0 ? (longUsd + shortUsd) / latestEquity * 100 : 0;

  // ── Sector P&L (open unrealized + closed realized) ───────────────────────────
  const secMap: Record<string, { pnlUsd: number; costBasis: number }> = {};
  for (const p of openPos) {
    const k = p.nicheDisplay;
    if (!secMap[k]) secMap[k] = { pnlUsd: 0, costBasis: 0 };
    secMap[k].pnlUsd    += p.pnl;
    secMap[k].costBasis += Math.abs(p.costBasis);
  }
  for (const t of closedTrades) {
    const k = NICHE_DISPLAY[t.niche] ?? t.niche;
    if (!secMap[k]) secMap[k] = { pnlUsd: 0, costBasis: 0 };
    secMap[k].pnlUsd += t.pnl_usd;
    // Back-calculate invested amount so pnlPct stays meaningful for closed-only sectors
    const invested = t.pnl_pct !== 0 ? Math.abs(t.pnl_usd / (t.pnl_pct / 100)) : 0;
    secMap[k].costBasis += invested;
  }
  const sectorContrib = ALL_NICHES.map(n => {
    const k = NICHE_DISPLAY[n];
    const s = secMap[k];
    return { niche: k, pnlUsd: s?.pnlUsd ?? 0, pnlPct: s ? s.pnlUsd / (s.costBasis || 1) * 100 : 0, hasData: !!s };
  });
  const maxAbsSec = Math.max(...sectorContrib.map(s => Math.abs(s.pnlPct)), 0.01);

  // ── Long / Short book attribution ────────────────────────────────────────────
  const bookStats = (side: string) => {
    const openSide   = openPos.filter(p => p.side.toLowerCase() === side);
    const closedSide = closedTrades.filter(t => t.direction?.toLowerCase() === side);
    const pnlUsd     = openSide.reduce((a, p) => a + p.pnl, 0) + closedSide.reduce((a, t) => a + t.pnl_usd, 0);
    const winCount   = openSide.filter(p => p.pnl > 0).length + closedSide.filter(t => t.outcome === 'WIN').length;
    const lossCount  = openSide.filter(p => p.pnl < 0).length + closedSide.filter(t => t.outcome === 'LOSS').length;
    const gross_p    = openSide.filter(p => p.pnl > 0).reduce((a, p) => a + p.pnl, 0) + closedSide.filter(t => t.pnl_usd > 0).reduce((a, t) => a + t.pnl_usd, 0);
    const gross_l    = Math.abs(openSide.filter(p => p.pnl < 0).reduce((a, p) => a + p.pnl, 0) + closedSide.filter(t => t.pnl_usd < 0).reduce((a, t) => a + t.pnl_usd, 0));
    const total      = winCount + lossCount;
    return { pnlUsd, winCount, lossCount, gross_p, gross_l, winRate: total > 0 ? winCount / total * 100 : 0 };
  };
  const longBook  = bookStats('long');
  const shortBook = bookStats('short');
  const totalBookPnl = longBook.pnlUsd + shortBook.pnlUsd;
  const longPct  = totalBookPnl !== 0 ? Math.abs(longBook.pnlUsd)  / (Math.abs(longBook.pnlUsd) + Math.abs(shortBook.pnlUsd)) * 100 : 50;
  const shortPct = 100 - longPct;

  // ── Best / Worst trade ───────────────────────────────────────────────────────
  const allTrades = [
    ...openPos.map(p => ({ ticker: p.ticker, pnlPct: p.pnlPct, pnlUsd: p.pnl, hold: null as number | null, dir: p.side })),
    ...closedTrades.map(t => ({ ticker: t.ticker, pnlPct: t.pnl_pct, pnlUsd: t.pnl_usd, hold: t.hold_days, dir: t.direction })),
  ];
  const best  = allTrades.length ? allTrades.reduce((a, b) => b.pnlPct > a.pnlPct ? b : a) : null;
  const worst = allTrades.length ? allTrades.reduce((a, b) => b.pnlPct < a.pnlPct ? b : a) : null;

  // ── Unified trade history ────────────────────────────────────────────────────
  const tradeRows: TradeRow[] = [
    ...openPos.map((p, i): TradeRow => ({
      id:          `open-${p.ticker}-${i}`,
      ticker:      p.ticker,
      direction:   p.side.toLowerCase() === 'long' ? 'LONG' : 'SHORT',
      date:        '—',
      holdDays:    null,
      pnl:         p.pnl,
      pnlPct:      p.pnlPct,
      status:      'Open',
      entryPrice:  p.entryPrice,
      currentPrice: p.currentPrice,
      thesis:      p.thesis,
      confidence:  p.effectiveConfidence,
    })),
    ...closedTrades.map((t): TradeRow => ({
      id:          `closed-${t.ticker}-${t.exit_date}`,
      ticker:      t.ticker,
      direction:   t.direction?.toLowerCase() === 'long' ? 'LONG' : 'SHORT',
      date:        t.exit_date ? new Date(t.exit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
      holdDays:    t.hold_days,
      pnl:         t.pnl_usd,
      pnlPct:      t.pnl_pct,
      status:      'Closed',
      outcome:     t.outcome,
      exitReason:  t.exit_reason,
      keyLesson:   t.key_lesson,
      sectorAccuracy: t.sector_accuracy,
      entryTiming:    t.entry_timing,
      exitTiming:     t.exit_timing,
      confidence:  t.entry_effective_confidence,
    })),
  ];

  // ── Metric cards data ────────────────────────────────────────────────────────
  const coreMetrics = [
    { label: 'Total Return',   value: `${totalReturn >= 0 ? '+' : '−'}${fmt$(totalReturn)}`, sub: fmtPct(totalReturnPct) + ' since start', trend: totalReturn >= 0 ? 'up' : 'down' },
    { label: 'vs SPY Alpha',   value: fmtPct(alphaPct), sub: `SPY: ${fmtPct(spyCumPct)}`, trend: alphaPct >= 0 ? 'up' : 'down' },
    { label: 'Sharpe Ratio',   value: isFinite(sharpe) ? sharpe.toFixed(2) : '—', sub: 'risk-adjusted return', trend: 'neutral' },
    { label: 'Max Drawdown',   value: maxDD < 0 ? `${maxDD.toFixed(2)}%` : '0.00%', sub: maxDDDate ? `trough on ${maxDDDate}` : 'no drawdown', trend: 'down' },
    { label: 'Win Rate',       value: closedTrades.length > 0 ? `${winRate.toFixed(1)}%` : '—', sub: `${wins} of ${closedTrades.length} closed +`, trend: 'neutral' },
    { label: 'Avg Hold',       value: closedTrades.length > 0 ? `${avgHold.toFixed(1)}d` : '—', sub: 'closed trades', trend: 'neutral' },
  ];

  const riskMetrics = [
    { label: 'Sortino Ratio',     value: isFinite(sortino) ? sortino.toFixed(2) : '—', sub: 'downside risk-adjusted' },
    { label: 'Calmar Ratio',      value: isFinite(calmar)  ? calmar.toFixed(2)  : '—', sub: 'return / max drawdown'  },
    { label: 'Information Ratio', value: isFinite(infoRatio) ? infoRatio.toFixed(2) : '—', sub: 'vs SPY benchmark' },
    { label: 'Profit Factor',     value: isFinite(profitFactor) && profitFactor > 0 ? `${profitFactor.toFixed(2)}×` : '—', sub: 'gross gain / gross loss' },
  ];

  const benchmarkItems = [
    { label: 'Beta to SPY',    value: isFinite(beta)          ? beta.toFixed(2)           : '—',             color: 'text-ink'  },
    { label: "Jensen's Alpha", value: isFinite(jensensAlpha)  ? fmtPct(jensensAlpha)      : '—',             color: jensensAlpha >= 0 ? 'text-gain' : 'text-loss' },
    { label: 'Net Exposure',   value: fmtPct(netExp, 1),                                                      color: 'text-ink'  },
    { label: 'Gross Exposure', value: `${grossExp.toFixed(1)}%`,                                              color: 'text-ink'  },
    { label: 'Up Capture',     value: isFinite(upCapture)     ? `${upCapture.toFixed(0)}%`   : '—',          color: upCapture >= 100 ? 'text-gain' : 'text-loss' },
    { label: 'Down Capture',   value: isFinite(downCapture)   ? `${downCapture.toFixed(0)}%` : '—',          color: downCapture <= 100 ? 'text-gain' : 'text-loss' },
    { label: 'Batting Avg',    value: isFinite(battingAvg)    ? `${battingAvg.toFixed(1)}%`  : '—',          color: 'text-ink'  },
  ];

  const tooltipStyle = { background: '#1A1F2E', border: '1px solid #2D3748', borderRadius: 8, fontSize: 12 };
  const labelStyle   = { color: '#9CA3AF' };

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64 text-dim text-sm">Loading performance data…</div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold text-ink">Performance</h1>
        <p className="text-sm text-dim mt-1">Full history since inception · {rawPoints.length} trading day{rawPoints.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Equity Curve */}
      <div className="bg-panel border border-rim rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Equity Curve</h2>
          <div className="flex items-center gap-4 text-xs text-dim">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-accent rounded" />Portfolio</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-dim rounded" />SPY</span>
          </div>
        </div>
        {snapshots.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-dim">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={snapshots} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 11 }} tickLine={false} axisLine={false}
                interval={0} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} domain={['auto', 'auto']} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any, name: any) => [`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, name === 'portfolio' ? 'Portfolio' : 'SPY'] as any} />
              <ReferenceLine y={START_CAPITAL} stroke="#2D3748" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="portfolio" stroke="#3B82F6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="spy" stroke="#9CA3AF" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Monthly Returns Grid */}
      <MonthlyReturnsGrid data={monthlyReturns} />

      {/* Core Metrics */}
      <div>
        <p className="text-xs text-dim uppercase tracking-wider mb-3">Core Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
          {coreMetrics.map(m => (
            <div key={m.label} className="bg-panel border border-rim rounded-xl p-4">
              <p className="text-xs text-dim uppercase tracking-wider mb-2">{m.label}</p>
              <p className={`font-mono text-lg font-semibold ${m.trend === 'up' ? 'text-gain' : m.trend === 'down' ? 'text-loss' : 'text-ink'}`}>
                {m.value}
              </p>
              <p className="text-xs text-dim mt-1">{m.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Metrics */}
      <div>
        <p className="text-xs text-dim uppercase tracking-wider mb-3">Risk Metrics</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {riskMetrics.map(m => (
            <div key={m.label} className="bg-panel border border-rim rounded-xl p-4">
              <p className="text-xs text-dim uppercase tracking-wider mb-2">{m.label}</p>
              <p className="font-mono text-lg font-semibold text-ink">{m.value}</p>
              <p className="text-xs text-dim mt-1">{m.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Benchmark & Exposure */}
      <div className="bg-panel border border-rim rounded-xl p-5">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-ink">Benchmark & Exposure</h2>
          <p className="text-xs text-dim mt-0.5">Risk-adjusted performance vs SPY · current exposure levels</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-x-6 gap-y-5">
          {benchmarkItems.map(m => (
            <div key={m.label}>
              <p className="text-xs text-dim mb-1">{m.label}</p>
              <p className={`font-mono text-base font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Drawdown Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-panel border border-rim rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">Underwater Chart</h2>
            <p className="text-xs text-dim mt-0.5">Drawdown from high-water mark · 0 = at peak</p>
          </div>
          {drawdownData.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-xs text-dim">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={drawdownData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  interval={Math.max(1, Math.floor(drawdownData.length / 5))} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v.toFixed(1)}%`} width={44} domain={[Math.min(ddMin * 1.2, -0.5), 0]} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${Number(v).toFixed(2)}%`, 'Drawdown'] as any} />
                <ReferenceLine y={0} stroke="#2D3748" strokeWidth={1} />
                <Area type="monotone" dataKey="dd" stroke="#EF4444" strokeWidth={1.5} fill="#EF4444" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-panel border border-rim rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">Drawdown Summary</h2>
            <p className="text-xs text-dim mt-0.5">All-time stats since inception</p>
          </div>
          <div className="space-y-3">
            {[
              { l: 'Max Drawdown',        v: maxDD < 0 ? `${maxDD.toFixed(2)}%` : '0.00%',                            c: maxDD < 0 ? 'text-loss' : 'text-dim' },
              { l: 'Calmar Ratio',         v: isFinite(calmar) && calmar > 0 ? calmar.toFixed(2) : '—',               c: 'text-ink' },
              { l: 'Annualized Return',    v: isFinite(annRet) ? fmtPct(annRet) : '—',                                 c: annRet >= 0 ? 'text-gain' : 'text-loss' },
              { l: 'Trading Days',         v: String(days),                                                             c: 'text-ink' },
              { l: 'Profitable Days',      v: portRet.length > 0 ? `${portRet.filter(r => r > 0).length}/${portRet.length}` : '—', c: 'text-ink' },
            ].map(({ l, v, c }) => (
              <div key={l} className="flex justify-between text-xs">
                <span className="text-dim">{l}</span>
                <span className={`font-mono font-medium ${c}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Long / Short Book Attribution */}
      <div className="bg-panel border border-rim rounded-xl p-5">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-ink">Long / Short Book Attribution</h2>
          <p className="text-xs text-dim mt-0.5">P&L split by book · realized + unrealized combined</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {[
            { label: 'Long Book', book: longBook, dir: 'long' },
            { label: 'Short Book', book: shortBook, dir: 'short' },
          ].map(({ label, book }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-4">
                <span className={`text-xs uppercase tracking-wider font-semibold ${label.includes('Long') ? 'text-gain' : 'text-loss'}`}>{label}</span>
                <span className={`font-mono text-sm font-semibold ${book.pnlUsd >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {book.pnlUsd >= 0 ? '+' : '−'}{fmt$(book.pnlUsd)}
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { l: 'Winners',      v: `${book.winCount} trade${book.winCount !== 1 ? 's' : ''}`,                   c: 'text-gain' },
                  { l: 'Gross Profit', v: book.gross_p > 0 ? `+${fmt$(book.gross_p)}` : '—',                           c: 'text-gain' },
                  { l: 'Losers',       v: `${book.lossCount} trade${book.lossCount !== 1 ? 's' : ''}`,                  c: 'text-loss' },
                  { l: 'Gross Loss',   v: book.gross_l > 0 ? `−${fmt$(book.gross_l)}` : '—',                           c: 'text-loss' },
                  { l: 'Win Rate',     v: book.winCount + book.lossCount > 0 ? `${book.winRate.toFixed(1)}%` : '—',     c: 'text-ink'  },
                ].map(({ l, v, c }) => (
                  <div key={l} className="flex justify-between text-xs">
                    <span className="text-dim">{l}</span>
                    <span className={`font-mono ${c}`}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {(longBook.pnlUsd !== 0 || shortBook.pnlUsd !== 0) && (
          <div className="mt-6 pt-4 border-t border-rim/40">
            <div className="flex justify-between text-xs text-dim mb-2">
              <span>Long — {longPct.toFixed(1)}%</span>
              <span>Short — {shortPct.toFixed(1)}%</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              <div className={`rounded-l-full ${longBook.pnlUsd >= 0 ? 'bg-gain/50' : 'bg-loss/50'}`} style={{ width: `${longPct}%` }} />
              <div className={`rounded-r-full ${shortBook.pnlUsd >= 0 ? 'bg-gain/20' : 'bg-loss/20'}`} style={{ width: `${shortPct}%` }} />
            </div>
            <div className="flex justify-between text-xs mt-2">
              <span className={`font-mono ${longBook.pnlUsd >= 0 ? 'text-gain' : 'text-loss'}`}>
                {longBook.pnlUsd >= 0 ? '+' : '−'}{fmt$(longBook.pnlUsd)}
              </span>
              <span className={`font-mono ${shortBook.pnlUsd >= 0 ? 'text-gain' : 'text-loss'}`}>
                {shortBook.pnlUsd >= 0 ? '+' : '−'}{fmt$(shortBook.pnlUsd)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rolling Risk Charts */}
      {rollingData.length >= 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-panel border border-rim rounded-xl p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-ink">Rolling Sharpe Ratio</h2>
              <p className="text-xs text-dim mt-0.5">{WINDOW}-day window · annualized · rf = 0%</p>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={rollingData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  interval={Math.max(1, Math.floor(rollingData.length / 5))} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => v.toFixed(1)} width={32} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [Number(v).toFixed(2), 'Sharpe'] as any} />
                <ReferenceLine y={1} stroke="#2D3748" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="sharpe" stroke="#3B82F6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-panel border border-rim rounded-xl p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-ink">Rolling Volatility</h2>
              <p className="text-xs text-dim mt-0.5">{WINDOW}-day window · annualized daily std dev</p>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={rollingData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  interval={Math.max(1, Math.floor(rollingData.length / 5))} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v.toFixed(0)}%`} width={36} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Vol (ann.)'] as any} />
                <Line type="monotone" dataKey="vol" stroke="#9CA3AF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Sector P&L */}
      <div className="bg-panel border border-rim rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">Sector P&L Since Inception</h2>
        <div className="space-y-3">
          {sectorContrib.map(s => {
            const up = s.pnlPct > 0;
            return (
              <div key={s.niche} className="flex items-center gap-3">
                <span className="text-xs text-dim w-24 md:w-48 shrink-0 truncate">{s.niche}</span>
                <div className="flex-1 flex items-center gap-2">
                  {!s.hasData ? (
                    <span className="text-xs text-dim/40 italic">no trades</span>
                  ) : (
                    <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${up ? 'bg-gain' : 'bg-loss'}`}
                        style={{ width: `${(Math.abs(s.pnlPct) / maxAbsSec) * 100}%` }} />
                    </div>
                  )}
                </div>
                {s.hasData && (
                  <div className="flex items-baseline gap-1.5 min-w-[110px] justify-end">
                    <span className={`font-mono text-sm font-semibold ${up ? 'text-gain' : 'text-loss'}`}>
                      {up ? '+' : ''}{s.pnlPct.toFixed(2)}%
                    </span>
                    <span className="font-mono text-xs text-dim">
                      {up ? '+' : '−'}${Math.abs(s.pnlUsd).toFixed(0)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Best / Worst */}
      {(best || worst) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {best && (
            <div className="bg-panel border border-rim rounded-xl p-4 flex items-center gap-4">
              <Trophy size={20} className="text-gain shrink-0" />
              <div>
                <p className="text-xs text-dim uppercase tracking-wider">Best Trade</p>
                <p className="text-sm font-semibold text-ink">{best.ticker} — {fmtPct(best.pnlPct)} ({best.pnlUsd >= 0 ? '+' : '−'}{fmt$(best.pnlUsd)})</p>
                <p className="text-xs text-dim capitalize">{best.dir} · {best.hold != null ? `${best.hold}d hold` : 'open'}</p>
              </div>
            </div>
          )}
          {worst && (
            <div className="bg-panel border border-rim rounded-xl p-4 flex items-center gap-4">
              <TrendingDown size={20} className="text-loss shrink-0" />
              <div>
                <p className="text-xs text-dim uppercase tracking-wider">Worst Trade</p>
                <p className="text-sm font-semibold text-ink">{worst.ticker} — {fmtPct(worst.pnlPct)} ({worst.pnlUsd >= 0 ? '+' : '−'}{fmt$(worst.pnlUsd)})</p>
                <p className="text-xs text-dim capitalize">{worst.dir} · {worst.hold != null ? `${worst.hold}d hold` : 'open'}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade History */}
      <div className="bg-panel border border-rim rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-rim flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Trade History</h2>
          <p className="text-xs text-dim">
            {openPos.length} open · {closedTrades.length} closed · click to expand
          </p>
        </div>
        {tradeRows.length === 0 ? (
          <div className="px-5 py-8 text-xs text-dim text-center">No trades yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rim">
                  <th className="px-4 py-3 w-4" />
                  {[
                    { label: 'Date',      hide: true  },
                    { label: 'Ticker',    hide: false },
                    { label: 'Direction', hide: false },
                    { label: 'Hold',      hide: true  },
                    { label: 'P&L',       hide: false },
                    { label: 'P&L %',     hide: false },
                    { label: 'Status',    hide: false },
                  ].map(({ label, hide }) => (
                    <th key={label} className={`text-left text-xs text-dim font-medium uppercase tracking-wider px-3 md:px-4 py-3 whitespace-nowrap ${hide ? 'hidden md:table-cell' : ''}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeRows.map(t => <ExpandableTradeRow key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
