import { describe, it, expect } from 'vitest';
import { signatureEchoIds } from '../src/rules/spellOptions';
import type { SpellcastingEntry } from '../src/rules/types';

// Minimal spontaneous entry: 'fear' is a signature filed at rank 1; 'heal' is repertoired at rank 1
// but NOT signature. Slots exist at ranks 1–3. The echo's base rank is where the REPERTOIRE files the
// spell, not the spell's own rank in the content database (R2), so there is nothing to pass in.
const entry = {
  id: 'bard-casting',
  type: 'spontaneous',
  repertoire: { 0: ['daze'], 1: ['fear', 'heal'], 2: [], 3: ['fireball'] },
  signature: ['fear'],
  slots: { 1: { max: 4, used: 0 }, 2: { max: 4, used: 0 }, 3: { max: 3, used: 0 } },
} as unknown as SpellcastingEntry;

describe('signatureEchoIds', () => {
  it('echoes a rank-1 signature at every higher rank that has a slot pool', () => {
    expect(signatureEchoIds(entry, 2)).toEqual(['fear']);
    expect(signatureEchoIds(entry, 3)).toEqual(['fear']);
  });

  it('does NOT echo at the base rank (it is already shown there) or at cantrip rank 0', () => {
    expect(signatureEchoIds(entry, 1)).toEqual([]);
    expect(signatureEchoIds(entry, 0)).toEqual([]);
  });

  it('does not echo into a rank with no slot pool', () => {
    const noSlots = { ...entry, slots: { 1: { max: 4, used: 0 } } } as unknown as SpellcastingEntry;
    expect(signatureEchoIds(noSlots, 2)).toEqual([]);
  });

  it('skips a signature spell already repertoired at that rank (no duplicate)', () => {
    const dup = { ...entry, repertoire: { ...entry.repertoire, 2: ['fear'] } } as unknown as SpellcastingEntry;
    expect(signatureEchoIds(dup, 2)).toEqual([]);
  });

  it('non-signature repertoire spells never echo', () => {
    // 'heal' is repertoired at rank 1 but not in signature -> never appears as an echo.
    for (const r of [2, 3]) expect(signatureEchoIds(entry, r)).not.toContain('heal');
  });

  it('a ★ the repertoire files NOWHERE echoes nowhere', () => {
    // The star outlives the spell being removed on purpose (it comes back with it), and applyPlayState
    // already declines to draw it. The echo must give the same answer rather than the spell's own rank.
    const orphan = { ...entry, signature: ['fear', 'mirror-image'] } as unknown as SpellcastingEntry;
    for (const r of [2, 3]) expect(signatureEchoIds(orphan, r)).not.toContain('mirror-image');
  });
});
