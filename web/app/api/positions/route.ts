import { NextResponse } from 'next/server';
import { alpacaFetch } from '@/lib/alpaca';
import { sql } from '@/lib/db';
import { TICKER_NICHE, NICHE_DISPLAY } from '@/lib/constants';

export const dynamic = 'force-dynamic';

interface AlpacaPos {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
}

export async function GET() {
  try {
    const [alpacaPositions, entryRows, statusRows] = await Promise.all([
      alpacaFetch<AlpacaPos[]>('/positions'),

      // Most-recent BUY/SHORT action per ticker — gives entry thesis + stop
      sql`
        WITH raw AS (
          SELECT
            action->>'ticker'                         AS ticker,
            action->>'action'                         AS action_type,
            action->>'thesis'                         AS thesis,
            action->>'conviction'                     AS conviction,
            (action->>'stop_pct_used')::numeric       AS stop_pct_used,
            (action->>'effective_confidence')::numeric AS effective_confidence,
            ps.created_at
          FROM stocks.portfolio_snapshots ps
          CROSS JOIN LATERAL jsonb_array_elements(ps.raw_json->'portfolio_actions') AS action
          WHERE action->>'action' IN ('BUY', 'SHORT')
            AND action->>'ticker' IS NOT NULL
        )
        SELECT DISTINCT ON (ticker)
          ticker, action_type, thesis, conviction, stop_pct_used, effective_confidence, created_at
        FROM raw
        ORDER BY ticker, created_at DESC
      `,

      // Most-recent thesis_intact + stop_proximity per ticker from positions_json
      sql`
        WITH raw AS (
          SELECT
            pos->>'ticker'                      AS ticker,
            (pos->>'thesis_intact')::boolean    AS thesis_intact,
            pos->>'stop_proximity'              AS stop_proximity,
            ps.created_at
          FROM stocks.portfolio_snapshots ps
          CROSS JOIN LATERAL jsonb_array_elements(ps.positions_json) AS pos
          WHERE pos->>'ticker' IS NOT NULL
        )
        SELECT DISTINCT ON (ticker)
          ticker, thesis_intact, stop_proximity, created_at
        FROM raw
        ORDER BY ticker, created_at DESC
      `,
    ]);

    // Index lookup maps
    const entryByTicker: Record<string, typeof entryRows[0]> = {};
    for (const r of entryRows) entryByTicker[r.ticker as string] = r;

    const statusByTicker: Record<string, typeof statusRows[0]> = {};
    for (const r of statusRows) statusByTicker[r.ticker as string] = r;

    const positions = alpacaPositions.map(p => {
      const entry  = entryByTicker[p.symbol];
      const status = statusByTicker[p.symbol];
      const side   = p.side === 'long' ? 'LONG' : 'SHORT';
      const entryPrice   = parseFloat(p.avg_entry_price);
      const currentPrice = parseFloat(p.current_price);
      const stopPct      = entry?.stop_pct_used != null ? parseFloat(String(entry.stop_pct_used)) : null;
      const stopPrice    = stopPct != null
        ? (side === 'LONG' ? entryPrice * (1 - stopPct / 100) : entryPrice * (1 + stopPct / 100))
        : null;

      return {
        ticker:              p.symbol,
        side,
        shares:              parseFloat(p.qty),
        entryPrice,
        currentPrice,
        marketValue:         parseFloat(p.market_value),
        costBasis:           parseFloat(p.cost_basis),
        pnl:                 parseFloat(p.unrealized_pl),
        pnlPct:              parseFloat(p.unrealized_plpc) * 100,
        changeToday:         parseFloat(p.change_today) * 100,
        niche:               TICKER_NICHE[p.symbol] ?? null,
        nicheDisplay:        NICHE_DISPLAY[TICKER_NICHE[p.symbol]] ?? '—',
        thesis:              entry?.thesis ?? null,
        conviction:          entry?.conviction ?? null,
        effectiveConfidence: entry?.effective_confidence != null ? parseFloat(String(entry.effective_confidence)) : null,
        stopPct,
        stopPrice,
        distToStop:          stopPrice != null ? Math.abs(currentPrice - stopPrice) : null,
        thesisIntact:        status?.thesis_intact ?? null,
        stopProximity:       status?.stop_proximity ?? null,
      };
    });

    return NextResponse.json({ positions });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
