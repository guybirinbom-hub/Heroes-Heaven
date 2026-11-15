/*
 * Tweaks phase 2, WP14 — "Remove a place" for a skill increase and an attribute boost (`remove.choicePlace` with
 * `place: 'skillIncrease'` / `'boost'`; plan work/tweaks-phase2-notes/plan.md WP14, C46, C47, section 10). Synthetic
 * characters only. The screens are test/tweaks-p2-remove-skill-boost-ui.test.tsx.
 *
 * Pinned here:
 *   - a removed 5th-level increase holding Stealth: Stealth drops a rank at 5 and every later level, the store is
 *     byte-equal, `Character.tweakKept.skillIncreases` keeps the answer, the timeline loses the step, Restore (the
 *     block deleted) brings the rank back;
 *   - paused and Tweaks off: the place is back with its answer, which counts;
 *   - an empty removed increase is not owed; a filled one owes nothing; `levelChoices` is otherwise deep-equal;
 *   - a removed bonus increase and a removed background increase;
 *   - a removed 10th-level boost holding Dex (+2 below 18, +1 from 18), the breakdown parts sum, the other three count;
 *   - a removed ancestry boost and a removed level-1 free boost; their empty twins are not owed in Setup;
 *   - the places a removal may name: only boost slots a player answers (no fixed boost, no key attribute);
 *   - a build-less reopen puts the kept Stealth and Dex back in their stores, and Dex is not counted twice.
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, drawnSkillBoostPlaces, emptyBuild, levelChoices, setupMissing, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { storedChoiceBlocks } from '../src/rules/blocks/active';
import { dropChoiceTweak } from '../src/rules/blocks/write';
import { explainStat } from '../src/rules/explain';
import { skillRankAt } from '../src/rules/ranks';
import type { BuildOverrides, Character, ContentDatabase } from '../src/rules/types';

const db = content();
let seq = 0;
const nextId = (tag: string) => `t${++seq}_${tag}${String(seq).padStart(2, '0')}`;
const rmSkill = (level: number, lane = 'main', more: Record<string, unknown> = {}) => ({
  id: nextId('wp14sk'),
  kind: 'remove.choicePlace',
  v: 1,
  place: 'skillIncrease',
  level,
  lane,
  ...more,
});
const rmBoost = (set: string, index: number, level?: number) => ({
  id: nextId('wp14bo'),
  kind: 'remove.choicePlace',
  v: 1,
  place: 'boost',
  set,
  ...(set === 'level' ? { level } : {}),
  index,
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const pause = (b: BuildState): BuildState => ({ ...b, overrides: ov(...((b.overrides?.blocks ?? []) as object[]).map((x) => ({ ...x, on: false }))) });
const noBlocks = (b: BuildState): BuildState => ({ ...b, overrides: ov() });
const cdb = (b: BuildState): ContentDatabase => contentFor(db, b);
const built = (b: BuildState): Character => buildCharacter(b, cdb(b));
const restore = (b: BuildState): BuildState => {
  const key = storedChoiceBlocks(b).find((x) => x.kind === 'remove.choicePlace')!.key;
  const r = dropChoiceTweak(b, key);
  expect(r.refused).toBeUndefined();
  return r.build;
};

function hero(level: number, blocks: object[], more: Partial<BuildState> = {}, classId = 'fighter'): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'WP14 removal fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ancestryBoosts: ['int', 'cha'],
    backgroundBoosts: ['wis', 'con'],
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    options: { overridesEnabled: true },
    overrides: ov(...blocks),
    ...more,
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}
/** What a removal could move on the sheet. */
const sheet = (c: Character) => ({ abilities: c.abilities, skills: c.proficiencies.skills, skillIncreases: c.skillIncreases });
const owed = (b: BuildState) => levelChoices(b, cdb(b)).map((m) => m.label);

