/*
 * WHICH RECORDS PRINT AN ALWAYS-PRESENT FAMILIAR ABILITY, AND WHETHER THE GRANT TABLE AGREES.
 *
 *   npm run scan:companion-locks            # the counts
 *   npm run scan:companion-locks -- --list  # every record, both ways
 *
 * A companion-granting record may name an ability the familiar ALWAYS has. The printed clause then
 * says one of two opposite things about the ability budget, and the app models the difference with
 * `CompanionGrant.lockedFree`:
 *
 *   FREE   "doesn't count against your usual limit of familiar abilities (typically 2)"  (Alchemical
 *          Familiar), "in addition to the two abilities you normally choose" (Friend of the Sea),
 *          "Instead of the normal choice of pet abilities" (Elver Pet)
 *          → the record's ability. `deriveFamiliar` grants it (`fromFeat`); it costs no slot and the
 *            player cannot toggle it off.
 *
 *   COUNTS "which counts against your limit for familiar and master abilities as normal" (Corgi
 *          Mount), "the speech ability counts against your familiar's abilities each day"
 *          (Psychopomp Familiar), "one of them must always be the Dragon familiar ability"
 *          (Draconic Familiar)
 *          → one of the PLAYER's picks, seeded for them. It spends a slot, as printed.
 *
 * Getting this backwards is not cosmetic: a Corgi Mount owner treated as FREE can pick two more
 * abilities and end with three where the rules give two.
 *
 * ⚠ ANCHORED ON THE OUTCOME AND SCOPED TO THE SENTENCE. Matching the phrases alone over the whole
 * corpus finds 18 records, ten of which are about property runes, invested items, the multiple attack
 * penalty and squadmates. The clause only counts when the SENTENCE it sits in is about a familiar or a
 * pet, which is what this scanner requires. Checked against records already known correct: the ten
 * unrelated ones must not appear, and they do not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

const COLLECTIONS = ['feats', 'classFeatures', 'heritages'];
const textOf = (coll, id) =>
  String(core[coll]?.[id]?.description ?? desc[coll]?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

const FREE = /(doesn'?t count against|does not count against|in addition to the (?:two|three|four)|instead of the normal choice)/i;
const COUNTS = /(counts? against your (?:usual )?limit|counts? against your familiar'?s abilities|must always be|must always have|one of (?:them|its abilities) must always)/i;
/** The sentence a match sits in — the clause only binds when that sentence is about a familiar/pet. */
const sentenceAt = (t, at) => {
  const start = t.lastIndexOf('.', at) + 1;
  const end = t.indexOf('.', at);
  return t.slice(start, end < 0 ? t.length : end + 1).trim();
};
const ABOUT_A_FAMILIAR = /familiar|\bpet\b/i;

/**
 * EXEMPT — a printed clause the grant table genuinely cannot express today, each with the blocker.
 * An exemption is a promise that the record was READ, not a way to make the count zero: the scanner
 * still fails if an exempt record's stated blocker stops being true.
 */
const EXEMPT = {
  'leshy-familiar': {
    why: 'the free ability is a CHOICE — "which has your choice of either the plant or fungus familiar ability". `lockedAbilities` is a fixed list, so authoring one of the two would pick for the player and authoring both would grant two abilities where the book gives one. Needs a lockedFromChoice lane (the ids `plant` and `fungus` both exist).',
    blockerStillTrue: () => !!core.familiarAbilities?.plant && !!core.familiarAbilities?.fungus && !FEAT_COMPANION_GRANTS['leshy-familiar']?.lockedAbilities,
  },
  'marine-ally': {
    why: 'a CHOICE, and one of its two printed options has no ability id at all — "one of its abilities must always be a swim Speed or the amphibious familiar ability". There is no swim-Speed entry in content.familiarAbilities, so half the clause is unrepresentable and picking `amphibious` for the player would over-constrain them.',
    blockerStillTrue: () => !core.familiarAbilities?.swimmer && !core.familiarAbilities?.['swim-speed'],
  },
};

/**
 * A record whose locked-ability clause is printed on a DIFFERENT record — the one it grants. Spore
 * Order: *"You also gain the Leshy Familiar druid feat, but you must create a fungus leshy"*, so its
 * `fungus` is Leshy Familiar's free plant-or-fungus ability with the choice already made. Enhanced
 * Psychopomp Familiar's `speech` is Psychopomp Familiar's, which counts. Without this the scanner
 * reads a record's OWN text only and both are invisible to it.
 */
