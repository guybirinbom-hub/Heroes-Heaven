import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { sanctificationOf } from '../src/rules/derive';

/**
 * Sanctified Relic (Mythic, 18): "choose two attributes (one of which must be your key attribute) as
 * your divine attributes and either holy or unholy sanctification."
 *
 * Two permanent, constrained picks that were never asked for. The BENEFIT is deliberately not
 * modelled: the relic raises the attributes of whoever wears it, and the feat says outright "You
 * can't wear this apex item, but your hierophant can" — so nothing here belongs on the owner's own
 * sheet, and pretending otherwise would hand them an apex bonus they do not have.
 */
const db = content();
const feat = db.feats['sanctified-relic'];

describe('Sanctified Relic — the picks are asked for', () => {
  /* `relic-sanctification`, not `sanctification`. The deity asks its own question under that bare id
   * and `sanctificationOf` matched the first pick carrying it, with no check on who asked — and feats
   * resolve before the deity, so this relic answered for the character. Measured: champion of Ma'at,
   * deity holy, relic unholy, character read as UNHOLY. They are different questions: this one is the
   * trait the relic confers on whoever wears it, and the feat says that cannot be you. */
  it('asks for one divine attribute and the trait the RELIC confers, under its own id', () => {
    const ids = (feat.effectChoices ?? []).map((c) => c.id);
    expect(ids).toEqual(['divine-attribute', 'relic-sanctification']);
  });

  it('offers all six attributes, and exactly two sanctifications', () => {
    const [attr, sanct] = feat.effectChoices!;
    expect(attr.options?.map((o) => o.value)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(sanct.options?.map((o) => o.value)).toEqual(['holy', 'unholy']);
  });

  it('asks for ONE attribute, not two', () => {
    // "one of which must be your key attribute" fixes the other, so a second picker would invite an
    // answer the rules forbid. The prompt has to say which one it is asking for.
    expect(feat.effectChoices![0].prompt).toMatch(/key attribute/i);
    expect(feat.choice, 'a second attribute picker would allow an illegal pair').toBeUndefined();
  });

  it('tells the player the must-match constraint it cannot enforce', () => {
    // "if you have the holy or unholy trait through a class feature or other ability, you must choose
    // that same trait" — the app has no sanctification track to check against, so it is stated.
    for (const o of feat.effectChoices![1].options ?? []) expect(o.note).toMatch(/must choose this one/i);
  });
});

describe('Sanctified Relic — the benefit stays off the owner’s sheet', () => {
  it('grants nothing mechanical, because the wearer is someone else', () => {
    for (const ch of feat.effectChoices ?? []) for (const o of ch.options ?? []) expect(o.grant).toBeUndefined();
  });

  it('the note says where the bonus actually lands', () => {
    expect(feat.note).toMatch(/cannot wear it yourself|can.t wear/i);
    expect(feat.note).toMatch(/hierophant/i);
    expect(feat.note).toMatch(/Mythic Point/i);
  });

  it('answering both picks moves no number on the character', () => {
    const plain = build('cleric', 18, { featPicks: { '18:class:0': 'sanctified-relic' } } as never);
    const answered = build('cleric', 18, {
      featPicks: { '18:class:0': 'sanctified-relic' },
      effectChoices: { 'sanctified-relic:divine-attribute': 'cha', 'sanctified-relic:relic-sanctification': 'holy' },
    } as never);
    // The relic is worn by the hierophant — the owner's own attributes must not move.
    expect(answered.abilities).toEqual(plain.abilities);
    // …and the pick is still RECORDED, which is the whole point of asking.
    expect(answered.effectPicks?.some((p) => p.recordId === 'sanctified-relic')).toBe(true);
  });
});

/**
 * THE RELIC DOES NOT ANSWER FOR YOU.
 *
 * `sanctificationOf` matched the first effect pick whose `choiceId` was `sanctification`, with no
 * check on which record asked. The deity uses that bare id — and so did this feat, for a different
 * question: the trait the relic confers on whoever WEARS it, which the feat's own text says cannot be
 * you ("You cannot wear it yourself; your hierophant can"). buildCharacter resolves feats before the
 * deity, so the relic's answer was found first and won.
 *
 * The printed rule is that the two can't disagree — "if you have the holy or unholy trait through a
 * class feature or other ability, you must choose that same trait" — which is a constraint on the
 * player's choice, not licence for one to speak for the other. Nothing enforced it, so the app let the
 * disagreement be created and then resolved it backwards.
 */
describe('a relic’s sanctification is not the character’s', () => {
  const champion = (deityId: string, deityPick: string, relicPick: string) =>
    build('champion', 13, {
      deityId,
      featPicks: { '2:class:0': 'sanctified-relic' },
      effectChoices: {
        [`${deityId}:sanctification`]: deityPick,
        'sanctified-relic:divine-attribute': 'cha',
        'sanctified-relic:relic-sanctification': relicPick,
      },
    });

  it('a champion of Ma’at whose relic is set to unholy is still holy', () => {
    // Ma'at offers holy | none, so unholy is not even a legal answer for the character.
    expect(sanctificationOf(champion('maat', 'holy', 'unholy'))).toBe('holy');
  });

  it('and the relic alone leaves the character with no sanctification of their own', () => {
    const c = build('fighter', 13, {
      featPicks: { '2:class:0': 'sanctified-relic' },
      effectChoices: { 'sanctified-relic:divine-attribute': 'cha', 'sanctified-relic:relic-sanctification': 'unholy' },
    });
    expect(sanctificationOf(c)).toBeNull();
  });
});
