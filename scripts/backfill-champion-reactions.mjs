/*
 * A champion's Champion's Reaction — the class's defining ability — was listed nowhere.
 *
 * The cause row's text NAMES the reaction ("**Champion's Reaction** Retributive Strike") and that is
 * all: the reaction is its own class-feature record, in no class feature list, reachable by nothing.
 * Every champion has one and no champion could see it.
 *
 * Each cause hands its reaction over via `SubclassOption.featureIds` — the same lane the oracle's
 * curse and the gunslinger's deeds use, which both derives and (now) displays. The name is PARSED
 * from each cause's own text, so a wording change surfaces here instead of leaving a stale map.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const options = core.classes.champion?.subclass?.options ?? [];
if (!options.length) {
  console.error('The champion has no cause options — nothing to patch.');
  process.exit(1);
}

const entries = [];
const skipped = [];
for (const opt of options) {
  if (opt.featureIds?.length) {
    skipped.push(`${opt.id}: already carries featureIds — left alone`);
    continue;
  }
  const text = String(opt.description ?? '').replace(/\s+/g, ' ');
  const m = text.match(/Champion.{0,3}s Reaction\*{0,2}\s*([A-Z][A-Za-z '\-]{2,40})/);
  if (!m) {
    skipped.push(`${opt.id}: its text names no Champion's Reaction`);
    continue;
  }
  const want = norm(m[1]);
  const hit = Object.entries(core.classFeatures).find(([, f]) => norm(f.name) === want);
  if (!hit) {
    skipped.push(`${opt.id}: "${m[1].trim()}" is not a shipped class feature`);
    continue;
  }
  // The reaction arrives with the cause, at 1st level.
  const value = [{ id: hit[0], level: 1 }];
  opt.featureIds = value;
  entries.push({
    category: 'classes',
    id: 'champion',
    path: ['subclass', 'options', `id=${opt.id}`],
    field: 'featureIds',
    value,
  });
  console.log(`  ${opt.id.padEnd(12)} -> ${hit[0]}`);
}

if (skipped.length) console.warn(`SKIPPED (${skipped.length}):\n  ` + skipped.join('\n  '));
if (entries.length !== options.length) {
  console.error(`only ${entries.length} of ${options.length} causes resolved — refusing to write a partial set.`);
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wired ${entries.length} champion reactions (backfill ${backfill.length} → ${next.length})`);
