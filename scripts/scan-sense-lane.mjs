/*
 * TWO WAYS THE SENSE LANE IS AUTHORED WRONG, OVER THE WHOLE CORPUS.
 *
 *   node scripts/scan-sense-lane.mjs           # the counts
 *   node scripts/scan-sense-lane.mjs --list    # every record, both shapes
 *
 * The batch-001 audit named two records. Both turned out to be instances of a SHAPE, and the shape is
 * a scan. Anchored on the OUTCOME each time — what the character ends up with — never on the wording
 * of the clause, because the wording is the half that varies.
 *
 * ── SHAPE 1 · a `conditionalSenses` row the record's own flat `senses` row satisfies ─────────────
 *
 * "You gain low-light vision, or you gain darkvision if your ancestry already has low-light vision."
 * is modelled as `conditionalSenses: [{ ifPresent: 'low-light-vision', base: …, upgraded: … }]`, and
 * derive.ts evaluates `ifPresent` against the senses gathered SO FAR (derive.ts ~2143). A flat
 * `senses: [{ name: 'low-light-vision' }]` on the SAME record is gathered first — so the feat
 * satisfies its own condition and every character takes the `upgraded` branch. A human with Ember's
 * Eyes was handed darkvision at 1st level.
 *
 * The `base` branch already grants the unconditional half, so the flat row is not merely redundant:
 * it is the bug. The correct authoring is `conditionalSenses` ALONE — which is exactly what the two
 * records nobody had touched (`aquatic-eyes` after this pass, `stargazers-eyes`) look like. Those two
 * are this detector's control: it must NOT flag them.
 *
 * ── SHAPE 2 · a printed clause modelled AS a sense ───────────────────────────────────────────────
 *
 * `SenseEntry.name` is a sense selector — "darkvision", "scent", "tremorsense". Ash-piercing Gaze had
 * `senses: [{ name: 'ignores concealment from smoke and mist' }]`, which put a sentence on the Senses
 * row of the sheet and claimed a perception capability the feat does not grant (the creature stays
 * concealed; only the flat check to target it auto-succeeds). Those clauses belong in the situational
 * registry on the Strike row, the shape `firesight` has always used.
 *
 * The player-facing record buckets are held at ZERO. `items` carries ten more, each a genuine judgement
 * call about a capability with no better surface ("see into the Ethereal Plane"), so that bucket is a
 * RATCHET: the count may go down and never up.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** derive.ts's own normaliser (derive.ts, the `norm` beside conditionalSenses), copied deliberately:
 *  if that one changes, this scan must be re-derived from it rather than silently keep agreeing. */
export const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '-').replace(/-vision$/, '');

/**
 * Every sense SELECTOR the corpus uses, normalised. Measured, not invented — this is the census of
 * `senses[].name` across public/core.json minus the prose entries listed in SHAPE 2.
 */
export const KNOWN_SENSES = new Set(
  [
    'normal',
    'low-light-vision',
    'darkvision',
    'greater-darkvision',
    'truesight',
    'scent',
    'tremorsense',
    'wavesense',
    'lifesense',
    'deathsense',
    'spiritsense',
    'magicsense',
    'thoughtsense',
    'bloodsense',
    'motion-sense',
    'echolocation',
    'apparition-sight',
    'see-invisibility',
    // A named creature ability, not a sentence: it has a range the automaton Enhancement tier
    // extends from touch to 10 feet, and a SENSE_GLOSSARY entry so the pill reads properly.
    'touch-telepathy',
  ].map(norm),
);

/** Buckets whose records reach deriveDefenses as the PLAYER's own senses. `animalCompanions` is
 *  excluded on purpose: its `senses` are plain strings and never pass through deriveDefenses. */
const PLAYER_BUCKETS = ['feats', 'heritages', 'classFeatures', 'ancestries', 'backgrounds', 'archetype'];
const RATCHET_BUCKETS = ['items'];

/** The item bucket's accepted backlog. May only shrink — see the guard test. */
export const ITEM_PROSE_RATCHET = 10;

const senseNames = (rec) =>
  (Array.isArray(rec?.senses) ? rec.senses : []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);

/** Walk one record for `senses` arrays wherever they hide — top level, passiveEffects, whileActive,
 *  modes, effectChoices[].options[].grant. A shallow read once called two records empty. */
function everySenseList(rec, at, out) {
  if (!rec || typeof rec !== 'object') return;
  if (Array.isArray(rec)) {
    rec.forEach((x, i) => everySenseList(x, `${at}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'senses') {
      for (const n of senseNames({ senses: v })) out.push({ at, name: n });
    } else if (v && typeof v === 'object') {
      everySenseList(v, at === '' ? k : `${at}.${k}`, out);
    }
  }
}

export function audit() {
  const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
  const selfSatisfying = [];
  const prose = { player: [], ratchet: [] };

  for (const bucket of [...PLAYER_BUCKETS, ...RATCHET_BUCKETS]) {
    for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
      if (!rec || typeof rec !== 'object') continue;

      // SHAPE 1 — only the record's own TOP-LEVEL senses/conditionalSenses can collide, because that
      // is the pair derive.ts evaluates against each other (`src.senses` then `src.conditionalSenses`).
      const flat = senseNames(rec).map(norm);
      for (const cs of rec.conditionalSenses ?? []) {
        if (flat.includes(norm(cs.ifPresent))) {
          selfSatisfying.push({ bucket, id, ifPresent: cs.ifPresent, upgraded: cs.upgraded?.name, flat });
        }
      }

      // SHAPE 2 — any sense name that is not a selector.
      const found = [];
      everySenseList(rec, '', found);
      for (const f of found) {
        if (KNOWN_SENSES.has(norm(f.name))) continue;
        (PLAYER_BUCKETS.includes(bucket) ? prose.player : prose.ratchet).push({ bucket, id, at: f.at, name: f.name });
      }
    }
  }
  return { selfSatisfying, prose };
}

if (process.argv[1] && process.argv[1].endsWith('scan-sense-lane.mjs')) {
  const LIST = process.argv.includes('--list');
  const { selfSatisfying, prose } = audit();

  console.log(`SHAPE 1 · conditionalSenses satisfied by the record's own flat senses   ${selfSatisfying.length}`);
  console.log(`           <- every character takes the "upgraded" branch, whatever they already had`);
  for (const r of selfSatisfying) console.log(`     ${r.bucket}/${r.id}   flat ${JSON.stringify(r.flat)}  ifPresent "${r.ifPresent}" -> ${r.upgraded}`);

  console.log(`\nSHAPE 2 · a printed clause modelled as a sense`);
  console.log(`  player records (feats/heritages/classFeatures/…)   ${prose.player.length}   <- must be 0`);
  for (const r of prose.player) console.log(`     ${r.bucket}/${r.id}${r.at ? '.' + r.at : ''}   "${r.name}"`);
  console.log(`  items (accepted backlog, ratchet ${ITEM_PROSE_RATCHET})              ${prose.ratchet.length}`);
  if (LIST) for (const r of prose.ratchet) console.log(`     ${r.bucket}/${r.id}${r.at ? '.' + r.at : ''}   "${r.name}"`);
  else if (prose.ratchet.length) console.log(`     --list to see them`);
}
