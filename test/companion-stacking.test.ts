/*
 * Companion numbers follow the PF2e stacking rule: of each type (status, circumstance, item) only the
 * best bonus and the worst penalty count; untyped modifiers add. A companion's conditions, its modes, its
 * gear and — for a familiar or eidolon — the master's own live number all feed ONE pool (`poolTypedMods`),
 * so a frightened master with a frightened familiar gives the familiar −1 Will, not −2.
 *
 * Every case below failed on the old code — except the "no change from before" control, which must pass
 * on both — because the old code summed `conditionPenalty(...) + modeNumberBonus(...)` side by side (and
 * the gear's item bonus on top) instead of pooling them.
 */
import { describe, it, expect } from 'vitest';
import { deriveAnimalCompanion, deriveEidolon, deriveFamiliar } from '../src/rules/companions';
import { content, build } from './_content';
import type { ActiveCondition, Character, CompanionConfig, ModeDef } from '../src/rules/types';

const c = content();
const wolf = c.animalCompanions.wolf;
const mode = (id: string, modifiers: ModeDef['modifiers']): ModeDef => ({ id, name: id, modifiers });
const animal = (conds: ActiveCondition[] = [], modes: ModeDef[] = [], inventory: CompanionConfig['inventory'] = []) =>
  deriveAnimalCompanion({ id: 'a', kind: 'animal', name: '', typeId: 'wolf', maturity: 'mature', inventory }, wolf, 4, c, conds, false, modes);
const barding = [{ itemId: 'light-barding', quantity: 1, worn: true }] as CompanionConfig['inventory'];
const withConds = (ch: Character, conditions: ActiveCondition[]): Character => ({ ...ch, conditions });

describe('animal companion: one pool for conditions, modes and gear', () => {
  const base = animal();

  it('two status penalties (frightened 1 + a −1 status mode) count once', () => {
    const b = animal([{ id: 'frightened', value: 1 }], [mode('curse', [{ value: -1, type: 'status', target: 'save', detail: 'will' }])]);
    expect(b.saves.will.modifier).toBe(base.saves.will.modifier - 1);
  });

  it('a status bonus still applies beside the worst status penalty', () => {
    // Heroism +1 status, frightened 2, and a second −1 status: +1 − 2 (the −1 is beaten).
    const b = animal(
      [{ id: 'frightened', value: 2 }],
      [mode('heroism', [{ value: 1, type: 'status', target: 'all-checks' }]), mode('curse', [{ value: -1, type: 'status', target: 'save', detail: 'will' }])],
    );
    expect(b.saves.will.modifier).toBe(base.saves.will.modifier - 1);
  });

  it("barding's item bonus and a mode's item bonus to AC take the higher", () => {
    expect(barding).toBeTruthy();
    const worn = animal([], [], barding);
    expect(worn.ac).toBe(base.ac + 1);
    expect(animal([], [mode('ward', [{ value: 1, type: 'item', target: 'ac' }])], barding).ac).toBe(base.ac + 1);
    expect(animal([], [mode('ward', [{ value: 2, type: 'item', target: 'ac' }])], barding).ac).toBe(base.ac + 2);
  });

  it('an untyped modifier adds beside a pooled typed pair', () => {
    const b = animal([], [mode('ward', [{ value: 2, type: 'item', target: 'ac' }]), mode('flat', [{ value: 1, type: 'untyped', target: 'ac' }])], barding);
    expect(b.ac).toBe(base.ac + 2 + 1);
  });

  it('damage: enfeebled and a status damage penalty count once', () => {
    // A bear: its Jaws are not finesse, so the Strength attack carries Enfeebled to damage.
    const bear = (conds: ActiveCondition[] = [], modes: ModeDef[] = []) =>
      deriveAnimalCompanion({ id: 'b', kind: 'animal', name: '', typeId: 'bear', maturity: 'mature' }, c.animalCompanions.bear, 4, c, conds, false, modes);
    const flat = (d: string) => Number((d.match(/d\d+([+-]\d+)?/) ?? [])[1] ?? 0);
    const b = bear([{ id: 'enfeebled', value: 1 }], [mode('weak', [{ value: -1, type: 'status', target: 'damage' }])]);
    expect(flat(b.attacks[0].damage)).toBe(flat(bear().attacks[0].damage) - 1);
  });
});

