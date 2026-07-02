import { describe, it, expect } from 'vitest';
import { content } from './_content';
import {
  additionalClassSkills,
  bonusLanguageSlots,
  buildCharacter,
  canTakeNewDedication,
  computeAbilities,
  emptyBuild,
  checkPrerequisites,
  type BuildState,
} from '../src/rules/build';
import { abilityMod } from '../src/rules/derive';
import { SKILLS, type Feat } from '../src/rules/types';

const c = content();
const mk = (over: Partial<BuildState>): BuildState => ({
  ...emptyBuild(),
  name: 't',
  ancestryId: 'human',
  backgroundId: Object.keys(c.backgrounds)[0],
  classId: 'fighter',
  keyAbility: 'str',
  level: 1,
  ...over,
});

describe('bonus languages (Int-based)', () => {
  it('a human (additional 1, Int +0) gets exactly one bonus slot', () => {
    const b = mk({});
    expect(abilityMod(buildCharacter(b, c).abilities.int)).toBe(0);
    expect(bonusLanguageSlots(b, c)).toBe(1);
  });
  it('Int boosts add more slots', () => {
    const b = mk({ ancestryBoosts: ['int', 'str'], levelBoosts: ['int', null, null, null] });
    const intMod = abilityMod(buildCharacter(b, c).abilities.int);
    expect(intMod).toBeGreaterThan(0);
    expect(bonusLanguageSlots(b, c)).toBe(1 + intMod);
  });
  it('chosen bonus languages are added (granted + chosen), capped at the slot count', () => {
    const ch = buildCharacter(mk({ languages: ['dwarven', 'elven', 'draconic'] }), c);
    expect(ch.languages).toContain('common'); // granted
    expect(ch.languages).toContain('dwarven'); // first chosen (1 slot)
    expect(ch.languages.length).toBe(2); // common + 1 bonus
  });
});

describe('Skilled Heritage', () => {
  it('the chosen skill is trained at L1 and expert at L5', () => {
    const l4 = buildCharacter(mk({ heritageId: 'skilled-human', heritageSkill: 'arcana', level: 4 }), c);
    const l5 = buildCharacter(mk({ heritageId: 'skilled-human', heritageSkill: 'arcana', level: 5 }), c);
    expect(l4.proficiencies.skills.arcana).toBe('trained');
    expect(l5.proficiencies.skills.arcana).toBe('expert');
  });
});

describe('rogue racket key ability', () => {
  // PC2: a racket makes the key attribute a CHOICE between Dex and the racket's attribute.
  // Unpicked (keyAbility null) defaults to the racket attribute; an explicit Dex pick is honored.
  const rogue = (racket: string, key: 'dex' | null = null) =>
    buildCharacter(mk({ classId: 'rogue', keyAbility: key, subclassId: racket, levelBoosts: ['str', 'con', 'wis', 'cha'] }), c);
  it('an unpicked Ruffian keys off Strength (the racket default) and gets the Str key boost', () => {
    const before = mk({ classId: 'rogue', keyAbility: null, subclassId: 'ruffian', levelBoosts: ['str', 'con', 'wis', 'cha'] });
    const noKeyBoost = computeAbilities({ ...before, classId: null }, c).str; // baseline without the class key boost
    const ch = rogue('ruffian');
    expect(ch.keyAbility).toBe('str');
    expect(ch.abilities.str).toBe(noKeyBoost + 2);
  });
  it('a Ruffian who PICKED Dexterity keeps it (a Dex Ruffian is legal)', () => {
    expect(rogue('ruffian', 'dex').keyAbility).toBe('dex');
  });
  it('an unpicked Scoundrel keys off Charisma and a Mastermind off Intelligence', () => {
    expect(rogue('scoundrel').keyAbility).toBe('cha');
    expect(rogue('mastermind').keyAbility).toBe('int');
  });
  it('a Thief racket leaves the Dexterity default in place', () => {
    expect(rogue('thief', 'dex').keyAbility).toBe('dex');
  });
});

