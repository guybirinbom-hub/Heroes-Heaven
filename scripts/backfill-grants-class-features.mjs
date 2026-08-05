/*
 * "You gain the Sneak Attack class feature."
 *
 * A record handing over a CLASS FEATURE rather than a feat — the archetype route into another class's
 * signature ability. `grantsFeats` could not express it (the target is not a feat) and nothing else
 * wrote into `ownedFeatureIds`, so 14 records said this and delivered none of it: an Investigator
 * Dedication granted no On the Case, Sneak Attacker granted no sneak attack dice.
 *
 * PARSED from each record's own sentence and matched to a shipped class feature by NAME. Anything
 * that does not resolve is reported, never guessed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const RE = /[Yy]ou gain the ([A-Z][A-Za-z' -]{2,42}?) (?:class feature|feature)\b/;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const byName = new Map(Object.entries(core.classFeatures).map(([id, f]) => [norm(f.name), id]));

const entries = [];
const rows = [];
const skipped = [];

for (const coll of ['feats', 'classFeatures', 'heritages']) {
  for (const [id, rec] of Object.entries(core[coll] ?? {})) {
    const text = String(rec.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(RE);
    if (!m) continue;
    const target = byName.get(norm(m[1]));
    if (!target) {
      skipped.push(`${coll}/${id}: "${m[1].trim()}" is not a shipped class feature`);
      continue;
    }
    // A record granting ITSELF is the class's own feature list describing what it is, not a grant.
    if (target === id) {
      skipped.push(`${coll}/${id}: names itself — that is a description, not a grant`);
      continue;
    }
    const value = [target];
    rec.grantsClassFeatures = value;
    entries.push({ category: coll, id, field: 'grantsClassFeatures', value });
    rows.push(`${coll}/${id} -> ${target}`);
  }
}

if (skipped.length) console.warn(`SKIPPED (${skipped.length}):\n  ` + skipped.join('\n  '));
if (!entries.length) {
  console.error('nothing resolved — refusing to write.');
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`\nwrote ${entries.length} records (backfill ${backfill.length} -> ${next.length})`);
for (const r of rows) console.log('  ' + r);
