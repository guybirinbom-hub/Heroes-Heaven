// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { carryModePin, getPrefs, setPref } from '../src/data/prefs';

/**
 * 2026-10-20, finding r3-R3-pin-lost-on-copy. A mode only a character's `carried` holds is edited
 * copy-on-write: the copy gets a fresh id (src/App.tsx saveOwnModeDef, src/sheet/GmEditSheet.tsx
 * saveModeDef). "Pin to top" is keyed by mode id (prefs.pinnedModes, read by ModesPanel), so without
 * carrying the pin the player's edited copy dropped out of the pinned group. Synthetic ids only.
 */
afterEach(() => {
  setPref('pinnedModes', []);
  localStorage.clear();
});

describe('carryModePin', () => {
  it('a pinned mode’s copy is pinned too; the original stays pinned (another character may carry it)', () => {
    // mutation-proof: make carryModePin a no-op (src/data/prefs.ts) and this goes red: the copy is not pinned.
    setPref('pinnedModes', ['mode-gm-old-z1', 'mode-other-z2']);
    carryModePin('mode-gm-old-z1', 'mode-copy-z3');
    expect(getPrefs().pinnedModes).toEqual(['mode-gm-old-z1', 'mode-other-z2', 'mode-copy-z3']);
  });

  it('an unpinned mode’s copy is not pinned, and a second carry adds nothing twice', () => {
    setPref('pinnedModes', ['mode-other-z2']);
    carryModePin('mode-gm-old-z1', 'mode-copy-z3');
    expect(getPrefs().pinnedModes, 'nothing pinned that was not').toEqual(['mode-other-z2']);
    setPref('pinnedModes', ['mode-gm-old-z1', 'mode-copy-z3']);
    const before = getPrefs();
    carryModePin('mode-gm-old-z1', 'mode-copy-z3');
    expect(getPrefs(), 'already pinned: no write at all').toBe(before);
  });
});