describe('arbitrary Lore class skills', () => {
  it('a `lore:<subject>` class pick is trained and counts against the class-skill cap', () => {
    const ch = buildCharacter(mk({ classId: 'rogue', keyAbility: 'dex', classSkills: ['lore:warfare', 'acrobatics'] }), c);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('trained');
    expect(ch.proficiencies.skills.acrobatics).toBe('trained');
  });
  it('class lores are capped together with ordinary skill picks', () => {
    const b = mk({ classId: 'fighter', keyAbility: 'str' }); // fighter: 3 additional skills, Int +0
    const cap = additionalClassSkills(b, c);
    const picks = ['lore:sailing', 'lore:underworld', 'lore:academia', 'lore:heraldry', 'lore:warfare'];
    const ch = buildCharacter({ ...b, classSkills: picks }, c);
    // Only `cap` of the chosen lores end up trained (the background's own granted Lore is separate).
    const trained = picks.filter((k) => ch.proficiencies.skills[k as 'lore:x'] === 'trained');
    expect(trained.length).toBe(cap);
  });
});

describe('Lore as a skill-increase target', () => {
  it('a skill increase can train a brand-new arbitrary Lore from untrained', () => {
    // rogue gets a skill increase at L2; the character has no Warfare Lore beforehand.
    const ch = buildCharacter(mk({ classId: 'rogue', keyAbility: 'dex', skillIncreases: { 2: 'lore:warfare' }, level: 2 }), c);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('trained');
  });
  it('successive skill increases raise the same Lore (trained → expert at L3)', () => {
    const ch = buildCharacter(
      mk({ classId: 'rogue', keyAbility: 'dex', skillIncreases: { 2: 'lore:warfare', 3: 'lore:warfare' }, level: 3 }),
      c,
    );
    expect(ch.proficiencies.skills['lore:warfare']).toBe('expert');
  });
});

describe('archetypes / multiclass (Phase 1)', () => {
  it('dedications are class-category archetype feats (so they fit class slots)', () => {
    const fd = c.feats['fighter-dedication'];
    expect(fd?.category).toBe('class');
    expect(fd?.traits).toEqual(expect.arrayContaining(['archetype', 'dedication']));
  });
  it('a follow-on archetype feat is gated behind its dedication, then unlocked by it', () => {
    const follow = c.feats['basic-maneuver']; // prereq: "Fighter Dedication"
    const without = buildCharacter(mk({ classId: 'rogue', keyAbility: 'dex', level: 2 }), c);
    expect(checkPrerequisites(follow, without, c).met).toBe(false);
    const withDed = buildCharacter(
      mk({ classId: 'rogue', keyAbility: 'dex', level: 2, featPicks: { '2:class:0': 'fighter-dedication' } }),
      c,
    );
    expect(withDed.feats.some((f) => f.featId === 'fighter-dedication')).toBe(true);
    expect(checkPrerequisites(follow, withDed, c).met).toBe(true);
  });

  it('feats carry their archetype slug (from the import path)', () => {
    expect(c.feats['fighter-dedication'].archetype).toBe('fighter');
    expect(c.feats['basic-maneuver'].archetype).toBe('fighter');
  });

  it('canTakeNewDedication enforces "two feats before a new dedication"', () => {
    expect(canTakeNewDedication([], c)).toBe(true); // no archetypes started
    expect(canTakeNewDedication(['fighter-dedication'], c)).toBe(false); // started, 0 feats
    expect(canTakeNewDedication(['fighter-dedication', 'basic-maneuver'], c)).toBe(false); // only 1
    expect(canTakeNewDedication(['fighter-dedication', 'basic-maneuver', 'reactive-striker'], c)).toBe(true); // 2 ✓
  });
});

describe('compound "X or Y" prerequisites', () => {
  const feat = (pre: string): Feat =>
    ({ id: 'x', name: 'X', level: 1, category: 'skill', traits: [], rarity: 'common', description: '', prerequisites: [pre] }) as Feat;
  it('is met when EITHER alternative is satisfied, unmet when neither is', () => {
    const ch = buildCharacter(mk({ classSkills: ['nature'] }), c);
    expect(ch.proficiencies.skills.nature).toBe('trained');
    expect(checkPrerequisites(feat('trained in arcana or nature'), ch, c).met).toBe(true);
    const lacking = SKILLS.filter((s) => ch.proficiencies.skills[s] === 'untrained');
    expect(checkPrerequisites(feat(`trained in ${lacking[0]} or ${lacking[1]}`), ch, c).met).toBe(false);
  });
});
