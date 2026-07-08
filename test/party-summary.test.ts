import { describe, it, expect } from 'vitest';
import { computeSummary } from '../src/sheet/partySummary';
import type { Character, ContentDatabase } from '../src/rules/types';

// computeSummary is the small card payload every owner computes at publish time; it MUST never throw the
// publish/sync path (the derive calls are wrapped in try/catch with fallbacks). These tests pin that
// defensive contract + the field mapping, without needing a fully-built character.

const content = {
  ancestries: { elf: { name: 'Elf' } },
  classes: { wizard: { name: 'Wizard' } },
  conditions: { frightened: { name: 'Frightened' } },
} as unknown as ContentDatabase;

const char = (over: Record<string, unknown> = {}): Character => ({ name: 'X', level: 1, ...over }) as unknown as Character;

describe('computeSummary', () => {
  it('never throws on a degenerate character/content and returns sane defaults', () => {
    const s = computeSummary({} as Character, {} as ContentDatabase);
    expect(s.name).toBe('Unnamed');
    expect(s.level).toBe(0);
    expect(s.ac).toBe(10);
    expect(s.perception).toBe(0);
    expect(s.conditions).toEqual([]);
    expect(s.modes).toEqual([]);
    expect(typeof s.hpMax).toBe('number');
  });

  it('resolves ancestry/class names from content (and leaves them undefined when absent)', () => {
    const s = computeSummary(char({ ancestryId: 'elf', classId: 'wizard' }), content);
    expect(s.ancestry).toBe('Elf');
    expect(s.className).toBe('Wizard');
    expect(computeSummary(char({}), content).ancestry).toBeUndefined();
  });

  it('maps conditions (content name, else capitalized id), non-empty modes, temp HP, portrait', () => {
    const s = computeSummary(
      char({
        hitPoints: { current: 12, temp: 3 },
        conditions: [{ id: 'frightened', value: 2 }, { id: 'my-custom' }],
        activeModes: [{ name: 'Rage' }, { name: '' }],
        appearance: { portrait: 'data:img' },
      }),
      content,
    );
    expect(s.hpCur).toBe(12);
    expect(s.hpTemp).toBe(3);
    expect(s.conditions).toEqual([
      { name: 'Frightened', value: 2 },
      { name: 'My-custom', value: undefined },
    ]);
    expect(s.modes).toEqual(['Rage']); // the empty-name mode is filtered out
    expect(s.portrait).toBe('data:img');
  });

  it('falls hpCur back to hpMax when hitPoints is absent', () => {
    const s = computeSummary(char({}), content);
    expect(s.hpCur).toBe(s.hpMax);
    expect(s.hpTemp).toBeUndefined();
  });
});
