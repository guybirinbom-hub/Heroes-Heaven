/*
 * Tweaks phase 2, WP11 — an extra skill increase and an extra attribute boost a player adds at a level
 * (`choice.addPlace` with `place: 'skillIncrease'` / `'boost'`, a carrier: the block holds the answer; plan
 * work/tweaks-phase2-notes/plan.md WP11, C15, C16, C43, C3). Synthetic characters only. The Tweaks page and the
 * Builder cards are test/tweaks-p2-skill-boost-places-ui.test.tsx.
 *
 * Pinned here:
 *   - the extra increase counts at its level and every later one, through the ledger (`skillHistory` holds a
 *     `tweakIncrease:<id>` step, the skill timeline shows it with its reason), and the level's cap holds;
 *   - paused and Tweaks off = the twin with no place; a book character is unchanged;
 *   - the extra boost is its own group after the level's set: on an attribute that set already boosted it adds +2,
 *     at 18 or more +1; the attribute breakdown lists it as its own line (the parts sum to the score), with a
 *     timeline entry, both gone while paused; the level's own boost count is untouched;
 *   - an unreadable carrier (`attribute: 'luck'`) changes nothing and throws nothing (C3);
 *   - the bonus and background lanes' starting ranks are untouched, and the tweak lane starts after them
 *     (`afterBackground`, C15);
 *   - a build-less reopen (deriveBuildFromCharacter) keeps the increase out of the main lane and the boost single
 *     (three reopens, C43);
 *   - an empty live place is owed (levelChoices), a paused one is not;
 *   - a carrier on a Lore the character does not know is Broken with Point to another on its skill (finding 16).
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, levelChoices, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { baselineFor } from '../src/rules/blocks/baseline';
import { openForTweaks } from '../src/rules/blocks/save';
import { explainStat } from '../src/rules/explain';
import { skillRankAt, TWEAK_INCREASE_SOURCE } from '../src/rules/ranks';
import { carrierSkillOptions, tweakRows } from '../src/builder/tweaks/model';
import type { BuildOverrides, Character, ProficiencyKey } from '../src/rules/types';

const db = content();
let seq = 0;
const nextId = (tag: string) => `t${++seq}_${tag}${String(seq).padStart(2, '0')}`;
const skillPlace = (level: number, skill?: string, more: Record<string, unknown> = {}) => ({
  id: nextId('wp11sk'),
  kind: 'choice.addPlace',
  v: 1,
  place: 'skillIncrease',
  level,
  ...(skill ? { skill } : {}),
  ...more,
});
const boostPlace = (level: number, attribute?: string, more: Record<string, unknown> = {}) => ({
  id: nextId('wp11bo'),
  kind: 'choice.addPlace',
  v: 1,
  place: 'boost',
  level,
  ...(attribute ? { attribute } : {}),
  ...more,
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const pause = (b: BuildState): BuildState => ({ ...b, overrides: ov(...((b.overrides?.blocks ?? []) as object[]).map((x) => ({ ...x, on: false }))) });
const noBlocks = (b: BuildState): BuildState => ({ ...b, overrides: ov() });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));

function hero(level: number, blocks: object[], more: Partial<BuildState> = {}, classId = 'fighter'): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'WP11 place fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    options: { overridesEnabled: true },
    overrides: ov(...blocks),
    ...more,
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}
/** What a Character shows that a place could move (the numbers, the ledger, the boost record). */
const sheet = (c: Character) => ({
  abilities: c.abilities,
  skills: c.proficiencies.skills,
  skillIncreases: c.skillIncreases,
  steps: c.skillHistory?.steps,
  tweakBoostSteps: c.tweakBoostSteps,
});
const tweakStep = (c: Character, id: string) => c.skillHistory?.steps.find((s) => s.source === `${TWEAK_INCREASE_SOURCE}${id}`);

