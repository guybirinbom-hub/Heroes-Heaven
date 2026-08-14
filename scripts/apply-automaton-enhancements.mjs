/*
 * The automaton ENHANCEMENT tier — 19 records, one picker, and until now zero consumers.
 *
 * Every automaton ancestry feat prints a base benefit and then an "**Enhancement**" paragraph you
 * gain ONLY by pointing an augmentation at that feat. Lesser Augmentation (AoN feat-3103, Guns &
 * Gears Remastered pg. 42): "You gain the enhancement benefits of one of your 1st- or 5th-level
 * automaton ancestry feats." Greater Augmentation (feat-3111) does the same for 1st/5th/9th/13th.
 *
 * Both already carried an `effectChoices` picker listing those feats by name, whose own prompt said
 * "(prose benefit - read that feat's Enhancement entry)" - and nothing under src/ read the answer.
 * Owner ruling Q26: a picker whose answer reaches nothing is a MISSING LANE, not flavour.
 *
 * WHERE THE VALUES GO. No authoring script owned any of these records (`npm run feat -- arcane-eye`
 * reports "no authoring script names this record"), and `feats` is not in import-core-v2's
 * CARRY_WHOLESALE list, so scripts/data/effect-backfill.json is the only place a value survives
 * `npm run data`. This file is now that owner. Every guard REFUSES rather than guesses.
 *
 * Measured with `npm run scan:enhancements`: 22 feats carry the `automaton` trait, 19 print an
 * Enhancement, 18 are reachable, 4 are computed here and the other 15 carry a note saying the
 * benefit is prose.
 *
 * Run: node scripts/apply-automaton-enhancements.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatBackfill } from './lib/write-backfill.mjs';

// fileURLToPath, not `new URL(...).pathname` — this repo lives under a path with spaces, and the
// pathname form hands back "%20" and a leading slash.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const coreRaw = readFileSync(CORE, 'utf8');
const descRaw = readFileSync(DESC, 'utf8');
const db = JSON.parse(coreRaw);
const desc = JSON.parse(descRaw);
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };
// A parse→stringify round trip of a 9.8 MB minified file is only safe if it IS lossless on this
// tree (key order, number formatting, escapes). Asserted rather than assumed, before any edit.
if (JSON.stringify(db) !== coreRaw) fail('public/core.json does not round-trip through JSON.parse/stringify — refusing to rewrite it');
if (JSON.stringify(desc) !== descRaw) fail('public/core-descriptions.json does not round-trip through JSON.parse/stringify — refusing to rewrite it');
const norm = (s) => String(s).replace(/[’‘']/g, "'").replace(/\s+/g, ' ').toLowerCase();
/** Assert the record still SAYS the sentence a row implements. */
const says = (id, quote) => {
  const text = desc.feats?.[id]?.d ?? '';
  if (!norm(text).includes(norm(quote))) fail(`${id}'s description no longer contains "${quote}"`);
};
/** Write an overlay row AND apply it to the live core.json. `value: null` deletes the field. */
const write = (category, id, field, value) => {
  if (!db[category]?.[id]) fail(`${category}/${id} is not in core.json`);
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row; else rows.push(row);
  if (value === null) delete db[category][id][field];
  else db[category][id][field] = value;
};
/** Overlay-only: `description` lives in core-descriptions.json, not in core.json. */
const writeRow = (category, id, field, value) => {
  if (!db[category]?.[id]) fail(`${category}/${id} is not in core.json`);
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row; else rows.push(row);
};
const done = [];

/* ------------------------------------------------------------------ the tier itself ----------- */

/* --- Automaton Armament: the die step ---------------------------------------------------------- */
// "Enhancement Your attacking part is reinforced. Increase the damage die of the unarmed attack you
// gain from this feat by one step (from 1d4 to 1d6, or from 1d6 to 1d8)."  (mirror feat-3090)
{
  const id = 'automaton-armament';
  const dice = (db.feats[id]?.grantedStrikes ?? []).map((s) => s.die).join(',');
  if (dice !== 'd4,d6') fail(`${id}.grantedStrikes dice are ${dice} - expected d4,d6 (claw, pincer)`);
  says(id, 'Increase the damage die of the unarmed attack you gain from this feat by one step');
  write('feats', id, 'enhancement', { strikeDieStep: 1 });
  done.push(`${id}: enhanced claw 1d4->1d6, pincer 1d6->1d8 on the Strikes tab`);
}

