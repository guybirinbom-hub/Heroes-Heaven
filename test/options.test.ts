import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { fixedBoosts, deriveBuildFromCharacter, buildCharacter } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { deriveSpeeds } from '../src/rules/derive';
import type { AbilityId } from '../src/rules/types';

describe('character options — Alternate Ancestry Boosts', () => {
  const db = content();
  // An ancestry with at least one fixed boost AND a flaw (e.g. dwarf: +Con +Wis, −Cha).
  const anc = Object.values(db.ancestries).find((a) => a.abilityFlaws.length > 0 && fixedBoosts(a.abilityBoosts).length > 0)!;
  const flaw = anc.abilityFlaws[0] as AbilityId;

  it('removes the ancestry flaw and replaces fixed boosts with two free boosts', () => {
    const std = build('fighter', 1, { keyAbility: 'str', ancestryId: anc.id });
    const alt = build('fighter', 1, {
      keyAbility: 'str',
      ancestryId: anc.id,
      options: { alternateAncestryBoosts: true },
      ancestryBoosts: ['int', 'cha'],
    });
    // the flawed attribute is no longer reduced
    expect(alt.abilities[flaw]).toBeGreaterThan(std.abilities[flaw]);
    // the two chosen free boosts raised Int and Cha
    expect(alt.abilities.int).toBeGreaterThan(std.abilities.int);
  });

  it('round-trips (rebuild from the saved character reproduces the scores)', () => {
    const alt = build('fighter', 1, {
      keyAbility: 'str',
      ancestryId: anc.id,
      options: { alternateAncestryBoosts: true },
      ancestryBoosts: ['int', 'cha'],
    });
    const rt = deriveBuildFromCharacter(alt, db);
    expect(rt.options?.alternateAncestryBoosts).toBe(true);
    const rebuilt = buildCharacter(rt, db);
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) expect(rebuilt.abilities[a], a).toBe(alt.abilities[a]);
  });
});

describe('character options — Voluntary Flaw', () => {
  it('applies an extra attribute flaw (−2 to the chosen attribute)', () => {
    const base = build('fighter', 1, { keyAbility: 'str', ancestryId: null });
    const vf = build('fighter', 1, { keyAbility: 'str', ancestryId: null, options: { voluntaryFlaw: true, voluntaryFlawAbility: 'int' } });
    expect(base.abilities.int - vf.abilities.int).toBe(2);
  });

  it('does nothing until an attribute is chosen', () => {
    const base = build('fighter', 1, { keyAbility: 'str', ancestryId: null });
    const onNoPick = build('fighter', 1, { keyAbility: 'str', ancestryId: null, options: { voluntaryFlaw: true } });
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) expect(onNoPick.abilities[a]).toBe(base.abilities[a]);
  });

  it('round-trips the voluntary flaw', () => {
    const vf = build('fighter', 1, { keyAbility: 'str', ancestryId: null, options: { voluntaryFlaw: true, voluntaryFlawAbility: 'cha' } });
    const rt = deriveBuildFromCharacter(vf, content());
    expect(rt.options?.voluntaryFlaw).toBe(true);
    expect(rt.options?.voluntaryFlawAbility).toBe('cha');
    expect(buildCharacter(rt, content()).abilities.cha).toBe(vf.abilities.cha);
  });
});

describe('encumbered from over-Bulk', () => {
  const db = content();
  const heavy = Object.values(db.items).find((i) => (i.bulk ?? 0) >= 2)!;
  const overInv = [{ itemId: heavy.id, quantity: 20, worn: false, equipped: false, instanceId: 'h1' }];

  it('adds the Encumbered condition + −10 Speed when carrying over the Bulk limit', () => {
    const ch = build('fighter', 1, { keyAbility: 'str', inventory: overInv });
    const applied = applyPlayState(ch, initialPlay(ch, db), db);
    expect(applied.conditions.some((c) => c.id === 'encumbered')).toBe(true);
    const baseSpeed = deriveSpeeds(build('fighter', 1, { keyAbility: 'str' }), db).land ?? 0;
    expect(deriveSpeeds(applied, db).land).toBe(baseSpeed - 10);
  });

  it('"Ignore Bulk Limit" option suppresses the Encumbered condition', () => {
    const ch = build('fighter', 1, { keyAbility: 'str', inventory: overInv, options: { ignoreBulk: true } });
    const applied = applyPlayState(ch, initialPlay(ch, db), db);
    expect(applied.conditions.some((c) => c.id === 'encumbered')).toBe(false);
  });

  it('no Encumbered when within the Bulk limit', () => {
    const ch = build('fighter', 1, { keyAbility: 'str' });
    const applied = applyPlayState(ch, initialPlay(ch, db), db);
    expect(applied.conditions.some((c) => c.id === 'encumbered')).toBe(false);
  });
});
