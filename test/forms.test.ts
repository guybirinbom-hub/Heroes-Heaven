import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveStrikes, deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

describe('alternate forms (stance/form toggle)', () => {
  const db = content();
  const ursine = (): Character =>
    build('fighter', 6, { ancestryId: 'human', backgroundId: 'warrior', overrides: { addedFeats: [{ featId: 'ursine-avenger-form', level: 2, category: 'class' }, { featId: 'senses-of-the-bear', level: 4, category: 'class' }] } });

  it('grants the form\'s Strikes only while the form is active', () => {
    const c = ursine();
    expect(deriveStrikes(c, db).some((s) => s.name === 'Jaws')).toBe(false);
    c.activeStance = 'ursine-avenger-form';
    const names = deriveStrikes(c, db).map((s) => s.name);
    expect(names).toContain('Jaws');
    expect(names).toContain('Claws');
  });
  it('applies a rider feat\'s senses (Senses of the Bear) only in the form', () => {
    const c = ursine();
    c.activeStance = 'ursine-avenger-form';
    const senses = deriveDefenses(c, db).senses.map((s) => s.name);
    expect(senses).toContain('low-light-vision');
    expect(senses).toContain('scent');
  });
  it('grants a form Speed formula (Dragon\'s Rage Wings: fly = land Speed)', () => {
    const c = build('barbarian', 6, { ancestryId: 'human', backgroundId: 'warrior', subclassId: 'dragon-instinct', overrides: { addedFeats: [{ featId: 'dragons-rage-wings', level: 6, category: 'class' }] } });
    expect(deriveSpeeds(c, db).fly ?? 0).toBe(0);
    c.activeStance = 'dragons-rage-wings';
    const spd = deriveSpeeds(c, db);
    expect(spd.fly).toBe(spd.land);
  });
});

describe('Quick Climb / Quick Swim — proficiency-gated speed', () => {
  const db = content();
  const at = (rank: string) => {
    const c = build('fighter', 15, { ancestryId: 'human', backgroundId: 'warrior', overrides: { addedFeats: [{ featId: 'quick-climb', level: 7, category: 'skill' }, { featId: 'quick-swim', level: 8, category: 'skill' }] } });
    c.proficiencies.skills.athletics = rank as never;
    return deriveSpeeds(c, db);
  };
  it('grants no climb/swim Speed below legendary Athletics', () => {
    for (const r of ['expert', 'master']) {
      const s = at(r);
      expect(s.climb ?? 0).toBe(0);
      expect(s.swim ?? 0).toBe(0);
    }
  });
  it('grants climb + swim Speed equal to land Speed at legendary', () => {
    const s = at('legendary');
    expect(s.climb).toBe(s.land);
    expect(s.swim).toBe(s.land);
  });
});

describe('heritage-conditional speed (Swift Swimmer)', () => {
  const db = content();
  it('grants the upgraded swim Speed only for the matching heritage', () => {
    const wet = build('fighter', 5, { ancestryId: 'lizardfolk', heritageId: 'wetlander-lizardfolk', overrides: { addedFeats: [{ featId: 'swift-swimmer', level: 1, category: 'ancestry' }] } });
    const other = build('fighter', 5, { ancestryId: 'lizardfolk', heritageId: 'unseen-lizardfolk', overrides: { addedFeats: [{ featId: 'swift-swimmer', level: 1, category: 'ancestry' }] } });
    expect(deriveSpeeds(wet, db).swim).toBe(25);
    // A different heritage does NOT get the wetlander upgrade.
    expect(deriveSpeeds(other, db).swim ?? 0).toBeLessThan(25);
  });
});

describe('language grants', () => {
  it('an invested item grants its language (Plate Armor of the Deep → Thalassic)', () => {
    const db = content();
    const inv = (invested: boolean) => build('fighter', 10, { ancestryId: 'human', inventory: [{ instanceId: 'p', itemId: 'plate-armor-of-the-deep', quantity: 1, worn: true, invested }] as never });
    expect(inv(true).languages).toContain('thalassic');
    expect(inv(false).languages).not.toContain('thalassic');
  });
});