/* --- Arcane Eye: the SPURIOUS flat grant, plus the real hourly one ------------------------------ */
// "You gain darkvision.  Enhancement ... You can cast See the Unseen as an arcane innate spell once
// per hour."  (mirror feat-3092; AoN's text still prints the pre-Remaster spell name "see
// invisibility" - See the Unseen IS its Remaster name, and our spell id is see-the-unseen.)
//
// The record granted the spell FLATLY, so a 1st-level automaton was shown an innate spell they
// cannot cast. Every sibling authors only its base benefit; this one was the outlier.
{
  const id = 'arcane-eye';
  const cur = JSON.stringify(db.feats[id]?.innateSpells ?? null);
  const FLAT = JSON.stringify([{ spellId: 'see-the-unseen', tradition: 'arcane' }]);
  if (cur !== FLAT && cur !== 'null') fail(`${id}.innateSpells is ${cur} - expected the flat grant this row removes, or nothing`);
  if (!db.spells['see-the-unseen']) fail('see-the-unseen is not in core.json');
  says(id, 'as an arcane innate spell once per hour');
  write('feats', id, 'innateSpells', null);
  write('feats', id, 'enhancement', {
    // "once per hour" is authorable and was simply absent: usesPer feeds innateCadence (build.ts
    // ~4829) and SpellsTab prints "1/hour". Without it build.ts defaults the grant to 1/day, so the
    // use came back at daily preparations instead.
    grant: { innateSpells: [{ spellId: 'see-the-unseen', tradition: 'arcane', usesPer: 'hour' }] },
  });
  done.push(`${id}: See the Unseen is no longer granted at 1st level; it arrives with the Enhancement, 1/hour`);
}

/* --- Arcane Communication: a base benefit that reached NOTHING ---------------------------------- */
// "You gain touch telepathy, allowing you to communicate silently and mentally with any creature
// you're touching, as long as you share a language.  Enhancement ... Your telepathy gains a range of
// 10 feet, but you still have to share a language with your target."  (mirror feat-3091)
//
// The record stored level/category/rarity/actionCost and nothing else, so the whole feat was silent.
// `senses[]` is free-form and already carries non-vision capabilities across the corpus
// (thoughtsense, lifesense, apparition sight, "ignores concealment from smoke").
//
// The two entries share ONE name on purpose: deriveDefenses keys senses by name and keeps the one
// with the greater range (derive.ts ~2113), so `range: 0` -> `range: 10` REPLACES rather than adding
// a second pill, and senseLabel hides a falsy range.
//
// ⚠ `range: 0` IS LOAD-BEARING. addSense compares with `rng(r) = r ?? Infinity`, so an ABSENT range
// beats 10 and the enhanced telepathy would lose to its own base entry. Do not "clean up" the zero.
{
  const id = 'arcane-communication';
  const OWN = JSON.stringify([{ name: 'touch-telepathy', range: 0 }]);
  const curSenses = db.feats[id]?.senses ? JSON.stringify(db.feats[id].senses) : null;
  if (curSenses && curSenses !== OWN) fail(`${id} already carries senses ${curSenses} - re-read the record before overwriting it`);
  says(id, 'You gain touch telepathy');
  says(id, 'Your telepathy gains a range of 10 feet');
  write('feats', id, 'senses', [{ name: 'touch-telepathy', range: 0 }]);
  write('feats', id, 'enhancement', { grant: { senses: [{ name: 'touch-telepathy', range: 10 }] } });
  done.push(`${id}: "Touch Telepathy" on the Senses row, becoming "Touch Telepathy (10 ft)" when enhanced`);
}

/* --- Automaton Lore: the Arcana-or-Crafting pick, and a description that matches no printing ---- */
// REMASTER (mirror feat-3093, Guns & Gears Remastered pg. 40):
//   "Enhancement Increase your proficiency rank in your choice of either Arcana or Crafting to expert."
// LEGACY   (mirror feat-8595, Guns & Gears pg. 40):
//   "...You also become trained in Automaton Lore. Enhancement Your gain greater understanding.
//    Increase your proficiency rank in either Arcana or Crafting, AS WELL AS AUTOMATON LORE, to
//    expert. If you were already an expert in the chosen skill, increase your rank to master instead."
//
// Our record IS the remaster one (aonId feat-3093, edition remaster): its first paragraph carries the
// remaster's "You also gain the Additional Lore feat", and its ast - which is what the player
// actually reads, since DescBody renders from the ast when one exists - carries the remaster
// Enhancement sentence with no master clause. Only the fallback `description` string kept a HYBRID
// that matches NEITHER printing (the legacy master clause without the legacy's "as well as Automaton
// Lore"). Corrected here so the mechanic and the words agree, and so the next audit reads the right
// sentence. Both quoted literals above were read from the mirror today, not remembered.
{
  const id = 'automaton-lore';
  const HYBRID_ENH = '**Enhancement** Your gain greater understanding. Increase your proficiency rank in your choice of either Arcana or Crafting to expert. If you were already an expert in the chosen skill, increase your rank to master instead.';
  const REMASTER_ENH = '**Enhancement** Increase your proficiency rank in your choice of either Arcana or Crafting to expert.';
  const cur = desc.feats?.[id]?.d ?? '';
  if (!cur.includes(HYBRID_ENH) && !cur.includes(REMASTER_ENH)) fail(`${id}'s description carries neither the shipped hybrid nor the remaster Enhancement sentence`);
  if (db.feats[id]?.effectChoices && db.feats[id].effectChoices[0]?.id !== 'enhancement-rank') fail(`${id} already carries a DIFFERENT effectChoices - re-read the record before overwriting it`);
  says(id, 'You also gain the Additional Lore feat for Automaton Lore');
  const next = cur.includes(HYBRID_ENH) ? cur.replace(HYBRID_ENH, REMASTER_ENH) : cur;
  desc.feats[id].d = next;
  writeRow('feats', id, 'description', next);
  // BOTH options stay live. The grant runs through maxRank, so it can only raise a rank and never
  // sets one - which is what the clause says ("increase ... to expert"), and means an already-expert
  // pick costs nothing rather than being an error worth greying out.
  write('feats', id, 'effectChoices', [{
    id: 'enhancement-rank',
    prompt: 'Enhancement - increase your proficiency rank to expert',
    options: [
      { value: 'arcana', label: 'Arcana', grant: { skills: { arcana: 'expert' } } },
      { value: 'crafting', label: 'Crafting', grant: { skills: { crafting: 'expert' } } },
    ],
  }]);
  write('feats', id, 'enhancement', { choiceIds: ['enhancement-rank'] });
  done.push(`${id}: the Arcana-or-Crafting pick exists and raises that rank to expert, but only while enhanced`);
  done.push(`${id}: description corrected to the remastered Enhancement sentence (the hybrid master clause is gone)`);
}

