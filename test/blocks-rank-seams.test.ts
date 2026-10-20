import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { readLegacyBlocks } from '../src/rules/blocks/stored';
import { deriveSkill, profBonus } from '../src/rules/derive';
import type { BuildOverrides, Character, ProficiencyRank, TweakMeta } from '../src/rules/types';
import { content } from './_content';

/**
 * THE RANK SEAMS (docs/overrides-redesign.md, spec item 5, Building blocks item 8; checker C2, C16).
 *
 * An `overrides.proficiencies` entry whose `overrides.meta['proficiencies:<key>']` says `mode: 'atLeast'`
 * or `mode: 'exactly'` (with a matching `of`) is a rank block, and reaches the build at its own seam:
 *   - 'rank.atLeast' on a skill or Lore: a floor seeded BEFORE the skill-increase loop, its start level
 *     honoured inside the loop — so "at least trained" plus a level-3 increase gives expert;
 *   - 'rank.atLeast' on a save, Perception, class DC, weapon or armor track: a floor at today's override
 *     loop (after the class raises);
 *   - 'rank.exactly': ONE clamp just before the Character is put together, after every raise — so a rank
 *     the player lowered stays lowered when a later class feature or a feat grant raises it.
 * An entry with no mode ('rank.legacySet') keeps today's `=` loop exactly (checker C2: part A moves no
 * number except case D). Every rank block goes through the one reader (blocks/active.ts): paused,
 * broken, below its start level, or the Tweaks switch off → no effect. Synthetic characters only.
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
    // Acolyte trains Religion and Scribing Lore (`lore:scribing`).
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}

/** One rank tweak, stored as part B will store it: the old key plus its meta (`of` = the stored rank). */
function rankTweak(key: string, rank: string, meta: Partial<TweakMeta> & { mode?: TweakMeta['mode'] } = {}): BuildOverrides {
  return { proficiencies: { [key]: rank as ProficiencyRank }, meta: { [`proficiencies:${key}`]: { of: rank, ...meta } } };
}
const atLeast = (key: string, rank: string, more: Partial<TweakMeta> = {}) => rankTweak(key, rank, { mode: 'atLeast', ...more });
const exactly = (key: string, rank: string, more: Partial<TweakMeta> = {}) => rankTweak(key, rank, { mode: 'exactly', ...more });

const build = (b: BuildState, overrides?: BuildOverrides, options?: BuildState['options']): Character =>
  buildCharacter({ ...b, ...(overrides ? { overrides } : {}), ...(options ? { options } : {}) } as BuildState, db);

describe("'rank.atLeast' on a skill: a floor seeded before the skill-increase loop", () => {
  const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);

  it("'at least trained' Athletics + a level-3 increase on Athletics → expert (spec 2 case A)", () => {
    expect(build(wiz3).proficiencies.skills.athletics).toBe('trained'); // the increase alone
    const c = build(wiz3, atLeast('athletics', 'trained'));
    expect(c.proficiencies.skills.athletics).toBe('expert');
    // The number moves with the rank: expert is +2 over trained.
    expect(deriveSkill(c, 'athletics', db).modifier - deriveSkill(build(wiz3), 'athletics', db).modifier).toBe(profBonus('expert', 3) - profBonus('trained', 3));
    // The increase is still recorded where the player spent it.
    expect((c.skillIncreases ?? []).some((s) => s.level === 3 && s.skill === 'athletics')).toBe(true);
  });

  it('a floor never lowers: at least trained on a skill the class already made expert changes nothing', () => {
    const b = hero('wizard', 3, { skillIncreases: { 3: 'arcana' } } as Partial<BuildState>);
    expect(build(b).proficiencies.skills.arcana).toBe('expert');
    expect(build(b, atLeast('arcana', 'trained')).proficiencies.skills.arcana).toBe('expert');
  });
});

