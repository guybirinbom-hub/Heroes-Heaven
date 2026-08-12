/*
 * Restricted spell slots for the four records whose extra slots may hold only certain spells.
 *
 * Each value is checked against the record's own printed text before it is written — a rank the text
 * does not mention, or a spell name the text does not list, aborts the whole run rather than writing
 * a plausible guess.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/** Every spell id must exist AND be named in the record's own text. */
const checkSpells = (text, ids) => {
  for (const id of ids) {
    const sp = db.spells[id];
    if (!sp) fail(`spell "${id}" does not exist`);
    if (!new RegExp(sp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) fail(`"${sp.name}" is not named in the record text`);
  }
};

const GRANTS = [];

// ---- Conscious Spell Specialization (psychic 14) --------------------------------------------------
{
  const f = db.feats['conscious-spell-specialization'];
  const t = plain(f?.description);
  if (!/1st, 2nd, 3rd, and 4th ranks/i.test(t)) fail('conscious-spell-specialization: ranks 1-4 not found in text');
  if (!/At 18th level, you also gain an additional 5th-rank spell slot/i.test(t)) fail('conscious-spell-specialization: the 18th-level 5th-rank slot not found');
  if (!/only a spell granted by your conscious mind/i.test(t)) fail('conscious-spell-specialization: the restriction sentence not found');
  GRANTS.push({
    category: 'feats',
    id: 'conscious-spell-specialization',
    field: 'spellSlotBonus',
    value: {
      entryId: 'psychic-casting',
      restricted: {
        label: 'Conscious mind slots',
        note: 'These slots can cast only a spell granted by your conscious mind.',
        byRank: { 1: 1, 2: 1, 3: 1, 4: 1 },
        byRankAt: [{ level: 18, byRank: { 5: 1 } }],
        from: 'subclass-granted',
      },
    },
  });
  // The plain-slot warning it shipped with is what this replaces.
  GRANTS.push({ category: 'feats', id: 'conscious-spell-specialization', field: 'dataWarning', value: null });
}

// ---- Creed Magic (Battle Harbinger 8) -------------------------------------------------------------
{
  const f = db.feats['creed-magic'];
  const t = plain(f?.description);
  if (!/two special 2nd-rank creed spell slots/i.test(t)) fail('creed-magic: the two 2nd-rank slots not found in text');
  if (!/At 10th level, the extra slots increase to 3rd rank/i.test(t)) fail('creed-magic: the 10th-level step not found');
  if (!/At 14th level, the extra slots increase to 4th rank/i.test(t)) fail('creed-magic: the 14th-level step not found');
  const base = ['resist-energy', 'see-the-unseen', 'sure-strike', 'water-breathing'];
  const at10 = ['haste', 'heroism'];
  const at14 = ['fly', 'unfettered-movement'];
  checkSpells(t, [...base, ...at10, ...at14]);
  GRANTS.push({
    category: 'feats',
    id: 'creed-magic',
    field: 'spellSlotBonus',
    value: {
      entryId: 'cleric-casting',
      restricted: {
        label: 'Creed slots',
        note: 'Two creed slots, prepared as divine spells from your creed list.',
        // A LADDER, not additions: "the extra slots INCREASE to 3rd rank" — there are always two.
        ladder: [
          { level: 8, byRank: { 2: 2 }, addSpells: base },
          { level: 10, byRank: { 3: 2 }, addSpells: at10 },
          { level: 14, byRank: { 4: 2 }, addSpells: at14 },
        ],
      },
    },
  });
}

// ---- Sin Reservoir (Runelord 8) -------------------------------------------------------------------
{
  const f = db.feats['sin-reservoir'];
  const t = plain(f?.description);
  if (!/one additional spell slot of any spell level up to two levels below the highest-level wizard spell you can cast/i.test(t))
    fail('sin-reservoir: the "two levels below" clause not found in text');
  if (!/You can prepare only one of your curriculum spells in this slot/i.test(t)) fail('sin-reservoir: the curriculum restriction not found');
  GRANTS.push({
    category: 'feats',
    id: 'sin-reservoir',
    field: 'spellSlotBonus',
    value: {
      entryId: 'wizard-casting',
      restricted: {
        label: 'Sin Reservoir',
        // No `spells`/`from`: a wizard's curriculum lives only in its school's description prose, so
        // the allowed set cannot be resolved and the restriction stays a sentence the player applies.
        note: 'Prepare only one of your curriculum spells here. Choose the slot’s rank at your daily preparations — anything up to two ranks below your highest.',
        rankChoice: { count: 1, belowHighest: 2 },
      },
    },
  });
}

// ---- Candle of Invocation (item 16) — a MODE, because a candle is lit, not invested ---------------
const CANDLE_MODE = (() => {
  const it = db.items['candle-of-invocation'];
  const t = plain(it?.description);
  if (!/two additional spell slots for the day, each at half the highest spell slot they possess/i.test(t))
    fail('candle-of-invocation: the "two slots at half your highest" clause not found in text');
  if (!/worship the deity emblazoned on the candle/i.test(t)) fail('candle-of-invocation: the deity gate not found');
  return {
    id: 'item-candle-of-invocation',
    name: 'Candle of Invocation',
    fromItemId: 'candle-of-invocation',
    duration: 'until your next daily preparations',
    survivesRest: true,
    note: 'You must cast divine spells, worship the deity emblazoned on the candle, and have performed your daily preparations within 10 feet of it while lit. No one benefits from more than one candle in a day.',
    modifiers: [],
    spellSlotBonus: {
      restricted: {
        label: 'Candle of Invocation',
        note: 'Two extra slots at half your highest rank, lost at your next daily preparations.',
        halfHighest: 2,
      },
    },
  };
})();

// ---- write ----------------------------------------------------------------------------------------
let added = 0;
let replaced = 0;
for (const g of GRANTS) {
  const i = rows.findIndex((r) => r.category === g.category && r.id === g.id && r.field === g.field);
  if (g.value === null) {
    if (i >= 0) {
      rows.splice(i, 1);
      replaced++;
    }
    continue;
  }
  if (i >= 0) {
    rows[i] = g;
    replaced++;
  } else {
    rows.push(g);
    added++;
  }
}
writeFileSync(BF, formatBackfill(rows));

// The consumable-modes source is an ARRAY at ONE-space indent — matching it exactly keeps the diff
// to the rows actually added.
const CM = ROOT + 'scripts/data/consumable-modes.json';
const modes = JSON.parse(readFileSync(CM, 'utf8'));
const mi = modes.findIndex((m) => m.id === CANDLE_MODE.id);
if (mi >= 0) modes[mi] = CANDLE_MODE;
else modes.push(CANDLE_MODE);
modes.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(CM, JSON.stringify(modes, null, 1) + '\n');

// …and into core.json's `modes` bucket, which is what the app actually reads. The source file above
// is provenance only: `modes` is on the importer's CARRY_WHOLESALE list, so the bucket is copied from
// the PREVIOUS core.json on every regen and a row that exists only in scripts/data never arrives.
// Writing it here is what makes the mode survive `npm run data` — the same reason effect-backfill.json
// exists for record fields.
const CORE = ROOT + 'public/core.json';
const core = JSON.parse(readFileSync(CORE, 'utf8'));
core.modes = core.modes ?? {};
const existed = !!core.modes[CANDLE_MODE.id];
core.modes[CANDLE_MODE.id] = CANDLE_MODE;
// Minified — core.json is ~22 MB and pretty-printing it triples the download.
writeFileSync(CORE, JSON.stringify(core));

console.log(`effect-backfill: +${added} added, ${replaced} replaced/removed`);
console.log(`consumable-modes: candle mode ${mi >= 0 ? 'replaced' : 'added'} (${modes.length} total)`);
console.log(`core.json modes: candle ${existed ? 'replaced' : 'added'} (${Object.keys(core.modes).length} total)`);
