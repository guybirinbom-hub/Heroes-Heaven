import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { heighteningApplies, heightenTrigger, splitHeightening, addDice, scaleDamage, scaleArea } from '../src/rules/heightening';

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

  // Regression: the real importer emits "**Heightened (Nth)**" bold labels with a "---" divider; a
  // bad split sheared "**Heightened" into orphan "*" fragments that rendered as stray asterisks.
  it('keeps the "**Heightened (Nth)**" bold label intact (no orphan asterisks)', () => {
    const { base, heightening } = splitHeightening(
      'Base effect text.\n\n---\n\n**Heightened (3rd)** You learn more.\n\n**Heightened (4th)** As 3rd, but better.',
    );
    expect(base).toBe('Base effect text.');
    expect(heightening).toEqual([
      '**Heightened (3rd)** You learn more.',
      '**Heightened (4th)** As 3rd, but better.',
    ]);
    expect(heightening.some((h) => /^\*+$/.test(h.trim()))).toBe(false);
    expect(heightenTrigger('**Heightened (3rd)** text')).toEqual({ type: 'abs', n: 3 });
    expect(heightenTrigger('**Heightened (+1)** text')).toEqual({ type: 'rel', n: 1 });
  });
});

describe('upcast value computation', () => {
  it('adds dice formulas correctly', () => {
    expect(addDice('6d6', '2d6', 2)).toBe('10d6');
    expect(addDice('1d10+4', '1d10+4', 2)).toBe('3d10+12');
    expect(addDice('3d8', '1d8', 1)).toBe('4d8');
    expect(addDice('6d6', '2d6', 0)).toBe('6d6'); // base rank → unchanged
    expect(addDice('1d6', '1d4', 2)).toBe('1d6 + 2d4'); // mixed die sizes concat
  });

  it('scales real spells from the imported data', () => {
    const db = content();
    const fireball = db.spells.fireball;
    expect(fireball.baseDamage).toBe('6d6');
    expect(scaleDamage(fireball, fireball.rank)).toBeNull(); // at base rank, no arrow
    expect(scaleDamage(fireball, fireball.rank + 2)).toBe('10d6'); // +2 ranks × 2d6
    const ward = db.spells['establish-ward'];
    expect(scaleArea(ward, ward.rank + 2)).toBe(ward.baseArea!.value + 5); // interval 2 → 1 step × 5 ft
    expect(scaleArea(ward, ward.rank)).toBeNull();
  });
});

describe('every real spell heightening entry is well-formed (guards the renderer)', () => {
  it('no entry is an orphan asterisk fragment; each starts with its label', () => {
    const db = content();
    const offenders: string[] = [];
    let entries = 0;
    for (const [id, s] of Object.entries(db.spells)) {
      for (const h of splitHeightening((s as { description?: string }).description ?? '').heightening) {
        entries++;
        if (!/^\*{0,2}Heightened\s*\(/.test(h)) offenders.push(`${id}: ${JSON.stringify(h.slice(0, 24))}`);
      }
    }
    expect(entries).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