describe("'rank.exactly': one clamp after every raise", () => {
  it('holds after a later CLASS raise: a commander held at exactly trained in Warfare Lore stays trained at 3rd (Warfare Expertise)', () => {
    const b = hero('commander', 3);
    expect(build(b).proficiencies.skills['lore:warfare']).toBe('expert'); // the class feature's own raise at 3rd
    expect(build(b, exactly('lore:warfare', 'trained')).proficiencies.skills['lore:warfare']).toBe('trained');
  });

  it('a thaumaturge held at exactly trained in Esoteric Lore stays trained at 7th (the feature makes it master)', () => {
    const b = hero('thaumaturge', 7);
    expect(build(b).proficiencies.skills['lore:esoteric']).toBe('master');
    expect(build(b, exactly('lore:esoteric', 'trained')).proficiencies.skills['lore:esoteric']).toBe('trained');
  });

  it('an "exactly" LOWER than computed stays lower after a FEAT_GRANTS raise (Medic Dedication: expert in Medicine) — spec 2 case B', () => {
    const b = hero('fighter', 4);
    const medic: BuildOverrides = { addedFeats: [{ featId: 'medic-dedication', level: 2, category: 'class' }] };
    expect(build(b, medic).proficiencies.skills.medicine).toBe('expert');
    const c = build(b, { ...medic, ...exactly('medicine', 'untrained') });
    expect(c.proficiencies.skills.medicine).toBe('untrained');
    expect(deriveSkill(c, 'medicine', db).modifier).toBe(deriveSkill(build(b), 'medicine', db).modifier);
  });

  it('on a save, Perception and a weapon track: the rank asked for, up or down — and it holds after a feat grant (Canny Acumen)', () => {
    const b = hero('fighter', 7);
    const c0 = build(b);
    expect(c0.proficiencies.perception).toBe('master');
    expect(build(b, exactly('perception', 'trained')).proficiencies.perception).toBe('trained');
    expect(build(b, exactly('will', 'legendary')).proficiencies.saves.will).toBe('legendary');
    expect(build(b, exactly('martial', 'trained')).proficiencies.attacks.martial).toBe('trained');
    // Canny Acumen (Will) makes a 1st-level fighter's Will expert AFTER today's override loop.
    const canny = (more: BuildOverrides = {}) =>
      build({ ...hero('fighter', 1), featChoices: { 'override:canny-acumen': 'will' } } as BuildState, { addedFeats: [{ featId: 'canny-acumen', level: 1, category: 'general' }], ...more });
    expect(canny().proficiencies.saves.will).toBe('expert');
    expect(canny(exactly('will', 'trained')).proficiencies.saves.will).toBe('trained');
  });
});

describe("'rank.atLeast' on a save, Perception, class DC, weapon or armor track: a floor after the class raises", () => {
  it('lifts a track below it and never lowers one above it (a fighter at 9th: Fortitude master, Reflex expert)', () => {
    const b = hero('fighter', 9);
    const c0 = build(b);
    expect(c0.proficiencies.saves.fortitude).toBe('master');
    const floors = { fortitude: 'expert', reflex: 'master', classDc: 'expert', simple: 'master', heavy: 'expert', perception: 'trained' } as Record<string, ProficiencyRank>;
    const c = build(b, { proficiencies: floors, meta: Object.fromEntries(Object.entries(floors).map(([k, r]) => [`proficiencies:${k}`, { mode: 'atLeast' as const, of: r }])) });
    expect(c.proficiencies.saves.fortitude).toBe('master'); // not lowered
    expect(c.proficiencies.saves.reflex).toBe('master');
    expect(c.proficiencies.classDc).toBe('expert');
    expect(c.proficiencies.attacks.simple).toBe('master');
    expect(c.proficiencies.defenses.heavy).toBe('expert');
    expect(c.proficiencies.perception).toBe(c0.proficiencies.perception); // master stays master
  });
});

