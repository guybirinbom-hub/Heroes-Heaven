import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import type { Spell } from '../src/rules/types';

/**
 * Elemental Magic — the one class archetype whose entire point is a DIFFERENT spell list.
 *
 * "Replace your spell list with the elemental spell list. Your actual magical tradition is
 * unchanged, but you choose your spells from the elemental list instead." Before this the wizard
 * elementalist was handed the full arcane list, so the archetype's only working half was the
 * resistance attunement on its dedication.
 */
const c = () => content();

/** The membership rule the picker applies, kept next to the test that asserts it. */
const onList = (s: Spell, rep: NonNullable<ReturnType<typeof build>['spellListReplacement']>) => {
  if (!s.traditions.length) return !!s.spellLists?.includes(rep.list);
  if (s.spellLists?.includes(rep.list)) return true;
  if (!rep.anyTrait.length) return false;
  const t = s.traits ?? [];
  return t.some((x) => rep.anyTrait.includes(x)) && !t.some((x) => rep.excludeTraits.includes(x));
};

const wiz = (philosophy?: string) =>
  build('wizard', 8, {
    subclassId: 'school-of-battle-magic',
    featPicks: { '2:class:0': 'elementalist-dedication' },
    ...(philosophy ? { effectChoices: { 'elementalist-dedication:elemental-philosophy': philosophy } } : {}),
  });

describe('the elemental spell list', () => {
  it('is carried on the character, scoped to the class entry, tradition untouched', () => {
    const ch = wiz('inner-sea');
    const rep = ch.spellListReplacement;
    expect(rep).toBeTruthy();
    expect(rep!.list).toBe('elemental');
    expect(rep!.entryId).toBe('wizard-casting');
    // The archetype says so in as many words: the tradition, and therefore the spell attack and DC,
    // are exactly what the class gave you.
    expect(ch.spellcasting.find((e) => e.id === 'wizard-casting')!.tradition).toBe('arcane');
  });

  it('is smaller than the tradition it replaced', () => {
    const ch = wiz('inner-sea');
    const all = Object.values(c().spells);
    const arcane = all.filter((s) => s.traditions.includes('arcane')).length;
    const elemental = all.filter((s) => onList(s, ch.spellListReplacement!)).length;
    expect(elemental).toBeGreaterThan(100); // it is a real list, not an empty filter
    expect(elemental).toBeLessThan(arcane); // "a smaller, more focused spell list"
  });

  it('admits the universal elemental spells whatever the philosophy', () => {
    // Marked from the printed "Spell Lists Elemental" line, not guessed from traits.
    const universal = Object.values(c().spells).filter((s) => s.spellLists?.includes('elemental'));
    expect(universal.length).toBeGreaterThan(40);
    for (const p of ['inner-sea', 'elemental-cycle']) {
      const rep = wiz(p).spellListReplacement!;
      expect(universal.every((s) => onList(s, rep))).toBe(true);
    }
    // Detect Magic and Dispel Magic are on it; Fireball is not — it joins only through the fire trait.
    expect(c().spells['detect-magic'].spellLists).toContain('elemental');
    expect(c().spells['fireball'].spellLists ?? []).not.toContain('elemental');
  });

  it('applies the philosophy exactly as the example in the text does', () => {
    const cycle = wiz('elemental-cycle').spellListReplacement!;
    const inner = wiz('inner-sea').spellListReplacement!;
    // `traditions` is non-empty because a spell with none is on no list at all — see the test below.
    const spell = (traits: string[]) => ({ traits, traditions: ['arcane'], spellLists: [] }) as unknown as Spell;
    // "An elemental cycle elementalist could choose a spell with both the earth and fire traits, but
    // not one with the air and fire traits, while an inner sea elementalist could choose either of
    // those, but not a spell with metal and fire traits."
    expect(onList(spell(['earth', 'fire']), cycle)).toBe(true);
    expect(onList(spell(['air', 'fire']), cycle)).toBe(false);
    expect(onList(spell(['earth', 'fire']), inner)).toBe(true);
    expect(onList(spell(['air', 'fire']), inner)).toBe(true);
    expect(onList(spell(['metal', 'fire']), inner)).toBe(false);
    // …and a spell with no element trait at all is only on the list if it is universal.
    expect(onList(spell(['healing']), cycle)).toBe(false);
  });

  it('never offers something that is on no list at all', () => {
    // The ordinary tradition test excluded focus spells, rituals and the class-granted cantrips for
    // free, because none of them carries a tradition. A rule written on traits does not, so an
    // elementalist wizard was being offered Crushing Ground and Earthworks (druid/animist focus
    // spells) and Entropic Wheel (a psychic amp) as things to write in a spellbook.
    const rep = wiz('inner-sea').spellListReplacement!;
    const offered = Object.values(c().spells).filter((s) => onList(s, rep));
    expect(offered.length).toBeGreaterThan(100);
    expect(offered.filter((s) => (s.traits ?? []).includes('focus'))).toEqual([]);
    expect(offered.filter((s) => s.ritual)).toEqual([]);
    for (const id of ['crushing-ground', 'earthworks', 'fire-ray', 'entropic-wheel', 'redistribute-potential']) {
      expect(onList(c().spells[id], rep), id).toBe(false);
    }
    // …but the universal elemental spells stay in, and so do ordinary element-trait spells.
    for (const id of ['detect-magic', 'air-bubble', 'breathe-fire']) {
      expect(onList(c().spells[id], rep), id).toBe(true);
    }
  });

  it('offers only the universal half until the philosophy is chosen, and says so', () => {
    const rep = wiz().spellListReplacement!;
    expect(rep.anyTrait).toEqual([]);
    expect(rep.note).toMatch(/philosophy/i);
    const kept = Object.values(c().spells).filter((s) => onList(s, rep));
    expect(kept.every((s) => s.spellLists?.includes('elemental'))).toBe(true);
  });

  it('leaves a character without the dedication on their ordinary list', () => {
    expect(build('wizard', 8, { subclassId: 'school-of-battle-magic' }).spellListReplacement).toBeUndefined();
  });
});

