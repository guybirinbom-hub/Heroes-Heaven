/*
 * THE BUILDER-CHOICE-SETS LANE — dead answers, over-wide lists, over-narrow lists, slots that never
 * widen.
 *
 *   node scripts/apply-builder-choice-sets.mjs
 *
 * Every value here is a printed clause. The five shapes and their corpus-wide counts come from
 * `npm run scan:choices`, whose detectors this file IMPORTS rather than copies — a scanner and an
 * applier that disagree is how a lane gets reported closed while half of it is unwritten.
 *
 * WHERE THE VALUES GO. `feats` is not in import-core-v2's CARRY_WHOLESALE, so
 * scripts/data/effect-backfill.json is the only place a feat field survives `npm run data`. This file
 * is the owner for these rows (`npm run feat -- adopted-ancestry` reported none). It writes BOTH the
 * overlay row and the live public/core.json, and refuses rather than guesses at every guard. Running
 * it twice writes byte-identical files.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatBackfill } from './lib/write-backfill.mjs';
import { scanOnlyAtLevel, scanDistinctAcrossTakes, scanSenseSpelling, senseKey } from './scan-choice-sets.mjs';

// fileURLToPath, not `new URL(...).pathname` — this repo lives under a path with spaces.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const coreRaw = readFileSync(CORE, 'utf8');
const db = JSON.parse(coreRaw);
const desc = JSON.parse(readFileSync(DESC, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
// A parse→stringify round trip of a 9.8 MB minified file is only safe if it IS lossless on this tree
// (key order, number formatting, escapes). Asserted rather than assumed, before any edit.
if (JSON.stringify(db) !== coreRaw) fail('public/core.json does not round-trip through JSON.parse/stringify — refusing to rewrite it');

const norm = (s) => String(s).replace(/[’‘']/g, "'").replace(/\s+/g, ' ').toLowerCase();
/** Assert the record still SAYS the sentence a row implements. */
const says = (cat, id, quote) => {
  const text = desc[cat]?.[id]?.d ?? db[cat]?.[id]?.description ?? '';
  if (!norm(text).includes(norm(quote))) fail(`${cat}/${id}'s description no longer contains "${quote}"`);
};
/**
 * Write an overlay row AND apply it to the live core.json. `value: null` DELETES the field
 * (apply-backfill.mjs:51). `path` addresses a nested object (`['passiveEffects']`).
 */
