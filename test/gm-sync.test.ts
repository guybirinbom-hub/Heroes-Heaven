import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileGmWork,
  playerWorkWasOverwritten,
  editsToApply,
  clearGmPendingEdits,
  gmPendingEdit,
  rememberGmEdit,
  resolvePendingGmEdit,
  setGmPendingAccount,
} from '../src/sheet/gmSync';
import type { SavedChar } from '../src/data/storage';

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

  it('stays quiet when nothing has been published yet AND the incoming sheet is unknown', () => {
    // With no baseline at all we can't tell, and a banner on every GM edit would train the player
    // to ignore it.
    expect(playerWorkWasOverwritten(undefined, 'anything')).toBe(false);
  });

  // bug 2026-09-13: edits overwritten (D5)
  it('falls back to the INCOMING sheet before the first publish — the first revert is not silent', () => {
    // Nothing published this session (the usual state until the publish debounce has fired once), so
    // the only other version we have is the one about to land. Different = the player's copy is being
    // replaced, which is exactly what the banner is for.
    expect(playerWorkWasOverwritten(undefined, 'local', 'gmVersion')).toBe(true);
    // …and identical = nothing of theirs is being replaced, so still silent.
    expect(playerWorkWasOverwritten(undefined, 'same', 'same')).toBe(false);
  });
});

describe('editsToApply — a lingering gm_character_edits row must apply exactly once', () => {
  const edit = (updatedAt?: string, campaignId = 'c1', charId = 'x') => ({ campaignId, charId, updatedAt });

  it('applies an edit it has never seen', () => {
    expect(editsToApply([edit('2026-09-01T10:00:00Z')], {})).toHaveLength(1);
  });

  it('NEVER re-applies an edit at or below its stamp — the 2.5-second revert loop', () => {
    // The bug this exists for: the cleanup delete silently removed nothing (missing
    // gce_owner_delete policy), the row survived, and every poll tick rewound the sheet —
    // an inventory move undone "out of nowhere" a couple of seconds after the player made it.
    const stamps = { 'c1|x': '2026-09-01T10:00:00Z' };
    expect(editsToApply([edit('2026-09-01T10:00:00Z')], stamps)).toHaveLength(0);
    expect(editsToApply([edit('2026-09-01T09:59:59Z')], stamps)).toHaveLength(0);
  });

  it('a genuinely NEWER GM edit still lands', () => {
    const stamps = { 'c1|x': '2026-09-01T10:00:00Z' };
    expect(editsToApply([edit('2026-09-01T10:00:01Z')], stamps)).toHaveLength(1);
  });

  it('stamps are per (campaign, character) — a sibling campaign’s edit is untouched', () => {
    const stamps = { 'c1|x': '2026-09-01T10:00:00Z' };
    expect(editsToApply([edit('2026-09-01T09:00:00Z', 'c2', 'x')], stamps)).toHaveLength(1);
    expect(editsToApply([edit('2026-09-01T09:00:00Z', 'c1', 'y')], stamps)).toHaveLength(1);
  });

  it('an edit with no timestamp cannot prove it is new — skipped, never loopable', () => {
    expect(editsToApply([edit(undefined)], {})).toHaveLength(0);
    expect(editsToApply([edit(undefined)], { 'c1|x': '2026-09-01T10:00:00Z' })).toHaveLength(0);
  });
});

/*
 * A GM's pending edit is private to the GM's account, so it must never be drawn on a character that
 * account OWNS — their own app applies it through the ordinary player path. An edit row written
 * before `gm_character_edits.owner_id` existed can't say whose character it is about; the PUBLISHED
 * row always can, and this is the read that puts the two together.
 */
describe('resolvePendingGmEdit — an overlay never lands on the viewer’s own character', () => {
  const EDITED = { id: 'pc-1', character: { name: 'the GM’s unapplied change' } } as unknown as SavedChar;
  const PUBLISHED = { id: 'pc-1', character: { name: 'what the player published' } } as unknown as SavedChar;
  /** An older row: the push never recorded whose character it is. */
  const ownerless = () => rememberGmEdit('c1', 'pc-1', EDITED, '2026-09-22T10:05:00Z', '2026-09-22T10:00:00Z');

  beforeEach(() => {
    clearGmPendingEdits();
    setGmPendingAccount('gm-1');
  });

  it('refuses it when the published row says the owner is us — and drops it from every surface', () => {
    ownerless();
    const row = { sheet: PUBLISHED, updatedAt: '2026-09-22T10:00:00Z', ownerId: 'gm-1' };
    expect(resolvePendingGmEdit('c1', 'pc-1', row)).toBe(PUBLISHED);
    expect(gmPendingEdit('c1', 'pc-1'), 'the row placed it, so the chip and the strip go too').toBeUndefined();
  });

  it('still overlays another player’s character, exactly as before', () => {
    ownerless();
    const row = { sheet: PUBLISHED, updatedAt: '2026-09-22T10:00:00Z', ownerId: 'player-1' };
    expect(resolvePendingGmEdit('c1', 'pc-1', row)).toBe(EDITED);
    expect(gmPendingEdit('c1', 'pc-1')?.ownerId, 'and the store keeps what the row taught it').toBe('player-1');
  });

  it('refuses rather than guesses when NOBODY can say whose character it is', () => {
    // An older edit row AND a read that answered no row (offline, a blip). Two unknowns are not a
    // reason to show someone's silent change on a sheet that may be our own.
    ownerless();
    expect(resolvePendingGmEdit('c1', 'pc-1', null)).toBeNull();
    expect(gmPendingEdit('c1', 'pc-1'), 'and refusing to DRAW it never drops it — it is a server row').toBeDefined();
  });

  it('an edit whose own push recorded the owner is untouched by any of this', () => {
    rememberGmEdit('c1', 'pc-1', EDITED, '2026-09-22T10:05:00Z', '2026-09-22T10:00:00Z', 'player-1');
    expect(resolvePendingGmEdit('c1', 'pc-1', null), 'a failed read never stands an edit down').toBe(EDITED);
  });

  it('learning the owner MUTATES the pending entry — reconcileGmPendingEdits keys a delete off that identity', () => {
    // If this ever goes back to replacing the entry (`pendingMap().set(key, { ...edit, ownerId })`),
    // a learn landing mid-fetch makes reconcileGmPendingEdits' `before.get(key) !== have` (gmSync.ts
    // ~line 392) see a "different" object and skip a delete it should make.
    ownerless();
    const before = gmPendingEdit('c1', 'pc-1');
    const row = { sheet: PUBLISHED, updatedAt: '2026-09-22T10:00:00Z', ownerId: 'player-1' };
    resolvePendingGmEdit('c1', 'pc-1', row);
    const after = gmPendingEdit('c1', 'pc-1');
    expect(after, 'same object — not a replacement').toBe(before);
    expect(after?.ownerId).toBe('player-1');
  });
});
