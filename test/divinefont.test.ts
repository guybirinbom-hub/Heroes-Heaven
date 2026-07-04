import { describe, it, expect } from 'vitest';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { content, build } from './_content';

const c = content();

describe('Divine Font as a second (heal/harm) prepared list', () => {
  // Cloistered explicitly — the cleric's default subclass option is now Battle Creed (a battle font).
  const ch = build('cleric', 5, { subclassId: 'cloistered-cleric', keyAbility: 'wis', divineFont: 'heal' });
  const entry = ch.spellcasting.find((e) => e.font)!;

  it('the cleric gains a heal/harm font list at the top rank', () => {
    expect(entry).toBeTruthy();
    expect(entry.font!.type).toBe('heal');
    expect(entry.font!.slots).toBeGreaterThanOrEqual(1);
    expect(entry.font!.rank).toBeGreaterThanOrEqual(1);
  });

  // Divine Font (Player Core) is LEVEL-based, not Cha-based: 4 slots, rising to 5 at 5th and 6 at 15th,
  // at your highest rank of cleric spell slots. (Regression: the old code used "1 + Cha modifier".)
  it('grants level-based 4/5/6 font slots at the highest NORMAL spell rank', () => {
    const font = (L: number) =>
      build('cleric', L, { subclassId: 'cloistered-cleric', keyAbility: 'wis', divineFont: 'heal' }).spellcasting.find(
        (e) => e.font,
      )!.font!;
    expect(font(1)).toMatchObject({ slots: 4, rank: 1 });
    expect(font(4)).toMatchObject({ slots: 4, rank: 2 });
    expect(font(5)).toMatchObject({ slots: 5, rank: 3 });
    expect(font(14)).toMatchObject({ slots: 5 });
    expect(font(15)).toMatchObject({ slots: 6, rank: 8 });
    // The 10th-rank slot at L19+ is the Miraculous Spell capstone; the font must sit at the highest
    // NORMAL rank (9), never 10.
    expect(font(19)).toMatchObject({ slots: 6, rank: 9 });
    expect(font(20)).toMatchObject({ slots: 6, rank: 9 });
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
