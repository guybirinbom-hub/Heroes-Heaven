import { describe, it, expect } from 'vitest';
import { content, build, prof } from './_content';
import { deityFavorsSimpleOrUnarmed } from '../src/rules/build';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { maxTakes } from '../src/rules/featGrants';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';

/*
 * Section 3C — feat-granted proficiencies (archetype dedications), fighter weapon-group mastery,
 * and Warpriest Deadly Simplicity conditioning. Rules verified against .import-src Foundry text.
 */
describe('archetype dedications grant proficiencies (featGrants table)', () => {
  // A wizard is untrained in light armor and martial weapons by default, so the grant is visible.
  it('Sentinel Dedication grants trained light + medium armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'sentinel-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
    // A character without the dedication stays untrained.
    const plain = build('wizard', 4);
    expect(plain.proficiencies.defenses.light).toBe('untrained');
    expect(plain.proficiencies.defenses.medium).toBe('untrained');
  });

  it('Fighter Dedication grants trained martial-weapon proficiency', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'fighter-dedication' } });
    expect(ch.proficiencies.attacks.martial).toBe('trained');
    expect(build('wizard', 4).proficiencies.attacks.martial).toBe('untrained');
  });

  it('Rogue Dedication grants trained light armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
  });

  it('Medic Dedication grants expert Medicine', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'medic-dedication' } });
    expect(ch.proficiencies.skills.medicine).toBe('expert');
  });

  it('a grant never LOWERS an already-higher class proficiency', () => {
    // Fighter is already expert in martial weapons; taking Sentinel Dedication (armor only) leaves
    // martial untouched, and the grant of a track the class already exceeds does not regress it.
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    // Fighter is trained in light armor at L1 (not lowered by rogue-dedication's trained grant).
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.attacks.martial).toBe('expert');
  });
});

/*
 * Canny Acumen grants a proficiency chosen in the feat's own dropdown, so it needs both the
 * choiceGrants lookup and the level-17 rankUpgrade. It regressed to a no-op for a long time: the
 * pick was recorded but nothing ever read it, so taking the feat changed nothing on the sheet.
 * A wizard is only trained in Fortitude, which makes the grant visible.
 */
describe('Canny Acumen grants the CHOSEN proficiency (choiceGrants + rankUpgrade)', () => {
  const canny = (level: number, choice?: string) =>
    build('wizard', level, {
      featPicks: { '1:general:0': 'canny-acumen' },
      ...(choice ? { featChoices: { '1:general:0': choice } } : {}),
    });

  it('choosing Fortitude makes a L3 wizard an EXPERT in Fortitude', () => {
    expect(build('wizard', 3).proficiencies.saves.fortitude).toBe('trained');
    expect(canny(3, 'system.saves.fortitude.rank').proficiencies.saves.fortitude).toBe('expert');
  });

  it('choosing Perception raises Perception', () => {
    expect(canny(3, 'system.perception.rank').proficiencies.perception).toBe('expert');
  });

  it('only the CHOSEN track is raised — the other saves are untouched', () => {
    const ch = canny(3, 'system.saves.fortitude.rank');
    expect(ch.proficiencies.saves.reflex).toBe(build('wizard', 3).proficiencies.saves.reflex);
    expect(ch.proficiencies.saves.will).toBe(build('wizard', 3).proficiencies.saves.will);
  });

  it('at 17th level the choice becomes MASTER', () => {
    expect(canny(17, 'system.saves.fortitude.rank').proficiencies.saves.fortitude).toBe('master');
    // …and below 17 it stays expert.
    expect(canny(16, 'system.saves.fortitude.rank').proficiencies.saves.fortitude).toBe('expert');
  });

  it('never LOWERS a rank the class already grants, and an unmade choice is inert', () => {
    // Wizard Will is already expert at L3; picking Will must not downgrade or crash.
    expect(canny(3, 'system.saves.will.rank').proficiencies.saves.will).toBe('expert');
    expect(canny(3).proficiencies.saves.fortitude).toBe('trained');
  });
});

/*
 * Repeatable feats. Foundry's system.maxTakable is imported into core.json; the app must (a) know a
 * feat is repeatable, (b) let the picker offer it until the cap is reached, and (c) keep every take
 * in the built character. Before this, a 2nd take was silently dropped by a dedupe-by-id.
 */
