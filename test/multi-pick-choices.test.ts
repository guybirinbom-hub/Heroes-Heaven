import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { choiceKeys, choiceOptionsFor } from '../src/rules/build';
import { openChoiceOptions } from '../src/rules/openChoice';
import type { FeatChoiceDef } from '../src/rules/types';

const c = content();

/**
 * MULTI-PICK CHOICES.
 *
 * FeatChoiceDef held ONE answer, so "choose two DIFFERENT terrains" would have been stored as a
 * single pick — quietly halving the feat. `picks` fans the answer out to `<slotKey>#<i>`, and
 * `distinct` makes each picker hide what the others took.
 */
describe('multi-pick choices', () => {
  const def = (picks?: number, distinct?: boolean) => ({ flag: 'f', prompt: 'p', kind: 'array', picks, distinct }) as FeatChoiceDef;

  it('a single pick keeps the BARE slot key, so old characters are untouched', () => {
    expect(choiceKeys('3:class:0', def())).toEqual(['3:class:0']);
    expect(choiceKeys('3:class:0', def(1))).toEqual(['3:class:0']);
    expect(choiceKeys('3:class:0', undefined)).toEqual(['3:class:0']);
  });

  it('multiple picks fan out per index', () => {
    expect(choiceKeys('3:class:0', def(3))).toEqual(['3:class:0#0', '3:class:0#1', '3:class:0#2']);
  });

  it('a nonsense pick count cannot produce zero pickers', () => {
    expect(choiceKeys('k', def(0))).toEqual(['k']);
    expect(choiceKeys('k', def(-2))).toEqual(['k']);
  });

  it('distinct hides the OTHER picks answers, never your own', () => {
    const opts = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
    // Picker 0 keeps 'a' (its own answer) and loses 'b' (taken by picker 1).
    expect(choiceOptionsFor(opts, def(2, true), ['a', 'b'], 0).map((o) => o.value)).toEqual(['a', 'c']);
    expect(choiceOptionsFor(opts, def(2, true), ['a', 'b'], 1).map((o) => o.value)).toEqual(['b', 'c']);
  });

  it('without distinct, every option stays available', () => {
    const opts = [{ value: 'a' }, { value: 'b' }];
    expect(choiceOptionsFor(opts, def(2), ['a', 'a'], 0)).toHaveLength(2);
  });

  it('the shipped multi-pick records ask for fewer picks than they offer options', () => {
    const multi = Object.entries(c.feats).filter(([, f]) => (f.choice?.picks ?? 1) > 1);
    expect(multi.length).toBeGreaterThanOrEqual(3);
    for (const [id, f] of multi) {
      const def = f.choice!;
      const picks = def.picks!;
      // `own-*` sources resolve against the CHARACTER, so they are legitimately empty here — Fuse
      // Stance offers the stances YOU know, which is nothing until you know some.
      if (def.kind === 'open' && String(def.from?.type ?? '').startsWith('own-')) continue;
      // A 'text' pick is the player TYPING, so it has no option list by definition and counting one
      // is meaningless. Talisman Esoterica asks for two typed talisman names: openChoice has no
      // generic item source, and "a talisman whose formula you know" is not expressible as a filter,
      // so free text is the honest shape rather than a missing list.
      if (def.kind === 'text') continue;
      // An 'open' choice has no static list — its options resolve from `from` at render time, so
      // reading def.options would wrongly count zero.
      const opts = def.kind === 'open' ? openChoiceOptions(def.from, c).length : def.options?.length ?? 0;
      // Picking 3 of 2 is unsatisfiable, and with `distinct` it dead-ends the builder.
      expect(opts, `${id} offers ${opts} options for ${picks} picks`).toBeGreaterThan(picks);
    }
  });

  it('Mental Forge picks two distinct traits from its five', () => {
    const ch = c.feats['mental-forge']?.choice;
    expect(ch?.picks).toBe(2);
    expect(ch?.distinct).toBe(true);
    expect(ch?.options?.map((o) => o.value)).toEqual(['grapple', 'modular', 'nonlethal', 'shove', 'trip']);
  });
});
