/*
 * Ruling Q25 — the dedication feats whose "Special" clause DIFFERS from the general archetype rule.
 *
 * The rule itself is general and already applied by `dedicationBlock`'s default. Player Core,
 * *Archetypes*: *"once you select a dedication feat for an archetype, you must satisfy its
 * requirements before you can gain another dedication feat. Typically, you satisfy an archetype
 * dedication feat by gaining a certain number of feats from the archetype's list."* — the "typically"
 * is two, and the Remaster stopped restating it on each dedication. What is left printed on a feat is
 * therefore the EXCEPTION, and that is what this file records.
 *
 * ⚠ Every entry quotes the sentence it was read from. A gate with no quote is a guess, and a guess
 * here either hands out a dedication the rules withhold or blocks a legal pick.
 *
 * ⚠ The imported descriptions are UNUSABLE as the source: the importer dropped the archetype LINKS
 * out of these sentences, leaving "two other feats from the or archetype" on five of the thirteen.
 * The quotes below are the AoN archive's own text (C:/wonderers guide/aon-2e-archive/data), read per
 * record, and the script re-reads the archive to prove each quote is still the record's own sentence
 * rather than trusting this file.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const ARCHIVE = 'C:/wonderers guide/aon-2e-archive/data/by-category/feat/';
const CORE = ROOT + 'public/core.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';
const db = JSON.parse(readFileSync(CORE, 'utf8'));
const rows = readBackfill(ROOT);

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/**
 * The thirteen. `quote` is the record's own Special clause; `gate` is that sentence in fields.
 *
 * Six of them (wellspring mage, spell trickster, soul warden, undead slayer, mummy, harrower) restate
 * the DEFAULT — two feats, own archetype, no exception. They are authored anyway: the owner's ruling
 * is that the gate comes from the feat's own text read per record, and a record that carries its
 * reading is a record the next pass does not have to re-adjudicate.
 */
const GATES = {
  // "You cannot select another dedication feat other than Halcyon Speaker Dedication until you have
  //  gained two other feats from the Magaambyan Attendant or halcyon speaker archetype."
  'magaambyan-attendant-dedication': {
    quote: 'other than Halcyon Speaker Dedication until you have gained two other feats from the Magaambyan Attendant or halcyon speaker archetype',
    gate: { archetypes: ['magaambyan-attendant', 'halcyon-speaker'], count: 2, except: ['halcyon-speaker-dedication'] },
  },
  // "You cannot select another dedication feat until you have gained one other feat from the juggler
  //  archetype."  ⚠ ONE, not two — the only record in the game that lowers the count.
  'juggler-dedication': {
    quote: 'until you have gained one other feat from the juggler archetype',
    gate: { archetypes: ['juggler'], count: 1 },
  },
  // "You can't select another dedication feat until you gain two other feats from the Jalmeri
  //  Heavenseeker or Student of Perfection archetypes."
  'jalmeri-heavenseeker-dedication': {
    quote: 'two other feats from the Jalmeri Heavenseeker or Student of Perfection archetypes',
    gate: { archetypes: ['jalmeri-heavenseeker', 'student-of-perfection'], count: 2 },
  },
  // "You can't select another dedication feat other than Beast Gunner Dedication until you've gained
  //  two other feats from the spellshot or beast gunner archetypes."
  'spellshot-dedication': {
    quote: 'other than Beast Gunner Dedication until you',
    gate: { archetypes: ['spellshot', 'beast-gunner'], count: 2, except: ['beast-gunner-dedication'] },
  },
  /*
   * ⚠ TWO sentences, and the first pass read only the second.
   *
   * "You can take Familiar Sage Dedication even if you haven't yet gained three feats from the
   *  familiar master archetype, AND YOU CAN TAKE FAMILIAR MASTER DEDICATION EVEN IF YOU HAVEN'T YET
   *  GAINED THREE FEATS FROM THE FAMILIAR SAGE ARCHETYPE. You can't select another dedication feat
   *  until you've gained two other feats from the familiar master or familiar sage archetypes."
   *
   * The gate came from the last sentence alone, so a character holding Familiar Sage Dedication was
   * blocked from the one dedication the clause names as allowed — `dedicationBlock` escapes solely
   * via `gate.except`. The quote is therefore widened to span both sentences, which is what makes the
   * archive check above vouch for the exception rather than only for the count.
   *
   * The mirrored half ("you can take Familiar Sage Dedication even if…") needs nothing: the Remaster
   * `familiar-master-dedication` prints no Special clause and so carries no gate to except from.
   */
  'familiar-sage-dedication': {
    quote:
      'you can take Familiar Master Dedication even if you haven’t yet gained three feats from the familiar sage archetype. ' +
      'You can’t select another dedication feat until you’ve gained two other feats from the familiar master or familiar sage archetypes',
    gate: { archetypes: ['familiar-master', 'familiar-sage'], count: 2, except: ['familiar-master-dedication'] },
  },
  // "You can't select another dedication feat until you have gained at least two other feats from the
  //  scion of Domora or familiar master archetypes."
  'scion-of-domora-dedication': {
    quote: 'at least two other feats from the scion of Domora or familiar master archetypes',
    gate: { archetypes: ['scions-of-domora', 'familiar-master'], count: 2 },
  },

  // ---- the six that restate the default ------------------------------------------------------
  // "You can't select another dedication feat until you gain two other feats from the wellspring mage archetype."
  'wellspring-mage-dedication': {
    quote: 'two other feats from the wellspring mage archetype',
    gate: { archetypes: ['wellspring-mage'], count: 2 },
  },
  // "You can’t select another dedication feat until you have gained two other feats from the spell trickster archetype."
  'spell-trickster-dedication': {
    quote: 'two other feats from the spell trickster archetype',
    gate: { archetypes: ['spell-trickster'], count: 2 },
  },
  // "You can't select another dedication feat until you have gained two other feats from the soul warden archetype."
  'soul-warden-dedication': {
    quote: 'two other feats from the soul warden archetype',
    gate: { archetypes: ['soul-warden'], count: 2 },
  },
  // "You can't select another dedication feat until you have gained two other feats from the undead slayer archetype."
  'undead-slayer-dedication': {
    quote: 'two other feats from the undead slayer archetype',
    gate: { archetypes: ['undead-slayer'], count: 2 },
  },
  // "You can't select another dedication feat until you have gained two other feats from the mummy archetype."
  'mummy-dedication': {
    quote: 'two other feats from the mummy archetype',
    gate: { archetypes: ['mummy'], count: 2 },
  },
  // "You can't select another dedication feat until you've gained two other feats from the harrower archetype."
  'harrower-dedication': {
    quote: 'two other feats from the harrower archetype',
    gate: { archetypes: ['harrower'], count: 2 },
  },

  /*
   * The two LEGACY Knight Vigilant records. Both carry the clause and NEITHER carries an `archetype`
   * field, so the default — which reads `archetype` to know what to count — silently gated nothing:
   * a character holding one of them could take a second dedication immediately. Naming the archetype
   * here is what makes the default apply to them at all.
   *
   * `knight-vigilant-dedication` (the live Remaster record) does carry `archetype: knight-vigilant`,
   * prints no Special clause, and is correctly left to the default.
   */
  // "You cannot select another dedication feat until you have gained two other feats from the Knight
  //  Vigilant archetype."
  'knight-vigilant': { quote: 'two other feats from the Knight Vigilant archetype', gate: { archetypes: ['knight-vigilant'], count: 2 } },
  'aon-knight-vigilant': { quote: 'two other feats from the Knight Vigilant archetype', gate: { archetypes: ['knight-vigilant'], count: 2 } },
};

