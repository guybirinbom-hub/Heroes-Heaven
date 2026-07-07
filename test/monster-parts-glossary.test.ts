import { describe, it, expect } from 'vitest';
import { getMpProperty, MONSTER_PART_PROPERTIES } from '../src/rules/monsterParts';
import {
  mpPathDesc,
  mpPropertyDesc,
  mpTermDesc,
  MP_TERM_LABELS,
  propertyMatchesQuery,
} from '../src/rules/monsterPartsGlossary';

describe('Monster Parts — path glossary', () => {
  it('describes the three weapon paths + main', () => {
    for (const id of ['magic', 'might', 'technique', 'main']) {
      const d = mpPathDesc(id)!;
      expect(d.title).toBeTruthy();
      expect(d.description.length).toBeGreaterThan(20);
    }
  });

  it('falls back to the generic "Effect" description for an unknown path id', () => {
    expect(mpPathDesc('nonsense')).toEqual(mpPathDesc('main'));
  });

  it('gives distinct copy per path', () => {
    expect(mpPathDesc('magic')!.description).not.toBe(mpPathDesc('might')!.description);
    expect(mpPathDesc('might')!.description).not.toBe(mpPathDesc('technique')!.description);
  });
});

describe('Monster Parts — property description (catalog-sourced)', () => {
  it('builds a description from the catalog (requirement + effect + a level ladder)', () => {
    const fire = getMpProperty('fire')!;
    const d = mpPropertyDesc(fire);
    expect(d.title).toBe(fire.name);
    expect(d.description).toContain(fire.requirement);
    // Effect line present.
    if (fire.effect) expect(d.description).toContain(fire.effect);
    // A per-path level ladder was rendered (ordinal level markers).
    expect(/\*\*\d+(st|nd|rd|th)\*\*/.test(d.description)).toBe(true);
  });

  it('produces a non-empty description for every catalog property', () => {
    for (const p of MONSTER_PART_PROPERTIES) {
      const d = mpPropertyDesc(p);
      expect(d.title).toBe(p.name);
      expect(d.description.length).toBeGreaterThan(10);
    }
  });

  it('notes reused paths for Chaotic/Lawful', () => {
    const chaotic = getMpProperty('chaotic');
    if (chaotic?.reusesPathsOf) {
      expect(mpPropertyDesc(chaotic).description.toLowerCase()).toContain(chaotic.reusesPathsOf);
    }
  });
});

describe('Monster Parts — MP-specific term glossary', () => {
  it('has authored entries for persistent damage / weakness / resistance / precision / hardness', () => {
    for (const t of ['persistent damage', 'weakness', 'resistance', 'precision', 'hardness']) {
      expect(mpTermDesc(t)?.description.length).toBeGreaterThan(20);
    }
  });

  it('does not re-author conditions that live in imported content (off-guard/frightened)', () => {
    // These are linkified from content, never from the MP glossary.
    expect(mpTermDesc('off-guard')).toBeUndefined();
    expect(mpTermDesc('frightened')).toBeUndefined();
  });

  it('exposes term labels longest-first for regex building', () => {
    expect(MP_TERM_LABELS.length).toBeGreaterThan(0);
    for (let i = 1; i < MP_TERM_LABELS.length; i++) {
      expect(MP_TERM_LABELS[i - 1].length).toBeGreaterThanOrEqual(MP_TERM_LABELS[i].length);
    }
  });
});

describe('Monster Parts — rules-page property search', () => {
  it('matches by property name', () => {
    const sonic = getMpProperty('sonic')!;
    expect(propertyMatchesQuery(sonic, 'Sonic')).toBe(true);
    expect(propertyMatchesQuery(sonic, 'sonic')).toBe(true);
  });

  it('matches on effect / path / level text, not just the name', () => {
    // Every damage property mentions its energy type in its per-level entries; a search for the type
    // should hit the property even when the query is not its display name.
    const acid = getMpProperty('acid')!;
    expect(propertyMatchesQuery(acid, 'acidic burst')).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(MONSTER_PART_PROPERTIES.every((p) => propertyMatchesQuery(p, ''))).toBe(true);
    expect(MONSTER_PART_PROPERTIES.every((p) => propertyMatchesQuery(p, '   '))).toBe(true);
  });

  it('a nonsense query matches nothing', () => {
    expect(MONSTER_PART_PROPERTIES.some((p) => propertyMatchesQuery(p, 'zzzxqwv'))).toBe(false);
  });
});
