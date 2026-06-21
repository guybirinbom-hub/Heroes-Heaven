import { describe, it, expect } from 'vitest';
import { duplicateChar, type SavedChar } from '../src/data/storage';
import { build } from './_content';

describe('duplicateChar', () => {
  const original: SavedChar = {
    id: 'c-orig',
    character: build('fighter', 3),
    build: undefined,
    play: { damage: 5, tempHp: 0, heroPoints: 0, xp: 100, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [] },
    archived: true,
  };

  it('gives a fresh roster id, a "(Copy)" name, and clears the archived flag', () => {
    const copy = duplicateChar(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.character.name).toBe(`${original.character.name} (Copy)`);
    expect(copy.archived).toBe(false);
  });

  it('is a deep copy — mutating the copy does not affect the original', () => {
    const copy = duplicateChar(original);
    copy.play!.xp = 999;
    expect(original.play!.xp).toBe(100);
    expect(copy.play!.damage).toBe(5); // other play state carried over
  });
});
