/*
 * ORPHAN CLASS FEATURES — records no character can ever own.
 *
 * A classFeature that no route reaches is invisible however many fields it carries, and it LOOKS
 * built, which makes it the most expensive failure mode in this data.
 *
 * Reachability is measured by BUILDING CHARACTERS and reading `ownedFeatureIds` off each one — every
 * class, every subclass, every extra-choice option, every level threshold, plus the feats that hand
 * a feature over. Driving the reachability helpers directly is not enough and produced a wrong
 * answer once already: several routes exist only INSIDE buildCharacter, which is where a
 * thaumaturge's implement benefits are resolved (levels 7/11/17, Intense Implement, the paragon
 * gate). Measured against the helpers those 30 records looked unreachable; measured against a real
 * character they were never missing.
 *
 *   npx jiti scripts/orphan-features.mjs                 # summary
 *   npx jiti scripts/orphan-features.mjs --out work/orphans.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { buildCharacter, emptyBuild, inventorModificationOptions } from '../src/rules/build';
import { ownedFeatureIds, choiceOwnedFeatureIds } from '../src/rules/derive';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* Content exactly as the app assembles it, descriptions merged back in. */
const core = JSON.parse(read('public/core.json'));
{
  const desc = JSON.parse(read('public/core-descriptions.json'));
  for (const [bucket, records] of Object.entries(desc)) {
    if (!core[bucket]) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = core[bucket][id];
      if (rec && v.d !== undefined) rec.description = v.d;
    }
  }
}
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) {
  db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
}

const features = db.classFeatures ?? {};
const reachable = new Set();
const routeOf = new Map();
const note = (ids, route) => {
  for (const id of ids) {
    if (!features[id]) continue;
    if (!reachable.has(id)) routeOf.set(id, route);
    reachable.add(id);
  }
};

const anc = Object.keys(db.ancestries)[0];
const bg = Object.keys(db.backgrounds)[0];
const mk = (over) =>
  buildCharacter(
    { ...emptyBuild(), ancestryId: anc, backgroundId: bg, level: 20, keyAbility: 'str', ...over },
    db,
  );

/* ── 1. Every class × every subclass, at every level a feature can arrive. ─────────────────────── */
const LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 20];
let built = 0;
for (const cls of Object.values(db.classes ?? {})) {
  const subs = [null, ...(cls.subclass?.options ?? []).map((o) => o.id)];
  for (const sub of subs) {
    for (const level of LEVELS) {
      const ch = mk({ classId: cls.id, subclassId: sub, level });
      built++;
      note(ownedFeatureIds(ch, db), `class:${cls.id}${sub ? `/${sub}` : ''}`);
    }
  }
  /* ── 2. Extra choices (implements, ikons, apparitions, elements, curricula). Every option in every
   *      slot of every group, because the SLOT decides the level a pick counts from. ──────────── */
  for (const g of cls.extraChoices ?? []) {
    const slots = Math.max(...Object.values(g.pickByLevel ?? { 1: 1 }));
    for (const o of g.options ?? []) {
      for (let slot = 0; slot < slots; slot++) {
        const picks = Array.from({ length: slot + 1 }, (_, i) => (i === slot ? o.id : g.options[i % g.options.length].id));
        const ch = mk({ classId: cls.id, subclassId: cls.subclass?.options?.[0]?.id ?? null, level: 20, extraChoices: { [g.id]: picks }, implementAdept: o.id });
        built++;
        note(ownedFeatureIds(ch, db), `extraChoice:${cls.id}/${g.id}`);
      }
    }
  }
}

/* ── 3. Feats: a feature can arrive through a feat's own grant, a choice that OWNS a feature, or a
 *      derivedGrant chain. Enumerated over the whole feat list rather than by building a character
 *      per feat, which would be ~6,000 builds for the same answer. ───────────────────────────── */
{
  const featShapes = [];
  for (const f of Object.values(db.feats ?? {})) {
    if (f.choice?.options?.length) for (const o of f.choice.options) featShapes.push({ featId: f.id, choice: { value: o.value ?? o.id } });
    else featShapes.push({ featId: f.id });
  }
  note(choiceOwnedFeatureIds(featShapes, db), 'featChoice');
}
/* …and `grantsClassFeatures` / a class archetype's `addFeatures`, from anywhere, transitively. */
const walkGrants = (node, src) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((v) => walkGrants(v, src));
  for (const [k, v] of Object.entries(node)) {
    if (k === 'grantsClassFeatures') note(Array.isArray(v) ? v : [v], src);
    else if (k === 'addFeatures') note((Array.isArray(v) ? v : [v]).map((a) => a?.featureId).filter(Boolean), src);
    else walkGrants(v, src);
  }
};
for (const [bucket, records] of Object.entries(db)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [id, rec] of Object.entries(records)) walkGrants(rec, `${bucket}:${id}`);
}
for (let pass = 0; pass < 8; pass++) {
  const before = reachable.size;
  for (const id of [...reachable]) walkGrants(features[id], `classFeatures:${id}`);
  if (reachable.size === before) break;
}
/* ── 4. Build fields of their own: the inventor's chosen MODIFICATIONS and the mythic CALLING. ──
 *      Both are class features stored outside classChoices, so nothing above sees them. The
 *      modification list is taken from the shipped `inventorModificationOptions`, not from a tag
 *      match — a modification the picker filters out (a power-suit mod on a subterfuge suit) is
 *      genuinely unreachable for that build and must not be credited. */