describe("'rank.legacySet' — an old entry with no 'at least' / 'exactly' keeps today's '=' (checker C2)", () => {
  const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);

  it('an old "trained" plus a later increase is still trained (today), while the same entry marked "at least" gives expert', () => {
    const legacy = build(wiz3, { proficiencies: { athletics: 'trained' } });
    expect(legacy.proficiencies.skills.athletics).toBe('trained');
    // Meta that names no mode, or names another entry's rank, is not a mode: still today's '='.
    expect(build(wiz3, rankTweak('athletics', 'trained', { reason: 'old' })).proficiencies.skills.athletics).toBe('trained');
    expect(build(wiz3, { proficiencies: { athletics: 'trained' }, meta: { 'proficiencies:athletics': { mode: 'atLeast', of: 'expert' } } }).proficiencies.skills.athletics).toBe('trained');
    expect(build(wiz3, atLeast('athletics', 'trained')).proficiencies.skills.athletics).toBe('expert');
  });

  it('an old lower entry is still lifted by a later feat grant (today), while the same entry marked "exactly" stays', () => {
    const b = hero('fighter', 4);
    const medic: BuildOverrides = { addedFeats: [{ featId: 'medic-dedication', level: 2, category: 'class' }] };
    expect(build(b, { ...medic, proficiencies: { medicine: 'untrained' } }).proficiencies.skills.medicine).toBe('expert');
    expect(build(b, { ...medic, ...exactly('medicine', 'untrained') }).proficiencies.skills.medicine).toBe('untrained');
  });

  it("an old entry still sets every track with '=' (lowers a class rank, adds a Lore under its raw key); marked 'at least' it does neither", () => {
    const b = hero('fighter', 7);
    const old = { fortitude: 'trained', perception: 'trained', 'lore:Sailing Lore': 'expert' } as Record<string, ProficiencyRank>;
    const c = build(b, { proficiencies: old });
    expect(c.proficiencies.saves.fortitude).toBe('trained');
    expect(c.proficiencies.perception).toBe('trained');
    expect(c.proficiencies.skills['lore:Sailing Lore' as never]).toBe('expert');
    const meta = Object.fromEntries(Object.entries(old).map(([k, r]) => [`proficiencies:${k}`, { mode: 'atLeast' as const, of: r }]));
    const sorted = build(b, { proficiencies: old, meta });
    expect(sorted.proficiencies.saves.fortitude).toBe(build(b).proficiencies.saves.fortitude);
    expect(sorted.proficiencies.perception).toBe(build(b).proficiencies.perception);
    expect(sorted.proficiencies.skills['lore:sailing']).toBe('expert');
    expect('lore:Sailing Lore' in sorted.proficiencies.skills).toBe(false);
  });
});

