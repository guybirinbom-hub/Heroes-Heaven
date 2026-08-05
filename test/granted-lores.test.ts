import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * Training that arrives from a build selection which is NOT a feat.
 *
 * Both halves failed the same way: the rule was printed on a record the engine reads, but the field
 * that would carry it either could not express the value (a Lore is not a SkillId, so every
 * apparition's "Apparition Skills" line was inert) or existed and was never consulted for training
 * (`Deity.skill` was read only by Helm of Zeal's item bonus).
 */
const db = content();

const APPARITIONS = (db.classes.animist?.extraChoices ?? []).find((g) => g.id === 'apparition');

describe('an attuned apparition grants its Lores', () => {
  it('every apparition the app ships carries its Lore pair', () => {
    // Read from the AoN mirror, not from the app's own description text — checking the app against
    // itself would only prove it agrees with itself.
    const bare = (APPARITIONS?.options ?? []).filter((o) => !o.grants?.lores?.length).map((o) => o.id);
    expect(bare).toEqual([]);
    expect(APPARITIONS?.options.length).toBeGreaterThan(10);
  });

  it('attuning trains both of them', () => {
    const opt = APPARITIONS!.options.find((o) => o.id === 'custodian-of-groves-and-gardens')!;
    const c = build('animist', 3, { extraChoices: { apparition: [opt.id] }, primaryApparition: opt.id });
    expect(c.proficiencies.skills['lore:farming']).toBe('trained');
    expect(c.proficiencies.skills['lore:herbalism']).toBe('trained');
  });

  it('a different apparition brings different Lores, and not the first one’s', () => {
    const c = build('animist', 3, {
      extraChoices: { apparition: ['witness-to-ancient-battles'] },
      primaryApparition: 'witness-to-ancient-battles',
    });
    expect(c.proficiencies.skills['lore:battlegrounds']).toBe('trained');
    expect(c.proficiencies.skills['lore:heraldry']).toBe('trained');
    expect(c.proficiencies.skills['lore:farming'] ?? 'untrained').toBe('untrained');
  });

  it('attuning to two gives you all four', () => {
    // "Your attuned apparitions EACH grant you knowledge in the form of Lore skills" — not just the
    // primary, which is the one that additionally grants a vessel spell.
    const c = build('animist', 3, {
      extraChoices: { apparition: ['custodian-of-groves-and-gardens', 'steward-of-stone-and-fire'] },
      primaryApparition: 'custodian-of-groves-and-gardens',
    });
    for (const k of ['lore:farming', 'lore:herbalism', 'lore:mountain', 'lore:volcano']) {
      expect(c.proficiencies.skills[k as 'lore:farming'], k).toBe('trained');
    }
  });

  it('a granted Lore does not eat one of the free skill picks', () => {
    const none = build('animist', 3, {});
    const two = build('animist', 3, {
      extraChoices: { apparition: ['custodian-of-groves-and-gardens'] },
      primaryApparition: 'custodian-of-groves-and-gardens',
    });
    const free = (c: typeof none) => Object.entries(c.proficiencies.skills).filter(([k, r]) => !k.startsWith('lore:') && r !== 'untrained').length;
    expect(free(two)).toBe(free(none));
  });
});

describe("a cleric is trained in their deity's skill", () => {
  const deityWith = (skill: string) => Object.entries(db.deities).find(([, d]) => d.skill === skill)?.[0];

  it('the deity trains it', () => {
    const id = deityWith('nature')!;
    const c = build('cleric', 1, { deityId: id, subclassId: 'cloistered-cleric' });
    expect(c.proficiencies.skills.nature).toBe('trained');
  });

  it('a different deity trains a different skill', () => {
    const id = deityWith('stealth')!;
    const c = build('cleric', 1, { deityId: id, subclassId: 'cloistered-cleric' });
    expect(c.proficiencies.skills.stealth).toBe('trained');
  });

  it('it is free — the class skill picks are untouched', () => {
    const id = deityWith('thievery')!;
    const withIt = build('cleric', 1, { deityId: id, subclassId: 'cloistered-cleric' });
    const trained = Object.entries(withIt.proficiencies.skills).filter(([, r]) => r !== 'untrained').length;
    const other = build('cleric', 1, { deityId: deityWith('athletics')!, subclassId: 'cloistered-cleric' });
    const trainedOther = Object.entries(other.proficiencies.skills).filter(([, r]) => r !== 'untrained').length;
    // Two clerics with the same build and different deities end up equally trained, one skill each
    // from the deity — not one of them short because the deity ate a pick.
    expect(trained).toBe(trainedOther);
  });

  it("a champion's deity does NOT train a skill", () => {
    // "Deity and Cause" grants the favored weapon and the cause; the skill clause is the cleric's
    // Deity feature alone. Checked against the AoN text of both features.
    const id = deityWith('thievery')!;
    const c = build('champion', 1, { deityId: id });
    expect(c.proficiencies.skills.thievery ?? 'untrained').toBe('untrained');
  });

  it('almost every deity the app ships names a skill', () => {
    const without = Object.values(db.deities).filter((d) => !d.skill);
    expect(without.length).toBeLessThan(10);
  });
});