for (const sub of ['armor-innovation', 'weapon-innovation', 'construct-innovation']) {
  for (const armorStats of ['power-suit', 'subterfuge-suit', undefined]) {
    const type = sub === 'armor-innovation' ? 'armor' : sub === 'weapon-innovation' ? 'weapon' : 'construct';
    const opts = inventorModificationOptions(db, type, armorStats, 20);
    for (const o of opts) {
      const ch = mk({
        classId: 'inventor',
        subclassId: sub,
        level: 20,
        inventorArmorStats: armorStats ?? null,
        inventorModifications: { initial: o.id, breakthrough: o.id, revolutionary: o.id },
      });
      built++;
      note(ownedFeatureIds(ch, db), `inventor:${type}-modification`);
    }
  }
}
for (const id of Object.keys(features)) {
  const ch = mk({ classId: 'fighter', level: 20, mythicCalling: id, variantRules: { mythic: true } });
  if (ownedFeatureIds(ch, db).has(id)) note([id], 'mythic:calling');
}

/** Fields whose absence actually costs the player something. */
const MECHANICAL = [
  'grant', 'grants', 'effectChoices', 'choice', 'proficiencies', 'skills', 'skillChoices',
  'passiveEffects', 'situational', 'defenses', 'senses', 'resistances', 'immunities', 'weaknesses',
  'spellcasting', 'focusPool', 'innateSpells', 'spellListAdditions', 'restrictedSlots',
  'grantsActions', 'grantsRituals', 'extraReaction', 'limitedUses', 'classResource', 'modes',
  'companion', 'strikes', 'speeds', 'hpPerLevel', 'classArchetype', 'weaponGroupRanks',
  'checkPenaltyRelief', 'spellSlotBonus', 'spellcastingGrant', 'featChoices', 'uses', 'modifiesGrant',
];
/**
 * Why an unreachable record is unreachable.
 *
 * Most of them are not losses. The import split some records in two, so the LIVE copy is an action
 * (a commander tactic, a wizard's Drain Bonded Item) or a subclass option (the runelord school is a
 * strict superset of `school-of-thassilonian-rune-magic`), and the classFeature twin was never meant
 * to be reached. Others are legacy content the Remaster replaced. Only what is left after both is a
 * gap, and reporting a raw count without this distinction is how "181 orphans" turned into a number
 * nobody could act on.
 */
const classify = (id, rec) => {
  const ed = rec.edition;
  if (ed === 'legacy' || ed === 'legacy-era' || ed === 'superseded') return 'legacy';
  const action = db.actions?.[id];
  if (action) return 'duplicate:action';
  /*
   * A reachable feature that carries everything this one does, with the same VALUES.
   *
   * Matching on the name is not enough and misses the case that matters: the runelord subclass
   * option is `School of Thassilonian Rune Magic` under a different id, offers the identical seven
   * sins, and adds the curriculum on top. Comparing the field values catches it and cannot mistake
   * two records that merely share a shape.
   */
  const mine = MECHANICAL.filter((f) => rec[f] != null);
  /*
   * Compared by SHAPE, not by deep equality. The reachable twin is usually the better record — the
   * runelord subclass offers the same seven sins, and additionally grants each sin's focus spell and
   * carries its anathema. Deep equality would call that a difference and report a bare duplicate as
   * a loss; the shape says "asks the same question, answers it better".
   */
  const shape = (v) => {
    if (Array.isArray(v)) return v.map(shape).sort().join('|');
    if (v && typeof v === 'object') {
      const key = v.id ?? v.value ?? null;
      return key != null ? String(key) : Object.keys(v).sort().join(',');
    }
    return String(v);
  };
  for (const other of reachable) {
    const o = features[other];
    if (!o || !mine.length) continue;
    if (mine.every((f) => o[f] != null && shape(o[f]) === shape(rec[f]))) return `duplicate:${other}`;
  }
  // A record whose text is a section heading for options that ARE reachable (witch patron themes).
  if (!mine.length) return 'no-mechanics';
  return 'open';
};

const orphans = [];
for (const [id, rec] of Object.entries(features)) {
  if (reachable.has(id)) continue;
  const fields = MECHANICAL.filter((f) => rec[f] != null && (!Array.isArray(rec[f]) || rec[f].length));
  orphans.push({
    id,
    name: rec.name,
    level: rec.level ?? null,
    otherTags: rec.otherTags ?? [],
    traits: rec.traits ?? [],
    mechanicalFields: fields,
    why: classify(id, rec),
    description: String(rec.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  });
}
orphans.sort((a, b) => b.mechanicalFields.length - a.mechanicalFields.length || a.id.localeCompare(b.id));

const withFields = orphans.filter((o) => o.mechanicalFields.length);
const open = withFields.filter((o) => o.why === 'open');
const byWhy = {};
for (const o of withFields) byWhy[o.why.split(':')[0]] = (byWhy[o.why.split(':')[0]] ?? 0) + 1;
console.log(`characters built:  ${built}`);
console.log(`classFeatures:     ${Object.keys(features).length}`);
console.log(`reachable:         ${reachable.size}`);
console.log(`unreachable:       ${orphans.length}   (${withFields.length} carry a live mechanical field)`);
console.log(`  of those: ${Object.entries(byWhy).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log(`\nOPEN (a real loss): ${open.length}`);
for (const o of open) console.log(`  ! ${o.id.padEnd(40)} ${o.mechanicalFields.join(',')}`);
for (const o of withFields.filter((x) => x.why !== 'open')) console.log(`  · ${o.id.padEnd(40)} ${o.why}`);

const outIdx = process.argv.indexOf('--out');
if (outIdx > -1 && process.argv[outIdx + 1]) {
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, process.argv[outIdx + 1]), JSON.stringify(orphans, null, 1));
  console.log(`\nwrote ${orphans.length} -> ${process.argv[outIdx + 1]}`);
}
