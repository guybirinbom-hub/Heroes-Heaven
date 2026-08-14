/**
 * OWNS the innate-and-cantrip-spell-grant records of batch-001.
 *
 *   node scripts/apply-innate-cantrip-lane.mjs --dry     # what it would write
 *   node scripts/apply-innate-cantrip-lane.mjs           # writes core.json + the overlay
 *
 * `npm run feat -- arcane-sense` reported "no authoring script names this record" for every one of
 * these, which is exactly the state the verdict's C1 caught for `ancestral-mind` (whose owner IS
 * `scripts/backfill-entry-retune.mjs`, so `onlySources` is authored THERE, not here). An orphan
 * overlay row holds a value nothing regenerates and nothing explains; this file is the explanation.
 *
 * Every value below is quoted from the record's own printed text in public/core-descriptions.json —
 * the AoN mirror at C:/wonderers guide/aon-2e-archive/data/by-category/ is the ground truth, Foundry
 * is not. Each write is a WHOLE-VALUE replacement, so the script is idempotent for free.
 *
 * ── the lanes ──────────────────────────────────────────────────────────────────────────────────
 *
 * `heightenBySkill`   a heighten ladder keyed to a SKILL PROFICIENCY, not to level. Measured over the
 *                     whole corpus, exactly three records print one and all three carried no heighten
 *                     at all, so the rank never moved when the skill did. It is a FLOOR (build.ts's
 *                     `castRank`): Detect Magic is a cantrip and already auto-heightens.
 * `traditionFromChoiceFlag`
 *                     Bone Magic's Special clause — "this choice applies to all innate spells you
 *                     gain from lizardfolk ancestry feats that have Bone Magic as a prerequisite".
 *                     Measured: exactly two feats have that prerequisite.
 * `spellNotes.fromCantripPick`
 *                     a clause about the spell the player PICKED, whose identity no `spellId` can
 *                     name (Awakened Jewel's head gem).
 * `from.grantToClassEntry` / `from.excludeOwnTraditions`
 *                     Adapted Cantrip: the pick joins the class pool, and the picker stops offering
 *                     the tradition the character already casts in.
 * `from.type: 'own-deity-spell'`
 *                     Blessed Blood: "add UP TO THREE of your deity's spells". Twelve deities grant
 *                     nine, and the app was handing over all nine.
 *                     ⚠ The `own-` PREFIX is load-bearing, not cosmetic: two shipped guards
 *                     (test/choice-lane-applied.test.ts:42, test/multi-pick-choices.test.ts:55) skip
 *                     `own-*` and otherwise require an open choice to resolve a NON-EMPTY list with
 *                     no character, which a deity-scoped pool cannot. This lane once shipped the
 *                     resolver as `own-deity-spell` and the DATA as `deity-spell`, which took both
 *                     guards red and left the picker permanently empty — the reason `npm run
 *                     scan:choice-types` and test/open-choice-types.test.ts now exist.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const raw = readFileSync(p('public/core.json'), 'utf8');
const core = JSON.parse(raw);
/* A full parse→stringify of the 9.8 MB minified core.json must be byte-identical, or this script is
 * silently reformatting the file it was only meant to edit. Asserted, not assumed. */
if (JSON.stringify(core) !== raw) {
  console.error('public/core.json does not round-trip through JSON.parse/stringify — REFUSING to rewrite it.');
  process.exit(1);
}

/* "You cast the 3-action version of heal, heightened to a rank one lower than half your level rounded
 * up." (ceil(level/2)) − 1, as explicit steps, with Heal's own rank 1 as the base below 5th. */
const godclawHealLadder = [];
for (let lvl = 2; lvl <= 20; lvl++) {
  const rank = Math.ceil(lvl / 2) - 1;
  if (rank >= 2 && !godclawHealLadder.some((s) => s.rank === rank)) godclawHealLadder.push({ level: lvl, rank });
}

