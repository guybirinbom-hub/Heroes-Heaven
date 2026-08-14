/*
 * WHICH PICKERS OFFER THE SAME FEAT TWICE.
 *
 *   npx jiti scripts/scan-duplicate-feats.mjs           # the count
 *   npx jiti scripts/scan-duplicate-feats.mjs --list    # every group, and where it collides
 *
 * The batch-001 audit found ONE of these by reading one feat: `animal-empathy` and
 * `animal-empathy-druid` are two imports of AoN document feat-4709, and a level-1 druid's class-feat
 * picker listed "Animal Empathy" twice. The shape recurs, so the rest is a scan.
 *
 * ⚠ MEASURED ON THE OUTCOME, NOT THE CONDITION. "Two records share an aonId" is the condition and it
 * matches 113 groups, most of them legitimate: `tusks` / `tusks-orc` / `tusks-half-orc` are scoped to
 * different ancestries and never meet, `counterspell-prepared` / `counterspell-spontaneous` to
 * different classes. The OUTCOME is "one real picker offers two of them", and that is what this asks —
 * by running the app's own `eligibleFeatsForSlot` over every (category × class) and (ancestry) combo,
 * with the duplicate suppression the app already computes. 113 groups → 51 with more than one visible
 * member → 40 that actually collide.
 *
 * ⚠⚠ THERE IS NO SAFE BLANKET RULE, AND TWO MEASUREMENTS SAY SO. Do not turn this list into a sweep.
 *
 *   1. THE MIRROR CARRIES THE MISSPELLING in at least four groups. `feat-3603` is titled "Repulse the
 *      Wicken" in the AoN mirror itself, and so are "Camoflage Coat" (feat-5337), "Certain Strategem"
 *      (feat-5941) and "Exemplar Resilency" (feat-7228). A "keep whichever name matches the mirror"
 *      rule would delete the CORRECTLY spelled record in every one of them.
 *   2. A PARENTHETICAL TWIN CAN BE A DIFFERENT DOCUMENT. `feat-4708`'s mirror name is "Animal
 *      Companion", and the app also has "Animal Companion (Ranger)" stamped with that same id — AoN
 *      publishes those as separate feats and the stamp collapsed them. Hiding one would remove a real
 *      feat from a real picker.
 *
 * So each group has to be READ. Settle one, add it to `NEAR_DUPLICATE_IDS` in src/data/index.ts with
 * the evidence in a comment, and this count goes down. `test/batch001-surfaces.test.tsx` ratchets it:
 * the number may only fall.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { eligibleFeatsForSlot } from '../src/rules/featSlots.ts';
import { content } from '../test/_content.ts';

const CATS = ['class', 'ancestry', 'general', 'skill', 'archetype'];

/**
 * EXEMPT — groups examined and ruled NOT a defect, each with the reason. Keyed by aonId so a rename
 * cannot silently drop one out of the exemption.
 *
 * Empty today: every one of the 40 still needs reading. It exists so that settling a group as
 * "these really are two different feats" has somewhere to go that is not a deletion.
 */
export const EXEMPT = {};

let cached = null;

/**
 * EXPORTED so the guard test uses this detector rather than a copy of it.
 *
 * Each (category × class/ancestry) picker is resolved ONCE and every candidate group is checked
 * against that one result — not once per group, which is the same answer for 50× the work (8,058
 * `eligibleFeatsForSlot` calls instead of 162, and a test that timed out at 5 s). Memoised because
 * `content()` is itself cached and nothing here mutates it.
 */
export function audit() {
  if (cached) return cached;
  const db = content();
  const classes = Object.keys(db.classes);
  const ancestries = Object.keys(db.ancestries);

  const byAon = new Map();
  for (const [id, f] of Object.entries(db.feats)) {
    if (!f.aonId || db.duplicateIds?.has(id)) continue;
    if (!byAon.has(f.aonId)) byAon.set(f.aonId, []);
    byAon.get(f.aonId).push(id);
  }
  /** featId -> its aonId, for the groups that COULD collide (2+ visible members). */
  const candidate = new Map();
  for (const [aonId, ids] of byAon) if (ids.length > 1) for (const id of ids) candidate.set(id, aonId);

  const where = new Map(); // aonId -> [{cat, who, ids}]
  for (const cat of CATS) {
    const combos =
      cat === 'ancestry'
        ? ancestries.map((a) => ({ ancestryId: a, classId: 'fighter' }))
        : classes.map((cl) => ({ classId: cl, ancestryId: 'human' }));
    for (const base of combos) {
      const offered = eligibleFeatsForSlot({ ...base, level: 20, featPicks: {}, featChoices: {} }, db, {
        level: 20,
        category: cat,
        idx: 0,
      });
      const seen = new Map(); // aonId -> ids offered together in THIS picker
      for (const f of offered) {
        const aonId = candidate.get(f.id);
        if (!aonId) continue;
        seen.set(aonId, (seen.get(aonId) ?? []).concat(f.id));
      }
      for (const [aonId, ids] of seen) {
        if (ids.length < 2) continue;
        if (!where.has(aonId)) where.set(aonId, []);
        where.get(aonId).push({ cat, who: cat === 'ancestry' ? base.ancestryId : base.classId, ids });
      }
    }
  }

  const groups = [];
  const exempt = [];
  for (const [aonId, hits] of where) {
    const row = { aonId, ids: [...new Set(hits.flatMap((w) => w.ids))], names: {}, slots: hits.length, sample: hits[0] };
    for (const id of row.ids) row.names[id] = db.feats[id].name;
    if (EXEMPT[aonId]) exempt.push({ ...row, why: EXEMPT[aonId] });
    else groups.push(row);
  }
  cached = { groups, exempt, visiblePairs: [...byAon.values()].filter((v) => v.length > 1).length };
  return cached;
}

// `import.meta.url === process.argv[1]` does NOT detect a direct run under jiti — match the paths.
const isDirect = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  const LIST = process.argv.includes('--list');
  const { groups, exempt, visiblePairs } = audit();
  console.log(`aonId groups with more than one VISIBLE feat   ${visiblePairs}`);
  console.log(`  …that a REAL picker offers together          ${groups.length}   <- one feat, listed twice`);
  if (exempt.length) console.log(`  …examined and exempted                       ${exempt.length}`);
  for (const g of exempt) console.log(`     ${g.aonId}: ${g.ids.join(' + ')} — ${g.why}`);

  const rows = LIST ? groups : groups.slice(0, 8);
  console.log('');
  for (const g of rows) {
    console.log(`  ${g.aonId}  ${g.ids.map((i) => `${i} ("${g.names[i]}")`).join('  |  ')}`);
    console.log(`      e.g. a ${g.sample.cat} slot for ${g.sample.who} (${g.slots} slot combinations)`);
  }
  if (!LIST && groups.length > rows.length) console.log(`  …and ${groups.length - rows.length} more — --list for all of them.`);
  console.log('\nSettle one by adding its loser to NEAR_DUPLICATE_IDS (src/data/index.ts) WITH THE EVIDENCE.');
  console.log('Read the two warnings at the top of this file first: neither name nor mirror settles it on its own.');
}