describe('start level: a rank block counts from its level, inside the skill-increase loop', () => {
  const wiz = (level: number, inc: Record<number, string> = {}) => hero('wizard', level, { skillIncreases: inc } as Partial<BuildState>);

  it('"at least expert from level 5" → nothing at level 4, expert at level 5', () => {
    const tw = atLeast('athletics', 'expert', { from: 5 });
    expect(build(wiz(4), tw).proficiencies.skills.athletics).toBe('untrained');
    expect(build(wiz(5), tw).proficiencies.skills.athletics).toBe('expert');
  });

  it('a floor from level 5 does not count before 5: a level-3 increase steps from untrained (→ trained, not expert)', () => {
    expect(build(wiz(5, { 3: 'athletics' }), atLeast('athletics', 'trained', { from: 5 })).proficiencies.skills.athletics).toBe('trained');
    // …while the same floor from level 1 is under the level-3 increase (→ expert).
    expect(build(wiz(5, { 3: 'athletics' }), atLeast('athletics', 'trained')).proficiencies.skills.athletics).toBe('expert');
  });

  it('a floor from level 5 lands BEFORE that same level\'s increase (→ expert), the order the "already trained?" replay uses', () => {
    expect(build(wiz(5, { 5: 'athletics' })).proficiencies.skills.athletics).toBe('trained');
    expect(build(wiz(5, { 5: 'athletics' }), atLeast('athletics', 'trained', { from: 5 })).proficiencies.skills.athletics).toBe('expert');
  });

  it('…and counts from 5 on: a level-7 increase steps from the floor (→ expert)', () => {
    expect(build(wiz(7, { 7: 'athletics' })).proficiencies.skills.athletics).toBe('trained');
    expect(build(wiz(7, { 7: 'athletics' }), atLeast('athletics', 'trained', { from: 5 })).proficiencies.skills.athletics).toBe('expert');
  });

  it('an in-build "already trained when the feat was taken?" reader sees a floor from its start level, not before (Molten Wit in a 5th-level slot)', () => {
    const slot = '5:ancestry:0';
    const b = { ...hero('fighter', 9), featPicks: { [slot]: 'molten-wit' } } as BuildState;
    expect(levelGrants(5, 'fighter', db, null, undefined, null, null, false, []).featSlots[0]).toBe('ancestry');
    const before = (from: number) => build(b, atLeast('deception', 'trained', { from })).skillRankBefore?.['molten-wit']?.deception;
    expect(build(b).skillRankBefore?.['molten-wit']?.deception).toBe('untrained');
    expect(before(3)).toBe('trained'); // the floor is there at 5th
    expect(before(5)).toBe('trained'); // …from the start of 5th
    expect(before(7)).toBe('untrained'); // not yet at 5th
    expect(build(b, atLeast('deception', 'trained', { from: 7 })).proficiencies.skills.deception).toBe('trained');
  });

  it('a save floor and an "exactly" from level 9 wait for level 9', () => {
    const f = (level: number) => hero('fighter', level);
    expect(build(f(8), atLeast('will', 'master', { from: 9 })).proficiencies.saves.will).toBe(build(f(8)).proficiencies.saves.will);
    expect(build(f(9), atLeast('will', 'master', { from: 9 })).proficiencies.saves.will).toBe('master');
    expect(build(f(8), exactly('perception', 'trained', { from: 9 })).proficiencies.perception).toBe(build(f(8)).proficiencies.perception);
    expect(build(f(9), exactly('perception', 'trained', { from: 9 })).proficiencies.perception).toBe('trained');
  });
});

describe('paused or broken → no effect (decision 13: listed, never applied)', () => {
  const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);
  const none = build(wiz3);

  it('a paused "at least" or "exactly" leaves every rank as it is without it', () => {
    expect(build(wiz3, atLeast('athletics', 'master', { on: false })).proficiencies).toEqual(none.proficiencies);
    expect(build(wiz3, exactly('arcana', 'untrained', { on: false })).proficiencies).toEqual(none.proficiencies);
    expect(build(wiz3, atLeast('fortitude', 'legendary', { on: false })).proficiencies).toEqual(none.proficiencies);
  });

  it('a broken rank (not a proficiency rank) is not written anywhere', () => {
    const c = build(wiz3, atLeast('athletics', 'Expert'));
    expect(c.proficiencies).toEqual(none.proficiencies);
    expect(build(wiz3, exactly('will', 'Legendary')).proficiencies).toEqual(none.proficiencies);
  });
});

