/*
 * Per-character end-to-end verification.
 *
 * Builds every class at every level and checks the numbers the app derives against GROUND TRUTH from
 * the AoN mirror — not against the app's own advancement table, which would be circular.
 *
 * What the mirror gives us per class, structured: starting HP, key attribute, and the LEVEL-1
 * proficiency ranks for Perception, the three saves, every attack category and every defence
 * category. That is exactly the surface where a wrong class table shows up first, and it is checked
 * for all 27 classes rather than sampled.
 *
 * On top of that it asserts the invariants that hold for EVERY character at EVERY level — HP
 * arithmetic, proficiency monotonicity, feat-slot fillability — across 27 classes x 20 levels.
 *
 * Run: npx jiti scripts/verify-characters.mjs [--quiet]   (or `npm run verify`)
 *
 * jiti, NOT plain node: this file imports src/rules/build.ts, whose own imports are extensionless
 * (`from './types'`). Node strips TypeScript types but will not resolve those, so `node
 * scripts/verify-characters.mjs` died on the first import before a single check ran — which is what
 * the header documented for months.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const AON = 'C:/wonderers guide/aon-2e-archive/data/by-category/class/';
process.chdir(ROOT);
const QUIET = process.argv.includes('--quiet');

const { buildCharacter, emptyBuild } = await import(pathToFileURL(ROOT + 'src/rules/build.ts').href);
const derive = await import(pathToFileURL(ROOT + 'src/rules/derive.ts').href);
const { seedContent } = await import(pathToFileURL(ROOT + 'src/rules/seed.ts').href);
const { findDuplicateIds } = await import(pathToFileURL(ROOT + 'src/data/index.ts').href);

const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
db.duplicateIds = findDuplicateIds(db);

/* ---- ground truth ---------------------------------------------------------------------------- */
const truth = new Map();
for (const f of readdirSync(AON)) {
  if (f === '_index.json') continue;
  let s;
  try {
    const o = JSON.parse(readFileSync(AON + f, 'utf8'));
    s = o._source ?? o;
  } catch {
    continue;
  }
  if (!s?.name) continue;
  truth.set(String(s.name).toLowerCase(), s);
}

const RANK = { untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 };
const rankOf = (s) => RANK[String(s ?? '').toLowerCase()] ?? null;

const problems = [];
const note = (cls, msg) => problems.push(`${cls}: ${msg}`);

const mk = (classId, level, subclassId) => {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 'verify',
    level,
    classId,
    keyAbility: cls?.keyAbility?.length === 1 ? cls.keyAbility[0] : (cls?.keyAbility?.[0] ?? 'str'),
    ancestryId: 'human',
    heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: subclassId !== undefined ? subclassId : (cls?.subclass?.options?.[0]?.id ?? null),
  };
};