const INHERITED = { 'spore-order': 'leshy-familiar', 'enhanced-psychopomp-familiar': 'psychopomp-familiar' };

/**
 * EXPORTED so the guard test and any future applier use this detector rather than a copy of it.
 * `grants` is injectable so a test can prove the detector DISCRIMINATES by feeding it a table it
 * should reject — a scanner nobody has seen fail is not evidence of anything.
 */
export function audit(grants = FEAT_COMPANION_GRANTS) {
  const rows = [];
  const ids = new Map();
  for (const coll of COLLECTIONS) for (const id of Object.keys(core[coll] ?? {})) if (!ids.has(id)) ids.set(id, coll);
  for (const [id, src] of Object.entries(INHERITED)) if (ids.has(src) && !ids.has(id)) ids.set(id, 'feats');
  {
    for (const [id, coll] of ids) {
      // A record's OWN text decides first; only when it prints no clause does an inherited one apply,
      // so a record that says something different from the feat it grants is never overruled by it.
      const classify = (t) => {
        const mFree = FREE.exec(t);
        const mCounts = COUNTS.exec(t);
        return {
          free: !!(mFree && ABOUT_A_FAMILIAR.test(sentenceAt(t, mFree.index))),
          counts: !!(mCounts && ABOUT_A_FAMILIAR.test(sentenceAt(t, mCounts.index))),
        };
      };
      let { free, counts } = classify(textOf(coll, id));
      let inherited = null;
      if (!free && !counts && INHERITED[id]) {
        ({ free, counts } = classify(textOf('feats', INHERITED[id]) || textOf('classFeatures', INHERITED[id])));
        if (free || counts) inherited = INHERITED[id];
      }
      if (!free && !counts) continue;
      const grant = grants[id];
      const exempt = EXEMPT[id];
      const locked = grant?.lockedAbilities ?? [];
      const problems = [];
      if (!grant) problems.push('prints an always-present familiar ability but has no FEAT_COMPANION_GRANTS entry');
      else if (exempt) {
        if (!exempt.blockerStillTrue()) problems.push(`EXEMPTION IS STALE — ${exempt.why}`);
      } else if (!locked.length) problems.push('prints an always-present familiar ability and `lockedAbilities` is empty — the ability is missing from the stat block');
      // "free" and "counts" can BOTH match: Alchemical Familiar prints the waiver of Construct's own
      // Tough requirement in the same paragraph as the budget clause. FREE wins, because the budget
      // sentence is the one that decides the lane.
      else if (free && !grant.lockedFree) problems.push('prints that the ability does NOT count against the budget, but `lockedFree` is unset — the player is charged a slot the book gives free');
      else if (!free && counts && grant.lockedFree) problems.push('prints that the ability COUNTS against the budget, but `lockedFree` is set — the player can take one ability more than the rules allow');
      rows.push({ coll, id, free, counts, inherited, hasGrant: !!grant, locked, lockedFree: !!grant?.lockedFree, exempt: !!exempt, problems });
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// Run-as-a-script detection, not `import.meta.url === process.argv[1]`: jiti rewrites argv[1] to its
// own loader, so that comparison is false when the scanner is run the documented way and the script
// prints nothing at all. Measured — the first version of this file was silent under `npx jiti`.
const RUN_DIRECTLY = process.argv.some((a) => a.replace(/\\/g, '/').endsWith('scripts/scan-companion-locks.mjs'));
if (RUN_DIRECTLY) {
  const rows = audit();
  const bad = rows.filter((r) => r.problems.length);
  console.log(`records printing an always-present familiar/pet ability: ${rows.length}`);
  console.log(`  free (record's, costs no slot)   : ${rows.filter((r) => r.free && !r.exempt).length}`);
  console.log(`  counts (one of the player's picks): ${rows.filter((r) => !r.free && r.counts && !r.exempt).length}`);
  console.log(`  exempt (blocker recorded)         : ${rows.filter((r) => r.exempt).length}`);
  console.log(`  DEFECTS                           : ${bad.length}`);
  if (LIST || bad.length) {
    for (const r of rows) {
      const tag = r.exempt ? 'EXEMPT' : r.free ? 'FREE  ' : 'COUNTS';
      const line = `  ${tag} ${r.coll}/${r.id}  locked=[${r.locked.join(',')}]${r.lockedFree ? ' lockedFree' : ''}${r.inherited ? ` (clause printed on ${r.inherited})` : ''}`;
      if (LIST || r.problems.length) console.log(line);
      for (const p of r.problems) console.log('         ⚠ ' + p);
    }
  }
  if (bad.length) process.exitCode = 1;
}
