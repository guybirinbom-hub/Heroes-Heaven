import { describe, it, expect } from 'vitest';
import { reconcileGmWork, playerWorkWasOverwritten } from '../src/sheet/gmSync';

/*
 * The conflict model, in the two places it can lose someone's work: the GM's unsaved working copy when
 * the player publishes underneath it, and the player's unpublished changes when a GM edit lands.
 */

describe('reconcileGmWork — the player publishes while the GM has a sheet open', () => {
  it('adopts silently when the GM has no unsaved edits', () => {
    // The seamless case: the working copy is just a mirror, so the player's HP loss should appear.
    expect(reconcileGmWork({ live: 'B', work: 'A', dirty: false })).toBe('adopt');
  });

  it('HOLDS when the GM has unsaved edits — their work is never overwritten', () => {
    expect(reconcileGmWork({ live: 'B', work: 'A', dirty: true })).toBe('hold');
  });

  it('does nothing when the two already match, dirty or not', () => {
    // Our own push echoing back through the player's re-publish must not raise a conflict.
    expect(reconcileGmWork({ live: 'A', work: 'A', dirty: false })).toBe('in-step');
    expect(reconcileGmWork({ live: 'A', work: 'A', dirty: true })).toBe('in-step');
  });

  it('is decided by the CONTENT, not by the dirty flag alone', () => {
    // A GM who edits and then undoes back to the published state has nothing to protect.
    expect(reconcileGmWork({ live: 'A', work: 'A', dirty: true })).not.toBe('hold');
  });
});

describe('playerWorkWasOverwritten — a GM edit lands on the player', () => {
  it('reports a loss when the sheet moved on since the last publish', () => {
    expect(playerWorkWasOverwritten('published', 'localChangedSince')).toBe(true);
  });

  it('stays quiet when the player was in sync — the usual case', () => {
    expect(playerWorkWasOverwritten('same', 'same')).toBe(false);
  });

  it('stays quiet when nothing has been published yet', () => {
    // We can't tell, and a banner on every GM edit would train the player to ignore it.
    expect(playerWorkWasOverwritten(undefined, 'anything')).toBe(false);
  });
});