describe('a removed 5th-level skill increase holding Stealth', () => {
  const b = hero(8, [rmSkill(5, 'main', { reason: 'GM ruling' })], { skillIncreases: { 5: 'stealth' } });
  const c = built(b);

  it('Stealth drops a rank at 5 and at every later level; the sheet is the twin without the answer', () => {
    const kept = built(noBlocks(b));
    for (const lvl of [5, 6, 7, 8]) {
      expect(skillRankAt(kept, 'stealth', lvl, 'end'), `level ${lvl}, the place counting`).toBe('trained');
      expect(skillRankAt(c, 'stealth', lvl, 'end'), `level ${lvl}, the place removed`).toBe('untrained');
    }
    expect(sheet(c)).toEqual(sheet(built({ ...noBlocks(b), skillIncreases: {} })));
  });

  it('the store is byte-equal after the build, and the kept answer travels in Character.tweakKept', () => {
    const before = JSON.stringify(b.skillIncreases);
    built(b);
    expect(JSON.stringify(b.skillIncreases)).toBe(before);
    expect(c.tweakKept?.skillIncreases).toEqual([{ level: 5, lane: 'main', skill: 'stealth' }]);
    expect(c.tweakKept?.boosts, 'absent when empty').toBeUndefined();
    expect(built(noBlocks(b)).tweakKept, 'no removal: no tweakKept').toBeUndefined();
  });

  it('the skill timeline loses the step', () => {
    const tl = explainStat(c, db, { kind: 'skill', skill: 'stealth' }, b).timeline;
    expect(tl.some((t) => t.level === 5)).toBe(false);
    const tk = explainStat(built(noBlocks(b)), db, { kind: 'skill', skill: 'stealth' }, noBlocks(b)).timeline;
    expect(tk.some((t) => t.level === 5)).toBe(true);
  });

  it('Restore deletes the block and the rank comes back', () => {
    const r = restore(b);
    expect(r.overrides?.blocks ?? []).toEqual([]);
    expect(built(r).proficiencies.skills.stealth).toBe('trained');
    expect(r.skillIncreases).toEqual(b.skillIncreases);
  });

  it('paused, and Tweaks off: the place is back with its answer, which counts; nothing is kept', () => {
    const twin = sheet(built(noBlocks(b)));
    for (const x of [pause(b), off(b)]) {
      const cx = built(x);
      expect(sheet(cx)).toEqual(twin);
      expect(cx.proficiencies.skills.stealth).toBe('trained');
      expect(cx.tweakKept).toBeUndefined();
    }
  });

  it('a filled removed place owes nothing: levelChoices is the twin\'s', () => {
    expect(owed(b)).toEqual(owed(noBlocks(b)));
  });
});

describe('an empty removed skill increase', () => {
  it('is not owed; levelChoices is otherwise deep-equal', () => {
    const e = hero(8, [rmSkill(5)]);
    const twin = owed(noBlocks(e));
    expect(twin).toContain('Level 5 — skill increase');
    expect(owed(e)).toEqual(twin.filter((l) => l !== 'Level 5 — skill increase'));
    expect(owed(pause(e)), 'paused: owed again').toEqual(twin);
    expect(owed(off(e)), 'Tweaks off: owed again').toEqual(twin);
    expect(built(e).tweakKept, 'nothing to keep').toBeUndefined();
  });
});

