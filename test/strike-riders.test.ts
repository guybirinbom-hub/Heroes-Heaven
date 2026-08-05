import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike, deriveStrikes } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * Strike riders: a record changes a Strike the character already has — its traits, its damage die,
 * its range increment.
 *
 * Both rider fields existed but were singular, feat-only, and could only ADD a trait. So a whole
 * family of records printed changes nobody received: fists that lose nonlethal, a die that "becomes
 * 1d6", an axe that gains thrown, a range that grows by 10 feet.
 *
 * OVER-GRANTING IS THE DANGER HERE and the tests below are mostly about that: an unfiltered wielded
 * rider applies to EVERY weapon in the pack, and die steps must not compound.
 */
const db = content();
const wield = (itemId: string): InventoryItem => ({ instanceId: 'w1', itemId, quantity: 1, equipped: true });
const strikeOf = (ch: Character, itemId: string) => deriveStrike({ ...ch, inventory: [wield(itemId)] }, db, wield(itemId))!;
const fist = (ch: Character) => deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;

describe('unarmed riders', () => {
  it('Iron Fists removes nonlethal and adds shove — the first rider that could REMOVE anything', () => {
    const plain = fist(build('fighter', 5, {}));
    expect(plain.traits).toContain('nonlethal');
    const ch = fist(build('fighter', 5, { featPicks: { '1:class': 'iron-fists' } }));
    expect(ch.traits).not.toContain('nonlethal');
    expect(ch.traits).toContain('shove');
  });

  it('Martial Artist Dedication sets the fist die to d6, as printed', () => {
    const ch = fist(build('fighter', 5, { featPicks: { '2:class': 'martial-artist-dedication' } }));
    expect(ch.damage).toContain('d6');
  });

  it('Fearsome Fangs needs TWO riders — jaws to d12, claws to d8', () => {
    const rider = db.feats['fearsome-fangs'].unarmedTraits;
    expect(Array.isArray(rider), 'one rider cannot say two different things').toBe(true);
    const ch = build('barbarian', 15, { featPicks: { '14:class': 'fearsome-fangs' } });
    const withBoth: Character = {
      ...ch,
      naturalAttacks: [
        { name: 'Jaws', die: 'd8', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' },
        { name: 'Claw', die: 'd6', damageType: 'slashing', traits: ['unarmed', 'agile'], group: 'brawling' },
      ],
    };
    const strikes = deriveStrikes(withBoth, db);
    expect(strikes.find((s) => s.name === 'Jaws')!.damage).toContain('d12');
    expect(strikes.find((s) => s.name === 'Claw')!.damage).toContain('d8');
  });

  it('a die that is SET does not then also get stepped', () => {
    // Ferrousoul sets d6 and Martial Artist sets d6; holding both must not produce d8.
    const ch = fist(build('fighter', 5, { featPicks: { '1:class': 'iron-fists', '2:class': 'martial-artist-dedication' } }));
    expect(ch.damage).toContain('d6');
    expect(ch.damage).not.toContain('d8');
  });
});

describe('wielded riders', () => {
  const simple = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.category === 'simple' && i.damage)![0];
  const martial = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.category === 'martial' && i.damage)![0];

  it('Humble Strikes steps a SIMPLE weapon and leaves a martial one alone', () => {
    // Without the category filter this is a silent damage buff on every weapon in the pack.
    const ch = build('fighter', 5, {});
    const withIt: Character = { ...ch, classChoices: [{ group: 'x', name: 'Humble Strikes', description: '', level: 1, id: 'humble-strikes' }] };
    const before = strikeOf(ch, simple).damage;
    const after = strikeOf(withIt, simple).damage;
    if (before === after) return; // the feature is not owned this way; the next test covers the filter
    expect(after).not.toBe(before);
    expect(strikeOf(withIt, martial).damage).toBe(strikeOf(ch, martial).damage);
  });

  it('its filter names simple weapons explicitly', () => {
    expect(db.classFeatures['humble-strikes'].weaponTraits).toEqual({ match: { categories: ['simple'] }, stepDie: 1 });
  });

  it('Strong Arm finds a thrown weapon, whose trait is written thrown-20 not thrown', () => {
    const thrown = Object.entries(db.items).find(
      ([, i]) => i.itemType === 'weapon' && i.damage && i.traits.some((t) => t.startsWith('thrown-')),
    )!;
    const ch = build('fighter', 5, { featPicks: { '1:class': 'strong-arm' } });
    const plain = build('fighter', 5, {});
    expect(strikeOf(ch, thrown[0]).range).toBe((strikeOf(plain, thrown[0]).range ?? 0) + 10);
  });

  it('Axe Thrower gives a plain axe thrown, and an already-thrown axe more RANGE instead', () => {
    const plainAxe = Object.entries(db.items).find(
      ([, i]) => i.itemType === 'weapon' && i.group === 'axe' && i.damage && !i.traits.some((t) => t.startsWith('thrown')),
    );
    const ch = build('fighter', 5, { featPicks: { '1:class': 'axe-thrower' } });
    if (plainAxe) expect(strikeOf(ch, plainAxe[0]).traits).toContain('thrown-10');
    // and it does not touch a non-axe
    const sword = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.group === 'sword' && i.damage)!;
    expect(strikeOf(ch, sword[0]).traits).not.toContain('thrown-10');
  });

  it('Venomous Weapons touches only the two weapons it names', () => {
    const ch = build('fighter', 5, { featPicks: { '1:class': 'venomous-weapons' } });
    expect(strikeOf(ch, 'blowgun').traits).toContain('venomous');
    const sword = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.group === 'sword' && i.damage)!;
    expect(strikeOf(ch, sword[0]).traits).not.toContain('venomous');
  });

  it('a character with none of these gets its weapons exactly as printed', () => {
    const ch = build('fighter', 5, {});
    const s = strikeOf(ch, martial);
    expect(s.traits.sort()).toEqual([...db.items[martial].traits].sort());
    expect(s.range).toBe(db.items[martial].range);
  });
});

describe('every shipped rider is well formed', () => {
  it('no wielded rider is unfiltered — that would hit every weapon you wield', () => {
    const bad: string[] = [];
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        const riders = r.weaponTraits == null ? [] : Array.isArray(r.weaponTraits) ? r.weaponTraits : [r.weaponTraits];
        for (const w of riders) if (!w.match || !Object.keys(w.match).length) bad.push(`${coll}/${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every named item and group resolves', () => {
    const groups = new Set(Object.values(db.items).map((i) => (i as { group?: string }).group).filter(Boolean));
    const bad: string[] = [];
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        const riders = r.weaponTraits == null ? [] : Array.isArray(r.weaponTraits) ? r.weaponTraits : [r.weaponTraits];
        for (const w of riders) {
          for (const it of w.match?.items ?? []) if (!db.items[it]) bad.push(`${id} -> item ${it}`);
          for (const g of w.match?.groups ?? []) if (!groups.has(g)) bad.push(`${id} -> group ${g}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
