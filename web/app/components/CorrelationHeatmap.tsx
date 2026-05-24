'use client';

import React, { useState } from 'react';

interface HeatmapProps {
  tickers: { ticker: string; side: 'L' | 'S' }[];
  matrix: number[][];
  penaltyThreshold?: number;
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function corrToColor(r: number): string {
  // panel: #1A1F2E  gain: #22C55E  loss: #EF4444
  const panel = [26, 31, 46];
  const green = [34, 197, 94];
  const red   = [239, 68, 68];

  const [dr, dg, db] = r >= 0 ? green : red;
  const t = Math.abs(r);

  return `rgb(${lerp(panel[0], dr, t)},${lerp(panel[1], dg, t)},${lerp(panel[2], db, t)})`;
}

function textColor(r: number): string {
  return Math.abs(r) > 0.45 ? 'rgba(255,255,255,0.90)' : 'rgba(156,163,175,0.80)';
}

export default function CorrelationHeatmap({
  tickers,
  matrix,
  penaltyThreshold = 0.70,
}: HeatmapProps) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  const n = tickers.length;
  const label = (i: number) => `${tickers[i].ticker} (${tickers[i].side})`;

  const hoveredCell =
    hovered
      ? {
          rowLabel: label(hovered.row),
          colLabel: label(hovered.col),
          value: matrix[hovered.row][hovered.col],
          isPenalty: hovered.row !== hovered.col && matrix[hovered.row][hovered.col] >= penaltyThreshold,
        }
      : null;

  return (
    <div className="bg-panel border border-rim rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">90-Day Return Correlation</h2>
          <p className="text-xs text-dim mt-0.5">Open positions · (L) long · (S) short</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-dim">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-loss/80 inline-block" /> Negative
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-panel border border-rim inline-block" /> Neutral
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gain/80 inline-block" /> Positive
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ display: 'grid', gridTemplateColumns: `7rem repeat(${n}, 1fr)`, gap: 3 }}>

          {/* Top-left corner spacer */}
          <div />

          {/* Column headers */}
          {tickers.map((t, i) => (
            <div
              key={i}
              className="text-center pb-1"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 72 }}
            >
              <span className={`text-xs font-mono font-medium ${t.side === 'L' ? 'text-gain' : 'text-loss'}`}>
                {t.ticker}
              </span>
              <span className="text-xs text-dim"> ({t.side})</span>
            </div>
          ))}

          {/* Rows */}
          {matrix.map((row, i) => (
            <React.Fragment key={i}>
              {/* Row label */}
              <div className="flex items-center justify-end pr-3">
                <span className={`text-xs font-mono font-medium ${tickers[i].side === 'L' ? 'text-gain' : 'text-loss'}`}>
                  {tickers[i].ticker}
                </span>
                <span className="text-xs text-dim ml-0.5">({tickers[i].side})</span>
              </div>

              {/* Cells */}
              {row.map((r, j) => {
                const isDiag    = i === j;
                const isPenalty = !isDiag && r >= penaltyThreshold;
                const isHovered = hovered?.row === i && hovered?.col === j;

                return (
                  <div
                    key={`${i}-${j}`}
                    className="relative rounded-sm flex items-center justify-center cursor-default transition-transform duration-75"
                    style={{
                      backgroundColor: corrToColor(r),
                      height: 48,
                      outline: isPenalty ? '2px solid #F59E0B' : isHovered ? '2px solid rgba(249,250,251,0.4)' : 'none',
                      outlineOffset: -1,
                      transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                      zIndex: isHovered ? 10 : 1,
                    }}
                    onMouseEnter={() => setHovered({ row: i, col: j })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span
                      className="font-mono text-xs font-semibold select-none"
                      style={{ color: textColor(r) }}
                    >
                      {isDiag ? '—' : r.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tooltip / info bar */}
      <div className="mt-4 h-8 flex items-center">
        {hoveredCell ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-dim">{hoveredCell.rowLabel}</span>
            <span className="text-dim">×</span>
            <span className="text-dim">{hoveredCell.colLabel}</span>
            <span className="text-rim">·</span>
            <span className={`font-mono font-semibold ${
              hoveredCell.value >= 0.70 ? 'text-yellow-400' :
              hoveredCell.value >= 0.40 ? 'text-gain' :
              hoveredCell.value <= -0.30 ? 'text-loss' : 'text-ink'
            }`}>
              {hoveredCell.value.toFixed(2)}
            </span>
            {hoveredCell.isPenalty && (
              <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                ⚠ penalty threshold exceeded — blocks new entries
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-dim/50">Hover a cell to inspect · amber border = ≥{penaltyThreshold} correlation penalty</p>
        )}
      </div>
    </div>
  );
}