describe('the other two increase lanes', () => {
  it('a removed bonus increase (swashbuckler, level 3, Acrobatics)', () => {
    const b = hero(3, [rmSkill(3, 'bonus')], { bonusSkillIncreases: { 3: 'acrobatics' } }, 'swashbuckler');
    const kept = built(noBlocks(b));
    const c = built(b);
    expect(kept.proficiencies.skills.acrobatics).toBe('expert');
    expect(c.proficiencies.skills.acrobatics).toBe('trained');
    expect(sheet(c)).toEqual(sheet(built({ ...noBlocks(b), bonusSkillIncreases: {} })));
    expect(c.tweakKept?.skillIncreases).toEqual([{ level: 3, lane: 'bonus', skill: 'acrobatics' }]);
    expect(owed(b)).toEqual(owed(noBlocks(b)));
    // Both lanes empty: the main one is still owed, the removed bonus one is not.
    const lvl3 = (x: BuildState) => owed(x).filter((l) => l === 'Level 3 — skill increase').length;
    const empty = hero(3, [rmSkill(3, 'bonus')], {}, 'swashbuckler');
    expect(lvl3(noBlocks(empty))).toBe(2);
    expect(lvl3(empty)).toBe(1);
  });

  it('a removed background increase (Reborn Soul, level 3, Warfare Lore)', () => {
    const rs = { backgroundId: 'reborn-soul', backgroundLore: 'Warfare', backgroundLore2: 'Sailing', backgroundBoosts: ['con', 'wis'] } as Partial<BuildState>;
    const b = hero(3, [rmSkill(3, 'background')], { ...rs, backgroundSkillIncreases: { 3: 'lore:warfare' } });
    const kept = built(noBlocks(b));
    const c = built(b);
    expect(kept.proficiencies.skills['lore:warfare']).toBe('expert');
    expect(c.proficiencies.skills['lore:warfare']).toBe('trained');
    expect(sheet(c)).toEqual(sheet(built({ ...noBlocks(b), backgroundSkillIncreases: {} })));
    expect(c.tweakKept?.skillIncreases).toEqual([{ level: 3, lane: 'background', skill: 'lore:warfare' }]);
  });
});

describe('a removed 10th-level boost holding Dex', () => {
  const sets = { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] } as BuildState['attributeBoosts'];

  it('below 18: Dex drops by 2; the other three still count; the breakdown parts sum to the score', () => {
    const b = hero(10, [rmBoost('level', 2, 10)], { attributeBoosts: sets });
    const c = built(b);
    const kept = built(noBlocks(b));
    expect(c.abilities.dex).toBe(kept.abilities.dex - 2);
    for (const a of ['str', 'con', 'wis', 'int', 'cha'] as const) expect(c.abilities[a], a).toBe(kept.abilities[a]);
    expect(c.abilities).toEqual(built({ ...noBlocks(b), attributeBoosts: { ...sets, 10: ['str', 'con', null, 'wis'] } }).abilities);
    const ex = explainStat(c, db, { kind: 'ability', ability: 'dex' }, b);
    expect(ex.parts.reduce((n, p) => n + p.value, 0)).toBe(c.abilities.dex);
    expect(ex.parts.map((p) => p.label), 'no new line').toEqual(['Base', 'Boosts & flaws']);
    expect(ex.timeline.some((t) => t.level === 10), 'the timeline loses the 10th-level boost').toBe(false);
    expect(explainStat(kept, db, { kind: 'ability', ability: 'dex' }, noBlocks(b)).timeline.some((t) => t.level === 10)).toBe(true);
    expect(c.tweakKept?.boosts).toEqual([{ set: 'level', level: 10, index: 2, attribute: 'dex' }]);
    expect(JSON.stringify(b.attributeBoosts)).toBe(JSON.stringify(sets));
  });

  it('from 18: Dex drops by 1', () => {
    const b = hero(10, [rmBoost('level', 2, 10)], { keyAbility: 'dex', ancestryBoosts: ['dex', 'con'], backgroundBoosts: ['wis', 'dex'], attributeBoosts: sets });
    const kept = built(noBlocks(b));
    expect(kept.abilities.dex, 'the fixture is past 18 before level 10').toBe(20);
    expect(built(b).abilities.dex).toBe(19);
  });

  it('paused and Tweaks off: the boost counts again', () => {
    const b = hero(10, [rmBoost('level', 2, 10)], { attributeBoosts: sets });
    const kept = built(noBlocks(b)).abilities;
    expect(built(pause(b)).abilities).toEqual(kept);
    expect(built(off(b)).abilities).toEqual(kept);
  });

  it('a filled removed set owes nothing; an empty removed boost is not owed', () => {
    const b = hero(10, [rmBoost('level', 2, 10)], { attributeBoosts: sets });
    expect(owed(b)).toEqual(owed(noBlocks(b)));
    const three = hero(10, [rmBoost('level', 2, 10)], { attributeBoosts: { ...sets, 10: ['str', 'con', null, 'wis'] } });
    expect(owed(noBlocks(three))).toContain('Level 10 — attribute boost');
    expect(owed(three)).toEqual(owed(noBlocks(three)).filter((l) => l !== 'Level 10 — attribute boost'));
  });
});

