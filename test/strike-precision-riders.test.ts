import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike, deriveStrikes } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

const c = content();
const fist = (ch: Character) => deriveStrikes(ch, c).find((s) => s.instanceId === 'fist')!;
const strikeOf = (ch: Character, itemId: string) => deriveStrike(ch, c, { instanceId: 'w', itemId, quantity: 1, equipped: true })!;

describe('Rogue Thief racket: Dexterity to damage (thief.json melee-strike-damage, item:trait:finesse)', () => {
  it('a Dex18/Str10 thief with a finesse melee weapon adds Dex to damage', () => {
    const base = build('rogue', 1, { subclassId: 'thief' });
    const ch: Character = {
      ...base,
      abilities: { ...base.abilities, str: 10, dex: 18 },
      inventory: [...base.inventory, { instanceId: 'rap', itemId: 'rapier', quantity: 1, equipped: true }],
    };
    const s = deriveStrikes(ch, c).find((x) => x.instanceId === 'rap')!; // finesse d6
    expect(s.dmgAbility).toBe('dex');
    expect(s.dmgAbMod).toBe(4); // Dex +4, not Str +0
    expect(s.damage).toMatch(/^1d6\+4 /);
    // breakdown mirrors the sheet
    const bd = explainStat(ch, c, { kind: 'strikeDamage', instanceId: 'rap' });
    expect(bd.parts.find((p) => p.label === 'Dexterity modifier')?.value).toBe(4);
  });

  it('does NOT swap when Str is higher, and NOT for a non-thief rogue', () => {
    const base = build('rogue', 1, { subclassId: 'thief' });
    const strThief = { ...base, abilities: { ...base.abilities, str: 18, dex: 14 } };
    expect(strikeOf(strThief, 'rapier').dmgAbility).toBe('str'); // Str18 > Dex14

    const scoundrel = build('rogue', 1, { subclassId: 'scoundrel' });
    const dexScoundrel = { ...scoundrel, abilities: { ...scoundrel.abilities, str: 10, dex: 18 } };
    expect(strikeOf(dexScoundrel, 'rapier').dmgAbility).toBe('str'); // no thief racket → Str only
  });

  it('does NOT apply to a non-finesse or ranged weapon', () => {
    const base = build('rogue', 1, { subclassId: 'thief' });
    const ch = { ...base, abilities: { ...base.abilities, str: 10, dex: 18 } };
    expect(strikeOf(ch, 'longsword').dmgAbility).toBe('str'); // longsword is not finesse
  });
});

describe('Monk Powerful Fist (powerful-fist.json): Fist die upgrades to 1d6 and loses nonlethal', () => {
  it('a level-1 monk fist is 1d6, not 1d4, and not nonlethal', () => {
    const monk = build('monk', 1);
    const f = fist(monk);
    expect(f.damage).toMatch(/^1d6/);
    expect(f.traits).not.toContain('nonlethal');
  });
  it("a non-monk's fist stays 1d4 nonlethal", () => {
    const f = fist(build('fighter', 1));
    expect(f.damage).toMatch(/^1d4/);
    expect(f.traits).toContain('nonlethal');
  });
});

describe('Sneak Attack conditional precision (sneak-attack.json: 1d6 @1, +1 die @5/11/17)', () => {
  const dice = (ch: Character, itemId: string) =>
    strikeOf(ch, itemId).conditionalDamage?.find((r) => r.note.includes('off-guard'))?.text;

  it('adds 1d6 precision (off-guard) with an agile/finesse weapon at L1, scaling by level', () => {
    expect(dice(build('rogue', 1), 'rapier')).toBe('1d6 precision'); // finesse
    expect(dice(build('rogue', 5), 'rapier')).toBe('2d6 precision');
    expect(dice(build('rogue', 11), 'rapier')).toBe('3d6 precision');
    expect(dice(build('rogue', 17), 'rapier')).toBe('4d6 precision');
  });

  it('does not apply to a non-agile/non-finesse melee weapon, and is not in the flat total', () => {
    const s = strikeOf(build('rogue', 5), 'longsword'); // not agile/finesse, melee
    expect(s.conditionalDamage).toBeUndefined();
    // sneak dice never inflate the unconditional dmgBonus
    const rapier = strikeOf(build('rogue', 5), 'rapier');
    expect(rapier.damage).not.toMatch(/^\dd6\+.*precision.*\+/); // riders are a suffix, not folded
  });

  it('the fighter (no Sneak Attack) has no precision rider', () => {
    expect(strikeOf(build('fighter', 5), 'rapier').conditionalDamage).toBeUndefined();
  });
});

describe('Ranger Precision hunters-edge (precision.json: 1d8 @1, 2d8 @11, 3d8 @19)', () => {
  const dice = (ch: Character) =>
    strikeOf(ch, 'longsword').conditionalDamage?.find((r) => r.note.includes('hunted prey'))?.text;

  it('a Precision ranger deals 1d8 precision on the first hit vs hunted prey (any weapon), scaling at 11/19', () => {
    expect(dice(build('ranger', 1, { subclassId: 'precision' }))).toBe('1d8 precision');
    expect(dice(build('ranger', 11, { subclassId: 'precision' }))).toBe('2d8 precision');
    expect(dice(build('ranger', 19, { subclassId: 'precision' }))).toBe('3d8 precision');
  });

  it('a Flurry ranger (no Precision edge) gets no precision rider', () => {
    expect(strikeOf(build('ranger', 5, { subclassId: 'flurry' }), 'longsword').conditionalDamage).toBeUndefined();
  });
});

describe('Kineticist Elemental Blast (elemental-blast.json): 2-action Con status bonus + weapon spec', () => {
  it('adds the Con modifier to blast damage and exposes it as dmgAbMod', () => {
    const l1 = build('kineticist', 1, { extraChoices: { element: ['fire-gate'] }, keyAbility: 'con' });
    const blast = deriveStrikes(l1, c).find((s) => s.instanceId.startsWith('blast:'))!;
    const conMod = Math.floor((l1.abilities.con - 10) / 2);
    expect(blast.dmgAbMod).toBe(Math.max(0, conMod));
    expect(blast.dmgAbility).toBe('con');
    // breakdown reconciles: parts sum to dmgBonus
    const bd = explainStat(l1, c, { kind: 'strikeDamage', instanceId: blast.instanceId });
    const sum = bd.parts.reduce((a, p) => a + p.value, 0);
    expect(sum).toBe(blast.dmgBonus);
  });

  it('level-13 blast sets specDamage AND folds it into dmgBonus so the popup matches', () => {
    const l13 = build('kineticist', 13, { extraChoices: { element: ['fire-gate'] }, keyAbility: 'con' });
    const blast = deriveStrikes(l13, c).find((s) => s.instanceId.startsWith('blast:'))!;
    expect(blast.specDamage).toBe(2); // expert (class DC) weapon specialization
    const bd = explainStat(l13, c, { kind: 'strikeDamage', instanceId: blast.instanceId });
    expect(bd.parts.find((p) => p.label === 'Weapon specialization')?.value).toBe(2);
    const sum = bd.parts.reduce((a, p) => a + p.value, 0);
    expect(sum).toBe(blast.dmgBonus);
  });
});
