/*
 * Writes the SYNTHESIZED "full" test character for the visual redesign (e2e/visual/fixtures/redesign-champion.json).
 *
 *   npx jiti e2e/visual/make-redesign-fixture.ts
 *
 * A level-8 champion filled with as much as the rules allow — cause + deity, a raised and dented shield,
 * two weapons, armor, consumables, Fighter Dedication (a borrowed class DC) AND Swashbuckler Dedication
 * (a second borrowed DC and the panache card, through Free Archetype), three Lores, varied skill ranks, a
 * heritage resistance, and a play state with damage, three conditions, spent focus and hero points. It is
 * the stress case the new layout must fit; the plain fighter in roster.json stays the baseline fixture.
 *
 * Built with the app's own buildCharacter() over the real game data (test/_content.ts content()), with the
 * builder state stored beside it so the sheet renders a structurally valid, editable character. Made up:
 * never replace it with a real player's save. Prints the DERIVED numbers the sheet shows (buildCharacter
 * returns the stored character, not the sheet) and every builder choice still open, so a data change that
 * breaks the build is visible here instead of in a picture.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../../test/_content';
import { buildCharacter, emptyBuild, levelChoices, setupMissing, checkPrerequisites, type BuildState } from '../../src/rules/build';
import { applyPlayState, initialPlay, type PlayState } from '../../src/rules/play';
import { deriveAc, deriveClassDc, deriveDefenses, deriveMaxHp, derivePerception, deriveShield, deriveSkill, deriveSpeeds } from '../../src/rules/derive';
import { CATALOG_MODE_MAP } from '../../src/rules/modes';
import type { ProficiencyKey } from '../../src/rules/types';

// The app merges the built-in mode catalog (Raise a Shield, …) into content.modes at load
// (src/data/index.ts); test/_content.ts does not, so do it here or the raised shield reads as nothing.
const raw = content();
const db = { ...raw, modes: { ...CATALOG_MODE_MAP, ...raw.modes } };

export const REDESIGN_FIXTURE_ID = 'c-uitest-champion';

const state: BuildState = {
  ...emptyBuild(),
  name: 'Test Champion',
  level: 8,
  variantRules: { freeArchetype: true },
  classId: 'champion',
  subclassId: 'justice',
  deityId: 'iomedae',
  devotionSpell: 'lay-on-hands',
  keyAbility: 'str',
  ancestryId: 'dwarf',
  heritageId: 'forge-dwarf',
  backgroundId: 'warrior',
  // dwarf: Con, Wis fixed + free (Dex); flaw Cha. warrior: Str (choice) + free (Cha).
  ancestryBoosts: ['dex'],
  backgroundBoosts: ['str', 'cha'],
  levelBoosts: ['str', 'dex', 'cha', 'con'],
  attributeBoosts: { 5: ['str', 'cha', 'con', 'wis'] },
  extraChoices: { blessing: ['blessed-shield'] },
  classSkills: ['athletics', 'lore:heraldry'],
  skillIncreases: { 3: 'athletics', 5: 'lore:warfare', 7: 'athletics' },
  featPicks: {
    '1:ancestry:0': 'dwarven-weapon-familiarity',
    '1:class:1': 'deitys-domain',
    '2:class:0': 'divine-grace',
    '2:skill:1': 'additional-lore',
    '2:archetype:2': 'fighter-dedication',
    '3:general:0': 'toughness',
    '4:class:0': 'mercy',
    '4:skill:1': 'quick-jump',
    '4:archetype:2': 'reactive-striker',
    '5:ancestry:0': 'dwarven-lore',
    '6:class:0': 'shield-warden',
    '6:skill:1': 'cat-fall',
    // Not Fighter Resiliency: it needs a class granting at most 8 + Con HP per level (champion is 10).
    '6:archetype:2': 'basic-maneuver',
    '7:general:0': 'fleet',
    '8:class:0': 'quick-shield-block',
    '8:skill:1': 'hefty-hauler',
    '8:archetype:2': 'swashbuckler-dedication',
  },
  // Deity's Domain: Might (one of Iomedae's domains, a second focus spell + point); Fighter Dedication's
  // class-DC attribute; Mercy of the Body; Swashbuckler style Wit.
  featChoices: { '1:class:1': 'might', '2:archetype:2': 'str', '4:class:0': 'body', '8:archetype:2': 'wit' },
  featLoreChoices: { 'additional-lore:0': 'Architecture' },
  // Basic Maneuver's 1st/2nd-level fighter feat.
  pickFeatChoices: { '6:archetype:2': 'sudden-charge' },
  featSkillChoices: { 'fighter-dedication:0': 'acrobatics', 'swashbuckler-dedication:wit:0': 'diplomacy' },
  languages: [],
  inventory: [
    { itemId: 'longsword', quantity: 1, equipped: true, runes: { potency: 1, striking: 'striking' } },
    { itemId: 'warhammer', quantity: 1, runes: { potency: 1 } },
    { itemId: 'javelin', quantity: 4 },
    { itemId: 'full-plate', quantity: 1, worn: true, runes: { potency: 1 } },
    { itemId: 'steel-shield', quantity: 1, equipped: true },
    { itemId: 'healing-potion-moderate', quantity: 2 },
    { itemId: 'elixir-of-life-lesser', quantity: 1 },
    { itemId: 'antidote-lesser', quantity: 1 },
    { itemId: 'alchemists-fire-lesser', quantity: 3 },
  ],
};

const character = buildCharacter(state, db);

// Play state: what the table left on the sheet mid-adventure.
// The app reads the TRUST-GATED data (src/data/index.ts), which drops fields a record has not earned —
// so the play numbers and the report below are read through the gated copy, the one the sheet uses.
const gatedRaw = content({ trustGate: true });
const view = { ...gatedRaw, modes: { ...CATALOG_MODE_MAP, ...gatedRaw.modes } };
const base = initialPlay(character, view);
const maxHp = deriveMaxHp(character, view);
const play: PlayState = {
  ...base,
  damage: Math.round(maxHp * 0.4),
  heroPoints: 2,
  focusUsed: 1,
  shieldDamage: 7,
  activeModes: ['cat-raise-shield'],
  conditions: [{ id: 'frightened', value: 2 }, { id: 'wounded', value: 1 }, { id: 'off-guard' }],
};

const roster = [{ id: REDESIGN_FIXTURE_ID, character, build: state, play }];

// ---- report: what the sheet will show -------------------------------------------------------------
const sheet = applyPlayState(character, play, view);
const missing = [...setupMissing(state, db), ...levelChoices(state, db).filter((m) => m.required).map((m) => m.label)];
const prereqFails = character.feats
  .map((f) => ({ f, feat: db.feats[f.featId] }))
  .filter((x) => x.feat)
  .map((x) => ({ id: x.f.featId, r: checkPrerequisites(x.feat!, character, db, { atLevel: x.f.level, without: new Set([x.f.featId]) }) }))
  .filter((x) => !x.r.met);
const skillKeys = Object.keys(sheet.proficiencies.skills).filter((k) => sheet.proficiencies.skills[k as ProficiencyKey] !== 'untrained') as ProficiencyKey[];
const def = deriveDefenses(sheet, view);
const shield = deriveShield(sheet, view);
const report = {
  name: sheet.name,
  level: sheet.level,
  abilities: sheet.abilities,
  hp: `${maxHp - play.damage}/${maxHp}`,
  ac: deriveAc(sheet, view).value,
  perception: derivePerception(sheet, view),
  // AC / class DC / skills below are the IN-PLAY numbers (frightened 2, off-guard, shield raised).
  classDc: deriveClassDc(sheet),
  acWithoutPlay: deriveAc(character, view).value,
  secondaryClassDcs: sheet.secondaryClassDcs,
  trainedSkills: skillKeys.map((k) => `${k} ${sheet.proficiencies.skills[k]} ${deriveSkill(sheet, k, view).modifier >= 0 ? '+' : ''}${deriveSkill(sheet, k, view).modifier}`),
  trainedSkillCount: skillKeys.length,
  lores: skillKeys.filter((k) => k.startsWith('lore:')),
  resistances: def.resistances,
  resistanceSources: (def as unknown as { sources?: unknown }).sources,
  weaknesses: def.weaknesses,
  immunities: def.immunities,
  conditions: sheet.conditions,
  shield,
  focus: sheet.focus,
  heroPoints: play.heroPoints,
  feats: character.feats.map((f) => `${f.level}:${f.featId}${db.feats[f.featId]?.actionCost?.type === 'reaction' ? ' [reaction]' : ''}`),
  speeds: deriveSpeeds(sheet, view),
  inventory: character.inventory.map((i) => `${i.itemId}${i.quantity > 1 ? ' x' + i.quantity : ''}${i.equipped ? ' (equipped)' : ''}${i.worn ? ' (worn)' : ''}`),
  openChoices: missing,
  prereqFails,
};
console.log(JSON.stringify(report, null, 2));

// Resolved from this file's own folder, so it lands in e2e/visual/fixtures whatever the current folder is.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures');
const OUT = join(OUT_DIR, 'redesign-champion.json');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(roster) + '\n');
console.log(`wrote ${relative(process.cwd(), OUT)} — ${character.name}, level ${character.level}, ${JSON.stringify(roster).length} bytes`);