describe('repeatable feats (maxTakable)', () => {
  const c = content();

  it('imports maxTakable from Foundry: Armor Prof 3, Skill Mastery 5, Weapon Prof + Multilingual unlimited', () => {
    expect(c.feats['armor-proficiency']?.maxTakable).toBe(3);
    expect(c.feats['skill-mastery']?.maxTakable).toBe(5);
    expect(c.feats['weapon-proficiency']?.maxTakable).toBe(null); // null = unlimited
    expect(c.feats['multilingual']?.maxTakable).toBe(null);
  });

  it('a once-only feat carries no maxTakable and reads as 1 take', () => {
    expect(c.feats['canny-acumen']?.maxTakable).toBeUndefined();
    expect(c.feats['toughness']?.maxTakable).toBeUndefined();
    expect(maxTakes(c.feats['canny-acumen'])).toBe(1);
    expect(maxTakes(c.feats['armor-proficiency'])).toBe(3);
    expect(maxTakes(c.feats['weapon-proficiency'])).toBe(Infinity);
    expect(maxTakes(undefined)).toBe(1);
  });

  it('the 4 feats Foundry wrongly omits are recovered from prose as repeatable', () => {
    // Foundry has no maxTakable for these; AoN prose plainly says repeatable. See featMaxTakes().
    for (const id of ['animists-power', 'order-magic', 'secret-speech', 'listeners-boon']) {
      expect(maxTakes(c.feats[id])).toBe(Infinity);
    }
  });

  it('the picker offers a repeatable feat until its cap, and a normal feat only once', () => {
    // General slots at L3/7/11/15/19. eligibleFeatsForSlot for a later slot must still offer
    // armor-proficiency while it sits in only the L3 slot, but hide a once-only feat already taken.
    const b0: BuildState = { ...emptyBuild(), ancestryId: 'human', classId: 'fighter', level: 20 };
    const has = (b: BuildState, key: string, id: string) =>
      eligibleFeatsForSlot(b, c, { level: Number(key.split(':')[0]), category: 'general', idx: 0 }).some((f) => f.id === id);

    // Repeatable: taken once (L3), still offered at L7.
    expect(has({ ...b0, featPicks: { '3:general:0': 'armor-proficiency' } }, '7:general:0', 'armor-proficiency')).toBe(true);
    // Taken 3× (the cap): NOT offered in a 4th slot.
    expect(
      has(
        { ...b0, featPicks: { '3:general:0': 'armor-proficiency', '7:general:0': 'armor-proficiency', '11:general:0': 'armor-proficiency' } },
        '15:general:0',
        'armor-proficiency',
      ),
    ).toBe(false);
    // Once-only (Toughness): taken at L3, hidden at L7.
    expect(has({ ...b0, featPicks: { '3:general:0': 'toughness' } }, '7:general:0', 'toughness')).toBe(false);
  });

  it('a repeatable feat placed in 3 slots yields 3 entries in the built character', () => {
    const ch = build('wizard', 13, {
      featPicks: { '3:general:0': 'armor-proficiency', '7:general:0': 'armor-proficiency', '11:general:0': 'armor-proficiency' },
    });
    expect(ch.feats.filter((f) => f.featId === 'armor-proficiency')).toHaveLength(3);
  });
});

/*
 * Armor Proficiency (Player Core p.252): trained in light; if already trained in light, medium; then
 * heavy — repeatable up to 3×, and each granted type is expert at 13th level. Modeled as a derived
 * cascade (FEAT_GRANTS.armorCascade) rather than a player choice, because Foundry's predicates make
 * exactly one option legal at a time. Verified against AoN feat-5120 + Foundry armor-proficiency.json.
 */
describe('Armor Proficiency cascade', () => {
  // General feats arrive at L3/7/11, so N takes need character level >= [3,7,11][N-1]. Build at 12
  // (all three slots live, but below the level-13 expert clause) so each take shows as trained.
  const wiz = (level: number, takes: number) => {
    const featPicks: Record<string, string> = {};
    (['3', '7', '11'] as const).slice(0, takes).forEach((lv) => (featPicks[`${lv}:general:0`] = 'armor-proficiency'));
    return build('wizard', level, { featPicks: featPicks as never });
  };

  it('a wizard (untrained in armor) trains light → medium → heavy across three takes', () => {
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 0), k))).toEqual(['untrained', 'untrained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 1), k))).toEqual(['trained', 'untrained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 2), k))).toEqual(['trained', 'trained', 'untrained']);
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(12, 3), k))).toEqual(['trained', 'trained', 'trained']);
  });

  it('at 13th level each granted armor type is EXPERT, not trained (Remaster clause)', () => {
    expect(['light', 'medium', 'heavy'].map((k) => prof(wiz(13, 3), k))).toEqual(['expert', 'expert', 'expert']);
    // …and one level below, still trained.
    expect(prof(wiz(12, 1), 'light')).toBe('trained');
  });

  it('is a harmless no-op for a fighter already trained/expert in every armor', () => {
    const base = build('fighter', 13);
    const withFeat = build('fighter', 13, { featPicks: { '3:general:0': 'armor-proficiency' } as never });
    for (const k of ['light', 'medium', 'heavy']) expect(prof(withFeat, k)).toBe(prof(base, k));
  });

  it('has no dropdown — the cascade is derived, so core.json carries no fake choice', () => {
    expect(content().feats['armor-proficiency']?.choice).toBeUndefined();
  });
});

describe('Weapon Proficiency grants martial, expert at 11th', () => {
  it('untrained wizard becomes trained in martial, then expert at level 11', () => {
    expect(prof(build('wizard', 7), 'martial')).toBe('untrained');
    expect(prof(build('wizard', 7, { featPicks: { '3:general:0': 'weapon-proficiency' } as never }), 'martial')).toBe('trained');
    expect(prof(build('wizard', 11, { featPicks: { '3:general:0': 'weapon-proficiency' } as never }), 'martial')).toBe('expert');
  });
});

describe('Warpriest Deadly Simplicity is conditioned on the favored weapon', () => {
  it('deityFavorsSimpleOrUnarmed: simple item, unarmed fist → true; martial → false', () => {
    const c = content();
    expect(deityFavorsSimpleOrUnarmed('abadar', c)).toBe(true); // crossbow (simple)
    expect(deityFavorsSimpleOrUnarmed('irori', c)).toBe(true); // fist (unarmed)
    expect(deityFavorsSimpleOrUnarmed('iomedae', c)).toBe(false); // longsword (martial)
  });

  it('Iomedae (longsword) warpriest does NOT gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'iomedae', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(false);
  });

  it('Abadar (crossbow, simple) warpriest DOES gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'abadar', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
  });
});
