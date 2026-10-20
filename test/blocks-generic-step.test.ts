import { describe, expect, it } from 'vitest';
import { blockKind } from '../src/rules/blocks/registry';
import type { StoredBlock } from '../src/rules/blocks/stored';
import type { TargetKind } from '../src/rules/blocks/targets';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveAc, deriveClassDc, deriveMaxHp, derivePerception, deriveSave, deriveSkill, deriveSpeeds, deriveSpellcasting, skillTerms } from '../src/rules/derive';
import { explainStat, type StatRef } from '../src/rules/explain';
import { deriveInitiative } from '../src/rules/initiative';
import { computePcStats } from '../src/integration/computePcStats';
import { SKILLS, type AbilityId, type Character, type ProficiencyKey, type SaveId } from '../src/rules/types';
import { content } from './_content';

/**
 * THE GENERIC STEP (docs/overrides-redesign.md, Building blocks items 4–6; spec items 6–8): every number
 * block kind, on every target it accepts, moves the sheet number by exactly what it says — +1 adds 1, a
 * set makes it N, an "at least N" lifts it to N or leaves it — and the breakdown still sums to it.
 * The accepted targets are read from the REGISTRY, so a kind that starts accepting a new target kind
 * fails here until this file can read that number. Synthetic characters only.
 */

const db = content();

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : 'str') as BuildState['keyAbility'],
    ancestryId: 'human',
    // Acolyte trains Scribing Lore, so every character here has a Lore target too.
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}
const CHARS: { name: string; b: BuildState }[] = [
  { name: 'wizard L5 (a casting entry)', b: hero('wizard', 5) },
  {
    name: 'fighter L7 in full plate (armor Speed penalty, armor in AC)',
    b: hero('fighter', 7, { inventory: [{ instanceId: 'a1', itemId: 'full-plate', quantity: 1, worn: true, runes: { potency: 1 } }] } as Partial<BuildState>),
  },
];

