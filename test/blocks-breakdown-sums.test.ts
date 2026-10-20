import { describe, expect, it } from 'vitest';
import type { StoredBlock } from '../src/rules/blocks/stored';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveAc, deriveClassDc, deriveMaxHp, derivePerception, deriveSave, deriveSkill, deriveSpeeds, deriveSpellcasting } from '../src/rules/derive';
import { explainStat, type StatRef } from '../src/rules/explain';
import { deriveInitiative } from '../src/rules/initiative';
import { CATALOG_MODE_MAP } from '../src/rules/modes';
import { applyPlayState, initialPlay, type PlayState } from '../src/rules/play';
import { SKILLS, type AbilityId, type Character, type ContentDatabase, type ModeDef, type ProficiencyKey, type SaveId } from '../src/rules/types';
import { content } from './_content';

/**
 * THE BREAKDOWN SUMS TO THE NUMBER (docs/overrides-redesign.md, Building blocks item 5; spec items 7, 8
 * and 14): for every main stat of spec item 8, on a spread of characters — every class, gear, every
 * kind of condition, modes (typed, attribute, max HP, Speed, battle form), a stance, rage and panache,
 * and tweak blocks of every number kind — the breakdown's parts add up to the number the sheet shows.
 * Both read ONE term list (blocks/terms.ts), so this holds by construction; this file is the guard
 * that a later edit cannot break it quietly.
 *
 * The sum rule, per stat:
 *   - skill, Lore, save, Perception: Σ parts = the modifier (a substitution adds a "<Skill> instead" line).
 *   - AC, class DC, spell DC: Σ parts = the number; "Base 10" is a part. A battle form's AC and a fixed
 *     spell DC are one line.
 *   - spell attack: Σ parts = the modifier.
 *   - Initiative: Σ parts = Initiative — the lines of the statistic it rolls, then its own.
 *   - max HP: Σ parts = max HP ("Minimum 0" when the total went below 0; a manual max HP is one line).
 *   - land Speed: Σ parts = the Speed shown ("Temporary Speed" when one is set in play).
 *   - attribute score: "Base 10" + "Boosts & flaws" + one line per tweak = the score.
 * Synthetic characters only.
 */

const base = content();
const USER_STR: ModeDef = { id: 'test-str-mod', name: 'Test: +1 Strength modifier', modifiers: [{ value: 1, type: 'status', target: 'ability', detail: 'str' }] };
const USER_TYPED: ModeDef = {
  id: 'test-typed',
  name: 'Test: typed spread',
  modifiers: [
    { value: 2, type: 'circumstance', target: 'ac' },
    { value: 1, type: 'status', target: 'save' },
    { value: -1, type: 'status', target: 'all-checks' },
    { value: 5, type: 'untyped', target: 'max-hp' },
    { value: 5, type: 'status', target: 'speed' },
    { value: 2, type: 'circumstance', target: 'initiative' },
  ],
};
/** The modes the app merges in at load (the catalog, then the player's own), as mergeWithSeed does. */
const db: ContentDatabase = { ...base, modes: { ...CATALOG_MODE_MAP, ...(base.modes ?? {}), [USER_STR.id]: USER_STR, [USER_TYPED.id]: USER_TYPED } };

const ABILS: AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  const key = (cls.keyAbility.length === 1 ? cls.keyAbility[0] : cls.keyAbility[0] ?? 'str') as AbilityId;
  const four = [...new Set([key, 'con', 'dex', 'wis', 'str'] as AbilityId[])].slice(0, 4);
  const attributeBoosts: Record<number, AbilityId[]> = {};
  for (const L of [5, 10, 15, 20]) if (L <= level) attributeBoosts[L] = [...four];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: key,
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: four,
    attributeBoosts,
    ...more,
  } as BuildState;
}

let bid = 0;
const blk = (kind: string, target: string, value: number, more: Partial<StoredBlock> = {}): StoredBlock => ({ id: `b${++bid}`, kind, v: 1, target, value, ...more });
/** Tweak blocks of every number kind, aimed across every stat of spec item 8. */
function everyKindBlocks(entryIds: string[]): StoredBlock[] {
  const out: StoredBlock[] = [
    blk('number.add', 'ac', 1),
    blk('number.add', 'save:fortitude', 2, { bonusType: 'status' }),
    blk('number.set', 'save:reflex', 14),
    blk('number.atLeast', 'save:will', 30),
    blk('number.atLeast', 'perception', -5),
    blk('number.add', 'skill:athletics', -2),
    blk('number.set', 'skill:stealth', 9),
    blk('number.add', 'skill:lore:scribing', 3, { bonusType: 'item' }),
    blk('number.atLeast', 'class-dc', 25),
    blk('number.set', 'initiative', 7),
    blk('number.add', 'max-hp', 4),
    blk('number.atLeast', 'max-hp', 500),
    blk('number.set', 'speed:land', 40),
    blk('number.add', 'speed:land', 5),
    blk('number.add', 'speed:land', 10, { bonusType: 'status' }),
    blk('attribute.add', 'score:str', 2),
    blk('attribute.add', 'score:dex', -1),
  ];
  for (const id of entryIds) out.push(blk('number.set', `spell-dc@casting-entry:${id}`, 30), blk('number.add', `spell-attack@casting-entry:${id}`, 1, { bonusType: 'status' }));
  return out;
}

