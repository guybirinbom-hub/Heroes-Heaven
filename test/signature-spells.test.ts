import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveShield } from '../src/rules/derive';
import { signaturesAt, toggleSignature } from '../src/rules/build';

/**
 * Signature spells: one per rank was a storage limit, not a rule.
 *
 * `BuildState.signatures` was `Record<number, string>` while everything downstream already took an
 * array — so Signature Spell Expansion ("two additional signature spells"), Reanimator Dedication
 * ("in addition to your usual") and Ultimate Polymath ("all of the spells in your repertoire are
 * signature spells") were all capped at one per rank.
 */
const db = content();

describe('the stored shape', () => {
  it('still reads a LEGACY bare string — saved characters are never normalized on load', () => {
    // Widening the type without this compiles clean and silently drops every existing pick.
    expect(signaturesAt({ 3: 'fireball' } as never, 3)).toEqual(['fireball']);
  });

  it('reads the array shape', () => {
    expect(signaturesAt({ 3: ['fireball', 'haste'] } as never, 3)).toEqual(['fireball', 'haste']);
  });

  it('is empty for a rank with nothing', () => {
    expect(signaturesAt({}, 3)).toEqual([]);
    expect(signaturesAt(undefined, 3)).toEqual([]);
  });

  it('toggling ADDS rather than replacing — that was the whole bug', () => {
    expect(toggleSignature({ 3: 'fireball' } as never, 3, 'haste')).toEqual({ 3: ['fireball', 'haste'] });
  });

  it('toggling an existing one removes it, and an empty rank disappears', () => {
    expect(toggleSignature({ 3: ['fireball', 'haste'] } as never, 3, 'haste')).toEqual({ 3: ['fireball'] });
    expect(toggleSignature({ 3: ['fireball'] } as never, 3, 'fireball')).toEqual({});
  });
});

describe('the records that make more than one reachable', () => {
  it('several feats grant additional signature spells', () => {
    for (const id of ['signature-spell-expansion', 'ultimate-polymath']) {
      expect(db.feats[id], id).toBeTruthy();
      expect(db.feats[id].description).toMatch(/signature spell/i);
    }
    expect(db.feats['signature-spell-expansion'].description).toMatch(/two additional signature spells/i);
  });
});

describe("Blessed Shield's redundancy clause", () => {
  const champ = (itemId: string, level: number, blessed: boolean) => {
    const c = build('champion', level, {
      deityId: 'iomedae',
      ...(blessed ? { extraChoices: { blessing: ['blessed-shield'] } } : {}),
    });
    return { ...c, inventory: [{ instanceId: 's', itemId, quantity: 1, worn: true, equipped: true }] } as typeof c;
  };

  it('a shield already at the tier gets +1 Hardness INSTEAD of the floor', () => {
    // "If your shield already has the appropriate reinforcing rune for your level … the shield's
    // Hardness instead increases by 1."
    expect(deriveShield(champ('sturdy-shield-supreme', 19, false), db)!.hardness).toBe(20);
    expect(deriveShield(champ('sturdy-shield-supreme', 19, true), db)!.hardness).toBe(21);
  });

  it('a shield that matches on Hardness but NOT on HP gets neither', () => {
    // warding-escutcheon-greater is hardness 20 with only 80 HP — it does not "already have" the
    // supreme rune, so the +1 must not apply, and its own stats already beat the floor.
    expect(deriveShield(champ('warding-escutcheon-greater', 19, true), db)!.hardness).toBe(20);
  });

  it('the two clauses are exclusive — a plain shield gets the floor and no +1', () => {
    const plainShield = Object.entries(db.items).find(([, i]) => i.itemType === 'shield' && (i.hardness ?? 0) <= 5)![0];
    expect(deriveShield(champ(plainShield, 3, true), db)!.hardness).toBe(8);
  });
});
