/**
 * FIXES THE VERIFIED SPELL-GRANT DEFECTS from scripts/audit/authored-verification.json.
 *
 * Twelve findings whose `field` names an innate spell grant, a spell note or an item frequency were
 * confirmed by an independent pass — each authored value read against the record's own printed text,
 * the claim then attacked and left standing. In every case the TEXT is right and OUR value is wrong.
 *
 * ── What each record's text says, and what it was authored as ───────────────────────────────────
 *
 *  feats/accursed-magic          "At 10th level, you can ALSO cast Seal Fate, and at 12th level …"
 *                                → three flat grants, all three handed to an 8th-level taker.
 *                                NEEDS A LANE: InnateSpellGrant had no availability gate at all.
 *  feats/lions-magic             "At 12th level, you can also cast a 5th-rank Subconscious Suggestion"
 *                                → the 12th-level spell was DROPPED, the same missing lane's other
 *                                  half. Authored now that `minLevel` exists.
 *  feats/greater-magical-edif.   "automatically heightened to the same rank as your cantrips"
 *                                → no heighten at all: rank 3 from level 10 to 20, printed 5-10.
 *  feats/manipulative-charm      "At 5th level and every 2 levels thereafter … maximum of a 9th-rank"
 *                                → heightenHalfLevel, one rank HIGH at every level and reaching a
 *                                  10th rank the text caps at 9.
 *  feats/devil-allies            "At 14th level and every 2 levels thereafter … maximum 10th at 20th"
 *                                → heightenHalfLevel: one rank LOW at levels 1-10 (it overrides the
 *                                  authored rank 6) and one rank HIGH at 13/15/17/19.
 *  feats/entities-from-afar      "At 16th level and every 2 levels thereafter … maximum of 8th rank"
 *                                → neither a ladder nor a word of it in the note: 5th rank at 20.
 *  feats/glass-skin              "At 18th level, the mountain resilience is heightened to 6th"
 *                                → the note says it, the grant does not, so the sheet shows 4th and
 *                                  the resistance the spell prints at 6th (10, not 5) never arrives.
 *  feats/cloud-walk              "ONCE PER HOUR, you can cast Air Walk on yourself"
 *                                → atWill: unlimited, and atWill also SUPPRESSES the cadence text.
 *  feats/pact-of-fey-glamour     "once per hour"  → bare grant, which the engine reads as 1/day.
 *  feats/pact-of-eldritch-eyes   "once per hour"  → the same, authored in the same block. The twin
 *                                  invisible-trickster has carried {usesPerDay:1, usesPer:'hour'}
 *                                  for the identical sentence all along.
 *  feats/mortal-herald-dedic.    "**Special** If you have void healing, you instead cast Harm."
 *                                → grants Heal unconditionally, and files all four riders on Heal.
 *                                NEEDS A LANE: nothing could express "this grant, for these characters".
 *  feats/enter-divine-realm      "…and they need not be the same targets of the previous casting"
 *                                → the note stops one clause early, and the dropped clause is a
 *                                  permission the printed text goes out of its way to grant.
 *  feats/vellumis-excision       "cast Field of Life as a 6th-rank HALCYON SPELL, and you gain a
 *                                6th-rank halcyon spell SLOT" → authored as a primal innate 1/day
 *                                with no slot: the wrong surface, the wrong tradition lock (its own
 *                                note is conditioned on casting it as primal, which became the only
 *                                possibility), and the feat's main mechanical point missing.
 *  items/cloak-of-repute-greater "**Frequency** twice per day" → frequency {max:1} inherited from the
 *                                base cloak, while the item's own counter and degree-shift say twice.
 *
 * ── Two lanes were built for this, rather than authoring a value known to be wrong ──────────────
 *
 *   `InnateSpellGrant.minLevel`         — the "At 10th level, you can also cast X" ladder.
 *   `ContentBase.voidHealingSpellSwap`  — the grant (and its own clause) for a void-healing character.
 *
 * See src/rules/types.ts for both, and test/innate-spell-verification.test.ts for what they buy.
 *
 * ── The item frequencies ────────────────────────────────────────────────────────────────────────
 *
 * The confirmed record is cloak-of-repute-greater. Scanning the 1,704 items carrying BOTH `frequency`
 * and `counters` found 8 where the two disagree, all of the same shape (frequency.max = 1 against a
 * larger counter). Six print one unambiguous "**Frequency** N per day" line and are corrected here.
 * The remaining two are NOT authored to a number, because the field cannot state their rule:
 *   • razmiri-wayfinder has TWO activations, 3/day and 1/day; one `frequency` can say only one of
 *     them, and its `counters` (freq + freq2) already say both.
 *   • red-thread-knot prints no Frequency line at all — six knots that untie for good.
 * Both have the invented `frequency` REMOVED. `itemUses.ts` already prefers `counters`, but
 * ItemEditorModal seeds from `frequency`, so editing either item baked the wrong number in.
 *
 * Where the values land: public/core.json AND scripts/data/effect-backfill.json (the only overlay
 * that survives `npm run data`), written through scripts/lib/write-backfill.mjs.
 *
 * Run: node scripts/apply-innate-spell-verification.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const rec = (key) => core[key.slice(0, key.indexOf('/'))]?.[key.slice(key.indexOf('/') + 1)];

/** The sentence the authored note stopped short of, restored in the printed wording. The dropped
 *  half is a permission, not a flourish: abridged, the note reads as though the 8 creatures must be
 *  the ones you brought, which is the inference the text goes out of its way to forbid. */