type Spec = { name: string; b: BuildState; play?: Partial<PlayState> };
const CONDITIONS = [
  { id: 'frightened', value: 1 },
  { id: 'clumsy', value: 1 },
  { id: 'drained', value: 2 },
  { id: 'enfeebled', value: 1 },
  { id: 'sickened', value: 1 },
  { id: 'encumbered' },
] as PlayState['conditions'];
const PLATE = { instanceId: 'arm', itemId: 'full-plate', quantity: 1, worn: true, runes: { potency: 1, resilient: 'resilient' } };
const SHIELD = { instanceId: 'sh', itemId: 'steel-shield', quantity: 1, equipped: true };
const GEAR = [
  PLATE,
  SHIELD,
  { instanceId: 'g1', itemId: 'armbands-of-athleticism', quantity: 1, worn: true, invested: true },
  { instanceId: 'g2', itemId: 'belt-of-good-health', quantity: 1, worn: true, invested: true },
  { instanceId: 'g3', itemId: 'cloak-of-elvenkind', quantity: 1, worn: true, invested: true },
];

function specs(): Spec[] {
  const out: Spec[] = [];
  for (const cid of Object.keys(db.classes).sort()) for (const L of [1, 12]) out.push({ name: `${cid} L${L}`, b: hero(cid, L) });
  const wiz = hero('wizard', 5);
  const ftr = hero('fighter', 8, { inventory: GEAR } as Partial<BuildState>);
  out.push(
    { name: 'fighter L8 with gear (armor, potency, resilient, shield, skill + HP items)', b: ftr },
    { name: 'fighter L8 with gear, shield raised', b: ftr, play: { activeModes: ['cat-raise-shield'] } },
    { name: 'wizard L5 with every condition', b: wiz, play: { conditions: CONDITIONS } },
    { name: 'wizard L5 + Heroism', b: wiz, play: { activeModes: ['cat-heroism'] } },
    { name: 'wizard L5 + attribute mode', b: wiz, play: { activeModes: [USER_STR.id] } },
    { name: 'wizard L5 + typed mode spread', b: wiz, play: { activeModes: [USER_TYPED.id] } },
    { name: "wizard L5 + Azata's Grace (max HP mode)", b: wiz, play: { activeModes: ['item-azatas-grace'] } },
    { name: 'wizard L5 + Triple Time (Speed mode)', b: wiz, play: { activeModes: ['cat-triple-time'] } },
    { name: 'wizard L5 + bat form (battle form)', b: wiz, play: { activeModes: ['bat-form'] } },
    { name: 'wizard L5 + temporary Speed', b: wiz, play: { tempSpeed: 15 } },
    { name: 'monk L5 in Mountain Stance', b: hero('monk', 5), play: { activeStance: 'mountain-stance' } },
    { name: 'barbarian L5 raging', b: hero('barbarian', 5), play: { resources: { rage: 1 }, activeModes: ['cat-rage'] } },
    { name: 'swashbuckler L5 with panache', b: hero('swashbuckler', 5), play: { resources: { panache: 1 } } },
    { name: 'swashbuckler L12 with panache', b: hero('swashbuckler', 12), play: { resources: { panache: 1 } } },
  );
  // Tweak blocks of every number kind, alone and under the play states above.
  const tweaked = (b: BuildState): BuildState => {
    const entryIds = buildCharacter(b, db).spellcasting.filter((e) => e.type !== 'focus').map((e) => e.id);
    return { ...b, overrides: { blocks: everyKindBlocks(entryIds) } };
  };
  const twz = tweaked(wiz);
  const tft = tweaked(ftr);
  out.push(
    { name: 'wizard L5 + tweak blocks of every kind', b: twz },
    { name: 'wizard L5 + tweaks + every condition', b: twz, play: { conditions: CONDITIONS } },
    { name: 'wizard L5 + tweaks + Heroism', b: twz, play: { activeModes: ['cat-heroism'] } },
    { name: 'wizard L5 + tweaks + typed mode spread', b: twz, play: { activeModes: [USER_TYPED.id] } },
    { name: 'wizard L5 + tweaks + bat form', b: twz, play: { activeModes: ['bat-form'] } },
    { name: 'wizard L5 + tweaks + Triple Time + temporary Speed', b: twz, play: { activeModes: ['cat-triple-time'], tempSpeed: 15 } },
    { name: 'fighter L8 with gear + tweaks', b: tft },
    { name: 'fighter L8 with gear + tweaks + shield raised + conditions', b: tft, play: { activeModes: ['cat-raise-shield'], conditions: CONDITIONS } },
    { name: 'monk L5 + tweaks in Mountain Stance', b: tweaked(hero('monk', 5)), play: { activeStance: 'mountain-stance' } },
    { name: 'barbarian L5 + tweaks raging', b: tweaked(hero('barbarian', 5)), play: { resources: { rage: 1 }, activeModes: ['cat-rage'] } },
    { name: 'swashbuckler L5 + tweaks with panache', b: tweaked(hero('swashbuckler', 5)), play: { resources: { panache: 1 } } },
  );
  return out;
}