/* ---- 1. level-1 starting numbers vs the mirror ------------------------------------------------ */
let checkedClasses = 0;
let matchedFields = 0;
for (const [id, cls] of Object.entries(db.classes)) {
  const t = truth.get(String(cls.name).toLowerCase());
  if (!t) {
    note(id, `no AoN class record named "${cls.name}" — cannot verify against ground truth`);
    continue;
  }
  checkedClasses++;
  /*
   * NO SUBCLASS for this comparison. The mirror's structured fields are the BASE class, while a
   * subclass can legitimately raise a level-1 proficiency — a cleric's Battle Creed doctrine grants
   * expert Fortitude and armour training, which read as two failures until the two sides were made
   * to describe the same character. The invariant sweep below keeps the subclass, so both paths run.
   */
  const ch = buildCharacter({ ...mk(id, 1), subclassId: null }, db);

  if (typeof t.hp === 'number') {
    if (cls.hpPerLevel !== t.hp) note(id, `class HP per level is ${cls.hpPerLevel}, AoN says ${t.hp}`);
    else matchedFields++;
  }

  const saves = { fortitude: t.fortitude_proficiency, reflex: t.reflex_proficiency, will: t.will_proficiency };
  for (const [save, want] of Object.entries(saves)) {
    const w = rankOf(want);
    if (w == null) continue;
    const got = rankOf(ch.proficiencies.saves[save]);
    if (got !== w) note(id, `${save} at level 1 is ${ch.proficiencies.saves[save]}, AoN says ${want}`);
    else matchedFields++;
  }
  const wantPerc = rankOf(t.perception_proficiency);
  if (wantPerc != null) {
    const got = rankOf(ch.proficiencies.perception);
    if (got !== wantPerc) note(id, `perception at level 1 is ${ch.proficiencies.perception}, AoN says ${t.perception_proficiency}`);
    else matchedFields++;
  }

  // "Expert in simple weapons", "Trained in all armor", … — parsed rather than assumed.
  const parseLines = (lines, map) => {
    for (const line of lines ?? []) {
      const m = /^(untrained|trained|expert|master|legendary)\s+in\s+(.+)$/i.exec(String(line).replace(/\s+/g, ' ').trim());
      if (!m) continue;
      const want = rankOf(m[1]);
      const what = m[2].toLowerCase();
      for (const [needle, get] of map) {
        if (!what.includes(needle)) continue;
        const got = rankOf(get());
        if (got == null) continue;
        if (got !== want) note(id, `${needle} at level 1 is ${get()}, AoN says ${m[1]}`);
        else matchedFields++;
      }
    }
  };
  parseLines(t.attack_proficiency, [
    ['simple weapons', () => ch.proficiencies.attacks.simple],
    ['martial weapons', () => ch.proficiencies.attacks.martial],
    ['advanced weapons', () => ch.proficiencies.attacks.advanced],
    ['unarmed', () => ch.proficiencies.attacks.unarmed],
  ]);
  /*
   * KEY ATTRIBUTE. The mirror lists it per class ("Strength", or "Strength, Dexterity" where the
   * class offers a choice, or "Dexterity, Other" for the rogue's racket-driven one). Comparing it
   * catches a class whose whole chassis is keyed to the wrong attribute — which every derived number
   * on the sheet then inherits.
   */
  if (Array.isArray(t.attribute) && t.attribute.length) {
    const want = new Set(
      t.attribute
        .map((a) => String(a).slice(0, 3).toLowerCase())
        .filter((a) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(a)),
    );
    const have = new Set(cls.keyAbility ?? []);
    if (want.size) {
      const missing = [...want].filter((a) => !have.has(a));
      // A subset is fine where the mirror says "Other" (the rogue's racket picks it) — an outright
      // mismatch is not.
      if (missing.length && have.size) note(id, `key attribute is ${[...have].join('/')}, AoN says ${t.attribute.join('/')}`);
      else matchedFields++;
    }
  }

  /*
   * FREE SKILL COUNT — "a number of additional skills equal to N plus your Intelligence modifier".
   * The one number in the mirror's skill line that is structured enough to compare, and a class that
   * grants the wrong count is a class whose player is short skills at every level.
   */
  {
    const line = (t.skill_proficiency ?? []).find((l) => /additional skills equal to/i.test(String(l)));
    const m = line && /equal to\s+(\d+)/i.exec(String(line));
    if (m) {
      const want = Number(m[1]);
      const have = cls.trainedSkills?.additional;
      if (typeof have === 'number') {
        if (have !== want) note(id, `grants ${have} free skills, AoN says ${want}`);
        else matchedFields++;
      }
    }
  }

  parseLines(t.defense_proficiency, [
    ['all armor', () => ch.proficiencies.defenses.light],
    ['light armor', () => ch.proficiencies.defenses.light],
    ['medium armor', () => ch.proficiencies.defenses.medium],
    ['heavy armor', () => ch.proficiencies.defenses.heavy],
    ['unarmored defense', () => ch.proficiencies.defenses.unarmored],
  ]);
}