describe('the extra skill increase (lane "tweak")', () => {
  const sk = skillPlace(5, 'stealth', { reason: 'GM gift' });
  const b = hero(8, [sk]);
  const c = built(b);

  it('counts at its level and every later level, and only from there', () => {
    expect(skillRankAt(built(noBlocks(b)), 'stealth', 8, 'end'), 'the twin never trains Stealth').toBe('untrained');
    expect(skillRankAt(c, 'stealth', 4, 'end')).toBe('untrained');
    for (const lvl of [5, 6, 7, 8]) expect(skillRankAt(c, 'stealth', lvl, 'end'), `level ${lvl}`).toBe('trained');
    expect(c.proficiencies.skills.stealth).toBe('trained');
    expect(c.skillIncreases?.filter((s) => s.lane === 'tweak')).toEqual([{ level: 5, skill: 'stealth', lane: 'tweak' }]);
  });

  it('skillHistory holds the step and the skill timeline shows it with its reason', () => {
    const step = tweakStep(c, sk.id);
    expect(step, 'a tweakIncrease step').toBeTruthy();
    expect(step!.key).toBe('stealth');
    expect(step!.level).toBe(5);
    const tl = explainStat(c, db, { kind: 'skill', skill: 'stealth' }).timeline;
    const e = tl.find((t) => t.level === 5);
    expect(e?.text).toMatch(/Trained/);
    expect(e?.detail).toBe('Tweak: extra skill increase (GM gift)');
  });

  it('the level cap holds: a skill already expert cannot go to master at level 5', () => {
    // Religion is trained by Acolyte; the main increase at 3 makes it expert; level 5 still caps at expert.
    const capped = hero(5, [skillPlace(5, 'religion')], { skillIncreases: { 3: 'religion' } });
    const cc = built(capped);
    expect(cc.proficiencies.skills.religion).toBe('expert');
    // The same as a main increase over the cap: the answer is kept, the step says "cap" and raises nothing.
    const step = cc.skillHistory?.steps.find((s) => s.source.startsWith(TWEAK_INCREASE_SOURCE));
    expect(step).toMatchObject({ level: 5, key: 'religion', from: 'expert', to: 'expert', note: 'cap' });
    // At 7 the cap is master, so the same place at 7 counts.
    const at7 = built(hero(7, [skillPlace(7, 'religion')], { skillIncreases: { 3: 'religion' } }));
    expect(at7.proficiencies.skills.religion).toBe('master');
  });

  it('paused, and Tweaks off, are the twin without the place', () => {
    const twin = sheet(built(noBlocks(b)));
    expect(sheet(built(pause(b)))).toEqual(twin);
    expect(sheet(built(off(b)))).toEqual(twin);
    expect(explainStat(built(pause(b)), db, { kind: 'skill', skill: 'stealth' }).timeline.some((t) => /Tweak/.test(t.detail ?? ''))).toBe(false);
  });

  it('pausing writes nothing: the stored blocks are byte-equal after a build', () => {
    const p = pause(b);
    const before = JSON.stringify(p.overrides);
    built(p);
    built(b);
    expect(JSON.stringify(p.overrides)).toBe(before);
  });
});

describe('the bonus and background lanes start where they did; the tweak lane starts after them (C15)', () => {
  // A level-7 swashbuckler: Stylish Tricks' bonus increase at 7 makes Acrobatics expert; the tweak at 7 raises it again.
  const base = hero(7, [], { skillIncreases: { 3: 'stealth', 5: 'athletics', 7: 'stealth' }, bonusSkillIncreases: { 3: 'stealth', 7: 'acrobatics' } }, 'swashbuckler');
  const tw = skillPlace(7, 'acrobatics');
  const withTweak = { ...base, overrides: ov(tw) };
  const twin = built(base);
  const c = built(withTweak);
  it('afterMain and afterBonus are unchanged; afterBackground is the tweak card start; end holds the tweak', () => {
    for (const point of ['afterMain', 'afterBonus', 'afterBackground'] as const)
      expect(skillRankAt(c, 'acrobatics', 7, point), point).toBe(skillRankAt(twin, 'acrobatics', 7, point));
    expect(skillRankAt(c, 'acrobatics', 7, 'afterMain')).toBe('trained');
    expect(skillRankAt(c, 'acrobatics', 7, 'afterBonus')).toBe('expert');
    expect(skillRankAt(c, 'acrobatics', 7, 'afterBackground')).toBe('expert');
    expect(skillRankAt(c, 'acrobatics', 7, 'end')).toBe('master');
    expect(twin.proficiencies.skills.acrobatics).toBe('expert');
  });
});