const WRITES = {
  // "You can cast 1st-rank Detect Magic at will as an arcane innate spell. If you're a master in
  //  Arcana, the spell is heightened to 3rd rank; if you're legendary, it is heightened to 4th rank."
  'feats/arcane-sense': {
    innateSpells: [
      {
        spellId: 'detect-magic',
        tradition: 'arcane',
        atWill: true,
        rank: 1,
        heightenBySkill: [
          { skill: 'arcana', rank: 'master', spellRank: 3 },
          { skill: 'arcana', rank: 'legendary', spellRank: 4 },
        ],
      },
    ],
  },
  // "You gain See the Unseen and Spirit Link as 2nd-rank divine innate spells… If you're a master in
  //  Religion, *spirit link* is heightened to 3rd rank. If you're legendary in Religion, *spirit link*
  //  is heightened to 4th rank."  ⚠ ONLY spirit link — see the unseen deliberately gets no ladder.
  'feats/rivethun-devotion': {
    innateSpells: [
      { spellId: 'see-the-unseen', tradition: 'divine', rank: 2, usesPerDay: 1 },
      {
        spellId: 'spirit-link',
        tradition: 'divine',
        rank: 2,
        usesPerDay: 1,
        heightenBySkill: [
          { skill: 'religion', rank: 'master', spellRank: 3 },
          { skill: 'religion', rank: 'legendary', spellRank: 4 },
        ],
      },
    ],
  },
  // "If you're legendary in Religion, *spiritual guardian* is heightened to 7th rank."
  'feats/rivethun-adept': {
    innateSpells: [
      { spellId: 'speak-with-stones', tradition: 'divine', rank: 5, usesPerDay: 1 },
      {
        spellId: 'spiritual-guardian',
        tradition: 'divine',
        rank: 5,
        usesPerDay: 1,
        heightenBySkill: [{ skill: 'religion', rank: 'legendary', spellRank: 7 }],
      },
    ],
  },
  // "You can cast Mindlink as an innate occult spell once per day, but you can target only aberrations."
  // The innate half was already right; the restriction had nowhere to live. Same shape as
  // azarketi-purification's, which is the sibling row this wording follows.
  'feats/aberration-kinship': {
    spellNotes: [{ spellId: 'mindlink', note: 'When you cast Mindlink from this feat, you can target only aberrations.' }],
  },
  // "You cast the 3-action version of Heal, heightened to a rank one lower than half your level
  //  rounded up. You can select up to five creatures in the area to remain unaffected by the spell.
  //  You can instead use this ability to bring a creature within 30 feet that has died within the last
  //  round back from the dead. If you do, the creature is restored to 1 Hit Point and is Doomed 1."
  // The rank is the whole point of the ability and was printed nowhere.
  'feats/blessing-of-the-five': {
    innateSpells: [{ spellId: 'heal', tradition: 'divine', rank: 1, usesPerDay: 1, heightenAt: godclawHealLadder }],
    spellNotes: [
      {
        spellId: 'heal',
        note:
          'Blessing of the Five casts the 3-action version of Heal, heightened to a rank one lower than half your level rounded up. ' +
          'You can select up to five creatures in the area to remain unaffected by the spell. You can instead spend the daily use to ' +
          'bring a creature within 30 feet that has died within the last round back from the dead; it is restored to 1 Hit Point and is doomed 1.',
      },
    ],
  },
  // "You can cast Dinosaur Form on yourself as a 5th-rank innate spell once per day." — no tradition
  // printed, because Bone Magic's Special clause decides it. `tradition` stays as the unanswered
  // fallback so a lizardfolk mid-build does not lose the grant.
  'feats/bone-investiture': {
    innateSpells: [{ spellId: 'dinosaur-form', tradition: 'primal', traditionFromChoiceFlag: 'boneMagicTradition', rank: 5, usesPerDay: 1 }],
  },
  // "You can cast Mask of Terror on yourself as an innate spell once per day." The second feat with
  // Bone Magic as a prerequisite, and the one the spec measured and left out: its grant named no
  // tradition at all, so the pooled entry fell back to Mask of Terror's first — ARCANE, which Bone
  // Magic's own sentence forbids ("primal or occult").
  'feats/fossil-rider': {
    innateSpells: [{ spellId: 'mask-of-terror', tradition: 'primal', traditionFromChoiceFlag: 'boneMagicTradition', usesPerDay: 1 }],
  },
  // "**Special** Choose when you gain this feat whether your innate spells are primal or occult; this
  //  choice applies to all innate spells you gain from lizardfolk ancestry feats that have Bone Magic
  //  as a prerequisite." The clause was never asked.
  'feats/bone-magic': {
    choice: {
      flag: 'boneMagicTradition',
      prompt: 'Bone Magic — are your innate spells primal or occult?',
      kind: 'array',
      options: [
        { value: 'primal', label: 'Primal' },
        { value: 'occult', label: 'Occult' },
      ],
      note: 'Your answer sets the tradition of the cantrip you pick for Bone Magic and of every innate spell from a lizardfolk ancestry feat that has Bone Magic as a prerequisite (Bone Investiture, Fossil Rider).',
    },
  },
  // "Add up to three of your deity's spells (spells your deity grants to clerics) to your spell list."
  // 460 deities grant exactly three (so nothing changes for them); twelve grant more, nine of them
  // NINE, and a Nethys sorcerer was handed all nine. WHICH three is the player's — the 9th-rank spell
  // is the whole point at 19th level, and "the first three" would be our ruling dressed as the book's.
  'feats/blessed-blood-sorcerer': {
    // ⚠ The old note said "Pick a deity in Setup", and there was no such control: the deity card was
    // gated on `buildNeedsDeity`, a class/subclass question a sorcerer never answers yes to. It renders
    // on the level-0 Identity card now (`buildUsesDeity`), so the note points at where it actually is.
    note: "Up to three of your deity's cleric spells join your spell list — you still spend a repertoire slot to learn one. Pick your deity on the level 0 page if you have not.",
    choice: {
      flag: 'blessedBloodDeitySpells',
      prompt: 'Deity spell added to your spell list',
      kind: 'open',
      picks: 3,
      distinct: true,
      from: { type: 'own-deity-spell' },
      note: 'Up to three. A deity granting exactly three adds all three whether or not you answer; a deity granting more (Nethys, Nalinivati, Abraxas, Yuelral, Isis, Zeaki and the three Nyarlathotep entries each grant nine) adds only the ones picked here.',
    },
  },
  // "Choose one cantrip from a magical tradition other than your own… If you have a spell repertoire,
  //  replace one of your cantrips known with the chosen spell. You can cast this cantrip as a spell of
  //  your class's tradition."
  //
  // `spellSlotBonus: { cantrips: -1 }` is the REPLACEMENT half, and it is not decoration: the builder's
  // cantrip cap and build.ts's class-entry slice both already read that field, so the player picks one
  // fewer and the granted cantrip takes its place. Without it the feat would hand a spontaneous caster
  // cantripsKnown + 1 — strictly better than the printed rule.
  'feats/adapted-cantrip': {
    spellSlotBonus: { cantrips: -1 },
    choice: {
      flag: 'adaptedCantrip',
      prompt: 'Adapted cantrip',
      kind: 'open',
      from: { type: 'spell', cantripsOnly: true, excludeOwnTraditions: true, grantToClassEntry: true },
      note: "Cast as a spell of your class's tradition, from your class's own pool, spell attack and DC. It REPLACES one of your cantrips known, so your class cantrip budget is one lower — pick the cantrip you are giving up by simply not choosing it.",
    },
  },
  // "You gain one cantrip from the occult spell list. **As long as you possess your head gem**, you can
  //  cast this spell as an innate spell at will." The condition is on a spell whose identity is the
  //  player's answer, so it rides on `fromCantripPick` rather than on a spellId.
  'feats/awakened-jewel': {
    // ⚠ No `spellId` — the spell IS the answer, and a placeholder id would be a lie the
    // "a note only ever names a spell the record grants" guard correctly rejects.
    spellNotes: [
      {
        fromCantripPick: true,
        note: 'You can cast this cantrip as an innate spell at will only as long as you possess your head gem.',
      },
    ],
  },
};