const write = (category, id, field, value, path) => {
  if (!db[category]?.[id]) fail(`${category}/${id} is not in core.json`);
  const same = (r) => r.category === category && r.id === id && r.field === field && JSON.stringify(r.path ?? null) === JSON.stringify(path ?? null);
  const i = rows.findIndex(same);
  const row = path ? { category, id, path, field, value } : { category, id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  let target = db[category][id];
  for (const step of path ?? []) target = target?.[step];
  if (!target) fail(`${category}/${id} has no ${(path ?? []).join('/')} to write ${field} into`);
  if (value === null) delete target[field];
  else target[field] = value;
};
/**
 * Has this exact deletion already landed?
 *
 * Re-running must be a no-op, and "the field is gone" alone cannot say whether it was THIS script or
 * an upstream change that removed it. The overlay row is the evidence, so both have to agree.
 */
const alreadyDeleted = (category, id, field) =>
  db[category]?.[id] && !(field in db[category][id]) && rows.some((r) => r.category === category && r.id === id && r.field === field && !r.path && r.value === null);

const done = [];

/* ══════════════════════════════════════════════════ 1. DEAD ANSWERS — delete the phantom picker
 *
 * Round 5's Exemplar Dedication ruling, verbatim: "Delete the picker." Two families here, and every
 * one was verified to have NO consumer: neither the record id nor the choice flag is read anywhere in
 * src/, and the answer's only effect was a label on the Feats tab — printed a second time beside the
 * live picker's own answer ("Animal Senses (Scent) (Scent (imprecise) 30 feet)").
 *
 *   (a) ASKED TWICE — the record also carries an `effectChoices` asking the same question, and THAT
 *       one is the picker that grants the sense/resistance.
 *   (b) COMPUTABLE — a Yes/No question the app already knows the answer to.
 */
const PHANTOM = {
  // (a) asked twice
  'animal-senses': ['You gain one of the following senses available to your inherent animal', 'sense'],
  'greater-animal-senses': ['You gain one of the following senses available to your inherent animal', 'sense'],
  'natural-senses': ['Choose one of the following senses appropriate to your kind of animal', 'sense'],
  'benefactors-resistance': ['you must choose acid, cold, fire, electricity, or sonic', 'breath-type'],
  // (b) computable — the sentence names the condition the app can test for itself
  'aqueous-dragonblood': ['if you already have a base swim Speed', null],
  'summiting-dragonblood': ['if you already have a base climb Speed', null],
  'animal-actor': ['if you were already trained in either, you become an expert in that skill instead', null],
};
for (const [id, [quote, ecId]] of Object.entries(PHANTOM)) {
  says('feats', id, quote);
  if (alreadyDeleted('feats', id, 'choice')) continue;
  if (!db.feats[id].choice) fail(`feats/${id} has no \`choice\` to delete — already gone, or the record moved`);
  if (ecId) {
    // The picker that survives must be the one that GRANTS. Refuse rather than delete the working half.
    const ec = (db.feats[id].effectChoices ?? []).find((c) => c.id === ecId);
    if (!ec) fail(`feats/${id} has no effectChoices[${ecId}] — deleting its \`choice\` would leave no picker at all`);
    if (!(ec.options ?? []).some((o) => o.grant)) fail(`feats/${id}'s effectChoices[${ecId}] grants nothing — it is not the working half`);
  }
  write('feats', id, 'choice', null);
  done.push(`feats/${id}.choice DELETED (${ecId ? 'asked twice' : 'the app computes it'})`);
}

/*
 * ADROIT MANIPULATION is the same ruling by a different route: "You gain the trained proficiency rank
 * in Thievery (or another skill of your choice, if you're already trained in Thievery)" is ONE
 * conditional question, and the working picker is the DERIVED one — `redundantFallback` at
 * featGrantsAuto.ts → Character.skillFallbacks → Builder.tsx — which fires only when the grant really
 * was redundant and greys every skill you already have. The record's own `choice` rendered a SECOND
 * "Replacement skill" picker for EVERY holder, over `trainedSkillOptions`, which is the exact INVERSE
 * of the legal list. scripts/apply-choice-lane.mjs already documents that this record must not get a
 * picker; it simply never removed the one that was there.
 */
{
  const id = 'adroit-manipulation';
  says('feats', id, "or another skill of your choice, if you're already trained in Thievery");
  if (!alreadyDeleted('feats', id, 'choice')) {
    if (!db.feats[id].choice) fail(`feats/${id} has no \`choice\` to delete`);
    write('feats', id, 'choice', null);
    done.push(`feats/${id}.choice DELETED (the redundantFallback picker is the working one)`);
  }
}

/* ══════════════════════════════════════════ 2. "Each time, choose a DIFFERENT …" — greyed, not gone */
{
  const b = scanDistinctAcrossTakes();
  if (!b.todo.length && !b.done.length) fail('the "each time, choose a different X" detector matched nothing — it has drifted');
  for (const { id } of [...b.todo, ...b.done]) {
    const def = db.feats[id].choice;
    if (!def) fail(`feats/${id} lost its choice`);
    write('feats', id, 'choice', { ...def, distinctAcrossTakes: true });
    done.push(`feats/${id}.choice.distinctAcrossTakes`);
  }
}

/* ══════════════════════════════════════════════════ 3. ADOPTED ANCESTRY — 8 hardcoded to all 50
 *
 * AoN feat-5115: "Choose a common ancestry **or another ancestry to which you have access**. You can
 * select ancestry feats from the ancestry you chose, in addition to your character's own ancestry, as
 * long as the ancestry feats don't require any physiological feature that you lack, **as determined by
 * the GM**."
 *
 * The list was 8 common ancestries; core.json ships 50, so kobold, hobgoblin, tengu and 39 others were
 * hard-blocked rather than offered with their rarity shown. The character's OWN ancestry was offered
 * live — the one pick that buys nothing (Q21). `inert` goes because after `adoptedAncestryIds`
 * (featSlots.ts) the pick is no longer inert; the GM caveat moves to `note`, which both picker lanes
 * now render.
 */
{
  const id = 'adopted-ancestry';
  says('feats', id, 'Choose a common ancestry or another ancestry to which you have access');
  const n = Object.keys(db.ancestries ?? {}).length;
  if (n < 40) fail(`only ${n} ancestries in core.json — an open list would be narrower than the 8 it replaces`);
  write('feats', id, 'choice', {
    flag: 'adoptedAncestry',
    prompt: 'Adopted ancestry',
    kind: 'open',
    from: { type: 'ancestry', excludeOwn: true },
    note: "Choose a common ancestry, or an uncommon or rare one your GM has given you access to — each option shows its rarity. The GM still rules out any feat of that ancestry needing a physiological feature you lack.",
  });
  done.push(`feats/${id}.choice → open list of all ${n} ancestries, own excluded`);
}

/* ══════════════════════════════════════════════════ 4. ANIMAL SENSES — the sense gate, and one spelling
 *
 * "You must have low-light vision before you can gain darkvision with this feat." Enforced nowhere: a
 * normal-sighted human was offered Darkvision as a live pick. Darkvision itself satisfies the gate —
 * a character who already has it loses nothing by picking it.
 */
{
  const id = 'animal-senses';
  says('feats', id, 'You must have low-light vision before you can gain darkvision with this feat');
  const ec = JSON.parse(JSON.stringify(db.feats[id].effectChoices));
  const sense = ec.find((c) => c.id === 'sense');
  const dark = sense?.options?.find((o) => o.value === 'darkvision');
  const low = sense?.options?.find((o) => o.value === 'low-light-vision');
  if (!dark || !low) fail(`feats/${id}'s sense choice no longer offers both darkvision and low-light-vision`);
  dark.requiresAnySense = ['low-light-vision', 'darkvision'];
  low.grant.senses[0].name = 'low-light-vision';
  write('feats', id, 'effectChoices', ec);
  done.push(`feats/${id}.effectChoices — darkvision gated on low-light vision`);
}

/* ══════════════════════════════════ 5. SENSE SPELLINGS — one name, or the sheet prints two rows
 *
 * `addSense` keys its Map by NAME, so `low-light vision` and `low-light-vision` are two senses to the
 * engine and one to the player. The majority spelling wins; the count comes from the scanner.
 */
{
/*
 * ⚠ `container` names the field the OVERLAY ALREADY OWNS, not the shortest path to the value. Three
 * of these live inside an item's `passiveEffects`, and the overlay's durable row for each is the WHOLE
 * `passiveEffects` object. Writing a nested `path: ['passiveEffects'], field: 'senses'` row instead
 * left that whole-object row holding the old spelling — a second writer for one value, with the stale
 * one winning at the next regeneration. test/overlay-durability.test.ts caught it; it is the "47
 * duplicate (category,id,field) rows" hazard one level down.
 */
  const SPELLING_FIX = [
    ['feats', 'shadowdancer-dedication', null, 'greater darkvision', 'greater-darkvision'],
    ['items', 'axe-of-the-dwarven-lords', 'passiveEffects', 'greater darkvision', 'greater-darkvision'],
    ['items', 'horns-of-naraga', 'passiveEffects', 'greater darkvision', 'greater-darkvision'],
    ['items', 'aon-beast-senses', 'passiveEffects', 'low-light vision', 'low-light-vision'],
  ];
  for (const [cat, id, container, from, to] of SPELLING_FIX) {
    if (senseKey(from) !== senseKey(to)) fail(`${from} and ${to} are not the same sense`);
    const holder = container ? db[cat][id]?.[container] : db[cat][id];
    if (!holder) fail(`${cat}/${id} has no ${container ?? 'record'} to respell`);
    const next = JSON.parse(JSON.stringify(container ? holder : { senses: holder.senses }));
    const hit = (next.senses ?? []).find((s) => s.name === from);
    // Already respelt (a re-run) is fine; the sense having VANISHED is not.
    if (!hit) {
      if (!(next.senses ?? []).some((s) => s.name === to)) fail(`${cat}/${id} grants neither "${from}" nor "${to}"`);
      continue;
    }
    hit.name = to;
    if (container) write(cat, id, container, next);
    else write(cat, id, 'senses', next.senses);
    done.push(`${cat}/${id}${container ? '.' + container : ''} senses "${from}" → "${to}"`);
  }
}

/* ══════════════════════════════════════════════ 6. ARTISANAL CRAFTER — 12 specialties down to 3
 *
 * "…and gain the Specialty Crafting skill feat **in your choice of blacksmithing, leatherworking, or
 * stonemasonry**." The granted picker offered all twelve. `choiceOptionLimits` is a live lane
 * (derive.ts effectiveChoiceLimits → narrowChoiceOptions → the granted-feat picker); three backgrounds
 * already carry one. This is a missing row, not a missing lane.
 */
{
  const id = 'artisanal-crafter';
  says('feats', id, 'in your choice of blacksmithing, leatherworking, or stonemasonry');
  const target = db.feats['specialty-crafting']?.choice;
  const values = new Set((target?.options ?? []).map((o) => o.value));
  for (const v of ['blacksmithing', 'leatherworking', 'stonemasonry'])
    if (!values.has(v)) fail(`specialty-crafting no longer offers "${v}" — a limit naming it would empty the picker`);
  write('feats', id, 'choiceOptionLimits', [
    {
      target: 'specialty-crafting',
      flag: target.flag,
      allow: [{ value: 'blacksmithing' }, { value: 'leatherworking' }, { value: 'stonemasonry' }],
      reason: 'Artisanal Crafter grants Specialty Crafting "in your choice of blacksmithing, leatherworking, or stonemasonry" — the other nine specialties are not on offer through this feat.',
    },
  ]);
  done.push(`feats/${id}.choiceOptionLimits — Specialty Crafting 12 → 3`);
}

/* ══════════════════════════════════════════════════ 7. BOUNCE BOOST — a printed prerequisite, unparsed
 *
 * The importer left "Prerequisites Trained in Athletics" inside the description and wrote no
 * `prerequisites` array, so build.ts's gate and the builder's "Requires:" chip both saw nothing and a
 * tripkee untrained in Athletics could take it. 167 live feats are in that state; this is the one whose
 * line was read off the mirror. The rest need a parse-and-verify pass — authoring them blind would
 * hard-block legal picks.
 */
{
  const id = 'bounce-boost';
  says('feats', id, 'Prerequisites Trained in Athletics');
  const have = db.feats[id].prerequisites ?? [];
  // Refuse to overwrite somebody ELSE's parse; re-writing our own is the idempotent case.
  if (have.length && JSON.stringify(have) !== JSON.stringify(['Trained in Athletics']))
    fail(`feats/${id} already has prerequisites ${JSON.stringify(have)} — refusing to overwrite`);
  write('feats', id, 'prerequisites', ['Trained in Athletics']);
  done.push(`feats/${id}.prerequisites`);
}

/* ═══════════════════════════════════ 8. "You can select this feat only at 1st level" — 27 records
 *
 * The ids come from the SCANNER, so the two can never disagree about which records print the clause.
 * They are ALSO written out below, and the two are asserted equal, for one reason: `npm run feat --
 * round-ears` finds a record's owning script by grepping scripts/*.mjs for its id, and a list derived
 * at runtime is invisible to it. Without this every one of the 27 reported "no authoring script names
 * this record" — an orphan-row warning on rows that are not orphans.
 */
const ONLY_AT_LEVEL_RECORDS = [
  'alabaster-eyes', 'aon-nocturnal-grippli', 'bestial-manifestation', 'chance-death', 'crocodiles-twin',
  'deliberate-death', 'draconic-aspect', 'elemental-eyes', 'elf-atavism', 'eyes-of-night', 'gravesight',
  'made-for-combat', 'nalinivatis-light', 'nocturnal-tripkee', 'orc-sight', 'parthenogenic-hatchling',
  'pierce-the-darkness', 'quadruped', 'round-ears', 'scaly-hide', 'sensitive-nose', 'tough-skin',
  'tusks', 'tusks-half-orc', 'tusks-orc', 'whitecape', 'willing-death',
];
{
  const a = scanOnlyAtLevel();
  if (a.prints.length < 20) fail(`the "only at Nth level" detector matched ${a.prints.length} records — it has drifted`);
  const found = [...a.todo, ...a.done].map((r) => r.id).sort();
  const listed = [...ONLY_AT_LEVEL_RECORDS].sort();
  if (JSON.stringify(found) !== JSON.stringify(listed))
    fail(`the scanner and ONLY_AT_LEVEL_RECORDS disagree.\n  scanner: ${found.join(' ')}\n  listed : ${listed.join(' ')}`);
  for (const r of [...a.todo, ...a.done]) {
    if (r.category !== 'ancestry')
      fail(`feats/${r.id} is category ${r.category}; only an ancestry slot is level-1-addressable (see ONLY_AT_EXEMPT)`);
    write('feats', r.id, 'onlyAtLevel', r.want);
  }
  done.push(`onlyAtLevel authored on ${found.length} records (1 exempt)`);
}

/* ═════════════════════════════ 9. BESTIAL MANIFESTATION — four bare words at a permanent choice
 *
 * AoN feat-4548 prints the four attacks with their dice and traits, and "The attack is in the brawling
 * group". The picker rendered "Claw / Hoof / Jaws / Tail" and nothing else, at a pick the feat's own
 * Special clause says can never be retrained.
 *
 * `grantedStrikes` is re-written UNCHANGED as a DURABILITY fix: the array is byte-identical to what
 * core.json holds today, but `feats` is not carried wholesale by the importer and no overlay row
 * carried it, so the sheet half of this feat dies at the next `npm run data`.
 */
{
  const id = 'bestial-manifestation';
  says('feats', id, 'You can select this feat only at 1st level');
  const DESCS = {
    claw: '1d4 slashing — agile, finesse, unarmed, versatile piercing. Brawling group.',
    hoof: '1d6 bludgeoning — finesse, unarmed. Brawling group.',
    jaws: '1d6 piercing — finesse, unarmed. Brawling group.',
    tail: '1d4 bludgeoning — agile, finesse, unarmed. Brawling group.',
  };
  const choice = JSON.parse(JSON.stringify(db.feats[id].choice));
  const strikes = db.feats[id].grantedStrikes;
  if (!strikes?.length) fail(`feats/${id} has no grantedStrikes to make durable`);
  for (const o of choice.options ?? []) {
    if (!DESCS[o.value]) fail(`feats/${id} offers "${o.value}", which has no transcribed line`);
    // The description must agree with the strike the same answer actually builds, or the picker
    // describes one attack and the sheet grants another.
    const s = strikes.find((x) => x.choiceValue === o.value);
    if (!s) fail(`feats/${id}: no grantedStrike for "${o.value}"`);
    if (!DESCS[o.value].startsWith(`1${s.die} ${s.damageType}`))
      fail(`feats/${id}: "${o.value}" is described as "${DESCS[o.value]}" but grants 1${s.die} ${s.damageType}`);
    o.description = DESCS[o.value];
  }
  write('feats', id, 'choice', choice);
  write('feats', id, 'grantedStrikes', strikes);
  done.push(`feats/${id}.choice option descriptions + grantedStrikes made durable`);
}

/* ─────────────────────────────────────────────────────────────────────────────── write
 *
 * The spelling fix is only finished if NO sense is left spelt two ways, so that is asserted over the
 * edited db before anything reaches disk — not read back from the file afterwards, where a stale
 * module-level copy would happily report success.
 */
{
  const byKey = new Map();
  const walk = (v, where) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return void v.forEach((x) => walk(x, where));
    for (const s of v.senses ?? []) if (s?.name) (byKey.get(senseKey(s.name)) ?? byKey.set(senseKey(s.name), new Set()).get(senseKey(s.name))).add(s.name);
    for (const x of Object.values(v)) walk(x, where);
  };
  for (const cat of Object.keys(db)) {
    const coll = db[cat];
    if (!coll || typeof coll !== 'object' || Array.isArray(coll)) continue;
    for (const [id, r] of Object.entries(coll)) walk(r, `${cat}/${id}`);
  }
  const left = [...byKey.entries()].filter(([, s]) => s.size > 1);
  if (left.length) fail(`still spelt two ways: ${left.map(([k, s]) => `${k} = ${[...s].join(' / ')}`).join('; ')}`);
}
writeFileSync(CORE, JSON.stringify(db));
writeFileSync(BF, formatBackfill(rows));
console.log(`${done.length} change groups:\n  ${done.join('\n  ')}`);
console.log(`\noverlay rows: ${rows.length}`);