describe('the extra attribute boost', () => {
  it('a boost on an attribute the level already boosted adds +2 more, recorded in tweakBoostSteps', () => {
    const b = hero(5, [], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'] } });
    const bo = boostPlace(5, 'dex');
    const twin = built(b);
    const c = built({ ...b, overrides: ov(bo) });
    expect(c.abilities.dex).toBe(twin.abilities.dex + 2);
    expect(c.tweakBoostSteps).toEqual([{ id: bo.id, level: 5, attribute: 'dex', value: 2 }]);
    expect(twin.tweakBoostSteps, 'absent when empty: every existing Character is unchanged').toBeUndefined();
  });

  it('partial at 18 or more: +1', () => {
    const b = hero(10, [], {
      ancestryBoosts: ['dex', 'con'],
      backgroundBoosts: ['dex', 'wis'],
      attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'dex', 'con', 'wis'] },
    });
    const bo = boostPlace(10, 'dex');
    const twin = built(b);
    expect(twin.abilities.dex, 'the fixture reaches 18 before the tweak').toBeGreaterThanOrEqual(18);
    const c = built({ ...b, overrides: ov(bo) });
    expect(c.abilities.dex).toBe(twin.abilities.dex + 1);
    expect(c.tweakBoostSteps?.[0]?.value).toBe(1);
  });

  it('the Dex breakdown: parts sum to the score with the tweak line; line and timeline entry gone while paused', () => {
    const bo = boostPlace(5, 'dex', { reason: 'GM gift' });
    const b = hero(5, [bo]);
    const c = built(b);
    const ex = explainStat(c, db, { kind: 'ability', ability: 'dex' }, b);
    expect(ex.parts.reduce((n, p) => n + p.value, 0)).toBe(c.abilities.dex);
    expect(ex.parts.map((p) => p.label)).toContain('Tweak: boost at level 5 (GM gift)');
    expect(ex.timeline.some((t) => t.level === 5 && t.text === 'Attribute boost +2')).toBe(true);
    const p = pause(b);
    const cp = built(p);
    const exp = explainStat(cp, db, { kind: 'ability', ability: 'dex' }, p);
    expect(cp.abilities.dex).toBe(c.abilities.dex - 2);
    expect(exp.parts.reduce((n, x) => n + x.value, 0)).toBe(cp.abilities.dex);
    expect(exp.parts.some((x) => /Tweak/.test(x.label))).toBe(false);
    expect(exp.timeline.some((t) => /Tweak/.test(t.detail ?? ''))).toBe(false);
  });

  it('paused, and Tweaks off, are the twin without the place', () => {
    const b = hero(5, [boostPlace(5, 'dex')]);
    const twin = sheet(built(noBlocks(b)));
    expect(sheet(built(pause(b)))).toEqual(twin);
    expect(sheet(built(off(b)))).toEqual(twin);
  });

  it('an unreadable carrier (attribute "luck") changes no score, no breakdown line, no tweakBoostSteps; nothing throws', () => {
    const b = hero(5, [boostPlace(5, 'luck')]);
    let c: Character | undefined;
    expect(() => (c = built(b))).not.toThrow();
    expect(sheet(c!)).toEqual(sheet(built(noBlocks(b))));
    expect(Object.keys(c!.abilities).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
    expect(c!.tweakBoostSteps).toBeUndefined();
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      const ex = explainStat(c!, db, { kind: 'ability', ability: a }, b);
      expect(ex.parts.some((p) => /Tweak/.test(p.label)), a).toBe(false);
    }
    expect(levelChoices(b, contentFor(db, b)).some((m) => /extra attribute boost/.test(m.label)), 'unreadable = not owed').toBe(false);
    const row = tweakRows(b, c!, contentFor(db, b)).find((r) => r.kind === 'choice.addPlace' || r.readOnly);
    expect(row?.repoint, 'no Point to another for a boost carrier').toBeFalsy();
  });
});

