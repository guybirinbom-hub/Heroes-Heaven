import { describe, it, expect } from 'vitest';
import { signatureEchoIds } from '../src/sheet/SpellsTab';
import type { SpellcastingEntry } from '../src/rules/types';

// Minimal spontaneous entry: 'fear' is a rank-1 signature; 'heal' is repertoired at rank 1 but NOT
// signature. Slots exist at ranks 1–3. baseRank() maps spell id -> its base rank.
const baseRanks: Record<string, number> = { fear: 1, heal: 1, fireball: 3, daze: 0 };
const baseRank = (id: string) => baseRanks[id] ?? 0;

const entry = {
  id: 'bard-casting',
  type: 'spontaneous',
  repertoire: { 0: ['daze'], 1: ['fear', 'heal'], 2: [], 3: ['fireball'] },
  signature: ['fear'],
  slots: { 1: { max: 4, used: 0 }, 2: { max: 4, used: 0 }, 3: { max: 3, used: 0 } },
} as unknown as SpellcastingEntry;

describe('signatureEchoIds', () => {
  it('echoes a rank-1 signature at every higher rank that has a slot pool', () => {
    expect(signatureEchoIds(entry, 2, baseRank)).toEqual(['fear']);
    expect(signatureEchoIds(entry, 3, baseRank)).toEqual(['fear']);
  });

  it('does NOT echo at the base rank (it is already shown there) or at cantrip rank 0', () => {
    expect(signatureEchoIds(entry, 1, baseRank)).toEqual([]);
    expect(signatureEchoIds(entry, 0, baseRank)).toEqual([]);
  });

  it('does not echo into a rank with no slot pool', () => {
    const noSlots = { ...entry, slots: { 1: { max: 4, used: 0 } } } as unknown as SpellcastingEntry;
    expect(signatureEchoIds(noSlots, 2, baseRank)).toEqual([]);
  });

  it('skips a signature spell already repertoired at that rank (no duplicate)', () => {
    const dup = { ...entry, repertoire: { ...entry.repertoire, 2: ['fear'] } } as unknown as SpellcastingEntry;
    expect(signatureEchoIds(dup, 2, baseRank)).toEqual([]);
  });

  it('non-signature repertoire spells never echo', () => {
    // 'heal' is repertoired at rank 1 but not in signature -> never appears as an echo.
    for (const r of [2, 3]) expect(signatureEchoIds(entry, r, baseRank)).not.toContain('heal');
  });
});
