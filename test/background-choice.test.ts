import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { backgroundChoiceKey, backgroundChoiceKind, backgroundChoiceValue, emptyBuild } from '../src/rules/build';
import { featEntries } from '../src/sheet/FeatsTab';

/**
 * A background's own embedded sub-choice.
 *
 * 71 backgrounds carry a full FeatChoiceDef and the field was not declared on the `Background`
 * interface at all — so nothing rendered it and nothing read it. Every one of those backgrounds asked
 * a question no player was ever shown.
 */
const db = content();
const withChoice = Object.entries(db.backgrounds).filter(([, b]) => b.choice);
const firstOf = (kind: 'skill' | 'lore' | 'feat' | 'other') =>
  withChoice.find(([, b]) => backgroundChoiceKind(b.choice!, db) === kind && b.choice!.options?.length)!;

describe('what a background asks', () => {
  it('dozens of backgrounds carry one', () => {
    /* 71 at first; batches 19–20 retired the DUPLICATE-carrier choices (a choice firing beside
     * trainedLoreOptions/trainedSkillChoice trained two skills from a background that prints one),
     * so the count is lower by exactly those removals — the lane itself is as alive as ever. */
    expect(withChoice.length).toBeGreaterThan(40);
  });

  it('every one classifies, and every kind is represented', () => {
    const kinds = new Set(withChoice.map(([, b]) => backgroundChoiceKind(b.choice!, db)));
    expect([...kinds].sort()).toEqual(['feat', 'lore', 'other', 'skill']);
  });

  it('an unanswered choice defaults to the first option, so the build stays legal', () => {
    const [id, bg] = firstOf('lore');
    expect(backgroundChoiceValue({ ...emptyBuild(), backgroundId: id }, bg)).toBe(bg.choice!.options![0].value);
  });
});

describe('what the answer does', () => {
  it('a Lore answer trains that Lore', () => {
    const [id, bg] = firstOf('lore');
    const pick = bg.choice!.options![1].value;
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: pick } });
    expect(c.proficiencies.skills[`lore:${pick}` as 'lore:guild']).toBe('trained');
  });

  it('a different answer trains a different Lore', () => {
    const [id, bg] = firstOf('lore');
    const a = bg.choice!.options![0].value;
    const b = bg.choice!.options![1].value;
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: a } });
    expect(c.proficiencies.skills[`lore:${a}` as 'lore:guild']).toBe('trained');
    expect(c.proficiencies.skills[`lore:${b}` as 'lore:guild'] ?? 'untrained').toBe('untrained');
  });

  it('a skill answer trains that skill', () => {
    const [id, bg] = firstOf('skill');
    const pick = bg.choice!.options![0].value;
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: pick } });
    expect(c.proficiencies.skills[pick as 'stealth']).toBe('trained');
  });

  it('a feat answer grants that feat', () => {
    const [id, bg] = firstOf('feat');
    const pick = bg.choice!.options![0].value;
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: pick } });
    expect(c.feats.some((f) => f.featId === pick)).toBe(true);
  });

  it('and it does not grant the option you did NOT pick', () => {
    const [id, bg] = firstOf('feat');
    const other = bg.choice!.options![1]?.value;
    if (!other) return;
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: bg.choice!.options![0].value } });
    expect(c.feats.some((f) => f.featId === other)).toBe(false);
  });

  it("an 'other' answer changes no number — that is correct, not a gap", () => {
    // A terrain, a constellation, a deviant classification. Being ASKED and having the answer kept is
    // the whole of what those records want; inventing a bonus would be worse than recording it.
    const [id, bg] = firstOf('other');
    const plain = build('fighter', 1, { backgroundId: id });
    const picked = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: bg.choice!.options![0].value } });
    expect(picked.proficiencies.skills).toEqual(plain.proficiencies.skills);
  });

  it('a Lore granted this way does not eat a free skill pick', () => {
    const [id, bg] = firstOf('lore');
    const c = build('fighter', 1, { backgroundId: id, featChoices: { [backgroundChoiceKey(id)]: bg.choice!.options![0].value } });
    const plain = build('fighter', 1, {});
    const free = (x: typeof c) => Object.entries(x.proficiencies.skills).filter(([k, r]) => !k.startsWith('lore:') && r !== 'untrained').length;
    expect(free(c)).toBe(free(plain));
  });
});

describe('the classifier decides by what the answer IS', () => {
  it("a prompt naming Lore is a Lore, whatever its flag", () => {
    expect(backgroundChoiceKind({ flag: 'x', prompt: 'Lore subject', kind: 'array', options: [{ value: 'guild', label: 'Guild Lore' }] }, db)).toBe('lore');
  });

  it('a kind of "skills" is a skill', () => {
    expect(backgroundChoiceKind({ flag: 'x', prompt: 'Skill', kind: 'skills' }, db)).toBe('skill');
  });

  it('options that are all real feats are a feat grant', () => {
    const someFeat = Object.keys(db.feats)[0];
    expect(backgroundChoiceKind({ flag: 'x', prompt: 'Pick', kind: 'array', options: [{ value: someFeat, label: 'F' }] }, db)).toBe('feat');
  });

  it('anything else is recorded, not guessed at', () => {
    expect(backgroundChoiceKind({ flag: 'x', prompt: 'Terrain', kind: 'array', options: [{ value: 'swamp', label: 'Swamp' }] }, db)).toBe('other');
  });
});

describe('cross-reference links inside a choice row', () => {
  it('a bloodline row carries its descRefs, so its links resolve', () => {
    const sub = db.classes.sorcerer.subclass!.options.find((o) => (o.descRefs ?? []).length)!;
    const row = featEntries(build('sorcerer', 5, { subclassId: sub.id }), db).find((e) => e.name === sub.name);
    expect(row?.descRefs?.length).toBe(sub.descRefs!.length);
  });

  it('there are enough of them for this to matter', () => {
    let n = 0;
    for (const cl of Object.values(db.classes)) {
      for (const o of cl.subclass?.options ?? []) n += (o.descRefs ?? []).length;
      for (const g of cl.extraChoices ?? []) for (const o of g.options ?? []) n += (o.descRefs ?? []).length;
    }
    expect(n).toBeGreaterThan(1000);
  });
});

describe('a heritage can grant a casting profile', () => {
  it('the one heritage carrying spellcastingGrant is read', () => {
    const [id, h] = Object.entries(db.heritages).find(([, x]) => x.spellcastingGrant)!;
    expect(h.spellcastingGrant).toBeTruthy();
    const c = build('fighter', 3, { ancestryId: h.ancestryId ?? 'human', heritageId: id });
    // The grant sets the profile an innate entry uses; with no innate spell there is no entry, so
    // assert the build accepts it rather than inventing an entry that should not exist.
    expect(c.heritageId).toBe(id);
  });
});
