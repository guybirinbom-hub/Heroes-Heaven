import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { isActionCost } from '../src/sheet/widgets';

/**
 * Feats that ARE actions must say so, or a player never finds them.
 *
 * The encounter action list is built from records whose own `actionCost` is 1–3 actions, a reaction
 * or a free action. 58 feats that are actions were stored as `passive` — Endure Death's Touch is a
 * Reaction, Educated Assessment a Single Action, Banishing Blow a Free Action — so they existed on
 * the sheet and nowhere a player would look for something to do on their turn.
 */
const c = () => content();

describe('feat action costs', () => {
  it.each([
    ['endure-deaths-touch', 'reaction'],
    ['reflexive-catch', 'reaction'],
    ['banishing-blow', 'free'],
    ['educated-assessment', 1],
    ['blood-frenzy', 1],
    ['merciless-rend', 1],
    ['mercy', 1],
    ['cruelty', 1],
  ])('%s costs %s', (id, cost) => {
    const a = c().feats[id as string]?.actionCost;
    expect(a, id as string).toBeTruthy();
    expect(a!.type === 'actions' ? a!.value : a!.type).toBe(cost);
  });

  it('the corrected counts match their remaster printing', () => {
    // Forestall Curse became a Free Action in the Remaster and was still a Single Action here.
    expect(c().feats['forestall-curse'].actionCost).toEqual({ type: 'free' });
    expect(c().feats['dominion-aura'].actionCost).toEqual({ type: 'actions', value: 1 });
    expect(c().feats['whirlwind-toss'].actionCost).toEqual({ type: 'actions', value: 2 });
    expect(c().feats['throw-and-catch'].actionCost).toEqual({ type: 'actions', value: 2 });
  });

  it('each corrected feat now qualifies for the encounter action list', () => {
    // isActionCost is the gate MainTab uses; a passive record never passes it.
    for (const id of ['endure-deaths-touch', 'banishing-blow', 'educated-assessment', 'forestall-curse']) {
      expect(isActionCost(c().feats[id].actionCost), id).toBe(true);
    }
  });
});

describe('spell areas', () => {
  it('follow the remaster printing where the two editions differ', () => {
    // Door to Beyond was a 20-foot emanation in Gods & Magic and is a 20-foot burst in Divine
    // Mysteries; Distortion Lens went from "one 5-foot square" to a 5-foot burst.
    expect(c().spells['door-to-beyond'].baseArea).toEqual({ value: 20, kind: 'burst' });
    expect(c().spells['distortion-lens'].baseArea).toEqual({ value: 5, kind: 'burst' });
    expect(c().spells['rainbows-end'].baseArea).toEqual({ value: 10, kind: 'emanation' });
    // …and the display string agrees with the structured value.
    for (const id of ['door-to-beyond', 'distortion-lens', 'rainbows-end']) {
      const s = c().spells[id];
      expect(s.area, id).toBe(`${s.baseArea!.value}-foot ${s.baseArea!.kind}`);
    }
  });
});