describe('familiar: the master’s live number and the familiar’s own modifiers share one pool', () => {
  const ch = build('wizard', 5, { keyAbility: 'int' });
  const fam = (master: Character, conds: ActiveCondition[] = [], modes: ModeDef[] = []) =>
    deriveFamiliar({ id: 'f', kind: 'familiar', name: '' }, master, c, conds, modes);
  const base = fam(ch);

  it('master frightened 1 + familiar frightened 1 → −1, not −2', () => {
    const b = fam(withConds(ch, [{ id: 'frightened', value: 1 }]), [{ id: 'frightened', value: 1 }]);
    expect(b.saves.will).toBe(base.saves.will - 1);
    expect(b.saves.fortitude).toBe(base.saves.fortitude - 1);
    expect(b.perception).toBe(base.perception - 1);
  });

  it('the worst of the two counts: master frightened 2 + familiar frightened 1 → −2', () => {
    const b = fam(withConds(ch, [{ id: 'frightened', value: 2 }]), [{ id: 'frightened', value: 1 }]);
    expect(b.saves.will).toBe(base.saves.will - 2);
  });

  it("the familiar's own status bonus applies beside the master's status penalty", () => {
    const b = fam(withConds(ch, [{ id: 'frightened', value: 1 }]), [{ id: 'frightened', value: 1 }], [mode('heroism', [{ value: 1, type: 'status', target: 'all-checks' }])]);
    expect(b.saves.will).toBe(base.saves.will);
  });

  it("the master's off-guard and the familiar's off-guard count once on AC", () => {
    const b = fam(withConds(ch, [{ id: 'off-guard' }]), [{ id: 'off-guard' }]);
    expect(b.ac).toBe(base.ac - 2);
  });

  it("a master's Tweak that SETS Will: the familiar reads the set value, then one pooled frightened", () => {
    // The familiar's terms join the master's list as 'transient', so they sit on top of the set (never
    // added to the replaced permanent part). Old code: set 20 − master frightened − familiar frightened = 18.
    const set = build('wizard', 5, { keyAbility: 'int', overrides: { blocks: [{ id: 't1', kind: 'number.set', v: 1, target: 'save:will', value: 20 }] } } as never);
    expect(fam(set).saves.will).toBe(20);
    expect(fam(withConds(set, [{ id: 'frightened', value: 1 }]), [{ id: 'frightened', value: 1 }]).saves.will).toBe(19);
  });

  it('a condition only one side has still applies in full (no change from before)', () => {
    expect(fam(ch, [{ id: 'frightened', value: 1 }]).saves.will).toBe(base.saves.will - 1);
    expect(fam(withConds(ch, [{ id: 'frightened', value: 1 }])).saves.will).toBe(base.saves.will - 1);
    // Different types both count: the master's status −1 and the familiar's circumstance −2.
    expect(fam(withConds(ch, [{ id: 'frightened', value: 1 }]), [{ id: 'off-guard' }]).ac).toBe(base.ac - 3);
  });
});

describe('eidolon: same pool for its saves, its own AC and its Strikes', () => {
  const ch = build('summoner', 5, { keyAbility: 'cha' });
  const eid = (master: Character, conds: ActiveCondition[] = [], modes: ModeDef[] = [], acItemBonus?: number) =>
    deriveEidolon({ id: 'e', kind: 'eidolon', name: '', typeId: ch.subclassId ?? undefined, eidolon: { acItemBonus } }, master, c, conds, modes);
  const base = eid(ch);

  it('summoner frightened 1 + eidolon frightened 1 → −1 on its saves', () => {
    const b = eid(withConds(ch, [{ id: 'frightened', value: 1 }]), [{ id: 'frightened', value: 1 }]);
    expect(b.saves.will).toBe(base.saves.will - 1);
  });

  it("the array's item bonus to AC and a mode's item bonus take the higher", () => {
    const withItem = eid(ch, [], [], 2);
    expect(withItem.ac).toBe(base.ac + 2);
    expect(eid(ch, [], [mode('ward', [{ value: 1, type: 'item', target: 'ac' }])], 2).ac).toBe(base.ac + 2);
  });

  it('two status penalties on its attack count once', () => {
    const b = eid(ch, [{ id: 'frightened', value: 1 }], [mode('curse', [{ value: -1, type: 'status', target: 'attack' }])]);
    expect(b.attacks[0].attack).toBe(base.attacks[0].attack - 1);
  });
});