const RETURN_CLAUSE =
  'You can return to your previous location by spending 1 minute picturing your destination; you can bring up to 8 willing creatures back with you in this way, and they need not be the same targets of the previous casting of Interplanar Teleport.';

/** The heightening sentence, printed. (devil-allies carries the same ladder in its own note, which is
 *  how the note half of this pattern was already established.) */
const ENTITIES_LADDER =
  ' At 16th level and every 2 levels thereafter, the Summon Entity spell is heightened by 1 rank (to a maximum of 8th rank when you reach 20th level).';

/** Every write, as `<collection>/<id>` → { field: value }. `null` REMOVES the field. */
const WRITES = {
  // ── level-gated grants (the new `minLevel` lane) ──────────────────────────────────────────────
  'feats/accursed-magic': {
    innateSpells: [
      { spellId: 'claim-curse', tradition: 'occult', usesPerDay: 1 },
      { spellId: 'seal-fate', tradition: 'occult', usesPerDay: 1, minLevel: 10 },
      { spellId: 'inevitable-disaster', tradition: 'occult', usesPerDay: 1, minLevel: 12 },
    ],
  },
  'feats/lions-magic': {
    innateSpells: [
      { spellId: 'suggestion', tradition: 'occult', rank: 4, usesPerDay: 1 },
      { spellId: 'subconscious-suggestion', tradition: 'occult', rank: 5, usesPerDay: 1, minLevel: 12 },
    ],
  },

  // ── heighten ladders: the text names its steps, so the half-level default is not it ───────────
  'feats/greater-magical-edification': {
    innateSpells: [
      { spellId: 'translate', tradition: 'occult', usesPerDay: 1 },
      { spellId: 'mindlink', tradition: 'occult', usesPerDay: 1 },
      // "the same spell rank as your cantrips from Magical Edification" — cantrips render at
      // ceil(level/2) (SpellsTab.tsx), which is exactly what heightenHalfLevel resolves to.
      { spellId: 'secret-page', tradition: 'occult', usesPerDay: 1, heightenHalfLevel: true },
    ],
  },
  'feats/manipulative-charm': {
    innateSpells: [
      {
        spellId: 'charm',
        tradition: 'divine',
        rank: 1,
        usesPerDay: 1,
        heightenAt: [
          { level: 5, rank: 2 }, { level: 7, rank: 3 }, { level: 9, rank: 4 }, { level: 11, rank: 5 },
          { level: 13, rank: 6 }, { level: 15, rank: 7 }, { level: 17, rank: 8 }, { level: 19, rank: 9 },
        ],
      },
    ],
  },
  'feats/devil-allies': {
    innateSpells: [
      {
        spellId: 'summon-fiend',
        rank: 6,
        usesPerDay: 1,
        heightenAt: [{ level: 14, rank: 7 }, { level: 16, rank: 8 }, { level: 18, rank: 9 }, { level: 20, rank: 10 }],
      },
    ],
  },
  'feats/entities-from-afar': {
    innateSpells: [
      {
        spellId: 'summon-entity',
        tradition: 'occult',
        usesPerDay: 1,
        heightenAt: [{ level: 16, rank: 6 }, { level: 18, rank: 7 }, { level: 20, rank: 8 }],
      },
    ],
  },
  'feats/glass-skin': {
    innateSpells: [{ spellId: 'mountain-resilience', tradition: 'primal', rank: 4, usesPerDay: 1, heightenAt: [{ level: 18, rank: 6 }] }],
  },

  // ── cadences the record simply did not carry ──────────────────────────────────────────────────
  'feats/cloud-walk': {
    innateSpells: [{ spellId: 'air-walk', tradition: 'arcane', rank: 4, usesPerDay: 1, usesPer: 'hour' }],
  },
  'feats/pact-of-fey-glamour': {
    innateSpells: [{ spellId: 'illusory-disguise', tradition: 'primal', usesPerDay: 1, usesPer: 'hour' }],
  },
  'feats/pact-of-eldritch-eyes': {
    innateSpells: [{ spellId: 'scouting-eye', tradition: 'occult', usesPerDay: 1, usesPer: 'hour' }],
  },

  // ── the void-healing swap (the new lane) ──────────────────────────────────────────────────────
  // The grant and the note stay authored on Heal, which is what the feat gives most characters; the
  // swap is what makes both follow the printed Special clause for the rest.
  'feats/mortal-herald-dedication': { voidHealingSpellSwap: { from: 'heal', to: 'harm' } },

  // ── the abridged clause ───────────────────────────────────────────────────────────────────────
  'feats/enter-divine-realm': { spellNotes: null },

  // ── the halcyon spell that was filed as an innate ─────────────────────────────────────────────
  'feats/vellumis-excision': {
    innateSpells: null,
    spellListAdditions: { spells: ['field-of-life'], as: 'repertoire', entryId: 'halcyon-speaker-dedication-casting' },
    spellSlotBonus: { entryId: 'halcyon-speaker-dedication-casting', byRank: { 6: 1 } },
  },

  // ── item activation frequencies ───────────────────────────────────────────────────────────────
  'items/cloak-of-repute-greater': { frequency: { max: 2, per: 'day' } },       // "twice per day"
  'items/cloak-of-repute-major': { frequency: { max: 3, per: 'day' } },         // "three times per day"
  'items/aeon-stone-rainbow-prism': { frequency: { max: 3, per: 'day' } },      // "three times per day"
  'items/conundrum-spectacles-greater': { frequency: { max: 3, per: 'day' } },  // "three times per day"
  'items/invisibility-greater': { frequency: { max: 3, per: 'day' } },          // "three times per day"
  'items/flawed-orb-of-gold-dragonkind': { frequency: { max: 3, per: 'day' } }, // "Three times per day"
  'items/razmiri-wayfinder': { frequency: null },                               // two activations; counters say both
  'items/red-thread-knot': { frequency: null },                                 // six knots, no Frequency line
};