/** Every stat of spec item 8 on one character: [name, breakdown ref, the number the sheet shows]. */
function stats(c: Character): [string, StatRef, number][] {
  const out: [string, StatRef, number][] = [];
  const skills = [...SKILLS, ...Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'))] as ProficiencyKey[];
  for (const k of skills) out.push([`skill ${k}`, { kind: 'skill', skill: k }, deriveSkill(c, k, db).modifier]);
  for (const s of ['fortitude', 'reflex', 'will'] as SaveId[]) out.push([`save ${s}`, { kind: 'save', save: s }, deriveSave(c, s, db).modifier]);
  out.push(['perception', { kind: 'perception' }, derivePerception(c, db).modifier]);
  out.push(['initiative', { kind: 'initiative' }, deriveInitiative(c, db).modifier]);
  out.push(['ac', { kind: 'ac' }, deriveAc(c, db).value]);
  out.push(['class DC', { kind: 'classDc' }, deriveClassDc(c).dc]);
  out.push(['max HP', { kind: 'hp' }, deriveMaxHp(c, db)]);
  out.push(['land Speed', { kind: 'speed' }, c.speedOverride ?? deriveSpeeds(c, db).land ?? 0]);
  for (const e of c.spellcasting ?? []) {
    const sc = deriveSpellcasting(c, e);
    out.push([`spell attack ${e.id}`, { kind: 'spell', entryId: e.id, which: 'attack' }, sc.attack]);
    out.push([`spell DC ${e.id}`, { kind: 'spell', entryId: e.id, which: 'dc' }, sc.dc]);
  }
  for (const a of ABILS) out.push([`score ${a}`, { kind: 'ability', ability: a }, c.abilities[a]]);
  return out;
}

/** The characters as the sheet sees them: built, then the play state laid over. */
const SHEETS = specs().map((s) => {
  const built = buildCharacter(s.b, db);
  const c = s.play ? applyPlayState(built, { ...initialPlay(built, db), ...s.play } as PlayState, db) : built;
  return { ...s, c };
});

describe('every breakdown of spec item 8 sums to its number', () => {
  for (const s of SHEETS) {
    it(s.name, () => {
      const bad: string[] = [];
      for (const [name, ref, n] of stats(s.c)) {
        const parts = explainStat(s.c, db, ref, s.b).parts;
        const sum = parts.reduce((t, p) => t + p.value, 0);
        if (sum !== n) bad.push(`${name}: parts sum to ${sum}, the number is ${n} — ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('the spread really reaches what it claims to (no vacuous pass)', () => {
  const find = (name: string) => SHEETS.find((s) => s.name === name)!.c;
  it('the play states are on', () => {
    expect(find('wizard L5 + bat form (battle form)').activeModes?.some((m) => m.battleForm)).toBe(true);
    expect(find('monk L5 in Mountain Stance').activeStance).toBeTruthy();
    expect(find('wizard L5 with every condition').conditions.length).toBeGreaterThanOrEqual(5);
    expect(find('wizard L5 + temporary Speed').speedOverride).toBe(15);
  });
  it('the tweak blocks moved numbers', () => {
    const plain = find('wizard L5 + Heroism');
    const tw = find('wizard L5 + tweaks + Heroism');
    expect(deriveSave(tw, 'reflex', db).modifier).toBe(14 + 1);
    expect(deriveInitiative(tw, db).modifier).not.toBe(deriveInitiative(plain, db).modifier);
    expect(tw.abilities.str).toBe(plain.abilities.str + 2);
    const spells = tw.spellcasting.filter((e) => e.type !== 'focus');
    expect(spells.length).toBeGreaterThan(0);
    for (const e of spells) expect(deriveSpellcasting(tw, e).dc).toBe(30);
  });
  it('a Speed set under panache: the play bonuses sit on top in full, with no "changed by play" line', () => {
    // set 40, +5 untyped, +10 status tweak; panache's +10 status and the tweak's +10 are one status bonus.
    const c = find('swashbuckler L5 + tweaks with panache');
    expect(deriveSpeeds(c, db).land).toBe(40 + 10 + 5);
    const parts = explainStat(c, db, { kind: 'speed' }).parts;
    // That line exists for a floor or "Minimum 0" that clips differently once play is on; none here.
    for (const s of SHEETS) expect(explainStat(s.c, db, { kind: 'speed' }).parts.some((p) => p.note?.endsWith('changed by what is on in play')), s.name).toBe(false);
    expect(parts.reduce((t, p) => t + p.value, 0)).toBe(55);
  });
});