describe('the class archetypes whose dedications carried no wiring', () => {
  it('Avenger removes Surprise Attack from a rogue', () => {
    const plain = build('rogue', 4, { subclassId: 'avenger' });
    const avenger = build('rogue', 4, { subclassId: 'avenger', featPicks: { '2:class:0': 'avenger-dedication' } });
    expect(plain.classArchetype).toBeUndefined();
    expect(avenger.classArchetype?.classId).toBe('rogue');
    expect(avenger.classArchetype?.suppressedFeatures).toContain('surprise-attack');
    expect(avenger.classArchetype?.notes.join(' ')).toMatch(/Surprise Attack/);
  });

  it('Runelord removes the arcane thesis from a wizard', () => {
    const ch = build('wizard', 4, { subclassId: 'runelord', featPicks: { '2:class:0': 'runelord-dedication' } });
    expect(ch.classArchetype?.suppressedFeatures).toContain('arcane-thesis');
  });

  it('Battle Harbinger removes Resolute Faith and Miraculous Spell', () => {
    const noDed = build('cleric', 19, { subclassId: 'battle-creed', deityId: 'sarenrae' });
    const ch = build('cleric', 19, {
      subclassId: 'battle-creed',
      deityId: 'sarenrae',
      featPicks: { '2:class:0': 'battle-harbinger-dedication' },
    });
    // Both are on the cleric's own feature list (9th and 19th), so this removes something real —
    // only the dedication takes them away, the battle-creed subclass alone does not.
    expect(noDed.classArchetype).toBeUndefined();
    expect(ch.classArchetype?.suppressedFeatures).toEqual(
      expect.arrayContaining(['resolute-faith', 'miraculous-spell']),
    );
  });

  it('leaves the reduced spells-per-day table to the battle-creed subclass that already carries it', () => {
    // "You have no more than two spell slots of your highest rank and … two spell slots of 1 rank
    // lower … even if you no longer have spell slots at those ranks." The subclass already produces
    // exactly that, so the dedication must NOT cap the table a second time.
    const ch = build('cleric', 9, {
      subclassId: 'battle-creed',
      deityId: 'sarenrae',
      featPicks: { '2:class:0': 'battle-harbinger-dedication' },
    });
    const prepared = ch.spellcasting.find((e) => e.id === 'cleric-casting')!.prepared!;
    const ranks = Object.entries(prepared).filter(([r]) => Number(r) > 0);
    expect(ranks.map(([r, s]) => `${r}:${s.length}`)).toEqual(['4:2', '5:2']);
  });

  it('every class archetype only applies to a character of its own class', () => {
    const ch = build('fighter', 6, { featPicks: { '2:class:0': 'avenger-dedication' } });
    expect(ch.spellListReplacement).toBeUndefined();
    expect(ch.classArchetype).toBeUndefined();
  });
});
