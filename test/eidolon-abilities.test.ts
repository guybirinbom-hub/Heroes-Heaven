import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveEidolon } from '../src/rules/companions';

/**
 * Every eidolon type already printed its own abilities, and nothing structured them.
 *
 * So the eidolon's block listed none of them — and Eidolon Symbiosis (7th) and Eidolon Transcendence
 * (17th), two class features whose entire content is "you gain your eidolon type's symbiosis /
 * transcendence ability", arrived empty.
 */
const db = content();
const TYPES = db.classes.summoner?.subclass?.options ?? [];

const eidolon = (typeId: string, level: number) =>
  deriveEidolon({ id: 'e1', kind: 'eidolon', name: 'Eidolon', typeId } as never, build('summoner', level, { subclassId: typeId }), db);

describe('the data', () => {
  it('all thirteen types carry all three tiers', () => {
    expect(TYPES.length).toBe(13);
    for (const t of TYPES) {
      expect(t.eidolonAbilities?.map((a) => a.tier), t.id).toEqual(['initial', 'symbiosis', 'transcendence']);
    }
  });

  it('every ability has a name AND its prose', () => {
    // The app's own option description carries only the INITIAL ability's text, which is exactly why
    // the other two arrived empty; these come from the AoN mirror instead.
    const bare: string[] = [];
    for (const t of TYPES) for (const a of t.eidolonAbilities ?? []) if (!a.name || a.text.length < 40) bare.push(`${t.id}/${a.tier}`);
    expect(bare).toEqual([]);
  });

  it('the tier levels match the class features that hand them over', () => {
    expect(db.classFeatures['eidolon-symbiosis'].level).toBe(7);
    expect(db.classFeatures['eidolon-transcendence'].level).toBe(17);
    for (const t of TYPES) {
      expect(t.eidolonAbilities!.map((a) => a.level)).toEqual([1, 7, 17]);
    }
  });

  it('names are properly cased, not slug-derived', () => {
    const angel = TYPES.find((t) => t.id === 'angel-eidolon')!.eidolonAbilities!;
    expect(angel.map((a) => a.name)).toEqual(['Hallowed Strikes', "Traveler's Aura", 'Angelic Mercy']);
  });
});

describe('what the eidolon block lists', () => {
  it('at 1st level, only the initial ability', () => {
    const b = eidolon('angel-eidolon', 1);
    expect(b.typeAbilities?.map((a) => a.name)).toEqual(['Hallowed Strikes']);
  });

  it('at 7th, the symbiosis ability arrives', () => {
    const b = eidolon('angel-eidolon', 7);
    expect(b.typeAbilities?.map((a) => a.tier)).toEqual(['initial', 'symbiosis']);
  });

  it('at 17th, all three', () => {
    const b = eidolon('angel-eidolon', 17);
    expect(b.typeAbilities?.map((a) => a.tier)).toEqual(['initial', 'symbiosis', 'transcendence']);
  });

  it('a 6th-level summoner does NOT see their 7th-level ability', () => {
    expect(eidolon('angel-eidolon', 6).typeAbilities?.length).toBe(1);
  });

  it('a different type brings different abilities', () => {
    const dragon = eidolon('dragon-eidolon', 17).typeAbilities!.map((a) => a.name);
    expect(dragon).toEqual(['Breath Weapon', 'Draconic Frenzy', "Wyrm's Breath"]);
    expect(dragon).not.toContain('Hallowed Strikes');
  });

  it('every type delivers three at 20th', () => {
    for (const t of TYPES) expect(eidolon(t.id, 20).typeAbilities?.length, t.id).toBe(3);
  });
});