/* -------------------------------------------------------------------------- verification ------- */

/** The record's own text from the AoN archive, keyed by the `aonId` core.json already stores. */
function archiveText(aonId) {
  const file = ARCHIVE + aonId + '.json';
  if (!existsSync(file)) return null;
  return String(JSON.parse(readFileSync(file, 'utf8')).text ?? '').replace(/\s+/g, ' ');
}

// The two knight-vigilant records point at archetype-27 / feat-1092; only the feat file is in this
// category folder, so the pair shares one source and one quote.
const KNIGHT_SOURCE = 'feat-1092';

let checked = 0;
for (const [id, { quote }] of Object.entries(GATES)) {
  const rec = db.feats[id];
  if (!rec) fail(`${id} is not in core.json`);
  if (!rec.traits?.includes('dedication')) fail(`${id} is not a dedication feat — the gate would never fire`);
  const aonId = id.includes('knight-vigilant') ? KNIGHT_SOURCE : rec.aonId;
  const text = archiveText(aonId);
  if (text == null) {
    console.warn(`!! ${id}: no archive copy at ${aonId} — quote unverified`);
    continue;
  }
  // Apostrophes differ between the archive's curly ’ and this file's straight '; nothing else may.
  const norm = (s) => s.replace(/[’']/g, "'").toLowerCase();
  if (!norm(text).includes(norm(quote))) fail(`${id}: the archive text no longer contains "${quote}"`);
  checked++;
}

// Every archetype named must be one whose feats exist, or the requirement can never be satisfied and
// the dedication becomes a permanent lock.
const archetypes = new Set(Object.values(db.feats).map((f) => f.archetype).filter(Boolean));
for (const [id, { gate }] of Object.entries(GATES)) {
  for (const a of gate.archetypes) if (!archetypes.has(a)) fail(`${id}: no feat carries archetype "${a}"`);
  for (const e of gate.except ?? []) {
    if (!db.feats[e]) fail(`${id}: exception "${e}" is not a feat`);
    if (!db.feats[e].traits?.includes('dedication')) fail(`${id}: exception "${e}" is not a dedication`);
  }
  // A count no archetype can reach is the same permanent lock by another route.
  const available = Object.values(db.feats).filter(
    (f) => gate.archetypes.includes(f.archetype) && !f.traits?.includes('dedication'),
  ).length;
  if (available < gate.count) fail(`${id}: needs ${gate.count} feats but only ${available} non-dedication feats exist for it`);
}

/*
 * The clause is NOT general — every other dedication is left to the default. Measured here rather
 * than asserted, because the ruling turns on the number: if a future import starts printing the
 * clause on more records, this is the line that notices.
 */
const printing = Object.entries(db.feats).filter(([, f]) => f.traits?.includes('dedication')).length;

/* ------------------------------------------------------------------------------- writes -------- */

for (const [id, { gate }] of Object.entries(GATES)) {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === id && r.field === 'dedicationGate' && !r.path);
  const row = { category: 'feats', id, field: 'dedicationGate', value: gate };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  db.feats[id].dedicationGate = gate;
}

writeBackfill(ROOT, rows);
writeFileSync(CORE, JSON.stringify(db));
console.log(
  `${Object.keys(GATES).length} dedication gates written (${checked} quotes verified against the AoN archive); ` +
    // Owner ruling Q28 removed the general default — "only feats that say it" — so the rest gate
    // nothing at all. Saying "left to the default" here would vouch for behaviour that was deleted.
    `${printing - Object.keys(GATES).length} dedications carry no clause and so are not gated\n` +
    `written: ${BF}, ${CORE}`,
);