// enter-divine-realm's note is rebuilt from the record's own authored text so the fix is a restored
// clause and not a re-transcription: everything before the final sentence must survive untouched.
{
  const notes = rec('feats/enter-divine-realm')?.spellNotes;
  const cur = notes?.[0]?.note;
  if (!cur) throw new Error('enter-divine-realm has no spellNotes to repair');
  const at = cur.indexOf('You can return to your previous location');
  if (at < 0) throw new Error('enter-divine-realm note is not the one this script was written against');
  WRITES['feats/enter-divine-realm'].spellNotes = [{ spellId: 'interplanar-teleport', note: cur.slice(0, at) + RETURN_CLAUSE }];
}

// …and the same for entities-from-afar, whose note is complete except for the ladder sentence.
{
  const cur = rec('feats/entities-from-afar')?.spellNotes?.[0]?.note;
  if (!cur) throw new Error('entities-from-afar has no spellNotes to extend');
  if (!cur.includes('without providing any other benefit')) throw new Error('entities-from-afar note is not the one this script was written against');
  WRITES['feats/entities-from-afar'].spellNotes = [{ spellId: 'summon-entity', note: cur + ENTITIES_LADDER }];
}

/** Nothing here may name a spell that does not ship — a typo grants and annotates nothing, silently. */
const missing = [];
for (const [key, fields] of Object.entries(WRITES)) {
  if (!rec(key)) { missing.push(`${key} is not in core.json`); continue; }
  for (const g of fields.innateSpells ?? []) if (!core.spells[g.spellId]) missing.push(`${key} → missing spell ${g.spellId}`);
  for (const n of fields.spellNotes ?? []) if (!core.spells[n.spellId]) missing.push(`${key} → note on missing spell ${n.spellId}`);
  for (const s of fields.spellListAdditions?.spells ?? []) if (!core.spells[s]) missing.push(`${key} → list addition of missing spell ${s}`);
  const sw = fields.voidHealingSpellSwap;
  if (sw && (!core.spells[sw.from] || !core.spells[sw.to])) missing.push(`${key} → swap names a missing spell`);
}
if (missing.length) { console.log('REFUSING TO WRITE:'); missing.forEach((m) => console.log('  ' + m)); process.exit(1); }

const rows = [];
for (const [key, fields] of Object.entries(WRITES)) {
  const category = key.slice(0, key.indexOf('/'));
  const id = key.slice(key.indexOf('/') + 1);
  for (const [field, value] of Object.entries(fields)) rows.push({ category, id, field, value });
}

console.log(`${Object.keys(WRITES).length} records · ${rows.length} field writes`);
for (const [key, fields] of Object.entries(WRITES)) console.log(`  ${key}: ${Object.keys(fields).join(', ')}`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const r of rows) {
  if (r.value === null) delete core[r.category][r.id][r.field];
  else core[r.category][r.id][r.field] = r.value;
}
writeFileSync(p('public/core.json'), JSON.stringify(core)); // MINIFIED — pretty-printing it costs 4 MB

const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const r of rows) {
  const at = overlay.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field && !x.path && !x.create);
  if (at >= 0) { overlay[at].value = r.value; updated++; }
  else { overlay.push({ category: r.category, id: r.id, field: r.field, value: r.value }); added++; }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
