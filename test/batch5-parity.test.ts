import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_RANK_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Records the Wanderer's Guide parity pass found broken in batch 5. Each assertion is the printed
 * clause that was doing nothing before.
 */

describe('Dongun Education — the picker that granted nothing', () => {
  /* "Pick TWO of the following Lore skills: Engineering, Explosive, or Firearm. At 2nd level you gain
   * EXPERT proficiency in these Lore skills; at 7th, MASTER; and at 15th, LEGENDARY."
   * The record shipped the three paired options and NO grants, so neither Lore was ever trained. */
  const dongun = (level: number, pick = 'engineering-explosive') =>
    build('fighter', level, {
      featPicks: { '1:ancestry': 'dongun-education' } as BuildState['featPicks'],
      featChoices: { '1:ancestry': pick } as BuildState['featChoices'],
    });

  it('trains both Lores of the chosen pair, and neither of the third', () => {
    const s = dongun(1).proficiencies.skills;
    expect(s['lore:engineering']).toBe('trained');
    expect(s['lore:explosive']).toBe('trained');
    expect(s['lore:firearm'] ?? 'untrained').toBe('untrained');
  });

  it('honours the other two pairings', () => {
    expect(dongun(1, 'explosive-firearm').proficiencies.skills['lore:firearm']).toBe('trained');
    expect(dongun(1, 'engineering-firearm').proficiencies.skills['lore:engineering']).toBe('trained');
  });

  it('climbs the printed ladder: expert at 2nd, master at 7th, legendary at 15th', () => {
    expect(dongun(1).proficiencies.skills['lore:engineering']).toBe('trained');
    expect(dongun(2).proficiencies.skills['lore:engineering']).toBe('expert');
    expect(dongun(7).proficiencies.skills['lore:engineering']).toBe('master');
    expect(dongun(15).proficiencies.skills['lore:engineering']).toBe('legendary');
  });
});

describe('Raging Intimidation — two feats behind two different gates', () => {
  /* "As soon as you meet the PREREQUISITES for the skill feats Intimidating Glare and Scare to Death,
   * you gain these feats." Glare needs trained Intimidation; Scare to Death needs LEGENDARY. The
   * record shipped a flat unconditional grant of the Glare alone. */
  const barb = (level: number, over: Partial<BuildState> = {}) =>
    build('barbarian', level, { featPicks: { '1:class': 'raging-intimidation' } as BuildState['featPicks'], ...over });

  it('is gated on Intimidation rank, not granted flat', () => {
    expect(db.feats['raging-intimidation'].grantsFeats, 'the unconditional grant must be gone').toBeUndefined();
    expect(FEAT_RANK_FEAT_GRANTS['raging-intimidation']?.map((r) => [r.skill, r.rank, r.feat])).toEqual([
      ['intimidation', 'trained', 'intimidating-glare'],
      ['intimidation', 'legendary', 'scare-to-death'],
    ]);
  });

  it('grants Intimidating Glare to a barbarian trained in Intimidation', () => {
    const ch = barb(1, { overrides: { proficiencies: { intimidation: 'trained' } } } as Partial<BuildState>);
    expect(ch.feats.map((f) => f.featId)).toContain('intimidating-glare');
  });

  it('withholds Scare to Death until Intimidation is legendary', () => {
    const trained = barb(1, { overrides: { proficiencies: { intimidation: 'trained' } } } as Partial<BuildState>);
    expect(trained.feats.map((f) => f.featId)).not.toContain('scare-to-death');
    const legendary = barb(15, { overrides: { proficiencies: { intimidation: 'legendary' } } } as Partial<BuildState>);
    expect(legendary.feats.map((f) => f.featId)).toContain('scare-to-death');
  });
});

describe('the rest of batch 5, authored from the printed text', () => {
  it("Sanctified Soul grants the trait its choice names", () => {
    const g = (db.feats['sanctified-soul'] as { grantsCreatureTraitFromChoice?: Record<string, string> }).grantsCreatureTraitFromChoice;
    expect(g).toEqual({ holy: 'holy', unholy: 'unholy' });
  });

  it('Read Psychometric Resonance grants its action', () => {
    expect(db.feats['read-psychometric-resonance'].grantsActions).toEqual(['psychometric-assessment']);
    expect(db.actions['psychometric-assessment'], 'the action must ship').toBeTruthy();
  });

  it("Pilgrim's Token grants the wooden religious symbol it gives you", () => {
    expect(db.feats['pilgrims-token'].grantsItems).toEqual([{ itemId: 'religious-symbol-wooden' }]);
    expect(db.items['religious-symbol-wooden'], 'the item must ship').toBeTruthy();
  });

  /* The wood-kineticist twin of Metal Carapace, and equally unbuilt: AC +3, Dex cap +2, check -2,
   * Speed -5, Str +2, Bulk 1, group wood — plus the wooden shield it creates. */
  it('Hardwood Armor creates both items, with the printed statistics', () => {
    expect(db.feats['hardwood-armor'].grantsItems?.map((g) => g.itemId)).toEqual(['hardwood-armor-armor', 'hardwood-armor-shield']);
    const a = db.items['hardwood-armor-armor'];
    expect([a.acBonus, a.dexCap, a.checkPenalty, a.speedPenalty, a.strength, a.bulk, a.group, a.category])
      .toEqual([3, 2, -2, -5, 2, 1, 'wood', 'medium']);
    const s = db.items['hardwood-armor-shield'];
    const wooden = db.items['wooden-shield'];
    expect([s.acBonus, s.hardness, s.hp]).toEqual([wooden.acBonus, wooden.hardness, wooden.hp]);
  });

  /* "…weapons with the JOTUNBORN TRAIT plus the bola, greataxe, halberd, maul, LONGSPEAR, and war
   * flail." The trait and the longspear were both absent. */
  it('Jotunborn Weapon Familiarity names all six weapons and the trait', () => {
    const wf = FEAT_GRANTS['jotunborn-weapon-familiarity']?.weaponFamiliarity;
    const one = Array.isArray(wf) ? wf[0] : wf;
    expect([...(one?.weapons ?? [])].sort()).toEqual(['bola', 'greataxe', 'halberd', 'longspear', 'maul', 'war-flail']);
    expect(one?.traits).toEqual(['jotunborn']);
  });

  it('Monastic Weaponry names the monk trait, not only the enumeration', () => {
    const wf = FEAT_GRANTS['monastic-weaponry']?.weaponFamiliarity;
    const one = Array.isArray(wf) ? wf[0] : wf;
    expect(one?.traits).toContain('monk');
    expect((one?.weapons ?? []).length).toBeGreaterThan(50);
  });

  it('Rivethun Disciple carries BOTH condition clauses', () => {
    const sit = (db.feats['rivethun-disciple'] as { situational?: { targets: { detail?: string }[]; when: string }[] }).situational ?? [];
    expect(sit).toHaveLength(2);
    expect(sit[0].when).toMatch(/clumsy/);
    expect(sit[1].when).toMatch(/immobilized/);
    expect(sit[1].targets.map((t) => t.detail).sort()).toEqual(['athletics', 'stealth', 'thievery']);
  });
});