/* Nothing here may name a spell that does not ship — a typo grants and annotates nothing, silently. */
const problems = [];
const catOf = (k) => k.slice(0, k.indexOf('/'));
const idOf = (k) => k.slice(k.indexOf('/') + 1);
const RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
/* Which records HAVE a pick-a-cantrip picker — read out of the registry itself rather than listed
 * here, so a `fromCantripPick` note can never be authored onto a record that asks nothing. */
const cantripPickIds = new Set(
  [...readFileSync(p('src/rules/featCantripGrants.ts'), 'utf8').matchAll(/^ {2}'([^']+)': \{ prompt:/gm)].map((m) => m[1]),
);
if (cantripPickIds.size < 40) {
  console.error(`only ${cantripPickIds.size} FEAT_CANTRIP_GRANTS entries parsed — the registry's shape changed, REFUSING to write.`);
  process.exit(1);
}
for (const [key, fields] of Object.entries(WRITES)) {
  const rec = core[catOf(key)]?.[idOf(key)];
  if (!rec) {
    problems.push(`${key} is not in core.json`);
    continue;
  }
  for (const g of fields.innateSpells ?? []) {
    if (!core.spells[g.spellId]) problems.push(`${key} → grants missing spell ${g.spellId}`);
    for (const h of g.heightenBySkill ?? []) {
      if (!RANKS.includes(h.rank)) problems.push(`${key} → heightenBySkill rank "${h.rank}" is not a proficiency rank`);
      if (!(h.spellRank >= 1 && h.spellRank <= 10)) problems.push(`${key} → heightenBySkill spellRank ${h.spellRank} out of range`);
    }
  }
  for (const n of fields.spellNotes ?? []) {
    // A pick-driven clause names no spell (its spell is the player's answer) but it MUST have a
    // pick to attach to, or it renders nowhere at all.
    if (n.fromCantripPick) {
      if (!cantripPickIds.has(idOf(key))) problems.push(`${key} → fromCantripPick note on a record with no FEAT_CANTRIP_GRANTS entry`);
      if (n.spellId) problems.push(`${key} → fromCantripPick note also names a spellId, which is ignored`);
      continue;
    }
    if (!core.spells[n.spellId]) problems.push(`${key} → note on missing spell ${n.spellId}`);
  }
}
/* The Special clause's SCOPE is measured, not assumed: it governs every lizardfolk feat with Bone
 * Magic as a prerequisite. If content ever adds a third, this refuses rather than quietly under-cover. */