describe('book twins and the level\'s own boost count', () => {
  it('a build with no place and the same build with Tweaks off are equal', () => {
    const b = hero(5, [], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'] }, skillIncreases: { 3: 'stealth', 5: 'religion' } });
    expect(sheet(built(off(b)))).toEqual(sheet(built(b)));
  });
  it('the level\'s set still owes what it owed: a tweak boost is not one of its four', () => {
    const three = hero(5, [], { attributeBoosts: { 5: ['str', 'dex', 'con'] } });
    const owedBoost = (x: BuildState) => levelChoices(x, contentFor(db, x)).filter((m) => /— attribute boost/.test(m.label)).map((m) => m.label);
    const withTweak = { ...three, overrides: ov(boostPlace(5, 'wis')) };
    expect(owedBoost(withTweak)).toEqual(owedBoost(three));
    expect(owedBoost(three)).toHaveLength(1);
    const four = hero(5, [boostPlace(5, 'wis')], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'] } });
    expect(owedBoost(four)).toEqual([]);
  });
});

describe('an empty live place is owed; a paused one is not', () => {
  it('levelChoices', () => {
    const b = hero(5, [skillPlace(5), boostPlace(5)]);
    const labels = levelChoices(b, contentFor(db, b)).map((m) => m.label);
    expect(labels).toContain('Level 5 — extra skill increase');
    expect(labels).toContain('Level 5 — extra attribute boost');
    const p = pause(b);
    const pl = levelChoices(p, contentFor(db, p)).map((m) => m.label);
    expect(pl.some((l) => /extra (skill increase|attribute boost)/.test(l))).toBe(false);
    const filled = hero(5, [skillPlace(5, 'stealth'), boostPlace(5, 'dex')]);
    expect(levelChoices(filled, contentFor(db, filled)).some((m) => /extra (skill increase|attribute boost)/.test(m.label))).toBe(false);
  });
});

describe('a build-less reopen keeps both places where they are (C43)', () => {
  it('Dex and Stealth stay the same over three reopens; the main lane never gets the tweak increase', () => {
    const b = hero(5, [skillPlace(5, 'stealth'), boostPlace(5, 'dex')], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'] } });
    const first = built(b);
    let cur = first;
    for (let i = 0; i < 3; i++) {
      const rb = deriveBuildFromCharacter(cur, contentFor(db, b));
      expect(rb.skillIncreases[5], `reopen ${i + 1}: the main lane at 5 stays empty`).toBeFalsy();
      expect(rb.overrides?.blocks, `reopen ${i + 1}: the blocks travel`).toEqual(b.overrides?.blocks);
      cur = built(rb);
      expect(cur.abilities.dex, `reopen ${i + 1}`).toBe(first.abilities.dex);
      expect(cur.proficiencies.skills.stealth, `reopen ${i + 1}`).toBe('trained');
      expect(cur.tweakBoostSteps).toEqual(first.tweakBoostSteps);
    }
  });

  // Fix round 1 (finding 2): the reverse build counts each extra boost as one more fixed boost. Subtracting its
  // delta instead breaks here: Cha 20 − 2 = 18 asks for four book boosts, the extra one makes five, and 19 comes back.
  const reopens = (b: BuildState, a: 'cha' | 'dex') => {
    const out: number[] = [];
    let cur = built(b);
    for (let i = 0; i < 3; i++) {
      cur = built(deriveBuildFromCharacter(cur, contentFor(db, b)));
      out.push(cur.abilities[a]);
    }
    return out;
  };
  it('the partial rule across reopens: Cha 16, extra boost at 5 (18), book boosts at 10 and 15 (19, 20)', () => {
    const b = hero(15, [boostPlace(5, 'cha')], {
      ancestryBoosts: ['cha', 'con'],
      backgroundBoosts: ['wis', 'cha'],
      levelBoosts: ['str', 'dex', 'con', 'cha'],
      attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'dex', 'con', 'cha'], 15: ['str', 'dex', 'con', 'cha'] },
    });
    const c = built(b);
    expect(built(noBlocks(b)).abilities.cha, 'the twin: 16, 18, 19').toBe(19);
    expect(c.abilities.cha).toBe(20);
    expect(c.tweakBoostSteps).toEqual([expect.objectContaining({ level: 5, attribute: 'cha', value: 2 })]);
    expect(reopens(b, 'cha')).toEqual([20, 20, 20]);
  });
  it('the partial rule across reopens: Dex 18 at level 1, extra boost at 5 (+1 = 19)', () => {
    const b = hero(5, [boostPlace(5, 'dex')], {
      keyAbility: 'dex',
      ancestryBoosts: ['dex', 'con'],
      backgroundBoosts: ['wis', 'dex'],
      levelBoosts: ['str', 'dex', 'con', 'wis'],
    });
    expect(built(noBlocks(b)).abilities.dex, 'the twin').toBe(18);
    const c = built(b);
    expect(c.abilities.dex).toBe(19);
    expect(c.tweakBoostSteps?.[0]?.value).toBe(1);
    expect(reopens(b, 'dex')).toEqual([19, 19, 19]);
  });
});

describe('a set made while an extra place is live stores no book baseline (fix round 1, finding 1)', () => {
  const setOn = (target: string, value: number, baseline?: number) => ({
    id: nextId('wp11ns'),
    kind: 'number.set',
    v: 1,
    target,
    value,
    ...(baseline === undefined ? {} : { baseline }),
  });
  const chipsOf = (b: BuildState) =>
    tweakRows(b, built(b), contentFor(db, b))
      .filter((r) => r.kind === 'number.set')
      .flatMap((r) => r.chips.map((c) => c.kind));
  const cases = [
    { target: 'ac', place: () => boostPlace(5, 'dex') },
    { target: 'skill:stealth', place: () => skillPlace(5, 'stealth') },
  ];
  for (const { target, place } of cases) {
    it(`${target}: no baseline while the place is live; pausing the place shows no "Book number changed"`, () => {
      const pl = place();
      const live = hero(5, [pl]);
      const twin = hero(5, []);
      expect(baselineFor(built(twin), db, target), 'the twin knows its book number').toBeTypeOf('number');
      const known = baselineFor(built(live), db, target);
      expect(known, 'unknown while the place is live').toBeUndefined();
      // The set as the editor stamps it (no baseline), then the place paused: no chip.
      const paused = hero(5, [{ ...pl, on: false }, setOn(target, 30, known)]);
      expect(chipsOf(paused)).not.toContain('bookChanged');
      // The guard's teeth: the number the old code stored (the book counting the place) does show the false chip.
      const wrong = baselineFor(built({ ...live, overrides: ov() }), db, target)! + (target === 'ac' ? 1 : 2);
      expect(chipsOf(hero(5, [{ ...pl, on: false }, setOn(target, 30, wrong)]))).toContain('bookChanged');
    });
  }
  it('score:dex: no baseline while an extra Dex boost is live (with or without the build); the open-time stamp agrees', () => {
    const live = hero(5, [boostPlace(5, 'dex')]);
    expect(baselineFor(built(live), db, 'score:dex', live)).toBeUndefined();
    expect(baselineFor(built(live), db, 'score:dex')).toBeUndefined();
    expect(baselineFor(built(live), db, 'score:str', live), 'another attribute is still known').toBeTypeOf('number');
    // blocks/save.ts openForTweaks stamps an old attribute set's baseline through the same function.
    const legacy = (blocks: object[]) => ({ ...hero(5, blocks), overrides: { ...ov(...blocks), attributes: { dex: 16 } } as unknown as BuildOverrides });
    const stamped = (b: BuildState) => JSON.stringify(openForTweaks(b, contentFor(db, b)).overrides ?? {});
    expect(stamped(legacy([])), 'control: the stamp writes a baseline').toMatch(/"baseline":/);
    expect(stamped(legacy([boostPlace(5, 'dex')]))).not.toMatch(/"baseline":/);
  });
});

describe('a carrier on a Lore the character does not know is Broken (finding 16)', () => {
  const sk = skillPlace(5, 'lore:sailing');
  const b = hero(5, [sk]);
  const c = built(b);
  it('applies nothing and creates no Lore', () => {
    expect(c.proficiencies.skills['lore:sailing' as ProficiencyKey] ?? 'untrained').toBe('untrained');
    expect(tweakStep(c, sk.id)?.note).toBe('drop');
  });
  it('its row is Broken and offers Point to another on its skill; the options are the known skills only', () => {
    const row = tweakRows(b, c, contentFor(db, b)).find((r) => r.kind === 'choice.addPlace')!;
    expect(row.broken).toMatch(/is not a Lore you know at level 5/);
    expect(row.repoint).toEqual({ answer: 'skill' });
    const opts = carrierSkillOptions(c, 5);
    expect(opts.some((o) => o.value === 'lore:sailing')).toBe(false);
    expect(opts.find((o) => o.value === 'stealth')?.disabled).toBeFalsy();
  });
  it('a known Lore is not Broken (Acolyte\'s Scribing Lore)', () => {
    const lore = Object.keys(built(hero(5, [])).proficiencies.skills).find((k) => k.startsWith('lore:'))!;
    expect(lore, 'the fixture knows a Lore').toBeTruthy();
    const ok = hero(5, [skillPlace(5, lore)]);
    const okc = built(ok);
    expect(okc.proficiencies.skills[lore as ProficiencyKey]).toBe('expert');
    expect(tweakRows(ok, okc, contentFor(db, ok)).find((r) => r.kind === 'choice.addPlace')!.broken).toBeFalsy();
  });
});
