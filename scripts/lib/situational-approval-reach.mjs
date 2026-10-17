/**
 * Which `situational` approvals in scripts/data/trust-approvals.json reach NOTHING (package I, desk #163, 2026-10-17).
 *
 * An approval whose field is `situational` says: "the starred note on this record may show". The note itself lives in
 * one of three places, and an approval for a record with none of them is a ruling that lights an empty room —
 * test/trust-approvals.test.ts and the ledger both stay green and the player gets nothing:
 *
 *   · FEAT_SITUATIONAL[<bare id>]    src/rules/situationalBonuses.ts (the hand-authored block and the generated one);
 *   · CHOICE_SITUATIONAL[<bare id>]  the same file, the per-answer stars;
 *   · a `situational` field on the record in public/core.json, at any depth.
 *
 * That is exactly what happened to desk #163 (Energy Shot, Fulminating Shot, Dispelling Bullet): three approvals,
 * filed 2026-10-15, and no star behind any of them. The rule here is the same scrape scripts/trust-ledger.mjs does
 * (registryEntries): a registry key is an entry at two-space indent whose value opens a list or object — the
 * generator and this reader must agree on what a key is, or the "lane" it builds and the check guarding it drift.
 *
 * `pending` approvals are exempt: they name a record the desk fix has not created yet.
 */

/** The text of one top-level `const SYMBOL ... };` table of a TypeScript source (empty when the table is gone). */
export function tableText(src, symbol) {
  const i = src.search(new RegExp(`^(?:export )?const ${symbol}\\b`, 'm'));
  if (i < 0) return '';
  const j = src.indexOf('\n};', i);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

/** Every entry key of one registry table: `  "energy-shot": [` / `  rage: {`. */
export function registryKeys(src, symbol) {
  const text = tableText(src, symbol);
  return [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*[[{]/gm)].map((m) => m[1] ?? m[2]);
}

/** Does `value` carry a non-empty `situational` field anywhere inside it? */
export function hasSituationalField(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return false;
  if (Array.isArray(value)) return value.some((v) => hasSituationalField(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (k === 'situational' && v && (Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v).length > 0 : true)) return true;
    if (hasSituationalField(v, depth + 1)) return true;
  }
  return false;
}

/**
 * `#<desk number> <bucket/id>` for every non-pending `situational` approval with no star behind it.
 * @param {{ approvals: { approvals?: any[] }, core: Record<string, Record<string, any>>, registrySource: string }} input
 *   `registrySource` is the full text of src/rules/situationalBonuses.ts.
 */
export function unreachedSituationalApprovals({ approvals, core, registrySource }) {
  const reached = new Set([...registryKeys(registrySource, 'FEAT_SITUATIONAL'), ...registryKeys(registrySource, 'CHOICE_SITUATIONAL')]);
  const out = [];
  for (const e of approvals?.approvals ?? []) {
    if (e.pending || !(e.fields ?? []).includes('situational')) continue;
    const [bucket, ...rest] = String(e.record ?? '').split('/');
    const id = rest.join('/');
    if (reached.has(id)) continue;
    if (hasSituationalField(core?.[bucket]?.[id])) continue;
    out.push(`#${e.n} ${e.record}`);
  }
  return out;
}

/** How many `situational` approvals there are to check (for the check's own line). */
export function situationalApprovalCount(approvals) {
  return (approvals?.approvals ?? []).filter((e) => !e.pending && (e.fields ?? []).includes('situational')).length;
}
