// @vitest-environment jsdom
// jsdom for the builder leg — the whole point of this lane is that the extra increase is a control
// the player can SEE and answer, so a pure-engine file would pin half the ruling. The engine
// assertions are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import {
  backgroundChosenLoreKeys,
  backgroundSkillIncreaseAllowed,
  buildCharacter,
  deriveBuildFromCharacter,
  emptyBuild,
  levelChoices,
  levelGrants,
  type BuildState,
} from '../src/rules/build';
import type { Character, ContentDatabase, ProficiencyKey } from '../src/rules/types';

const db = content();

/**
 * Batch 037 residual — Reborn Soul's restricted skill increases (desk ruling #85).
 *
 * AoN background-590: *"You become trained in two Lore skills, which you and your GM choose from Lore
 * skills associated with your past life. At 3rd level, 7th level, and 15th level, you receive skill
 * increases, which you can apply only to these Lore skills."*
 *
 * Owner ruling 2026-09-10 #85: ONE EXTRA increase at each of those three levels, spendable on ONE of
 * the two past-life Lores (the player picks which each time) — not Wanderer's Guide's both-Lores-each-
 * time reading, and not "the normal increases are locked".
 *
 * ⚠ The database is PATCHED here rather than read: the overlay row lives in
 * work/.b037-rows-reborn-soul.json and has not been applied yet (the closer runs the driver), so the
 * shipped record carries no `restrictedSkillIncreaseLevels`. Every leg therefore asserts on an
 * in-memory patched or STRIPPED copy — never a patched-vs-shipped delta, which would be asserting the
 * patch rather than the mechanic.
 */
const patched = <T extends object>(rec: T, patch: Record<string, unknown>): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
};

const withBackground = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, backgrounds: { ...db.backgrounds, [id]: patched(db.backgrounds[id], patch) } }) as ContentDatabase;

/** The exact value of the overlay row in work/.b037-rows-reborn-soul.json. */
const ROW = {
  levels: [3, 7, 15],
  includeBackgroundLores: true,
  reason:
    'Reborn Soul: this extra skill increase can be applied only to one of your two past-life Lore skills — you choose which one each time.',
};

/** The ruled database: the row applied, and the stale "apply these three by hand" warning gone. */
const ruled = withBackground('reborn-soul', { restrictedSkillIncreaseLevels: ROW, dataWarning: undefined });

const WARFARE = 'lore:warfare' as ProficiencyKey;
const SAILING = 'lore:sailing' as ProficiencyKey;

/** A fighter Reborn Soul whose two past-life Lores are Warfare and Sailing. Fighter because its
 *  ordinary increase ladder (3, 5, 7, …) covers all three ruled levels, so "the normal increases are
 *  untouched" is testable at exactly the levels the extra one arrives. */
const mkBuild = (over: Partial<BuildState>): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level: 1,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'skilled-human',
    backgroundId: 'reborn-soul',
    backgroundLore: 'Warfare',
    backgroundLore2: 'Sailing',
    ...over,
  }) as BuildState;

const hero = (over: Partial<BuildState>, content_ = ruled): Character => buildCharacter(mkBuild(over), content_);
const rank = (ch: Character, key: string): string | undefined => ch.proficiencies.skills[key as ProficiencyKey];

const grantsAt = (level: number, content_ = ruled, over: Partial<BuildState> = {}) => {
  const b = mkBuild({ level, ...over });
  return levelGrants(level, b.classId, content_, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, [], b);
};