describe('the Setup boost sets', () => {
  it('a removed ancestry boost holding Dex: Dex −2, the stored pick kept; the empty twin is not owed', () => {
    const b = hero(1, [rmBoost('ancestry', 0)], { ancestryBoosts: ['dex', 'con'] });
    const kept = built(noBlocks(b));
    const c = built(b);
    expect(c.abilities.dex).toBe(kept.abilities.dex - 2);
    expect(c.abilities.con).toBe(kept.abilities.con);
    expect(c.tweakKept?.boosts).toEqual([{ set: 'ancestry', index: 0, attribute: 'dex' }]);
    expect(setupMissing(b, cdb(b))).toEqual(setupMissing(noBlocks(b), cdb(b)));
    const empty = hero(1, [rmBoost('ancestry', 0)], { ancestryBoosts: [null, 'con'] });
    expect(setupMissing(noBlocks(empty), cdb(empty))).toContain('Ancestry boost');
    expect(setupMissing(empty, cdb(empty))).not.toContain('Ancestry boost');
  });

  it('a removed level-1 free boost holding Dex: Dex −2; the empty twin is not owed', () => {
    const b = hero(1, [rmBoost('free', 1)]);
    const kept = built(noBlocks(b));
    const c = built(b);
    expect(c.abilities.dex).toBe(kept.abilities.dex - 2);
    for (const a of ['str', 'con', 'wis'] as const) expect(c.abilities[a], a).toBe(kept.abilities[a]);
    expect(c.tweakKept?.boosts).toEqual([{ set: 'free', index: 1, attribute: 'dex' }]);
    const empty = hero(1, [rmBoost('free', 1)], { levelBoosts: ['str', null, 'con', 'wis'] });
    expect(setupMissing(noBlocks(empty), cdb(empty))).toContain('Free attribute boost');
    expect(setupMissing(empty, cdb(empty))).not.toContain('Free attribute boost');
  });

  it('a removed background boost holding Con: Con −2', () => {
    const b = hero(1, [rmBoost('background', 1)]);
    expect(built(b).abilities.con).toBe(built(noBlocks(b)).abilities.con - 2);
  });
});

describe('the places a removal may name (C47: a fixed boost, the key boost and the kineticist element are no places)', () => {
  const boostSets = (b: BuildState) =>
    drawnSkillBoostPlaces(b, cdb(b))
      .filter((p) => p.place === 'boost')
      .map((p) => `${p.set}${p.set === 'level' ? p.level : ''}:${p.index}`);

  it('a dwarf: its one free ancestry slot (its two fixed boosts are not places), the background\'s two, four free, each level set', () => {
    const b = hero(5, [], { ancestryId: 'dwarf', heritageId: null, ancestryBoosts: ['dex'] });
    expect(boostSets(b)).toEqual(['ancestry:0', 'background:0', 'background:1', 'free:0', 'free:1', 'free:2', 'free:3', 'level5:0', 'level5:1', 'level5:2', 'level5:3']);
  });

  it('a kineticist: the same sets only — its key attribute and its element are no boost places', () => {
    const b = hero(1, [], {}, 'kineticist');
    expect(boostSets(b)).toEqual(['ancestry:0', 'ancestry:1', 'background:0', 'background:1', 'free:0', 'free:1', 'free:2', 'free:3']);
  });

  it('the skill increase places: one per lane a level draws', () => {
    const b = hero(3, [], {}, 'swashbuckler');
    const sk = drawnSkillBoostPlaces(b, cdb(b)).filter((p) => p.place === 'skillIncrease');
    expect(sk.map((p) => `${p.level}:${p.lane}`)).toEqual(['3:main', '3:bonus']);
  });
});

