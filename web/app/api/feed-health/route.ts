import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const N8N_BASE  = 'https://<N8N_HOST>/api/v1';
const N8N_KEY   = process.env.N8N_API_KEY!;
const WORKFLOW  = 'l2d06hEvDlfLibms';

// Maps RSS node name → niche key
const RSS_NICHE: Record<string, string> = {
  'RSS Cybersecurity 1':                   'cybersecurity',
  'RSS Cybersecurity 2':                   'cybersecurity',
  'RSS Defense 1':                         'defense',
  'RSS Defense 2':                         'defense',
  'RSS Nuclear / Uranium 1':               'nuclear_uranium',
  'RSS Nuclear / Uranium 2':               'nuclear_uranium',
  'RSS Copper / Critical Minerals 1':      'copper_minerals',
  'RSS Copper / Critical Minerals 2':      'copper_minerals',
  'RSS AI & Semiconductors 1':             'semiconductors',
  'RSS AI & Semiconductors 2':             'semiconductors',
  'RSS Cloud Hyperscalers 1':              'enterprise_saas',
  'RSS Cloud Hyperscalers 2':              'enterprise_saas',
  'RSS Oil & Gas 1':                       'oil_gas',
  'RSS Oil & Gas 2':                       'oil_gas',
  'RSS Data Centers & AI Infrastructure 1':'data_centers',
  'RSS Data Centers & AI Infrastructure 2':'data_centers',
};

export interface FeedStatus {
  niche: string;
  feed1: { ok: boolean; error: string | null };
  feed2: { ok: boolean; error: string | null };
}

export async function GET() {
  try {
    // Get the most recent triggered execution (not manual)
    const listRes = await fetch(
      `${N8N_BASE}/executions?workflowId=${WORKFLOW}&limit=10`,
      { headers: { 'X-N8N-API-KEY': N8N_KEY } }
    );
    const list = await listRes.json();
    const lastTriggered = (list.data ?? []).find(
      (e: { mode: string }) => e.mode === 'trigger'
    );

    if (!lastTriggered) {
      return NextResponse.json({ feeds: [], executionId: null, startedAt: null });
    }

    // Fetch full execution data
    const execRes = await fetch(
      `${N8N_BASE}/executions/${lastTriggered.id}?includeData=true`,
      { headers: { 'X-N8N-API-KEY': N8N_KEY } }
    );
    const exec = await execRes.json();
    const runData: Record<string, { error?: { message: string } }[]> =
      exec.data?.resultData?.runData ?? {};

    // Build per-niche feed status
    const nicheMap: Record<string, FeedStatus> = {};
    for (const [nodeName, niche] of Object.entries(RSS_NICHE)) {
      if (!nicheMap[niche]) {
        nicheMap[niche] = { niche, feed1: { ok: true, error: null }, feed2: { ok: true, error: null } };
      }
      const isFeed2  = nodeName.endsWith(' 2');
      const nodeRuns = runData[nodeName];
      const errMsg   = nodeRuns?.[0]?.error?.message ?? null;
      const status   = { ok: !errMsg, error: errMsg };
      if (isFeed2) nicheMap[niche].feed2 = status;
      else         nicheMap[niche].feed1 = status;
    }

    return NextResponse.json({
      feeds: Object.values(nicheMap),
      executionId: lastTriggered.id,
      startedAt:   lastTriggered.startedAt,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
