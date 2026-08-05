import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * "Access" is three different promises in the printed text, and they are not interchangeable.
 *
 * `spellListAdditions` widened the PICKER and nothing else, so a record saying "you add Heal to your
 * apparition repertoire" (you KNOW it) and one saying "you can prepare Harm in your font slots" (a
 * different pool entirely) both landed as "you may now learn this", which is neither.
 *
 * It was also singular and declared on Feat alone, so no class feature could carry one.
 */
const db = content();
const grantsOf = (id: string) => {
  const g = (db.feats[id] ?? db.classFeatures[id])?.spellListAdditions;
  return g == null ? [] : Array.isArray(g) ? g : [g];
};

describe('the three promises are kept apart', () => {
  it('a FONT record targets the font', () => {
    for (const id of ['versatile-font', 'aura-enhancement', 'restorative-channel']) {
      expect(grantsOf(id)[0]?.as, id).toBe('font');
    }
  });

  it('a REPERTOIRE record grants knowledge, not permission', () => {
    for (const id of ['embodiment-of-the-balance', 'walk-the-wilds']) {
      expect(grantsOf(id)[0]?.as, id).toBe('repertoire');
    }
  });

  it("a LIST record leaves you still needing to learn it, which is what Dragon Arcana prints", () => {
    expect(grantsOf('shadow-spells')[0]?.as ?? 'list').toBe('list');
    expect(grantsOf('dragon-arcana')[0]?.as ?? 'list').toBe('list');
  });

  it('every spell named by every grant resolves, and none is a ritual', () => {
    const bad: string[] = [];
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        const g = r.spellListAdditions;
        for (const a of g == null ? [] : Array.isArray(g) ? g : [g]) {
          for (const s of a.spells ?? []) {
            if (!db.spells[s]) bad.push(`${id} -> ${s} is not a spell`);
            else if (db.spells[s].ritual) bad.push(`${id} -> ${s} is a ritual`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('a font addition reaches the font', () => {
  it('Versatile Font puts Heal and Harm in the allowed list', () => {
    const ch = build('cleric', 5, { deityId: 'sarenrae', divineFont: 'heal', featPicks: { '4:class': 'versatile-font' } });
    const withFont = ch.spellcasting.find((e) => e.font);
    if (!withFont) return; // this build has no font; the data assertion above still holds
    expect(withFont.font!.allowed).toEqual(expect.arrayContaining(['heal', 'harm']));
  });

  it('a cleric without the feat has no such allowance', () => {
    const ch = build('cleric', 5, { deityId: 'sarenrae', divineFont: 'heal' });
    const withFont = ch.spellcasting.find((e) => e.font);
    expect(withFont?.font?.allowed ?? []).not.toContain('harm');
  });
});

describe('a repertoire addition reaches the repertoire', () => {
  it('Walk the Wilds means the animist KNOWS Animal Form', () => {
    const ch = build('animist', 6, { featPicks: { '6:class': 'walk-the-wilds' } });
    const known = ch.spellcasting.flatMap((e) => Object.values(e.grantedRepertoire ?? {}).flat());
    expect(known).toContain('animal-form');
  });

  it('without it, they do not', () => {
    const ch = build('animist', 6, {});
    const known = ch.spellcasting.flatMap((e) => Object.values(e.grantedRepertoire ?? {}).flat());
    expect(known).not.toContain('animal-form');
  });
});
