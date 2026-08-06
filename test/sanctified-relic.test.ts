import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

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
  it('asks for one divine attribute and a sanctification', () => {
    const ids = (feat.effectChoices ?? []).map((c) => c.id);
    expect(ids).toEqual(['divine-attribute', 'sanctification']);
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
      effectChoices: { 'sanctified-relic:divine-attribute': 'cha', 'sanctified-relic:sanctification': 'holy' },
    } as never);
    // The relic is worn by the hierophant — the owner's own attributes must not move.
    expect(answered.abilities).toEqual(plain.abilities);
    // …and the pick is still RECORDED, which is the whole point of asking.
    expect(answered.effectPicks?.some((p) => p.recordId === 'sanctified-relic')).toBe(true);
  });
});
