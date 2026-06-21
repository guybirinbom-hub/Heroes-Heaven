import { describe, it, expect } from 'vitest';
import { heighteningApplies, heightenTrigger, splitHeightening } from '../src/rules/heightening';

describe('heightening parsing', () => {
  it('splits base text from heightening entries', () => {
    const { base, heightening } = splitHeightening(
      'Base effect text. Heightened (+1) More damage. Heightened (3rd) A bonus.',
    );
    expect(base).toBe('Base effect text.');
    expect(heightening).toHaveLength(2);
    expect(heightening[0]).toMatch(/^Heightened \(\+1\)/);
  });

  it('no heightening → empty list', () => {
    expect(splitHeightening('Just an effect.').heightening).toEqual([]);
  });

  it('parses relative and absolute triggers', () => {
    expect(heightenTrigger('Heightened (+1) ...')).toEqual({ type: 'rel', n: 1 });
    expect(heightenTrigger('Heightened (2nd) ...')).toEqual({ type: 'abs', n: 2 });
    expect(heightenTrigger('Heightened (4th) ...')).toEqual({ type: 'abs', n: 4 });
    expect(heightenTrigger('Not a heightening line')).toBeNull();
  });

  it('relative (+1) applies once the cast rank exceeds the base', () => {
    const e = 'Heightened (+1) x';
    expect(heighteningApplies(e, 1, 1)).toBe(false); // at base
    expect(heighteningApplies(e, 1, 2)).toBe(true); // base + 1
    expect(heighteningApplies(e, 3, 3)).toBe(false);
    expect(heighteningApplies(e, 3, 4)).toBe(true);
  });

  it('absolute (Nth) applies at cast rank N or higher', () => {
    const e = 'Heightened (3rd) y';
    expect(heighteningApplies(e, 1, 2)).toBe(false);
    expect(heighteningApplies(e, 1, 3)).toBe(true);
    expect(heighteningApplies(e, 1, 5)).toBe(true);
  });
});