describe('a build-less reopen (C46)', () => {
  const sets = { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] } as BuildState['attributeBoosts'];
  const b = hero(10, [rmSkill(5), rmBoost('level', 2, 10)], { skillIncreases: { 5: 'stealth' }, attributeBoosts: sets });

  it('the kept Stealth and Dex come back in their stores from c.tweakKept, and Dex is not counted twice', () => {
    const c = built(b);
    expect(c.tweakKept).toEqual({ skillIncreases: [{ level: 5, lane: 'main', skill: 'stealth' }], boosts: [{ set: 'level', level: 10, index: 2, attribute: 'dex' }] });
    let cur = c;
    for (let i = 0; i < 3; i++) {
      const rb = deriveBuildFromCharacter(cur, cdb(b));
      expect(rb.skillIncreases[5], `reopen ${i + 1}: the kept increase`).toBe('stealth');
      expect(rb.attributeBoosts[10]?.[2], `reopen ${i + 1}: the kept boost`).toBe('dex');
      expect(rb.overrides?.blocks).toEqual(b.overrides?.blocks);
      cur = built(rb);
      expect(cur.abilities, `reopen ${i + 1}: the scores`).toEqual(c.abilities);
      expect(cur.proficiencies.skills.stealth, `reopen ${i + 1}`).toBe('untrained');
      expect(cur.tweakKept).toEqual(c.tweakKept);
    }
    // Restored after the reopen: the answer is there and counts.
    const rb = deriveBuildFromCharacter(c, cdb(b));
    const back = built({ ...rb, overrides: ov() });
    expect(back.proficiencies.skills.stealth).toBe('trained');
    expect(back.abilities.dex).toBe(built(noBlocks(b)).abilities.dex);
  });

  // Fix round 1 (the checker's probe): the solver never saw the kept pick, so it could give a LIVE place of the same set
  // that attribute — a set with two Str, and after Restore `collectBoosts` keeps one (Str 14, the twin 16).
  it('no set holds an attribute twice, the scores are the sheet\'s, and Restore after the reopen equals the twin', () => {
    const layouts = [
      { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'], 15: ['str', 'dex', 'con', 'int'], 20: ['str', 'dex', 'con', 'wis'] },
      { 5: ['dex', 'cha', 'con', 'wis'], 10: ['dex', 'cha', 'int', 'str'], 15: ['dex', 'cha', 'con', 'wis'], 20: ['str', 'dex', 'con', 'wis'] },
      { 5: ['int', 'wis', 'cha', 'con'], 10: ['int', 'wis', 'cha', 'dex'], 15: ['int', 'wis', 'cha', 'str'], 20: ['int', 'wis', 'cha', 'con'] },
    ] as BuildState['attributeBoosts'][];
    const fails: string[] = [];
    let cases = 0;
    let emptied = 0;
    for (const lay of layouts)
      for (const at of [5, 10, 15, 20])
        for (let idx = 0; idx < 4; idx++)
          for (const extra of [[], [['free', 1]], [['ancestry', 0]]] as [string, number][][]) {
            const h = hero(20, [rmBoost('level', idx, at), ...extra.map(([s, i]) => rmBoost(s, i))], { attributeBoosts: lay });
            const c = built(h);
            const rb = deriveBuildFromCharacter(c, cdb(h));
            const tag = `L${at}[${idx}]${extra.map(([s, i]) => ` +${s}[${i}]`).join('')} ${JSON.stringify(lay[5])}`;
            cases++;
            const lists: [string, (string | null)[]][] = [['ancestry', rb.ancestryBoosts], ['background', rb.backgroundBoosts], ['free', rb.levelBoosts], ...Object.entries(rb.attributeBoosts).map(([l, s]) => [`L${l}`, s] as [string, (string | null)[]])];
            for (const [name, s] of lists) {
              const picks = (s ?? []).filter(Boolean);
              if (new Set(picks).size !== picks.length) fails.push(`${tag}: ${name} holds ${JSON.stringify(s)}`);
            }
            if (JSON.stringify(built(rb).abilities) !== JSON.stringify(c.abilities)) fails.push(`${tag}: reopened scores differ`);
            if (JSON.stringify(built({ ...rb, overrides: ov() }).abilities) !== JSON.stringify(built(noBlocks(h)).abilities)) fails.push(`${tag}: Restore after the reopen differs from the twin`);
            if ((rb.attributeBoosts[at]?.[idx] ?? null) === null) emptied++;
          }
    expect(cases).toBe(144);
    expect(fails, fails.slice(0, 5).join('\n')).toEqual([]);
    // Every one of these layouts has a legal move, so no kept answer had to be left out.
    expect(emptied, 'kept boosts left empty').toBe(0);
  });

  // Fix round 2 (the checker's p13): a swap or a 3-set rotation finds no move here; the player's own layout is a
  // 4-move cycle (Dex free → background[1], Cha background[1] → ancestry, Wis ancestry → background[0], Int → free).
  it('a vishkanya acolyte with the free Dex removed: the kept Dex comes back to free[0] through a 4-move cycle, nothing emptied', () => {
    const h = hero(1, [rmBoost('free', 0)], {
      ancestryId: 'vishkanya',
      heritageId: null,
      keyAbility: 'dex',
      ancestryBoosts: ['cha'],
      backgroundBoosts: ['wis', 'dex'],
      levelBoosts: ['dex', 'wis', 'int', 'cha'],
    });
    const c = built(h);
    expect(c.tweakKept?.boosts).toEqual([{ set: 'free', index: 0, attribute: 'dex' }]);
    const rb = deriveBuildFromCharacter(c, cdb(h));
    expect(rb.levelBoosts[0], 'the kept Dex, back in its place').toBe('dex');
    for (const s of [rb.ancestryBoosts, rb.backgroundBoosts, rb.levelBoosts]) {
      const picks = s.filter(Boolean);
      expect(new Set(picks).size, JSON.stringify(s)).toBe(picks.length);
    }
    expect(built(rb).abilities).toEqual(c.abilities);
    expect(built({ ...rb, overrides: ov() }).abilities).toEqual(built(noBlocks(h)).abilities);
  });

  it('without c.tweakKept the removed places come back empty (the list is what carries them)', () => {
    const { tweakKept: _k, ...bare } = built(b);
    const rb = deriveBuildFromCharacter(bare as Character, cdb(b));
    expect(rb.skillIncreases[5]).toBeFalsy();
    expect(rb.attributeBoosts[10]?.[2] ?? null).toBeNull();
    expect(built(rb).abilities).toEqual(built(b).abilities);
  });

  it('a kept answer goes only to a place a live removal names, and never over a store entry', () => {
    const c = built(b);
    // Level 3 is not a removed place: nothing is written there.
    const forged = { ...c, tweakKept: { skillIncreases: [{ level: 3, lane: 'main', skill: 'stealth' }] } } as Character;
    expect(deriveBuildFromCharacter(forged, cdb(b)).skillIncreases[3]).toBeFalsy();
    // A row already routed to the removed place keeps it.
    const held = { ...c, skillIncreases: [...(c.skillIncreases ?? []), { level: 5, skill: 'athletics', lane: 'main' }] } as Character;
    expect(deriveBuildFromCharacter(held, cdb(b)).skillIncreases[5]).toBe('athletics');
    // Paused on the reopened copy: the kept answer is not read (no live removal names the place).
    const paused = { ...c, overrides: pause(b).overrides } as Character;
    expect(deriveBuildFromCharacter(paused, cdb(b)).skillIncreases[5]).not.toBe('stealth');
  });
});
