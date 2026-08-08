/*
 * A STRATIFIED RANDOM SAMPLE of player-facing records, for estimating the residual defect rate.
 *
 * Every standing check reports zero, but they all share two blind spots: they compare fields the
 * mirror carries structurally, and the triage detects lanes by regex over a record's text. Neither
 * can see a record whose PROSE promises something the engine does not do.
 *
 * The only honest way to decide whether a larger audit is worth paying for is to measure the hit
 * rate on a sample first. This draws one, reproducibly — the shuffle is seeded, so the same sample
 * comes back on a re-run and a later pass can be compared against this one.
 *
 *   node scripts/audit-sample.mjs --n 120 --seed 20260807 --out work/audit-sample.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const N = Number(arg('n', 120));
const SEED = Number(arg('seed', 20260807));
const OUT = arg('out', null);

const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const text = (c, id) =>
  String((desc[c] ?? {})[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* Deterministic PRNG — Math.random would make the sample impossible to re-draw or audit. */
let s = SEED >>> 0;
const rand = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 4294967296;
};
const shuffle = (a) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Only records a player can actually reach — a hidden one cannot be a live defect. */
const hidden = new Set([...(db.duplicateIds ?? []), ...(db.umbrellaIds ?? [])]);
const REACHABLE = (coll, id, rec) => {
  if (!rec?.name || hidden.has(id) || id.startsWith('aon-')) return false;
  if (rec.edition === 'superseded') return false;
  return text(coll, id).length > 120; // a record with no real prose has nothing to promise
};

/* Proportional strata, so the sample mirrors the corpus rather than over-weighting a small bucket. */
const STRATA = ['feats', 'items', 'classFeatures', 'spells', 'heritages', 'backgrounds'];
const pools = {};
let total = 0;
for (const coll of STRATA) {
  pools[coll] = Object.entries(db[coll] ?? {}).filter(([id, rec]) => REACHABLE(coll, id, rec)).map(([id]) => id);
  total += pools[coll].length;
}

const sample = [];
for (const coll of STRATA) {
  const want = Math.max(4, Math.round((pools[coll].length / total) * N));
  for (const id of shuffle(pools[coll]).slice(0, want)) {
    const rec = db[coll][id];
    // Everything the engine could be storing for this record, so a reviewer compares like with like.
    const fields = Object.fromEntries(
      Object.entries(rec).filter(([k]) => !['description', 'descRefs', 'name', 'id', 'source'].includes(k)),
    );
    sample.push({ collection: coll, id, name: rec.name, level: rec.level ?? rec.rank ?? null, fields, text: text(coll, id) });
  }
}

console.log(`reachable population: ${total}`);
for (const coll of STRATA) console.log(`   ${coll.padEnd(15)} ${String(pools[coll].length).padStart(5)}  ->  ${sample.filter((x) => x.collection === coll).length} sampled`);
console.log(`sample: ${sample.length} (seed ${SEED})`);
if (OUT) {
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, OUT), JSON.stringify(sample, null, 1));
  console.log(`wrote ${OUT}`);
}
