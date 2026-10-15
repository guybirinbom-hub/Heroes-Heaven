/*
 * VERSATILE VIAL type guard.
 *
 * Alchemy (Player Core 2, class-feature-817): *"A vial you create is always the highest type you could
 * Craft."* Both vial records (`versatile-vial`, the Firework Technician's `pyrotechnic-versatile-vial`)
 * hold the LESSER type and nothing else, so for months the Strikes tab showed an 18th-level alchemist
 * throwing 1d6 — confidently, with no warning, and with no check that would have noticed.
 *
 * This guard states the expected numbers INDEPENDENTLY of src/rules/versatileVial.ts (the table below is
 * written out here on purpose, not imported) and drives the whole app to get the real ones: build a real
 * character, hand them a real vial, derive the real Strike on the trust-GATED content the app runs on,
 * read the damage string the sheet prints. A regression anywhere between the table and the sheet fails.
 *
 * The table, from the sidebar on the live Archives page Classes.aspx?ID=56 (read 2026-10-15; our mirror
 * has no copy of it): lesser Item 1, moderate Item 4, greater Item 12, major Item 18. ⚠ Every other
 * graded bomb (acid flask, alchemist's fire, necrotic bomb …) steps at 1 / 3 / 11 / 17, so the gate most
 * likely to be "corrected" wrongly is exactly the one a sibling suggests. And "could Craft" is Craft's
 * own test (action-2385): master Crafting from item level 9, legendary from 17 — so the ladder below is
 * walked by characters who raise Crafting as early as the rules allow, and one case keeps it trained.
 *
 * Run: npx jiti scripts/vial-tier-check.mjs   (or `npm run scan:vial`; part of `npm run verify`)
 *
 * jiti, NOT plain node — it imports src/rules/*.ts, whose imports are extensionless.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Resolved from THIS file, so the guard checks the tree it lives in (a worktree lane included).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(join(ROOT, p)).href;

const { buildCharacter, emptyBuild } = await import(src('src/rules/build.ts'));
const { deriveStrike } = await import(src('src/rules/derive.ts'));
const { seedContent } = await import(src('src/rules/seed.ts'));
const { findDuplicateIds } = await import(src('src/data/index.ts'));
const { applyTrustGate } = await import(src('src/data/trustGate.ts'));

const core = applyTrustGate(JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8')));
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
db.duplicateIds = findDuplicateIds(db);

/* Expected per CHARACTER level, stated here rather than imported. */
const EXPECTED = (level) =>
  level >= 18 ? { tier: 'major', dice: 4, itemAttack: 3, splash: 4 }
    : level >= 12 ? { tier: 'greater', dice: 3, itemAttack: 2, splash: 3 }
      : level >= 4 ? { tier: 'moderate', dice: 2, itemAttack: 1, splash: 2 }
        : { tier: 'lesser', dice: 1, itemAttack: 0, splash: 1 };

const problems = [];
const fail = (msg) => problems.push(msg);

const VIALS = { 'versatile-vial': 'acid', 'pyrotechnic-versatile-vial': 'fire' };
for (const [id, type] of Object.entries(VIALS)) {
  const item = db.items[id];
  if (!item) fail(`items['${id}'] is missing from public/core.json — the lane has nothing to scale`);
  else if (item.damage?.dice !== 1 || item.damage?.die !== 'd6' || item.damage?.type !== type)
    fail(`items['${id}'] no longer holds the LESSER ${type} statistics (${JSON.stringify(item.damage)}); this guard's premise changed`);
}

const held = (itemId) => ({ instanceId: 'vial', itemId, quantity: 1, equipped: true });
const buildAt = (classId, level, over = {}) => {
  const cls = db.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 'vial-guard',
      level,
      classId,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: cls?.keyAbility?.length === 1 ? cls.keyAbility[0] : null,
      subclassId: cls?.subclass?.options?.[0]?.id ?? null,
      ...over,
    },
    db,
  );
};
const strikeOf = (ch, itemId) => deriveStrike({ ...ch, inventory: [held(itemId)] }, db, held(itemId));
/* Crafting raised at the skill increases that reach legendary by 15th, for this class's schedule. */
const crafting = (level, at) => Object.fromEntries(at.filter((l) => l <= level).map((l) => [l, 'crafting']));

/* ---- every level, both vial kinds -------------------------------------------------------------- */
const ladder = (label, makeCharacter, itemId, fromLevel) => {
  let n = 0;
  const type = VIALS[itemId];
  for (let level = fromLevel; level <= 20; level++) {
    const s = strikeOf(makeCharacter(level), itemId);
    const want = EXPECTED(level);
    if (!s) { fail(`${label} ${level}: an equipped ${itemId} produced no Strike at all`); continue; }
    const printed = /^(\d+)d6\b/.exec(s.damage);
    if (!printed) fail(`${label} ${level}: damage "${s.damage}" does not open with Nd6 dice`);
    else if (Number(printed[1]) !== want.dice)
      fail(`${label} ${level}: shows ${printed[1]}d6, expected ${want.dice}d6 (${want.tier} vial) — "${s.damage}"`);
    if (!s.damage.includes(` ${type} `) && !s.damage.startsWith(`${want.dice}d6 ${type}`))
      fail(`${label} ${level}: "${s.damage}" does not deal ${type}`);
    if (!s.damage.includes(`plus ${want.splash} ${type} splash`))
      fail(`${label} ${level}: "${s.damage}" lacks the ${want.tier} vial's ${want.splash} ${type} splash`);
    if (s.potencyBonus !== want.itemAttack)
      fail(`${label} ${level}: item bonus to attack is ${s.potencyBonus}, expected +${want.itemAttack} (${want.tier} vial)`);
    n++;
  }
  return n;
};
let checked = 0;
checked += ladder('alchemist', (l) => buildAt('alchemist', l, { skillIncreases: crafting(l, [3, 7, 15]) }), 'versatile-vial', 1);
const fireworkTech = (l) =>
  buildAt('fighter', l, { featPicks: { '2:class': 'firework-technician-dedication' }, skillIncreases: crafting(l, [3, 5, 7, 15]) });
