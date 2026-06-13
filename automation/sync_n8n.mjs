#!/usr/bin/env node
/**
 * sync_n8n.mjs — push merged workflows/code/*.js into the live n8n nodes.
 *
 * The local files are source control; n8n is production. Merging a PR only
 * updates the files — this script makes the live nodes match. It is the
 * automated replacement for the manual "MANDATORY n8n sync" curl dance.
 *
 * USAGE
 *   node automation/sync_n8n.mjs                 # dry-run: show what WOULD change
 *   node automation/sync_n8n.mjs --apply         # push the diffs to live n8n
 *   node automation/sync_n8n.mjs --file 02_compute_derived_metrics.js [--apply]
 *   node automation/sync_n8n.mjs --changed-since <gitSha> --apply --notify
 *
 * SAFETY
 *   - Dry-run by default. Nothing is pushed without --apply.
 *   - Fresh download: every run GETs the live workflow (never a cached copy).
 *   - Drift guard (--changed-since only): before overwriting a node, confirm the
 *     live code matches what git expected BEFORE the merge (`git show <sha>:file`).
 *     If live matches neither the old nor new version, it was hand-edited in n8n —
 *     SKIP it and alert, never clobber.
 *   - Only ever replaces an existing node's jsCode. Never adds/rewires nodes.
 *   - build_specialist_message.js (8-instance template) is excluded by manifest.
 *
 * ENV: N8N_API_KEY (required), N8N_API_BASE (optional), TELEGRAM_* (for --notify)
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const CODE_DIR = join(REPO, "workflows", "code");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const APPLY = has("--apply");
const NOTIFY = has("--notify");
const ONLY_FILE = valOf("--file");
const CHANGED_SINCE = valOf("--changed-since"); // git SHA: enables drift guard + limits scope

const manifest = JSON.parse(readFileSync(join(__dirname, "n8n_manifest.json"), "utf8"));
const API_BASE = process.env.N8N_API_BASE || manifest.apiBaseDefault;
const API_KEY = process.env.N8N_API_KEY;

if (!API_KEY) { console.error("✖ N8N_API_KEY not set"); process.exit(1); }

// Compare ignoring trailing whitespace/newlines (n8n strips the final newline that
// git files keep) so that's never reported as a difference.
const norm = (s) => (s || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");

const api = async (method, path, body) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "X-N8N-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

// What did git think the live node held BEFORE this merge? (drift-guard baseline)
const gitVersionAt = (sha, file) => {
  try { return execSync(`git show ${sha}:workflows/code/${file}`, { cwd: REPO, encoding: "utf8" }); }
  catch { return null; } // file didn't exist at that sha (newly added) → no baseline
};

const send = (text) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    execSync(`curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" ` +
      `--data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}" >/dev/null`,
      { cwd: REPO });
  } catch { /* notification best-effort */ }
};

// Which files are in scope this run?
let entries = manifest.nodes;
if (ONLY_FILE) entries = entries.filter((e) => e.file === ONLY_FILE);
if (CHANGED_SINCE) {
  const changed = new Set(
    execSync(`git diff --name-only ${CHANGED_SINCE} HEAD -- workflows/code/`, { cwd: REPO, encoding: "utf8" })
      .split("\n").map((l) => l.replace("workflows/code/", "").trim()).filter(Boolean)
  );
  // Warn if a manual-only or unmapped code file changed — it won't be auto-synced.
  for (const f of changed) {
    const mapped = manifest.nodes.some((n) => n.file === f);
    const manual = manifest.manualOnly.some((m) => m.file === f);
    if (!mapped) console.warn(`⚠  ${f} changed but is ${manual ? "MANUAL-ONLY (sync by hand)" : "NOT in the manifest"} — skipping.`);
  }
  entries = entries.filter((e) => changed.has(e.file));
}

if (entries.length === 0) { console.log("Nothing in scope. Done."); process.exit(0); }

// Group by workflow so we GET/PUT each workflow once (atomic per workflow).
const byWf = {};
for (const e of entries) (byWf[e.workflow] ||= []).push(e);

const results = { synced: [], inSync: [], drift: [], missing: [] };

for (const [wfKey, group] of Object.entries(byWf)) {
  const wfId = manifest.workflows[wfKey];
  const wf = await api("GET", `/workflows/${wfId}`); // fresh download, always
  let dirty = false;

  for (const e of group) {
    const node = wf.nodes.find((n) => n.name === e.node);
    if (!node || node.type !== "n8n-nodes-base.code") {
      console.error(`✖ ${e.file}: node "${e.node}" not found as a Code node in ${wfKey}`);
      results.missing.push(e.file);
      continue;
    }
    const fileContent = readFileSync(join(CODE_DIR, e.file), "utf8");
    const live = norm(node.parameters.jsCode);
    const want = norm(fileContent);

    if (live === want) { results.inSync.push(e.file); console.log(`✓ ${e.file.padEnd(34)} in sync`); continue; }

    // Drift guard (only when we know the pre-merge baseline)
    if (CHANGED_SINCE) {
      const base = gitVersionAt(CHANGED_SINCE, e.file);
      const expected = base == null ? null : norm(base);
      if (expected != null && live !== expected) {
        console.error(`🛑 ${e.file.padEnd(34)} DRIFT — live n8n matches neither old nor new git. Hand-edited? Skipping.`);
        results.drift.push(e.file);
        continue;
      }
    }

    console.log(`● ${e.file.padEnd(34)} CHANGED (live ${live.length} → file ${want.length} chars)`);
    if (APPLY) { node.parameters.jsCode = fileContent; dirty = true; results.synced.push(e.file); }
    else { results.synced.push(e.file); } // dry-run: count as "would sync"
  }

  if (APPLY && dirty) {
    const put = await api("PUT", `/workflows/${wfId}`, {
      name: wf.name, nodes: wf.nodes, connections: wf.connections,
      // n8n's PUT schema rejects extra settings keys (e.g. binaryMode) — send only executionOrder.
      settings: { executionOrder: (wf.settings && wf.settings.executionOrder) || "v1" },
      staticData: wf.staticData ?? null,
    });
    if (!put.updatedAt) throw new Error(`PUT ${wfKey} returned no updatedAt`);
    console.log(`  ↑ pushed ${wfKey} (updatedAt ${put.updatedAt})`);
  }
}

// Summary
console.log("\n" + "─".repeat(52));
const verb = APPLY ? "pushed" : "would push";
console.log(`${results.synced.length} ${verb}, ${results.inSync.length} in sync, ` +
  `${results.drift.length} drift-skipped, ${results.missing.length} missing`);
if (!APPLY && results.synced.length) console.log("Re-run with --apply to push.");

if (NOTIFY && (results.synced.length || results.drift.length || results.missing.length)) {
  let msg = `n8n sync: ${results.synced.length} ${verb}`;
  if (results.synced.length) msg += `\n✅ ${results.synced.join(", ")}`;
  if (results.drift.length) msg += `\n🛑 DRIFT (skipped, review): ${results.drift.join(", ")}`;
  if (results.missing.length) msg += `\n✖ MISSING node: ${results.missing.join(", ")}`;
  send(msg);
}

// Non-zero exit if anything needs human attention so CI surfaces it.
if (results.drift.length || results.missing.length) process.exit(2);
