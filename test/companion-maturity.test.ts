import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { deriveAnimalCompanion, COMPANION_FORMULA, MATURITIES, type Maturity } from '../src/rules/companions';
import type { CompanionConfig } from '../src/rules/types';

const c = content();
/** Wolf: a plain Player Core companion whose signature skill is NOT Acrobatics/Athletics/Stealth,
 *  so an advancement's named skill is visible as a change rather than masked by the signature rank. */
const wolf = () => c.animalCompanions['wolf'] ?? Object.values(c.animalCompanions)[0];
const block = (maturity: Maturity) => {
  const cfg = { id: 'x', kind: 'animal', name: 'W', typeId: wolf().id, maturity } as CompanionConfig;
  return deriveAnimalCompanion(cfg, wolf(), 8, c);
};
const skill = (maturity: Maturity, name: string) =>
  block(maturity).skills.find((s) => s.name.toLowerCase() === name)?.rank;

/**
 * The advancements each raise a NAMED skill (Player Core p211 and the Lost Omens / Dark Archives
 * alternatives). The engine pinned every non-signature skill at `otherSkills` (trained), so those
 * increases were silently missing.
 */
describe('animal companion advancement skill increases', () => {
  it('young and mature leave Acrobatics/Athletics trained', () => {
    expect(skill('young', 'acrobatics')).toBe('trained');
    expect(skill('mature', 'acrobatics')).toBe('trained');
    expect(skill('mature', 'athletics')).toBe('trained');
  });

  it('nimble raises Acrobatics to expert (and not Athletics)', () => {
    expect(skill('nimble', 'acrobatics')).toBe('expert');
    expect(skill('nimble', 'athletics')).toBe('trained');
  });

  it('savage raises Athletics to expert (and not Acrobatics)', () => {
    expect(skill('savage', 'athletics')).toBe('expert');
    expect(skill('savage', 'acrobatics')).toBe('trained');
  });

  it('indomitable raises Athletics; unseen raises Stealth', () => {
    expect(skill('indomitable', 'athletics')).toBe('expert');
    expect(skill('unseen', 'stealth')).toBe('expert');
  });

  it('specializing keeps the path’s skill increase', () => {
    expect(skill('specialized', 'acrobatics')).toBe('expert');
    expect(skill('specialized-savage', 'athletics')).toBe('expert');
    expect(skill('specialized-unseen', 'stealth')).toBe('expert');
  });

  it('the alternative advancements carry the boosts the rules give them', () => {
    // Cumulative from young; mature already gave +1 to Str/Dex/Con/Wis.
    // Indomitable: Con +2, Str/Dex/Wis +1  →  str2 dex2 con3 wis2
    expect(COMPANION_FORMULA.maturities.indomitable.abilityBoosts).toEqual({ str: 2, dex: 2, con: 3, wis: 2 });
    // Unseen & genie-touched: Wis +2, Str/Dex/Con +1  →  str2 dex2 con2 wis3
    expect(COMPANION_FORMULA.maturities.unseen.abilityBoosts).toEqual({ str: 2, dex: 2, con: 2, wis: 3 });
    expect(COMPANION_FORMULA.maturities['genie-touched'].abilityBoosts).toEqual({ str: 2, dex: 2, con: 2, wis: 3 });
    // All three deal +3 with unarmed attacks, like savage.
    for (const m of ['indomitable', 'genie-touched', 'unseen'] as const) {
      expect(COMPANION_FORMULA.maturities[m].flatDamage, m).toBe(3);
    }
  });

  it('every maturity is offered and has a formula row', () => {
    for (const m of MATURITIES) expect(COMPANION_FORMULA.maturities[m], m).toBeTruthy();
    // Every advancement that the rules give a non-modellable rider carries a note.
    for (const m of ['indomitable', 'genie-touched', 'unseen'] as const) {
      expect(COMPANION_FORMULA.maturities[m].note, m).toBeTruthy();
    }
  });
});