describe('batch 037 residual — Reborn Soul restricted skill increases', () => {
  // batch 037: reborn-soul#restricted-increases
  it('grants the extra increase only at 3rd, 7th and 15th level', () => {
    expect(grantsAt(2).backgroundSkillIncrease, 'the clause names no 2nd level').toBe(false);
    expect([3, 7, 15].map((l) => grantsAt(l).backgroundSkillIncrease), '"At 3rd level, 7th level, and 15th level…"').toEqual([
      true,
      true,
      true,
    ]);
    expect([5, 9, 13].map((l) => grantsAt(l).backgroundSkillIncrease), 'and at no other increase level').toEqual([
      false,
      false,
      false,
    ]);
    // …and it is the BACKGROUND that grants it: a fighter with any other background gets none.
    expect(grantsAt(3, ruled, { backgroundId: 'acrobat' }).backgroundSkillIncrease).toBe(false);
  });

  // batch 037: reborn-soul#restricted-increases
  it('accepts only the two past-life Lores the player typed, either one, each time', () => {
    expect(backgroundChosenLoreKeys(mkBuild({}), ruled), 'the two answered boxes, in order').toEqual([WARFARE, SAILING]);
    expect([...(backgroundSkillIncreaseAllowed(mkBuild({}), ruled)?.skills ?? [])]).toEqual([WARFARE, SAILING]);

    const spend = (pick: string) => hero({ level: 3, backgroundSkillIncreases: { 3: pick as ProficiencyKey } });
    expect(rank(spend(WARFARE), WARFARE), '"…only to these Lore skills"').toBe('expert');
    expect(rank(spend(SAILING), SAILING), 'either of the two — the player chooses which each time').toBe('expert');

    // A THIRD Lore is not a past-life Lore, and neither is an ordinary skill: both are DROPPED rather
    // than applied, so a character saved while the picker was unguarded keeps no rank print forbids.
    const other = spend('lore:cooking');
    expect(rank(other, 'lore:cooking')).toBe(undefined);
    expect(other.skillIncreases, 'the level then reads as an unspent increase, which is the true state').toEqual([]);
    expect(rank(spend('athletics'), 'athletics'), 'an ordinary skill is not one of "these Lore skills" either').toBe('untrained');
  });

  // batch 037: reborn-soul#restricted-increases
  it('raises the rank on the sheet at all three levels, and the ordinary increases are untouched', () => {
    const ch = hero({
      level: 15,
      // Two of the three on Warfare, one on Sailing — the ruling's "you choose which one each time".
      backgroundSkillIncreases: { 3: WARFARE, 7: WARFARE, 15: SAILING },
      // …and the ORDINARY increases at the very same levels, spent freely on non-Lore skills.
      skillIncreases: { 3: 'athletics' as ProficiencyKey, 5: 'intimidation' as ProficiencyKey, 7: 'athletics' as ProficiencyKey, 15: 'athletics' as ProficiencyKey },
      classSkills: ['athletics', 'intimidation'],
    });
    expect(rank(ch, WARFARE), 'trained → expert (3rd) → master (7th)').toBe('master');
    expect(rank(ch, SAILING), 'trained → expert (15th)').toBe('expert');
    // The ordinary increases at 3, 7 and 15 are NOT narrowed and NOT consumed by the extra one:
    // Athletics takes all three (trained → expert → master → legendary) at the very levels the
    // background is also handing over an increase.
    expect(rank(ch, 'athletics'), "the level's ordinary increase stays free").toBe('legendary');
    expect(rank(ch, 'intimidation'), 'and the 5th-level one, which the background does not touch').toBe('expert');
    expect(ch.skillIncreases.filter((s) => s.level === 3), 'two increases at 3rd level, not one').toHaveLength(2);

    // Both answers survive a Character → BuildState round-trip: three entries at one level would
    // otherwise collapse into the two stores the builder had before this lane.
    const back = deriveBuildFromCharacter(ch, ruled);
    expect(back.backgroundSkillIncreases?.[3], 'the fighter grants no bonus increase, so the second entry is the background one').toBe(WARFARE);
    expect(back.skillIncreases[3]).toBe('athletics');
  });

  // batch 037: reborn-soul#restricted-increases
  // mutation-proof — this lane is new, so each half is stunted in turn and the mechanic must vanish.
  it('is carried by the record field and by the chosen-Lore resolver, and by nothing else', () => {
    const stored = { level: 3, backgroundSkillIncreases: { 3: WARFARE } } as Partial<BuildState>;
    expect(rank(hero(stored), WARFARE), 'the ruled control').toBe('expert');

    // 1 — strip the record field: no grant, no pick, the stored answer is ignored.
    const noRow = withBackground('reborn-soul', { restrictedSkillIncreaseLevels: undefined });
    expect(grantsAt(3, noRow).backgroundSkillIncrease).toBe(false);
    expect(rank(hero(stored, noRow), WARFARE), 'without the row the background is a Lore grant and nothing more').toBe('trained');

    // 2 — keep the levels, strip `includeBackgroundLores`: the increase is granted and NOTHING is
    // spendable, because "these Lore skills" are typed and can only ever be resolved, never listed.
    const noResolver = withBackground('reborn-soul', {
      restrictedSkillIncreaseLevels: { levels: ROW.levels, reason: ROW.reason },
    });
    expect(grantsAt(3, noResolver).backgroundSkillIncrease, 'the grant still arrives').toBe(true);
    expect([...(backgroundSkillIncreaseAllowed(mkBuild({}), noResolver)?.skills ?? [])]).toEqual([]);
    expect(rank(hero(stored, noResolver), WARFARE), 'so even a past-life Lore is refused').toBe('trained');

    // 3 — the resolver reads the player's OWN answers: clear the second box and only Warfare remains.
    const oneTyped = mkBuild({ backgroundLore2: '' });
    expect(backgroundChosenLoreKeys(oneTyped, ruled)).toEqual([WARFARE]);
    expect(rank(buildCharacter(mkBuild({ ...stored, backgroundLore2: '' }), ruled), WARFARE)).toBe('expert');
    expect(
      rank(buildCharacter(mkBuild({ level: 3, backgroundSkillIncreases: { 3: SAILING }, backgroundLore2: '' }), ruled), SAILING),
      'a Lore the player never named is not a past-life Lore',
    ).toBe(undefined);
  });

  // batch 037: reborn-soul#restricted-increases
  it('counts the extra increase as an outstanding choice beside the ordinary one', () => {
    const labels = levelChoices(mkBuild({ level: 3 }), ruled).map((c) => c.label);
    expect(labels.filter((l) => l === 'Level 3 — skill increase'), 'the ordinary increase and the extra one').toHaveLength(2);
    // Answer only the extra one and a single "skill increase" is left outstanding.
    const half = levelChoices(mkBuild({ level: 3, backgroundSkillIncreases: { 3: WARFARE } }), ruled).map((c) => c.label);
    expect(half.filter((l) => l === 'Level 3 — skill increase')).toHaveLength(1);
  });

  // batch 037: reborn-soul#restricted-increases
  it('shows the player a visible pick at 3rd level, narrowed to the two past-life Lores', () => {
    const ctl = (level: number, lvlTab: string, content_ = ruled) => {
      const initial = mkBuild({ level });
      const r = renderDom(
        createElement(Builder, { content: content_, initial, onCancel: () => undefined, onCreate: () => undefined }),
      );
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === lvlTab) ?? null);
      const node = [...r.host.querySelectorAll<HTMLElement>('[data-ctl="popup"]')].find(
        (el) => el.dataset.ctlTitle === 'Background skill increase',
      );
      const out = node
        ? { live: node.dataset.ctlLive, options: node.dataset.ctlOptions, reason: r.host.textContent?.includes(ROW.reason) }
        : null;
      r.stop();
      return out;
    };

    const at3 = ctl(3, '3');
    expect(at3, 'the ruling is a CHOICE, so the player must be able to make it').not.toBeNull();
    expect(at3?.live, 'only the two past-life Lores are selectable, out of every skill in the game').toBe('2');
    expect(Number(at3?.options), 'the control still lists the whole skill set, greyed').toBeGreaterThan(2);
    expect(at3?.reason, 'and says why, rather than leaving it to be found by tapping a greyed option').toBe(true);

    expect(ctl(2, '2'), 'no control at a level the clause does not name').toBeNull();
    const noRow = withBackground('reborn-soul', { restrictedSkillIncreaseLevels: undefined });
    expect(ctl(3, '3', noRow), 'and none without the record field').toBeNull();
  });

  // batch 037: reborn-soul#restricted-increases
  it('shows the rank BEFORE this level, so an answered extra increase can still be re-picked', () => {
    /* The "X → Y" on every option is read off `baseSkills`, which strips the increases at and above
     * the level being edited. It stripped the ORDINARY store only, so an answered extra increase at
     * THIS level counted as the starting rank: a level-3 Reborn Soul who has already spent the pick
     * on Warfare saw "expert → master", and master is above the level-3 cap — so the option they had
     * chosen was greyed with "This level's increases cap at expert." and could not be re-picked. The
     * same held for the swashbuckler's bonus lane, which is where the defect was already shipping. */
    const stored = mkBuild({ level: 3, backgroundSkillIncreases: { 3: WARFARE } });
    const r = renderDom(
      createElement(Builder, { content: ruled, initial: stored, onCancel: () => undefined, onCreate: () => undefined }),
    );
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '3') ?? null);
    const node = [...r.host.querySelectorAll<HTMLElement>('[data-ctl="popup"]')].find(
      (el) => el.dataset.ctlTitle === 'Background skill increase',
    );
    const live = node?.dataset.ctlLive;
    r.stop();
    expect(live, 'both past-life Lores stay selectable once one of them is the stored answer').toBe('2');
  });
});
