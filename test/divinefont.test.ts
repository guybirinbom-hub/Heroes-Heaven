import { describe, it, expect } from 'vitest';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { content, build } from './_content';

const c = content();

describe('Divine Font as a second (heal/harm) prepared list', () => {
  // Cloistered explicitly — the cleric's default subclass option is now Battle Creed (a battle font).
  const ch = build('cleric', 5, { subclassId: 'cloistered-cleric', keyAbility: 'wis', divineFont: 'heal' });
  const entry = ch.spellcasting.find((e) => e.font)!;

  it('the cleric gains a heal/harm font list (1 + Cha slots) at the top rank', () => {
    expect(entry).toBeTruthy();
    expect(entry.font!.type).toBe('heal');
    expect(entry.font!.slots).toBeGreaterThanOrEqual(1);
    expect(entry.font!.rank).toBeGreaterThanOrEqual(1);
  });

  it('font slots track expended via play-state, overlaid by applyPlayState', () => {
    const key = `${entry.id}:font:0`;
    const play = { ...initialPlay(ch, c), expendedSlots: { [key]: true } };
    const fe = applyPlayState(ch, play, c).spellcasting.find((e) => e.id === entry.id);
    expect(fe?.font?.expended?.[0]).toBe(true);
    expect(fe?.font?.expended?.[1] ?? false).toBe(false);
  });

  it('a cloistered cleric with no font choice has no font list', () => {
    expect(
      build('cleric', 5, { subclassId: 'cloistered-cleric', keyAbility: 'wis' }).spellcasting.find((e) => e.font),
    ).toBeUndefined();
  });
});
