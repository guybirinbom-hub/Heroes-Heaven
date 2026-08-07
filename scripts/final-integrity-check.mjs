// A stop-here check: is everything this session wrote consistent and loadable?
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
let bad = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
  if (!cond) bad++;
};

// ---- core.json ----
const raw = readFileSync(p('public/core.json'), 'utf8');
let core;
try { core = JSON.parse(raw); } catch (e) { console.log('FAIL  core.json does not parse:', e.message); process.exit(1); }
ok('core.json parses', true, `${(raw.length / 1048576).toFixed(1)} MB`);
ok('core.json is minified', !raw.includes('\n'), 'pretty-printing once cost 4 MB');
ok('batch-1 field write present', core.items['lifting-belt']?.passiveEffects?.skills?.athletics === 1, JSON.stringify(core.items['lifting-belt']?.passiveEffects));
ok('consumable modes present', Object.keys(core.modes ?? {}).length > 200, `${Object.keys(core.modes ?? {}).length} modes`);
ok('repaired description present', !/\battempt an checks?\b/.test(String(core.actions['boarding-assault']?.description ?? '')), 'boarding-assault');

// ---- the overlay: the only thing that survives a regen ----
const ov = JSON.parse(readFileSync(p('scripts/data/effect-backfill.json'), 'utf8'));
ok('overlay parses', Array.isArray(ov), `${ov.length} patches`);
/*
 * Three row shapes are NOT a plain `core[category][id][field] = value`, and comparing them that way
 * reported 383 phantom drifts on every run — a check that always fails is a check nobody reads.
 *
 *   description / descRefs  live in public/core-descriptions.json since the split; core.json no
 *                           longer holds them at all.
 *   create: true            builds a whole record, so there is no single field to compare.
 *   path                    writes into a nested location, which this flat lookup cannot address.
 */
const descSplit = JSON.parse(readFileSync(p('public/core-descriptions.json'), 'utf8'));
const liveValue = (x) => {
  if (x.field === 'description') return descSplit[x.category]?.[x.id]?.d;
  if (x.field === 'descRefs') return descSplit[x.category]?.[x.id]?.r;
  return core[x.category]?.[x.id]?.[x.field];
};
const comparable = ov.filter((x) => !x.create && !x.path);
const drift = comparable.filter((x) => {
  const live = liveValue(x);
  if (x.value === null && live === undefined) return false;
  return JSON.stringify(live) !== JSON.stringify(x.value);
});
ok(
  'overlay matches core.json',
  drift.length === 0,
  drift.length
    ? `${drift.length} drifted, e.g. ${drift.slice(0, 3).map((d) => `${d.category}/${d.id}.${d.field}`).join(', ')}`
    : `no drift (${comparable.length} comparable of ${ov.length}; ${ov.length - comparable.length} are create/path rows)`,
);
// A create/path row still has to land, so check the RECORD exists rather than a single field.
const missing = ov.filter((x) => (x.create || x.path) && !core[x.category]?.[x.id]);
ok('create/path rows produced a record', missing.length === 0, missing.length ? `${missing.length} missing` : `${ov.length - comparable.length} checked`);

// ---- the registry ----
const reg = readFileSync(p('src/rules/situationalBonuses.ts'), 'utf8');
const keys = (reg.match(/^ {2}"[a-z0-9-]+": \[/gm) ?? []).length;
const dupSemi = (reg.match(/\};;/g) ?? []).length;
ok('situational registry populated', keys > 2500, `${keys} records`);
ok('no doubled semicolons', dupSemi === 0);
// PER TABLE, not per file. The three tables share a line format, and a record legitimately appears in
// more than one of them — `the-fool` grants a conditional bonus AND marks an action. Scanning the whole
// file called that a collision, which it is not.
const dup = (() => {
  const tables = [
    ['FEAT_SITUATIONAL', reg.indexOf('export const FEAT_SITUATIONAL')],
    ['RECORD_MARKERS', reg.indexOf('export const RECORD_MARKERS')],
    ['SPELL_MARKERS', reg.indexOf('export const SPELL_MARKERS')],
    ['SITUATIONAL_SUPERSEDES', reg.indexOf('export const SITUATIONAL_SUPERSEDES')],
  ].filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]);
  const tableOf = (idx) => {
    let name = null;
    for (const [n, at] of tables) if (at < idx) name = n;
    return name;
  };
  const seen = new Map();
  const out = [];
  for (const m of reg.matchAll(/^ {2}"([a-z0-9-]+)": \[/gm)) {
    const key = `${tableOf(m.index)}|${m[1]}`;
    if (seen.has(key)) out.push(key);
    seen.set(key, true);
  }
  return out;
})();
ok('no duplicate keys within a table', dup.length === 0, dup.length ? `dupes: ${dup.slice(0, 5).join(', ')}` : 'a second key would silently win');

// ---- the HMR plugin ----
const vite = readFileSync(p('vite.config.ts'), 'utf8');
ok('HMR full-reload plugin wired', vite.includes('fullReloadOnLogicChange()') && vite.includes('handleHotUpdate'));

console.log(bad ? `\n${bad} PROBLEM(S)` : '\nAll checks pass — safe to stop here.');
process.exit(bad ? 1 : 0);