if (!fireworkTech(2).feats.some((f) => f.featId === 'firework-technician-dedication'))
  fail('fixture: Firework Technician Dedication did not land on the fighter');
else checked += ladder('Firework Technician', fireworkTech, 'pyrotechnic-versatile-vial', 2);

/* ---- the headline, asserted on its own so a failure names it ------------------------------------ */
{
  const s = strikeOf(buildAt('alchemist', 12, { skillIncreases: crafting(12, [3, 7]) }), 'versatile-vial');
  if (!s || !/^3d6\b/.test(s.damage))
    fail(`THE HEADLINE CASE: a 12th-level alchemist (master Crafting) shows "${s?.damage ?? 'no Strike'}", expected 3d6`);
}

/* ---- Craft's rank test: a 12th-level alchemist who never raised Crafting throws a moderate vial ---- */
{
  const ch = buildAt('alchemist', 12);
  if (ch.proficiencies.skills.crafting !== 'trained') fail(`fixture: the untouched 12th-level alchemist has ${ch.proficiencies.skills.crafting} Crafting, expected trained`);
  else {
    const s = strikeOf(ch, 'versatile-vial');
    if (!s || !/^2d6 acid plus 2 acid splash/.test(s.damage) || s.potencyBonus !== 1)
      fail(`a 12th-level alchemist with trained Crafting shows "${s?.damage}" +${s?.potencyBonus}, expected a moderate vial (2d6, +1): greater needs master Crafting`);
  }
}

/* ---- the vial counter and the bomb type must agree, maker by maker (master Crafting at 12th) ------ */
const at12 = { skillIncreases: crafting(12, [3, 5, 7]) };
const CASES = [
  ['Alchemist Dedication', buildAt('fighter', 12, { featPicks: { '2:class': 'alchemist-dedication' }, ...at12 }), true, 'versatile-vial'],
  ['Wandering Chef Dedication', buildAt('fighter', 12, { featPicks: { '2:class': 'wandering-chef-dedication' }, ...at12 }), true, 'versatile-vial'],
  ['Munitions Machinist', buildAt('gunslinger', 12, { featPicks: { '6:class': 'munitions-machinist' }, ...at12 }), true, 'versatile-vial'],
  // Sets `advancedAlchemy` and grants NO vials: keying the type to that field would tier this one.
  ['Herbalist Dedication', buildAt('fighter', 12, { featPicks: { '2:class': 'herbalist-dedication' }, ...at12 }), false, 'versatile-vial'],
  // A vial someone else made: the sheet cannot know that maker's level, so the printed lesser type.
  ['plain fighter', buildAt('fighter', 12, at12), false, 'versatile-vial'],
];
for (const [label, ch, maker, vial] of CASES) {
  const counter = 'versatile-vials' in (ch.classResources ?? {});
  if (counter !== maker) fail(`fixture: ${label} ${maker ? 'has no' : 'has a'} versatile-vials counter`);
  const s = strikeOf(ch, vial);
  const tiered = !!s && !/^1d6\b/.test(s.damage);
  if (tiered !== counter) fail(`${label}: vial counter ${counter ? 'present' : 'absent'} but the bomb ${tiered ? 'tiered' : 'did not tier'} — "${s?.damage}"`);
}

/* ---- per KIND: the Firework Technician makes only pyrotechnic vials, and nobody else makes those -- */
{
  const s = strikeOf(fireworkTech(18), 'versatile-vial');
  if (!s || !/^1d6\b/.test(s.damage)) fail(`a Firework Technician's plain acid vial shows "${s?.damage}" — they make only pyrotechnic ones, so it stays lesser`);
  const p = strikeOf(buildAt('alchemist', 18, { skillIncreases: crafting(18, [3, 7, 15]) }), 'pyrotechnic-versatile-vial');
  if (!p || !/^1d6\b/.test(p.damage)) fail(`a plain alchemist's pyrotechnic vial shows "${p?.damage}" — only a Firework Technician makes those, so it stays lesser`);
}

/* ---- the type belongs to the VIAL, not to the bomb group ---------------------------------------- */
{
  const sibling = 'necrotic-bomb-lesser';
  if (!db.items[sibling]) fail(`fixture: items['${sibling}'] is missing`);
  else {
    const s = strikeOf(buildAt('alchemist', 18), sibling);
    if (!s || !/^1d6\b/.test(s.damage) || s.potencyBonus !== 0) fail(`the vial type leaked onto ${sibling}: "${s?.damage}", +${s?.potencyBonus}`);
  }
}

/* ---- report ------------------------------------------------------------------------------------- */
console.log(`\nversatile vial: ${checked} levels checked (alchemist 1-20, Firework Technician 2-20), plus ${CASES.length + 4} who-scales cases`);
if (!problems.length) {
  console.log('No discrepancies. A 12th-level alchemist throws 3d6.\n');
  process.exit(0);
}
console.log(`\n${problems.length} DISCREPANCIES:\n`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