/** Every target key of one kind on this character. */
function keysOf(c: Character, kind: TargetKind): string[] {
  const entries = (c.spellcasting ?? []).filter((e) => e.type !== 'focus');
  switch (kind) {
    case 'ac':
    case 'perception':
    case 'class-dc':
    case 'initiative':
    case 'max-hp':
      return [kind];
    case 'save':
      return ['fortitude', 'reflex', 'will'].map((s) => `save:${s}`);
    case 'skill':
      return [...SKILLS, ...Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'))].map((s) => `skill:${s}`);
    case 'spell-attack':
    case 'spell-dc':
      return entries.map((e) => `${kind}@casting-entry:${e.id}`);
    case 'speed':
      return ['speed:land'];
    default:
      throw new Error(`blocks-generic-step: no reader for target kind '${kind}' — add one here`);
  }
}

function numberOf(c: Character, key: string): number {
  const [stat, owner] = key.split('@');
  const i = stat.indexOf(':');
  const kind = i < 0 ? stat : stat.slice(0, i);
  const detail = i < 0 ? '' : stat.slice(i + 1);
  const entry = owner ? c.spellcasting.find((e) => e.id === owner.slice('casting-entry:'.length))! : undefined;
  switch (kind) {
    case 'ac':
      return deriveAc(c, db).value;
    case 'max-hp':
      return deriveMaxHp(c, db);
    case 'save':
      return deriveSave(c, detail as SaveId, db).modifier;
    case 'perception':
      return derivePerception(c, db).modifier;
    case 'skill':
      return deriveSkill(c, detail as ProficiencyKey, db).modifier;
    case 'class-dc':
      return deriveClassDc(c).dc;
    case 'initiative':
      return deriveInitiative(c, db).modifier;
    case 'spell-attack':
      return deriveSpellcasting(c, entry!).attack;
    case 'spell-dc':
      return deriveSpellcasting(c, entry!).dc;
    case 'speed':
      return deriveSpeeds(c, db).land ?? 0;
  }
  throw new Error(`no number for ${key}`);
}

function refOf(key: string): StatRef {
  const [stat, owner] = key.split('@');
  const i = stat.indexOf(':');
  const kind = i < 0 ? stat : stat.slice(0, i);
  const detail = i < 0 ? '' : stat.slice(i + 1);
  switch (kind) {
    case 'ac':
      return { kind: 'ac' };
    case 'max-hp':
      return { kind: 'hp' };
    case 'save':
      return { kind: 'save', save: detail as SaveId };
    case 'perception':
      return { kind: 'perception' };
    case 'skill':
      return { kind: 'skill', skill: detail as ProficiencyKey };
    case 'class-dc':
      return { kind: 'classDc' };
    case 'initiative':
      return { kind: 'initiative' };
    case 'spell-attack':
    case 'spell-dc':
      return { kind: 'spell', entryId: owner.slice('casting-entry:'.length), which: kind === 'spell-dc' ? 'dc' : 'attack' };
    case 'speed':
      return { kind: 'speed' };
  }
  throw new Error(`no breakdown for ${key}`);
}

const sumOf = (c: Character, key: string) => explainStat(c, db, refOf(key)).parts.reduce((s, p) => s + p.value, 0);
const withBlocks = (c: Character, blocks: StoredBlock[]): Character => ({ ...c, overrides: { ...(c.overrides ?? {}), blocks } });
const blk = (kind: string, target: string, value: number): StoredBlock => ({ id: 's1', kind, v: 1, target, value });

/**
 * What stays on top of a set: the play layer — conditions, modes, the stance, play states (As built,
 * Building blocks item 4). The armor check penalty is a BOOK line, so a set replaces it like the rest of
 * the book total. These characters carry no play state, so on every target the play layer is 0; the
 * function reads it from the term list rather than assuming it, so a play line that sneaks in shows.
 */
function onTopOfSet(c: Character, key: string): number {
  if (!key.startsWith('skill:')) return 0;
  return skillTerms(c, key.slice('skill:'.length) as ProficiencyKey, db)
    .filter((t) => t.layer === 'transient')
    .reduce((s, t) => s + t.value, 0);
}

/** One kind's step on one target: what the number must become, from the number before (v0) and the
 *  play layer a set leaves on top (top). */
const STEP: Record<string, { value: (v0: number, top: number) => number; expect: (v0: number, top: number) => number }[]> = {
  'number.add': [
    { value: () => 1, expect: (v0) => v0 + 1 },
    { value: () => -2, expect: (v0) => v0 - 2 },
  ],
  // Set to the number the player sees + 3: the permanent part becomes that, the play layer stays on top.
  'number.set': [{ value: (v0, top) => v0 - top + 3, expect: (v0) => v0 + 3 }],
  'number.atLeast': [
    // Lifts: the permanent part (v0 − top) is below N.
    { value: (v0, top) => v0 - top + 2, expect: (v0) => v0 + 2 },
    // Does not lift: N is at or below the permanent part.
    { value: (v0, top) => v0 - top - 2, expect: (v0) => v0 },
  ],
};

for (const { name, b } of CHARS) {
  const c0 = buildCharacter(b, db);
  for (const kindId of Object.keys(STEP)) {
    const def = blockKind(kindId)!;
    if (!('aspect' in def.accepts)) throw new Error(kindId);
    const accepted = def.accepts.kinds;
    describe(`'${kindId}' on every target it accepts — ${name}`, () => {
      for (const tk of accepted) {
        for (const key of keysOf(c0, tk)) {
          it(`${key}`, () => {
            const v0 = numberOf(c0, key);
            const top = onTopOfSet(c0, key);
            expect(sumOf(c0, key)).toBe(v0);
            for (const s of STEP[kindId]) {
              const n = s.value(v0, top);
              const c = withBlocks(c0, [blk(kindId, key, n)]);
              expect(numberOf(c, key), `${kindId} ${n} on ${key}`).toBe(s.expect(v0, top));
              expect(sumOf(c, key), `breakdown of ${key} after ${kindId} ${n}`).toBe(s.expect(v0, top));
            }
          });
        }
      }
    });
  }
}

describe("'number.set' on a skill in armor (As built: the armor check penalty is a book line a set replaces)", () => {
  it('full plate: set Acrobatics to +10 → exactly 10; the penalty line still shows among the book lines', () => {
    const c0 = buildCharacter(CHARS[1].b, db);
    const acp = skillTerms(c0, 'acrobatics', db).find((t) => t.label === 'Armor check penalty');
    expect(acp?.value).toBeLessThan(0);
    expect(acp?.layer).toBe('book');
    // With no set it still adds in full, as before.
    expect(explainStat(c0, db, { kind: 'skill', skill: 'acrobatics' }).parts.find((p) => p.label === 'Armor check penalty')!.value).toBe(acp!.value);
    const c = withBlocks(c0, [blk('number.set', 'skill:acrobatics', 10)]);
    expect(numberOf(c, 'skill:acrobatics')).toBe(10);
    const parts = explainStat(c, db, { kind: 'skill', skill: 'acrobatics' }).parts;
    expect(parts.find((p) => p.label === 'Armor check penalty')!.value).toBe(acp!.value);
    expect(parts.reduce((s, p) => s + p.value, 0)).toBe(10);
  });
});

describe("'number.set' and 'number.add' where a number reads another, or nothing may move it", () => {
  it('a Perception set moves Initiative rolled with Perception (C12)', () => {
    const c0 = buildCharacter(CHARS[0].b, db);
    expect(deriveInitiative(c0, db).stat).toBe('perception');
    const c = withBlocks(c0, [blk('number.set', 'perception', 20)]);
    expect(derivePerception(c, db).modifier).toBe(20);
    expect(deriveInitiative(c, db).modifier).toBe(20 + (deriveInitiative(c0, db).modifier - derivePerception(c0, db).modifier));
    expect(sumOf(c, 'initiative')).toBe(deriveInitiative(c, db).modifier);
  });

  it('a skill set sits BEFORE substitution: a chirurgeon with Medicine set to 0 still rolls Medicine with Crafting', () => {
    const c0 = buildCharacter(hero('alchemist', 5, { subclassId: 'chirurgeon' }), db);
    const crafting = deriveSkill(c0, 'crafting', db).modifier;
    expect(deriveSkill(c0, 'medicine', db).substitutedFrom?.skill).toBe('crafting');
    const low = withBlocks(c0, [blk('number.set', 'skill:medicine', 0)]);
    expect(deriveSkill(low, 'medicine', db).modifier).toBe(crafting);
    expect(sumOf(low, 'skill:medicine')).toBe(crafting);
    // …and a set above Crafting is Medicine's own number again.
    const high = withBlocks(c0, [blk('number.set', 'skill:medicine', crafting + 5)]);
    expect(deriveSkill(high, 'medicine', db).modifier).toBe(crafting + 5);
    expect(deriveSkill(high, 'medicine', db).substitutedFrom).toBeUndefined();
  });

  it('an AC tweak is ignored during a battle form (the form states the whole AC)', () => {
    const c0 = buildCharacter(CHARS[0].b, db);
    const bat = db.modes['bat-form'];
    expect(bat?.battleForm).toBeTruthy();
    const form = { ...c0, activeModes: [bat] };
    const acForm = deriveAc(form, db).value;
    expect(acForm).not.toBe(deriveAc(c0, db).value);
    for (const b of [blk('number.add', 'ac', 3), blk('number.set', 'ac', 40), blk('number.atLeast', 'ac', 40)]) {
      const c = withBlocks(form, [b]);
      expect(deriveAc(c, db).value, b.kind).toBe(acForm);
      expect(sumOf(c, 'ac')).toBe(acForm);
    }
  });

  it('a fixed spell DC (an item that prints its DC) ignores tweaks; the same tweak moves a normal entry', () => {
    const c0 = buildCharacter({ ...CHARS[0].b, inventory: [{ itemId: 'sigil-of-the-first-clan', quantity: 1, worn: true, invested: true }] } as BuildState, db);
    const fixed = c0.spellcasting.find((e) => e.fixedDc != null)!;
    expect(fixed?.fixedDc).toBe(24);
    const key = `spell-dc@casting-entry:${fixed.id}`;
    for (const b of [blk('number.add', key, 2), blk('number.set', key, 40), blk('number.atLeast', key, 40)]) {
      const c = withBlocks(c0, [b]);
      expect(deriveSpellcasting(c, c.spellcasting.find((e) => e.id === fixed.id)!).dc, b.kind).toBe(24);
      expect(sumOf(c, key)).toBe(24);
    }
  });
});

describe("'attribute.add' survives the reverse build (build → deriveBuildFromCharacter → build)", () => {
  const scores = (c: Character) => Object.fromEntries((['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityId[]).map((a) => [a, c.abilities[a]]));
  const roundTrips = (b: BuildState) => {
    const c1 = buildCharacter(b, db);
    let c = c1;
    for (let i = 0; i < 3; i++) c = buildCharacter(deriveBuildFromCharacter(c, db), db);
    return { c1, c3: c };
  };
  const fighter = hero('fighter', 5);
  it('a +2 Dexterity block: the same scores after three round trips', () => {
    const { c1, c3 } = roundTrips({ ...fighter, overrides: { blocks: [{ id: 'rt', kind: 'attribute.add', v: 1, target: 'score:dex', value: 2 }] } } as BuildState);
    expect(c1.abilities.dex).toBe(buildCharacter(fighter, db).abilities.dex + 2);
    expect(scores(c3)).toEqual(scores(c1));
  });
  it('an odd +1 Strength block: the same scores after three round trips', () => {
    const { c1, c3 } = roundTrips({ ...fighter, overrides: { blocks: [{ id: 'rt', kind: 'attribute.add', v: 1, target: 'score:str', value: 1 }] } } as BuildState);
    expect(scores(c3)).toEqual(scores(c1));
  });
  it('a legacy attribute set plus a block: set + block, the same after three round trips', () => {
    const { c1, c3 } = roundTrips({ ...fighter, overrides: { attributes: { dex: 14 }, blocks: [{ id: 'rt', kind: 'attribute.add', v: 1, target: 'score:dex', value: 2 }] } } as BuildState);
    expect(c1.abilities.dex).toBe(16);
    expect(scores(c3)).toEqual(scores(c1));
  });
  it('a legacy attribute set alone: the same after three round trips', () => {
    const { c1, c3 } = roundTrips({ ...fighter, overrides: { attributes: { str: 18, wis: 8 } } } as BuildState);
    expect(scores(c3)).toEqual(scores(c1));
  });
});

describe("'number.add' reaches the tracker row and the party card's numbers (computePcStats)", () => {
  it('+1 on AC, Fortitude, Perception, Athletics, class DC, max HP and land Speed', () => {
    const c0 = buildCharacter(CHARS[0].b, db);
    const p0 = computePcStats(c0, db);
    const plus = (target: string): StoredBlock => ({ id: `p-${target}`, kind: 'number.add', v: 1, target, value: 1 });
    const c = withBlocks(c0, ['ac', 'save:fortitude', 'perception', 'skill:athletics', 'class-dc', 'max-hp', 'speed:land'].map(plus));
    const p = computePcStats(c, db);
    expect(p.ac).toBe(p0.ac! + 1);
    expect(p.fortMod).toBe(p0.fortMod! + 1);
    expect(p.perceptionMod).toBe(p0.perceptionMod! + 1);
    expect(p.skills!.Athletics.mod).toBe(p0.skills!.Athletics.mod + 1);
    expect(p.classDC).toBe(p0.classDC! + 1);
    expect(p.maxHP).toBe(p0.maxHP! + 1);
    expect(p.speed).toBe(p0.speed! + 1);
  });
});

describe("'attribute.add' changes the SCORE at build time", () => {
  const ab = (blocks: StoredBlock[] | undefined, level = 5) => buildCharacter({ ...CHARS[0].b, level, ...(blocks ? { overrides: { blocks } } : {}) } as BuildState, db);
  const score = (ability: AbilityId, value: number, more: Partial<StoredBlock> = {}): StoredBlock => ({ id: `a-${ability}`, kind: 'attribute.add', v: 1, target: `score:${ability}`, value, ...more });

  it('+1 on each attribute moves that score by exactly 1, and its breakdown sums with a tweak line', () => {
    const c0 = ab(undefined);
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityId[]) {
      const c = ab([score(a, 1)]);
      expect(c.abilities[a]).toBe(c0.abilities[a] + 1);
      for (const o of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityId[]) if (o !== a) expect(c.abilities[o]).toBe(c0.abilities[o]);
      const bd = explainStat(c, db, { kind: 'ability', ability: a });
      expect(bd.parts.reduce((s, p) => s + p.value, 0)).toBe(c.abilities[a]);
      expect(bd.parts.some((p) => p.label === 'Tweak: +1' && p.value === 1)).toBe(true);
    }
  });

  it('+2 on Strength is +1 to the modifier, so Athletics moves by 1', () => {
    const c0 = ab(undefined);
    const c = ab([score('str', 2)]);
    expect(c.abilities.str).toBe(c0.abilities.str + 2);
    expect(deriveSkill(c, 'athletics', db).modifier).toBe(deriveSkill(c0, 'athletics', db).modifier + 1);
  });

  it('a start level above the character level, or a paused block, leaves the score alone', () => {
    const c0 = ab(undefined);
    expect(ab([score('str', 2, { from: 6 })]).abilities.str).toBe(c0.abilities.str);
    expect(ab([score('str', 2, { from: 6 })], 6).abilities.str).toBe(ab(undefined, 6).abilities.str + 2);
    expect(ab([score('str', 2, { on: false })]).abilities.str).toBe(c0.abilities.str);
  });
});