/* ---- 2. invariants across every class at every level, for EVERY SUBCLASS ---------------------- */
/*
 * The sweep used to build options[0] and nothing else: 20 of 160 subclass options, so a sorcerer
 * bloodline, a witch patron or a wizard school that granted the wrong tradition or the wrong
 * level-1 proficiency shipped green. Bloodlines, patrons and schools are the three largest option
 * sets in the game. Two of the options — warpriest and the Battle Creed doctrine — change the
 * ADVANCEMENT TABLE itself, so they are exactly the ones a base-class-only sweep cannot see.
 */
let builds = 0;
let subclassesSwept = 0;
for (const id of Object.keys(db.classes)) {
  const options = db.classes[id].subclass?.options ?? [];
  const subclassIds = options.length ? options.map((o) => o.id) : [null];
  for (const subId of subclassIds) {
    subclassesSwept += subId ? 1 : 0;
    const label = subId ? `${id}/${subId}` : id;
    let prev = null;
    for (let level = 1; level <= 20; level++) {
      let ch;
      try {
        ch = buildCharacter(mk(id, level, subId), db);
      } catch (e) {
        note(label, `throws at level ${level}: ${e.message}`);
        break;
      }
      builds++;

      // HP: ancestry + (class HP + Con) per level. Wrong class HP shows up as a straight-line error.
      const con = Math.floor((ch.abilities.con - 10) / 2);
      const anc = db.ancestries[ch.ancestryId]?.hp ?? 0;
      const expect = anc + (db.classes[id].hpPerLevel + con) * level;
      const got = derive.deriveMaxHp(ch, db);
      if (got !== expect) note(label, `HP at level ${level} is ${got}, expected ${expect} (${anc} ancestry + (${db.classes[id].hpPerLevel}+${con}) x ${level})`);

      // Proficiency NEVER goes backwards as you level.
      if (prev) {
        for (const [k, v] of Object.entries(ch.proficiencies.saves))
          if (rankOf(v) < rankOf(prev.saves[k])) note(label, `${k} DROPS from ${prev.saves[k]} to ${v} at level ${level}`);
        if (rankOf(ch.proficiencies.perception) < rankOf(prev.perception))
          note(label, `perception DROPS from ${prev.perception} to ${ch.proficiencies.perception} at level ${level}`);
        for (const [k, v] of Object.entries(ch.proficiencies.attacks))
          if (rankOf(v) < rankOf(prev.attacks[k] ?? 'untrained')) note(label, `${k} attack DROPS at level ${level}`);
      }
      prev = { saves: { ...ch.proficiencies.saves }, perception: ch.proficiencies.perception, attacks: { ...ch.proficiencies.attacks } };

      // A caster must be able to cast something — and with the TRADITION its subclass sets, which is
      // the failure a base-class-only sweep is blind to (a witch patron or sorcerer bloodline picks it).
      if (db.classes[id].spellcasting) {
        const main = ch.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
        if (!main) note(label, `is a caster but has no spellcasting entry at level ${level}`);
        else if (!['arcane', 'divine', 'occult', 'primal'].includes(main.tradition))
          note(label, `casts with tradition "${main.tradition}" at level ${level}, which is not one of the four`);
      }
    }
  }
}

/* ---- report ----------------------------------------------------------------------------------- */
console.log(`\nclasses verified against the AoN mirror: ${checkedClasses}/${Object.keys(db.classes).length}`);
console.log(`ground-truth fields matched: ${matchedFields}`);
console.log(`subclass options swept: ${subclassesSwept}`);
console.log(`characters built and checked: ${builds}`);
if (!problems.length) {
  console.log('\nNo discrepancies.\n');
  process.exit(0);
}
console.log(`\n${problems.length} DISCREPANCIES:\n`);
const show = QUIET ? problems.slice(0, 25) : problems;
for (const p of show) console.log('  ' + p);
if (show.length < problems.length) console.log(`  …and ${problems.length - show.length} more`);
process.exit(1);
