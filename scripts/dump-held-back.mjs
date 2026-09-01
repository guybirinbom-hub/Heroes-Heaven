/*
 * Dump the held-back proposals in full, grouped by the REGISTRY they belong in — these are the ones
 * whose fix is a code change rather than a data row, so each needs its target file identified before
 * anything can be authored.
 *
 *   node scripts/dump-held-back.mjs [--group <name>]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const out = read('work/residual-workflow-out.json');

const types = readFileSync(join(ROOT, 'src/rules/types.ts'), 'utf8');
const DECLARED = new Set([...types.matchAll(/^\s{2,}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]));

const only = process.argv.includes('--group') ? process.argv[process.argv.indexOf('--group') + 1] : null;

/* Which registry a proposal names, read from its own field/evidence text. */
const registryOf = (t) => {
  const m = /([a-zA-Z]+(?:Grants|GrantsAuto|GrantsLane|FeatGrants|PickGrants|Archetypes|Bonuses|Book|Modes)[a-zA-Z]*)\.ts/.exec(t);
  if (m) return m[1] + '.ts';
  if (/companionGrants/.test(t)) return 'companionGrants.ts';
  if (/situationalBonuses/.test(t)) return 'situationalBonuses.ts';
  if (/featFeatGrants/.test(t)) return 'featFeatGrants.ts';
  if (/featGrantsAuto/.test(t)) return 'featGrantsAuto.ts';
  if (/featGrants/.test(t)) return 'featGrants.ts';
  if (/build\.ts|derive\.ts/.test(t)) return 'build/derive.ts';
  return '(unidentified)';
};

const groups = {};
for (const fix of out.survived ?? []) {
  const rawField = String(fix.field ?? '').trim();
  const field = rawField.split(/[\s—,]/)[0];
  const isNote = !field && fix.verdict === 'NOTE' && fix.note;
  if (isNote) continue;
  const held = !field || /[[\].]|\.ts|scripts\//.test(rawField.split(/\s/)[0]) || !DECLARED.has(field) || !core[fix.bucket]?.[fix.id];
  if (!held) continue;
  const g = registryOf(rawField + ' ' + (fix.evidence ?? ''));
  (groups[g] ??= []).push({ id: fix.id, bucket: fix.bucket, field: rawField, conf: fix.confidence, evidence: fix.evidence, valueJson: fix.valueJson });
}

for (const [g, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  if (only && g !== only) continue;
  console.log(`\n=== ${g}  (${list.length})`);
  for (const f of list) {
    console.log(`  ${f.bucket}/${f.id}   [${f.conf}]`);
    console.log(`     field: ${f.field.slice(0, 150)}`);
    if (only) {
      if (f.valueJson) console.log(`     value: ${String(f.valueJson).slice(0, 400)}`);
      console.log(`     why  : ${String(f.evidence ?? '').slice(0, 400)}`);
    }
  }
}
