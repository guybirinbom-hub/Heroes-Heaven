import { describe, it, expect } from 'vitest';
import { deriveAnimalCompanion, deriveEidolon, deriveFamiliar } from '../src/rules/companions';
import { deriveAc, deriveMaxHp, derivePerception, deriveSave } from '../src/rules/derive';
import { content, build } from './_content';

describe('animal companions', () => {
  const c = content();
  it('imported the animal companion types', () => {
    expect(Object.keys(c.animalCompanions).length).toBeGreaterThanOrEqual(10);
    expect(c.animalCompanions.wolf).toBeTruthy();
  });
  it('derives a level-4 mature wolf per the rules (AC stays trained, saves expert, 2 dice)', () => {
    const b = deriveAnimalCompanion({ id: 'x', kind: 'animal', name: 'Grey', typeId: 'wolf', maturity: 'mature' }, c.animalCompanions.wolf, 4, c);
    expect(b.ac).toBe(20);          // 10 + Dex4 + trained(2)+lvl4
    expect(b.hp).toBe(42);          // 6 + (6 + Con3) * 4
    expect(b.saves.fortitude.modifier).toBe(11); // Con3 + expert(4)+lvl4
    expect(b.saves.reflex.modifier).toBe(12);    // Dex4 + 8
    expect(b.saves.will.modifier).toBe(10);      // Wis2 + 8
    expect(b.perception.modifier).toBe(10);
    expect(b.attacks[0].attack).toBe(10);        // Dex4 (finesse) + trained(2)+lvl4
    expect(b.attacks[0].damage).toBe('2d8+3 piercing');
  });
  it('young wolf: 1 damage die, trained saves', () => {
    const b = deriveAnimalCompanion({ id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'young' }, c.animalCompanions.wolf, 1, c);
    expect(b.attacks[0].damage).toBe('1d8+2 piercing');
    expect(b.saves.fortitude.rank).toBe('trained');
  });
});

describe('familiar + eidolon use the master / summoner defenses', () => {
  const c = content();

  it('a familiar mirrors the master AC/saves/Perception, with 5×level HP', () => {
    const ch = build('wizard', 5, { keyAbility: 'int' });
    const fam = deriveFamiliar({ id: 'f', kind: 'familiar', name: 'Owl' }, ch, c);
    expect(fam.hp).toBe(5 * 5);
    expect(fam.ac).toBe(deriveAc(ch, c).value);
    expect(fam.perception).toBe(derivePerception(ch).modifier);
    expect(fam.saves.will).toBe(deriveSave(ch, 'will').modifier);
  });

  it('an eidolon shares the summoner HP/saves but uses its OWN Dex + array AC tweaks', () => {
    const ch = build('summoner', 5, { keyAbility: 'cha' });
    const mk = (eidolon?: import('../src/rules/types').EidolonConfig) =>
      deriveEidolon({ id: 'e', kind: 'eidolon', name: '', typeId: ch.subclassId ?? undefined, eidolon }, ch, c);
    const base = mk(); // default abilities (Dex +2)
    expect(base.hp).toBe(deriveMaxHp(ch, c)); // shared HP pool
    expect(base.saves.fortitude).toBe(deriveSave(ch, 'fortitude').modifier); // shared saves
    // AC tracks the eidolon's OWN Dex, the array's item bonus, and the array's Dex cap
    expect(mk({ abilities: { dex: 5 }, acItemBonus: 2 }).ac).toBe(base.ac + 3 + 2);
    expect(mk({ abilities: { dex: 5 }, dexCap: 1 }).ac).toBe(base.ac - 1);
  });

  it('an eidolon has a player-configured primary + a fixed secondary unarmed attack', () => {
    const ch = build('summoner', 5, { keyAbility: 'cha' });
    const eid = deriveEidolon(
      {
        id: 'e', kind: 'eidolon', name: '', typeId: ch.subclassId ?? undefined,
        eidolon: { abilities: { str: 5 }, primary: { name: 'Claw', damageType: 'slashing', option: 'd8-trip' }, secondary: { name: 'Tail', damageType: 'bludgeoning' } },
      },
      ch,
      c,
    );
    expect(eid.attacks).toHaveLength(2);
    // primary 1d8 (trip): attack = Str5 + trained(2) + level5 = 12; damage 1d8 + Str5
    expect(eid.attacks[0]).toMatchObject({ name: 'Claw', attack: 12, damage: '1d8+5 slashing' });
    expect(eid.attacks[0].traits).toEqual(expect.arrayContaining(['trip', 'unarmed']));
    // secondary is ALWAYS 1d6 with agile + finesse
    expect(eid.attacks[1]).toMatchObject({ name: 'Tail', damage: '1d6+5 bludgeoning' });
    expect(eid.attacks[1].traits).toEqual(expect.arrayContaining(['agile', 'finesse', 'unarmed']));
  });

  it('a cleared ability input falls back to the default (no NaN)', () => {
    const ch = build('summoner', 5, { keyAbility: 'cha' });
    const eid = deriveEidolon({ id: 'e', kind: 'eidolon', name: '', typeId: ch.subclassId ?? undefined, eidolon: { abilities: { str: undefined } } }, ch, c);
    expect(eid.abilities.str).toBe(4); // default spread, not NaN
    expect(Number.isNaN(eid.attacks[0].attack)).toBe(false);
  });

  it('a companion condition (Frightened 2) applies the status penalty to its stats', () => {
    const cfg = { id: 'w', kind: 'animal' as const, name: '', typeId: 'wolf', maturity: 'mature' };
    const base = deriveAnimalCompanion(cfg, c.animalCompanions.wolf, 4, c);
    const scared = deriveAnimalCompanion(cfg, c.animalCompanions.wolf, 4, c, [{ id: 'frightened', value: 2 }]);
    expect(scared.ac).toBe(base.ac - 2);
    expect(scared.saves.will.modifier).toBe(base.saves.will.modifier - 2);
    expect(scared.perception.modifier).toBe(base.perception.modifier - 2);
    expect(scared.attacks[0].attack).toBe(base.attacks[0].attack - 2);
  });

  it('a familiar condition applies on top of the master defenses', () => {
    const ch = build('wizard', 5, { keyAbility: 'int' });
    const base = deriveFamiliar({ id: 'f', kind: 'familiar', name: '' }, ch, c);
    const clumsy = deriveFamiliar({ id: 'f', kind: 'familiar', name: '' }, ch, c, [{ id: 'clumsy', value: 1 }]);
    expect(clumsy.ac).toBe(base.ac - 1); // Clumsy hits Dex-based AC
  });
});