const boneKin = Object.entries(core.feats)
  .filter(([, f]) => (f.prerequisites ?? []).some((x) => /bone magic/i.test(String(x))))
  .map(([id]) => id)
  .sort();
const boneAuthored = Object.keys(WRITES)
  .filter((k) => WRITES[k].innateSpells?.some((g) => g.traditionFromChoiceFlag === 'boneMagicTradition'))
  .map(idOf)
  .sort();
if (boneKin.join() !== boneAuthored.join())
  problems.push(`Bone Magic's Special clause covers [${boneKin.join(', ')}] but this script authors [${boneAuthored.join(', ')}]`);

if (problems.length) {
  console.log('REFUSING TO WRITE:');
  problems.forEach((m) => console.log('  ' + m));
  process.exit(1);
}

const rows = [];
for (const [key, fields] of Object.entries(WRITES))
  for (const [field, value] of Object.entries(fields)) rows.push({ category: catOf(key), id: idOf(key), field, value });

console.log(`${Object.keys(WRITES).length} records · ${rows.length} field writes`);
for (const [key, fields] of Object.entries(WRITES)) console.log(`  ${key}: ${Object.keys(fields).join(', ')}`);
console.log(`  Bone Magic's Special clause covers: ${boneKin.join(', ')}`);
if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

for (const r of rows) core[r.category][r.id][r.field] = r.value;
writeFileSync(p('public/core.json'), JSON.stringify(core)); // MINIFIED — pretty-printing it costs 4 MB

const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const r of rows) {
  const at = overlay.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field && !x.path && !x.create);
  if (at >= 0) {
    overlay[at].value = r.value;
    updated++;
  } else {
    overlay.push({ category: r.category, id: r.id, field: r.field, value: r.value });
    added++;
  }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