describe('the Tweaks switch (spec 2: "ON by read" until a Tweaks-aware save writes overrides.v)', () => {
  const wiz3 = hero('wizard', 3, { skillIncreases: { 3: 'athletics' } } as Partial<BuildState>);
  const v2 = (ov: BuildOverrides) => ({ ...ov, v: 2 }) as BuildOverrides;

  it('overrides.v absent → on', () => {
    expect(build(wiz3, atLeast('athletics', 'trained')).proficiencies.skills.athletics).toBe('expert');
    expect(build(wiz3, exactly('religion', 'untrained')).proficiencies.skills.religion).toBe('untrained');
  });

  it('v: 2 with options.overridesEnabled false → no effect; with it true → applies', () => {
    const none = build(wiz3);
    expect(build(wiz3, v2(atLeast('athletics', 'master')), { overridesEnabled: false } as BuildState['options']).proficiencies).toEqual(none.proficiencies);
    expect(build(wiz3, v2(exactly('religion', 'untrained')), { overridesEnabled: false } as BuildState['options']).proficiencies).toEqual(none.proficiencies);
    expect(build(wiz3, v2(atLeast('athletics', 'trained')), { overridesEnabled: true } as BuildState['options']).proficiencies.skills.athletics).toBe('expert');
  });
});

describe('rank blocks survive the reverse build (build → deriveBuildFromCharacter → build)', () => {
  it('an "at least" floor under a skill increase, a start-level floor and an "exactly" clamp: the same ranks after three round trips', () => {
    const b = hero('fighter', 7, { skillIncreases: { 3: 'athletics', 5: 'stealth', 7: 'athletics' } } as Partial<BuildState>);
    const ov: BuildOverrides = {
      proficiencies: { athletics: 'trained', stealth: 'expert', perception: 'trained', 'lore:Sailing Lore': 'trained' },
      meta: {
        'proficiencies:athletics': { mode: 'atLeast', of: 'trained' },
        'proficiencies:stealth': { mode: 'atLeast', of: 'expert', from: 7 },
        'proficiencies:perception': { mode: 'exactly', of: 'trained' },
        'proficiencies:lore:Sailing Lore': { mode: 'atLeast', of: 'trained' },
      },
    };
    const c1 = build(b, ov);
    expect(c1.proficiencies.skills.athletics).toBe('master'); // trained floor → expert at 3 → master at 7
    expect(c1.proficiencies.skills.stealth).toBe('expert');
    expect(c1.proficiencies.perception).toBe('trained');
    let c = c1;
    for (let i = 0; i < 3; i++) c = buildCharacter(deriveBuildFromCharacter(c, db), db);
    expect(c.proficiencies).toEqual(c1.proficiencies);
    expect(c.overrides).toEqual(c1.overrides);
  });

  /** The same overrides with every rank tweak paused (meta on:false). */
  const paused = (ov: BuildOverrides | undefined): BuildOverrides => ({
    ...ov,
    meta: Object.fromEntries(Object.entries(ov?.meta ?? {}).map(([k, m]) => [k, { ...m, on: false }])),
  });

  it('never INVENTS a class-skill pick: a wizard who never picked Athletics, floored at trained, still has no Athletics pick — paused after the round trip it is untrained, as before', () => {
    const b = hero('wizard', 3, { classSkills: ['stealth'] } as Partial<BuildState>);
    const tw = atLeast('athletics', 'trained');
    const c1 = build(b, tw);
    expect(c1.proficiencies.skills.athletics).toBe('trained');
    const back = deriveBuildFromCharacter(c1, db);
    expect(back.classSkills).not.toContain('athletics');
    expect(buildCharacter({ ...back, overrides: paused(back.overrides) }, db).proficiencies.skills.athletics).toBe(build(b, paused(tw)).proficiencies.skills.athletics);
    expect(build(b, paused(tw)).proficiencies.skills.athletics).toBe('untrained');
  });

  it('KNOWN LIMIT (part B keeps the stored build): a real class-skill pick under a live rank tweak comes back as "granted", not as a pick — the same as today\'s legacy "="', () => {
    // If this starts failing, the reverse build learned to tell a pick from a tweak: update the limit
    // lines beside the clamp in build.ts, in docs/overrides-redesign.md item 8 and the part B list.
    const b = hero('wizard', 1, { classSkills: ['athletics', 'stealth'] } as Partial<BuildState>);
    for (const ov of [exactly('athletics', 'expert'), atLeast('athletics', 'expert'), { proficiencies: { athletics: 'expert' as ProficiencyRank } }]) {
      const back = deriveBuildFromCharacter(build(b, ov), db);
      expect(back.classSkills).toContain('stealth');
      expect(back.classSkills).not.toContain('athletics');
    }
  });
});

