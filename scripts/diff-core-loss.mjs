/*
 * What did a `npm run data` regen DELETE?
 *
 * The importer rebuilds every record from the AoN export and re-applies effect-backfill.json. Anything
 * hand-authored that lives only in core.json — written straight into the bucket by an apply script
 * that never updated a source file — is simply gone, with no error and no diff anyone reads, because
 * core.json is a 22 MB minified blob.
 *
 * Compares a known-good core.json (argv[2]) against the current one and reports every field that was
 * lost or changed, grouped by field name so the shape of the loss is visible at a glance.
 */
import { readFileSync } from 'node:fs';

const readCore = (p) => {
  let s = readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
};

const good = readCore(process.argv[2]);
const now = readCore(process.argv[3] ?? 'C:/trying ai 2/pf2e codex/public/core.json');

// Buckets whose records the importer rebuilds. Reference/glossary buckets are regenerated wholesale
// and their churn is noise.
const BUCKETS = ['feats', 'classFeatures', 'items', 'spells', 'heritages', 'backgrounds', 'ancestries', 'classes', 'deities', 'actions', 'modes', 'stances'];

const lost = [];
for (const bucket of BUCKETS) {
  const g = good[bucket] ?? {};
  const n = now[bucket] ?? {};
  for (const [id, grec] of Object.entries(g)) {
    const nrec = n[id];
    if (!nrec) {
      lost.push({ bucket, id, field: '(WHOLE RECORD)', value: undefined });
      continue;
    }
    if (typeof grec !== 'object') continue;
    for (const [field, gval] of Object.entries(grec)) {
      const nval = nrec[field];
      if (JSON.stringify(gval) === JSON.stringify(nval)) continue;
      lost.push({ bucket, id, field, value: gval, now: nval });
    }
  }
}

const byField = new Map();
for (const l of lost) {
  const k = `${l.bucket}.${l.field}`;
  byField.set(k, (byField.get(k) ?? 0) + 1);
}
console.log(`fields lost or changed: ${lost.length}\n`);
for (const [k, n] of [...byField].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${k}`);

// The ones that matter are fields the regen DROPPED entirely (undefined now), not ones it rewrote
// from a fresher AoN export.
const dropped = lost.filter((l) => l.now === undefined);
console.log(`\nof which DROPPED entirely (present before, absent now): ${dropped.length}`);
const droppedByField = new Map();
for (const l of dropped) droppedByField.set(`${l.bucket}.${l.field}`, (droppedByField.get(`${l.bucket}.${l.field}`) ?? 0) + 1);
for (const [k, n] of [...droppedByField].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(5)}  ${k}`);
