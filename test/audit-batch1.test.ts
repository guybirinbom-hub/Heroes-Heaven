import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scaleDamage } from '../src/rules/heightening';
import { conditionPenalty } from '../src/rules/conditions';
import { emptyPlay, playForRebuild, type PlayState } from '../src/rules/play';
import type { ActiveCondition, Spell } from '../src/rules/types';

// A cantrip: rank 0 in the data, damage listed at its rank-1 baseline, +1d4 per rank above 1st.
const cantrip = () =>
  ({ rank: 0, baseDamage: '2d4', heightening: { type: 'interval', interval: 1, damageIncr: '1d4' } }) as unknown as Spell;

describe('cantrip heightening scales from rank 1, not rank 0 (off-by-one fix)', () => {
  it('a rank-0 cantrip adds one die per rank ABOVE the 1st', () => {
    const c = cantrip();
    expect(scaleDamage(c, 1)).toBeNull(); // cast at rank 1 = base damage, no change
    expect(scaleDamage(c, 2)).toBe('3d4'); // +1 step
    expect(scaleDamage(c, 3)).toBe('4d4'); // +2 steps (regression: used to be 5d4)
    expect(scaleDamage(c, 4)).toBe('5d4');
  });
  it('a leveled spell (base rank >= 1) is unaffected by the fix', () => {
    const fireball = { rank: 3, baseDamage: '6d6', heightening: { type: 'interval', interval: 1, damageIncr: '2d6' } } as unknown as Spell;
    expect(scaleDamage(fireball, 3)).toBeNull();
    expect(scaleDamage(fireball, 5)).toBe('10d6'); // +2 steps
  });
});

describe('off-guard AC from prone / restrained / grabbed', () => {
  const acPenalty = (id: string) => conditionPenalty([{ id } as ActiveCondition], 'dex', 'ac');
  it('each of off-guard / prone / restrained / grabbed gives -2 circumstance AC', () => {
    expect(acPenalty('off-guard')).toBe(-2);
    expect(acPenalty('prone')).toBe(-2);
    expect(acPenalty('restrained')).toBe(-2);
    expect(acPenalty('grabbed')).toBe(-2);
  });
  it('prone still penalizes the prone creature\'s own attacks by -2', () => {
    expect(conditionPenalty([{ id: 'prone' } as ActiveCondition], 'str', 'attack')).toBe(-2);
  });
  it('off-guard + prone do not stack (same circumstance type -> worst only)', () => {
    expect(conditionPenalty([{ id: 'off-guard' } as ActiveCondition, { id: 'prone' } as ActiveCondition], 'dex', 'ac')).toBe(-2);
  });
});

describe('playForRebuild keeps the player\'s inventory + currency across a build edit', () => {
  it('preserves in-play gear and gold', () => {
    const play = {
      ...emptyPlay(),
      inventory: [{ instanceId: 'a', itemId: 'longsword', quantity: 1 }],
      currency: { pp: 0, gp: 42, sp: 3, cp: 0 },
    } as PlayState;
    const out = playForRebuild(play);
    expect(out.inventory).toEqual(play.inventory);
    expect(out.currency).toEqual(play.currency);
  });
  it('leaves them undefined for a character that never managed inventory (so the build gear reseeds)', () => {
    const out = playForRebuild({ ...emptyPlay(), inventory: undefined, currency: undefined } as PlayState);
    expect(out.inventory).toBeUndefined();
    expect(out.currency).toBeUndefined();
  });
});

describe('content data regen', () => {
  const db = JSON.parse(readFileSync(new URL('../public/core.json', import.meta.url), 'utf8'));
  it('no ancestry is a broken 0-HP stub (the 18 versatile heritages are no longer duplicated as ancestries)', () => {
    const bad = Object.entries(db.ancestries as Record<string, { hp?: number }>).filter(([, a]) => !(a.hp && a.hp > 0));
    expect(bad.map(([id]) => id)).toEqual([]);
  });
});