describe('the stored reader keys a Lore through loreKey only for a rank block (an old entry keeps the row it writes)', () => {
  it("'rank.legacySet' Lore: raw target, never broken; 'rank.atLeast' Lore: the loreKey row, broken when it names no subject", () => {
    const legacy = readLegacyBlocks({ proficiencies: { 'lore:Sailing Lore': 'expert', 'lore:Lore': 'trained' } });
    const byKey = new Map(legacy.map((b) => [b.key, b]));
    expect(byKey.get('proficiencies:lore:Sailing Lore')).toMatchObject({ kind: 'rank.legacySet', target: 'skill:lore:Sailing Lore', rank: 'expert' });
    expect(byKey.get('proficiencies:lore:Sailing Lore')!.broken).toBeUndefined();
    expect(byKey.get('proficiencies:lore:Lore')).toMatchObject({ kind: 'rank.legacySet', target: 'skill:lore:Lore' });
    expect(byKey.get('proficiencies:lore:Lore')!.broken).toBeUndefined();
    // …and the build's '=' loop really writes that raw row (the target names what the entry changes).
    expect(build(hero('wizard', 1), { proficiencies: { 'lore:Lore': 'trained' } }).proficiencies.skills['lore:Lore' as never]).toBe('trained');

    const sorted = readLegacyBlocks({
      proficiencies: { 'lore:Sailing Lore': 'expert', 'lore:Lore': 'trained' },
      meta: { 'proficiencies:lore:Sailing Lore': { mode: 'atLeast', of: 'expert' }, 'proficiencies:lore:Lore': { mode: 'atLeast', of: 'trained' } },
    });
    const s = new Map(sorted.map((b) => [b.key, b]));
    expect(s.get('proficiencies:lore:Sailing Lore')).toMatchObject({ kind: 'rank.atLeast', target: 'skill:lore:sailing' });
    expect(s.get('proficiencies:lore:Lore')!.kind).toBe('rank.atLeast');
    expect(s.get('proficiencies:lore:Lore')!.target).toBeUndefined();
    expect(s.get('proficiencies:lore:Lore')!.broken).toMatch(/no Lore subject/);
  });
});

describe('a Lore floor keys through loreKey (spec item 11)', () => {
  it('"Scribing Lore" at least expert lands on the background\'s lore:scribing — one row, not two', () => {
    const b = hero('wizard', 3);
    expect(build(b).proficiencies.skills['lore:scribing']).toBe('trained');
    const c = build(b, atLeast('lore:Scribing Lore', 'expert'));
    expect(c.proficiencies.skills['lore:scribing']).toBe('expert');
    expect(Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'))).toEqual(['lore:scribing']);
  });

  it('a level-7 increase on the background Lore steps from the floor; a new Lore subject is added under its one key', () => {
    const b = hero('wizard', 7, { skillIncreases: { 7: 'lore:scribing' } } as Partial<BuildState>);
    expect(build(b).proficiencies.skills['lore:scribing']).toBe('expert'); // trained → expert
    expect(build(b, atLeast('lore:scribing-lore', 'expert')).proficiencies.skills['lore:scribing']).toBe('master'); // expert → master
    const sea = build(hero('wizard', 3), atLeast('lore:Lore of the Sea', 'trained'));
    expect(sea.proficiencies.skills['lore:sea']).toBe('trained');
    expect('lore:Lore of the Sea' in sea.proficiencies.skills).toBe(false);
  });

  it('"exactly" on a Lore keys the same way', () => {
    const b = hero('commander', 3);
    expect(build(b, exactly('lore:Warfare Lore', 'trained')).proficiencies.skills['lore:warfare']).toBe('trained');
  });
});
