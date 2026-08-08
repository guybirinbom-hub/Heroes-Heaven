/*
 * THE FROZEN 500 — the feat sample every audit run reuses.
 *
 * Randomly drawn once, then committed and never redrawn. Re-running this script with the same seed
 * reproduces it exactly; that is the point. A model bake-off is only comparable across runs if every
 * arm sees the same feats, and a later "did the rate drop?" question is only answerable against a
 * fixed set.
 *
 *   npx jiti scripts/feat-audit-sample.mjs            # write scripts/audit/feat-500.json
 *   npx jiti scripts/feat-audit-sample.mjs --check    # verify the committed file still matches
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'scripts/audit/feat-500.json');
const SEED = 20260808;
const N = 500;

const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

const hidden = new Set([...(core.duplicateIds ?? []), ...(core.umbrellaIds ?? [])]);
const textOf = (id) => String(desc.feats?.[id]?.d ?? '');

/* Feats whose printed text states no effect at all — only that you gain unspecified "benefits".
 * Requirement extraction is impossible from them, not merely hard, so they are excluded rather than
 * left to be guessed at. They are NOT forgotten: scripts/audit/feat-text-defects.json is the queue,
 * and each needs its parent archetype's text resolved in before it can be audited. */
const textDefects = new Set(
  JSON.parse(readFileSync(join(root, 'scripts/audit/feat-text-defects.json'), 'utf8')).featIds ?? [],
);

/** A feat a player can actually reach, whose text can actually be read. */
const reachable = ([id, f]) =>
  f?.name && !hidden.has(id) && !id.startsWith('aon-') && f.edition !== 'superseded'
  && textOf(id).trim().length > 0 && !textDefects.has(id);

let s = SEED >>> 0;
const rand = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 4294967296;
};

const pool = Object.entries(core.feats ?? {}).filter(reachable).map(([id]) => id).sort(); // sort → seed alone decides
const picked = [];
const taken = new Set();
while (picked.length < Math.min(N, pool.length)) {
  const i = Math.floor(rand() * pool.length);
  if (taken.has(i)) continue;
  taken.add(i);
  picked.push(pool[i]);
}

const payload = {
  seed: SEED,
  drawn: '2026-08-08',
  population: pool.length,
  note: 'Frozen. Do not redraw — every audit arm and every later re-measurement uses these exact feats.',
  featIds: picked,
};

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) { console.error('MISSING ' + OUT); process.exit(1); }
  const have = JSON.parse(readFileSync(OUT, 'utf8'));
  const same = have.featIds.length === picked.length && have.featIds.every((x, i) => x === picked[i]);
  console.log(same ? `OK — the committed 500 match seed ${SEED}` : 'DRIFT — the committed sample no longer matches the seed');
  process.exit(same ? 0 : 1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(`population ${pool.length} reachable feats -> sampled ${picked.length} (seed ${SEED})`);
console.log(`wrote scripts/audit/feat-500.json`);
