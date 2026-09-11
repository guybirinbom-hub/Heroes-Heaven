/*
 * WHY THIS GUARD EXISTS.
 *
 * FEAT_GRANTS is a CODE table, so the trust gate cannot strip a field off it. The gate turns a
 * carrier's grants off through `lanes.featGrants` in the ledger, and the only reader that honours
 * that list is `grantsFor(id)` (src/rules/featGrants.ts). A raw `FEAT_GRANTS[...]` anywhere on the
 * APPLY side is therefore a grant the gate cannot reach — it would hand a character a proficiency
 * off a record the owner turned off, silently (docs/trust-gate.md section 3).
 *
 * src/builder/Builder.tsx keeps reading the raw table ON PURPOSE: the picker must still render and
 * still record the player's answer (section 1, ruling Q27). Only src/rules is checked.
 *
 * src/rules/featGrants.ts itself is skipped — it DEFINES the table, and its two builder-facing
 * readers (featUpgradesAtLevel, exhaustedGrantReason) are called from Builder.tsx alone.
 *
 * Usage: node scripts/featgrants-raw-check.mjs   (part of `npm run verify`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['featGrants.ts']);
/* `(?<![_A-Z])` so FEAT_FEAT_GRANTS[…], CHOICE_FEAT_GRANTS[…] and FEAT_RANK_FEAT_GRANTS[…] — other
 * tables, with their own lane — are not mistaken for this one. */
const RAW = /(?<![_A-Z])FEAT_GRANTS\s*\[/g;

const bad = [];
for (const f of readdirSync(join(ROOT, 'src/rules')).sort()) {
  if (!f.endsWith('.ts') || SKIP.has(f)) continue;
  const text = readFileSync(join(ROOT, 'src/rules', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  text.split('\n').forEach((line, i) => {
    if (RAW.test(line)) bad.push(`src/rules/${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
    RAW.lastIndex = 0;
  });
}

if (bad.length) {
  console.error(`featgrants-raw-check FAILED: ${bad.length} raw FEAT_GRANTS[…] read(s) on the apply side:\n${bad.map((b) => `  ${b}`).join('\n')}`
    + '\n\nUse grantsFor(id) from ./featGrants — it removes the kinds the trust gate turned off for that'
    + '\ncarrier and returns undefined when every kind it delivers is off.');
  process.exit(1);
}
console.log(`featgrants-raw-check: OK — no raw FEAT_GRANTS[…] in src/rules (${SKIP.size} defining module skipped)`);