/*
 * ⚠ THE LORE SUBJECT IS FLAT ON PURPOSE, and is not a regression of this pass.
 *
 * The companion edit `FEAT_SKILL_GRANTS['automaton-lore'].skills['lore:automaton'] = 'trained'`
 * (src/rules/featGrantsAuto.ts) trains Automaton Lore and never raises it. The remaster clause grants
 * the Additional Lore FEAT, whose own text says "At 3rd, 7th, and 15th levels, you gain an additional
 * skill increase" - and `FEAT_SKILL_GRANTS['additional-lore'] = { loreChoices: 1 }` trains only, for
 * EVERY Lore in the app. That is corpus-wide and already recorded at
 * scripts/audit/audit-500-result.json:1947 for jotunborn-lore. The sibling shape (android-lore,
 * azarketi-lore) is the right one; this note stops it being re-reported as this cluster's defect.
 */

/* ---------------------------------------------------- the two pickers that hand the tier out --- */
const COMPUTED = {
  'automaton-armament': 'Computed on your sheet: the claw or pincer this feat grants steps up one damage die (1d4 to 1d6, 1d6 to 1d8).',
  'arcane-communication': 'Computed on your sheet: your touch telepathy gains a 10-foot range, shown on the Senses row.',
  'arcane-eye': 'Computed on your sheet: See the Unseen becomes an arcane innate spell, once per hour, on the Spells page.',
  'automaton-lore': 'Computed on your sheet: choose Arcana or Crafting on Automaton Lore itself; that rank becomes expert.',
};
const PROSE = "Prose benefit - read this feat's Enhancement entry and apply it in play; the app does not compute it.";
const PICKER_NOTE = 'Your Enhancement pick is applied wherever the app can compute it; each option says which. Reconfiguring the choice is a week of downtime.';

for (const id of ['lesser-augmentation', 'greater-augmentation']) {
  const ch = (db.feats[id]?.effectChoices ?? [])[0];
  if (!ch || ch.id !== 'enhancement' || !(ch.options ?? []).length) fail(`${id} no longer carries an "enhancement" effectChoice with options`);
  says(id, 'You gain the enhancement benefits of one of your');
  for (const o of ch.options) {
    if (!db.feats[o.value]) fail(`${id} offers "${o.value}", which is not a feat`);
    if (!/\*\*Enhancement\*\*/.test(desc.feats?.[o.value]?.d ?? '')) fail(`${id} offers "${o.value}", whose text prints no Enhancement clause`);
  }
  write('feats', id, 'effectChoices', [{
    ...ch,
    prompt: "Which automaton ancestry feat's Enhancement do you gain?",
    options: ch.options.map((o) => ({ ...o, note: COMPUTED[o.value] ?? PROSE })),
  }]);
  write('feats', id, 'enhancementPicker', { choiceIds: ['enhancement'] });
  // The old note said "this feat's effect is one the app does not compute, so no number changes
  // here". That is now false for four of the options and misleading for the rest.
  write('feats', id, 'note', PICKER_NOTE);
  done.push(`${id}: the answer now reaches the record it names; ${ch.options.filter((o) => COMPUTED[o.value]).length} of ${ch.options.length} options are computed`);
}

/* -------------------------------------------------------------------------------- writes ------ */
// public/core.json must stay MINIFIED (0 newlines) and core-descriptions.json with it.
writeFileSync(BF, formatBackfill(rows));
writeFileSync(CORE, JSON.stringify(db));
writeFileSync(DESC, JSON.stringify(desc));
console.log(done.map((d) => '  ' + d).join('\n') + `\nwritten: ${BF}, ${CORE}, ${DESC}`);
