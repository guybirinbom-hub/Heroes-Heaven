import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileGmWork,
  editsToApply,
  clearGmPendingEdits,
  gmPendingEdit,
  rememberGmEdit,
  resolvePendingGmEdit,
  setGmPendingAccount,
  sameInstant,
  boundGmBase,
  gmEditVerdict,
  gmPushBuiltOn,
  pendingEditStillStands,
  gmEditRefused,
  acknowledgeGmEditRefused,
  reconcileGmPendingEdits,
  snapshotGmPending,
  gmUpdateBase,
  gmHeldEdit,
  type GmBase,
  type PendingGmEdit,
  type PublishedRow,
} from '../src/sheet/gmSync';
import { authoredKey, hash53 } from '../src/data/authored';
import type { SavedChar } from '../src/data/storage';

/*
 * The conflict model, in the two places it can lose someone's work: the GM's unsaved working copy when
 * the player publishes underneath it, and the player's own sheet when a GM edit lands (F1, 2026-10:
 * `gmEditVerdict` — applied only when provably lossless).
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

// F1 (2026-10-09): the four `playerWorkWasOverwritten` legs are deleted with the function. Its banner
// announced a replacement AFTER it happened; an APPLY is now proved lossless before it happens
// (`gmEditVerdict`, below), so there is no replaced work left to announce.

describe('editsToApply — a lingering gm_character_edits row must be judged exactly once', () => {
  const edit = (updatedAt?: string, campaignId = 'c1', charId = 'x') => ({ campaignId, charId, updatedAt });

  it('applies an edit it has never seen', () => {
    expect(editsToApply([edit('2026-09-01T10:00:00Z')], {})).toHaveLength(1);
  });

  // F1 (2026-10-09): renamed from "NEVER re-applies an edit at or below its stamp" — the 09:59:59 leg
  // flips from 0 to 1. A DIFFERENT push stamped earlier is a new edit (the GM's other device, a slow
  // clock), and two GM devices' clocks are never ordered; the SAME edit is still never judged twice.
  it('never re-applies the SAME edit — the 2.5-second revert loop', () => {
    // The bug this exists for: the cleanup delete silently removed nothing (missing
    // gce_owner_delete policy), the row survived, and every poll tick rewound the sheet —
    // an inventory move undone "out of nowhere" a couple of seconds after the player made it.
    const stamps = { 'c1|x': '2026-09-01T10:00:00Z' };
    expect(editsToApply([edit('2026-09-01T10:00:00Z')], stamps)).toHaveLength(0);
    expect(editsToApply([edit('2026-09-01T09:59:59Z')], stamps)).toHaveLength(1);
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

  it('(12) a different push stamped EARLIER applies; the same instant in another spelling is skipped', () => {
    /*
     * MUTATION (run 2026-10-09): back to `(appliedStamps[k] ?? '') < (e.updatedAt || '')` in
     * gmSync.editsToApply — and this fails —
     *   AssertionError: the GM’s other device, a slow clock: expected [] to have a length of 1 but got +0
     */
    const stamps = { 'c1|x': '2026-10-09T10:00:00.000Z' };
    expect(editsToApply([edit('2026-10-09T09:58:00.000Z')], stamps), 'the GM’s other device, a slow clock').toHaveLength(1);
    expect(editsToApply([edit('2026-10-09T10:00:00+00:00')], stamps), 'PostgREST’s spelling of the same push').toHaveLength(0);
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

/* ──────────────────────────────────────────────────────────────────────────────
 * F1 (2026-10-09) — THE CHANNEL'S TWO ENDS: the base a push carries, and the player's verdict on it
 * ────────────────────────────────────────────────────────────────────────────── */

/** A BUILT character (synthetic): `character` is a derived cache except customization + currency. */
function built(over: { name?: string; hp?: number; potions?: number; xp?: number; zoom?: number; gp?: number; extra?: boolean } = {}): SavedChar {
  const name = over.name ?? 'Brannoc Vell';
  return {
    id: 'pc-1',
    character: {
      name,
      level: 3,
      hitPoints: { max: 38, current: over.hp ?? 38 },
      customization: { zoom: over.zoom ?? 1 },
      currency: { gp: over.gp ?? 15 },
      ...(over.extra ? { spellcasting: [{ cantripCap: 5 }] } : {}),
    },
    build: { name, level: 3, classId: 'fighter' },
    play: { damage: 0, xp: over.xp ?? 0, inventory: [{ itemId: 'healing-potion-minor', quantity: over.potions ?? 4 }] },
  } as unknown as SavedChar;
}
/** jsonb's own key order — shorter keys first, then byte order — as the `sheet` column hands it back. */
const wire = <T>(v: T): T => {
  const order = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(order)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.keys(x)
              .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
              .map((k) => [k, order((x as Record<string, unknown>)[k])]),
          )
        : x;
  return order(JSON.parse(JSON.stringify(v))) as T;
};
const H = (sc: SavedChar) => hash53(authoredKey(sc));
const S0 = '2026-10-09T10:00:00.000Z';
const S1 = '2026-10-09T10:05:00.000Z';
const PUSH = '2026-10-09T10:02:00.000Z';
const PUSH2 = '2026-10-09T10:03:00.000Z';
const base = (sc: SavedChar, over: Partial<GmBase> = {}): GmBase => ({ v: 1, at: PUSH, stamp: S0, hash: H(sc), on: null, ...over });
const row = (sheet: SavedChar, gmBase?: GmBase | 'future', updatedAt = PUSH) => ({ updatedAt, sheet, gmBase });
const own = (sheet: SavedChar | null, updatedAt = S0): PublishedRow => ({ sheet, updatedAt });

describe('(1) sameInstant — two spellings of one instant, never an ordering', () => {
  it('equal across spellings, unequal a millisecond apart, false on nothing', () => {
    /*
     * MUTATION (run 2026-10-09): `return a === b;` as the whole of gmSync.sameInstant — and this fails —
     *   AssertionError: PostgREST spells it +00:00: expected false to be true
     */
    expect(sameInstant('2026-10-09T10:00:00.123Z', '2026-10-09T10:00:00.123+00:00'), 'PostgREST spells it +00:00').toBe(true);
    expect(sameInstant('2026-10-09T10:00:00.123Z', '2026-10-09T10:00:00.124Z')).toBe(false);
    expect(sameInstant(undefined, '2026-10-09T10:00:00.123Z')).toBe(false);
    expect(sameInstant(undefined, undefined)).toBe(false);
  });
});

describe('(2)(3) authoredKey — what the player authored, and only that', () => {
  it('(2) a built character: the derived cache never counts; play, build, customization and currency do; key order never does', () => {
    /*
     * MUTATION (run 2026-10-09): count the whole `character` on a built sheet — `if (sc.build != null &&
     * false)` in authoredSheet, so every sheet takes the no-build branch — and this fails (with (6) and
     * the derived-only leg of (17)) —
     *   AssertionError: a launch rebuild changed only the derived cache: expected '{"character":{"currency":{"gp":15},"c…' to be '{"character":{"currency":{"gp":15},"c…'
     */
    const a = built();
    expect(authoredKey(built({ hp: 30, extra: true })), 'a launch rebuild changed only the derived cache').toBe(authoredKey(a));
    expect(authoredKey(built({ potions: 3 })), 'play').not.toBe(authoredKey(a));
    expect(authoredKey({ ...a, build: { ...(a.build as object), level: 4 } } as SavedChar), 'build').not.toBe(authoredKey(a));
    expect(authoredKey(built({ zoom: 1.25 })), 'character.customization').not.toBe(authoredKey(a));
    expect(authoredKey(built({ gp: 16 })), 'character.currency').not.toBe(authoredKey(a));
    expect(authoredKey(wire(a)), 'jsonb hands the keys back in its own order').toBe(authoredKey(a));
    expect(authoredKey({ ...a, id: 'other', archived: true } as SavedChar), 'never id/archived').toBe(authoredKey(a));
  });

  it('(3) a character with no build: its whole character is the player’s', () => {
    /*
     * MUTATION (run 2026-10-09): drop `character` from the no-build branch — `return { play: sc.play ??
     * null };` — and this fails —
     *   AssertionError: an imported sheet’s HP is theirs: expected '{"play":{}}' not to be '{"play":{}}'
     */
    const imported = { id: 'pc-2', character: { name: 'Imported', hitPoints: { current: 10 } }, play: {} } as unknown as SavedChar;
    const changed = { ...imported, character: { ...imported.character, hitPoints: { current: 9 } } } as unknown as SavedChar;
    expect(authoredKey(changed), 'an imported sheet’s HP is theirs').not.toBe(authoredKey(imported));
  });
});

describe('(4) boundGmBase — a base belongs to the push it sits beside', () => {
  it('binds across spellings; a survivor from an older push never binds; nothing is nothing', () => {
    /*
     * MUTATION (run 2026-10-09): skip the `sameInstant(b.at, row.updatedAt)` term in gmSync.boundGmBase —
     * and this fails —
     *   AssertionError: an older app's upsert left this base beside a new sheet: expected { v: 1, …(4) } to be undefined
     */
    const sc = built();
    expect(boundGmBase({ updatedAt: '2026-10-09T10:02:00+00:00', gmBase: base(sc) }), 'the row’s own stamp, another spelling').toBeDefined();
    expect(
      boundGmBase({ updatedAt: '2026-10-09T10:30:00.000Z', gmBase: base(sc) }),
      "an older app's upsert left this base beside a new sheet",
    ).toBeUndefined();
    expect(boundGmBase({ updatedAt: PUSH, gmBase: undefined })).toBeUndefined();
    expect(boundGmBase({ updatedAt: PUSH, gmBase: { ...base(sc), hash: '' } }), 'no hash proves nothing').toBeUndefined();
  });
});

describe('gmEditVerdict — the player’s app applies a GM edit only when it loses nothing', () => {
  const P = built(); // what the GM read: 4 potions, published at S0
  const E = built({ xp: 80 }); // the GM's edit, built on P

  it('(5) F1: they published after his read — refuse, never apply', () => {
    /*
     * The refuter's P2b2 / P2c / P5c shape: the GM read 4 potions; the player drank one and their app
     * published 3; the GM's push, built on 4, arrives with this device level with the server.
     * MUTATION (run 2026-10-09): drop `atBase` from the general rule — `if (A === S) return 'apply';` —
     * and this fails —
     *   AssertionError: their potion is never taken back: expected 'apply' to be 'refuse'
     */
    const drank = built({ potions: 3 });
    expect(gmEditVerdict({ row: row(E, base(P)), own: own(drank, S1), local: drank }), 'their potion is never taken back').toBe('refuse');
  });

  it('(6) idle: at base, local equal by authored content (jsonb order, a stale derived cache) — apply', () => {
    /*
     * MUTATION (run 2026-10-09): compare the full canonical sheets instead of the authored part — the
     * `sc.build != null && false` mutation of (2), which makes every key the whole sheet — and this fails —
     *   AssertionError: a launch rebuild is not an edit: expected 'wait' to be 'apply'
     * MUTATION (run 2026-10-09): compare by stamp equality instead of the hash — `const atBase =
     * sameInstant(a.own.updatedAt, b.stamp);` — and this fails, alone in this file —
     *   AssertionError: a no-op republish moved only the stamp: expected 'refuse' to be 'apply'
     */
    const local = built({ hp: 30, extra: true }); // rebuilt here; the server holds the older derived cache
    expect(gmEditVerdict({ row: row(E, base(P)), own: own(wire(P)), local }), 'a launch rebuild is not an edit').toBe('apply');
    expect(
      gmEditVerdict({ row: row(E, base(P)), own: own(wire(local), S1), local }),
      'a no-op republish moved only the stamp',
    ).toBe('apply');
  });

  it('(7) at base, but this device differs from the server — wait (unpublished, in flight, failed)', () => {
    /*
     * MUTATION (run 2026-10-09): `return atBase ? 'apply' : 'refuse';` as the last line — and this fails —
     *   AssertionError: their unpublished potion: expected 'apply' to be 'wait'
     * MUTATION (run 2026-10-09): `return 'refuse';` as the last line — and this fails —
     *   AssertionError: their unpublished potion: expected 'refuse' to be 'wait'
     */
    expect(gmEditVerdict({ row: row(E, base(P)), own: own(P), local: built({ potions: 3 }) }), 'their unpublished potion').toBe('wait');
  });

  it('(8) a failed read waits; no base, no published sheet refuse; a newer app’s row waits', () => {
    /*
     * MUTATION (run 2026-10-09): treat a missing base as at base — `if (!b) return a.own.sheet &&
     * authoredKey(a.local) === authoredKey(a.own.sheet) ? 'apply' : 'refuse';` — and this fails —
     *   AssertionError: an older GM app's row proves nothing: expected 'apply' to be 'refuse'
     */
    expect(gmEditVerdict({ row: row(E, base(P)), own: null, local: P }), 'the own read failed').toBe('wait');
    expect(gmEditVerdict({ row: row(E, undefined), own: own(P), local: P }), "an older GM app's row proves nothing").toBe('refuse');
    expect(gmEditVerdict({ row: row(E, base(P)), own: own(null), local: P }), 'detached, left, kicked').toBe('refuse');
    expect(gmEditVerdict({ row: row(E, 'future'), own: own(P), local: P }), 'unknown is not empty').toBe('wait');
  });

  it('(9) settled: the server already holds the GM’s sheet — consumed quietly, no false receipt', () => {
    /*
     * MUTATION (run 2026-10-09): drop the `settled` line — and this fails —
     *   AssertionError: their other device applied it first: expected 'refuse' to be 'settled'
     */
    expect(gmEditVerdict({ row: row(E, base(P)), own: own(wire(E), S1), local: P }), 'their other device applied it first').toBe('settled');
  });

  it('(9b) told: the server already carries our refusal receipt for THIS push — consumed, never applied', () => {
    /*
     * F1 (2026-10-09, round 6): a receipt UPDATE slower than the pass's 20 s bound lands after the pass gave
     * up on it, so the row stayed; their undo then brought the sheet back to his base content and the next
     * judgment APPLIED it while the GM's card said "not applied" (a round-5 timing probe, now race leg 46).
     * MUTATION (run 2026-10-09): drop the `told` line in gmSync.gmEditVerdict — and this fails —
     *   AssertionError: back at his base under our own receipt: expected 'apply' to be 'told' // Object.is equality
     */
    const told = { ...own(wire(P)), gmRefusedAt: '2026-10-09T10:02:00+00:00' }; // PUSH, as PostgREST spells it
    expect(gmEditVerdict({ row: row(E, base(P)), own: told, local: P }), 'back at his base under our own receipt').toBe('told');
    const chain = { at: PUSH, base: H(P), result: H(P) };
    expect(gmEditVerdict({ row: row(E, base(P, { on: PUSH })), own: told, local: P, chain }), 'before the chain').toBe('told');
    expect(gmEditVerdict({ row: row(E, base(P)), own: { ...told, sheet: wire(E) }, local: P }), 'before settled').toBe('told');
    expect(gmEditVerdict({ row: row(E, undefined), own: told, local: P }), 'no second receipt for a row with no base').toBe('told');
    expect(gmEditVerdict({ row: row(E, base(P)), own: { ...told, gmRefusedAt: PUSH2 }, local: P }), 'a receipt for another push').toBe('apply');
    expect(gmEditVerdict({ row: row(E, 'future'), own: told, local: P }), 'a newer app’s row still waits').toBe('wait');
  });

  describe('(10)(11) the chain — a push built on his own earlier push', () => {
    const E1 = built({ xp: 80 });
    const E2 = built({ xp: 80, potions: 5 }); // built on his held E1
    // F1 (2026-10-09): the record names WHICH push it is the result of (`at` = E1's own stamp, PUSH).
    const chain = { at: PUSH, base: H(P), result: H(E1) };
    const onE1 = base(P, { at: PUSH2, on: PUSH });

    it('(10) lands where E1 was applied; refuses over a Ctrl+Z of E1 or anything else', () => {
      /*
       * MUTATION (run 2026-10-09): drop the chain branch (`if (false && b.on && …)`) — and this fails —
       *   AssertionError: E1 applied, not republished yet: expected 'wait' to be 'apply'
       * (and the undo leg falls to the general rule: at base, local == server → `apply` — E2 over the
       * undo, which the App-level leg (31) shows landing.)
       */
      expect(gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(P), local: E1, chain }), 'E1 applied, not republished yet').toBe('apply');
      expect(gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(wire(E1), S1), local: E1, chain }), 'E1 applied and republished here').toBe('apply');
      expect(gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(P), local: P, chain }), 'the player undid E1 inside the debounce').toBe('refuse');
      expect(gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(built({ potions: 2 }), S1), local: E1, chain }), 'the server holds another sheet').toBe('refuse');
    });

    it('(11) a push built on the PUBLISHED sheet is never caught by the chain — no stuck refusals', () => {
      /*
       * MUTATION (run 2026-10-09): key the chain branch on the base alone — drop `b.on &&` — and this fails —
       *   AssertionError: his next push after an undo lands: expected 'refuse' to be 'apply'
       * F1 (2026-10-09): since the record names its push (`at`), `b.on &&` alone is redundant (no `on`
       * matches no `at`); the mutation is now `if (a.chain && a.chain.base === b.hash)` — dropping both
       * gates — and it fails the same way (run 2026-10-09), with (10c).
       */
      const E3 = built({ xp: 40 });
      expect(gmEditVerdict({ row: row(E3, base(P, { at: PUSH2 }), PUSH2), own: own(P), local: P, chain }), 'his next push after an undo lands').toBe('apply');
    });

    /*
     * F1 (2026-10-09): a chain record keyed on the base HASH alone answered for a push this device never
     * applied (refuter probe zz-f1-probe-rulings-1). Long ago E0 (a 5th potion) was built on P and applied
     * here; the player gave it back and published, so the server holds P's content again under S2 (an
     * A-B-A). Today the GM pushed E1 on P, then E2 on his held E1 — E2 replaced E1 before this device
     * fetched. The old record {base: H(P), result: H(E0)} then decided E2 — applying it over an
     * unpublished change that happened to equal E0's result, or refusing it on an in-step device.
     * MUTATION (run 2026-10-09): drop the `sameInstant(a.chain.at, b.on)` term from the chain clause in
     * gmSync.gmEditVerdict — and this fails —
     *   AssertionError: their unpublished potion: the edit WAITS, never applies over it: expected 'apply' to be 'wait'
     */
    it('(10c) a chain record from an OLD apply never answers for a push it did not produce', () => {
      const E0 = built({ potions: 5 });
      const S2 = '2026-10-09T11:00:00.000Z';
      const E1_AT = '2026-10-09T11:01:00.000Z';
      const E2_AT = '2026-10-09T11:02:00.000Z';
      const stale = { at: '2026-10-09T10:30:00.000Z', base: H(P), result: H(E0) };
      const e2 = row(built({ xp: 20 }), base(P, { at: E2_AT, stamp: S2, on: E1_AT }), E2_AT);
      const theirFifth = built({ potions: 5 }); // their own pick-up, the publish failed: E0's content exactly
      expect(H(theirFifth), 'fixture: their change reproduces the old result').toBe(stale.result);
      expect(
        gmEditVerdict({ row: e2, own: own(wire(P), S2), local: theirFifth, chain: stale }),
        'their unpublished potion: the edit WAITS, never applies over it',
      ).toBe('wait');
      expect(
        gmEditVerdict({ row: e2, own: own(wire(P), S2), local: P, chain: stale }),
        'this device never applied E1: the general rule — at base, in step — applies it (no false "not applied")',
      ).toBe('apply');
    });

    /*
     * F1 (2026-10-09): a player device with NO chain record applied a push built on an earlier push of
     * his that their OTHER device had applied and they had taken back (refuter probe zz-f1-probe-regress-1).
     * GM reads P at S0, pushes E1 (a 5th potion), then E2 on his held E1 (+80 XP; still S0). Device A
     * applies E1, republishes S1; the player gives the potion back on A → S2 holds P's content again.
     * Device B (cloud-synced to that, never applied E1) judged E2 by content alone: at base, in step →
     * APPLY, and E1's potion came back over their change. A push built on an earlier push of his now needs
     * the very publish it was built on as well — the GM's own write path builds on his held edit by the
     * same pair (`pendingEditStandsOnFreshRead`).
     * MUTATION (run 2026-10-09): drop `&& (!b.on || sameInstant(a.own.updatedAt, b.stamp))` from `atBase`
     * in gmSync.gmEditVerdict — and this fails —
     *   AssertionError: device B never applied E1: E2 carries E1's potion back over their change: expected 'apply' to be 'refuse'
     */
    it('(10d) a chain-less device never applies a chained push over a change they took back', () => {
      const S2 = '2026-10-09T10:04:00.000Z';
      const E2 = built({ potions: 5, xp: 80 });
      const e2 = row(E2, onE1, PUSH2); // on = PUSH (E1), built on S0 / H(P)
      const gaveBack = wire(P);
      expect(
        gmEditVerdict({ row: e2, own: own(gaveBack, S2), local: P }),
        "device B never applied E1: E2 carries E1's potion back over their change",
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: e2, own: own(gaveBack, S2), local: P, chain: { at: PUSH, base: H(P), result: H(built({ potions: 5 })) } }),
        'device A (which applied E1) refuses it too — its chain sees the change',
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: e2, own: own(wire(P), S0), local: P }),
        'E2 replaced E1 before anyone applied it: still the very publish it was built on → it lands (case 16)',
      ).toBe('apply');
    });

    /*
     * F1 (2026-10-09): the chain clause's "server still at the base" branch was content alone (refuter
     * probe zz-f1-probe-timing-2, T2; App leg (13b) in test/bug-gm-edit-race.test.tsx). Device A applied
     * E1 and republished it; their OTHER device took E1 back, publishing P's content under a NEW stamp
     * S2; A has not caught up (it still holds E1's result). E2 (built on his held E1, carrying E1's
     * change) was APPLIED on A, and A's republish wrote it over the other device's publish.
     * MUTATION (run 2026-10-09): `const atThatPublish = hS === b.hash;` in gmSync.gmEditVerdict (the
     * stamp term dropped) — and this fails (with (10d), which shares that term) —
     *   AssertionError: device A is behind their other device, which took E1 back: never applied here: expected 'apply' to be 'refuse'
     */
    it('(10e) a device that applied E1 never applies E2 once their other device took E1 back under a new publish', () => {
      const S2 = '2026-10-09T10:06:00.000Z';
      const recA = { at: PUSH, stamp: S0, base: H(P), result: H(E1) };
      expect(
        gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(wire(P), S2), local: E1, chain: recA }),
        'device A is behind their other device, which took E1 back: never applied here',
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: row(E2, onE1, PUSH2), own: own(wire(P), S0), local: E1, chain: recA }),
        'still the very publish E1 was applied over (A has not republished yet) → it lands (race leg 30)',
      ).toBe('apply');
    });

    /*
     * F1 (2026-10-09): table case 17 broke on a THIRD gesture (refuter probe zz-f1-probe-rulings-1; App
     * leg (31b)). Device A applied E1 over S0; the player's Ctrl+Z inside the debounce left the server at
     * S0. The GM pushed E2 on his held E1, then E3 on his held E2 (no receipt for E2 had reached his read
     * yet) — all on S0. The record named E1 only (`at`), so E3 (`on` = E2) fell to the general rule (the
     * server unmoved, in step) and was APPLIED: E1's potion back over the undo. The record's `stamp` (the
     * publish E1 was applied over, which every push built on a held edit over it carries) catches E3.
     * MUTATION (run 2026-10-09): drop `|| sameInstant(a.chain.stamp, b.stamp)` from the chain clause in
     * gmSync.gmEditVerdict — and this fails —
     *   AssertionError: a push built on a later held push of his, over the publish E1 was applied over, keeps their undo: expected 'apply' to be 'refuse'
     */
    it('(10f) a push built on a LATER held push of his, over the publish E1 was applied over, still meets the chain', () => {
      const PUSH3 = '2026-10-09T10:04:00.000Z';
      const recA = { at: PUSH, stamp: S0, base: H(P), result: H(E1) };
      const e3 = row(built({ xp: 80, potions: 6 }), base(P, { at: PUSH3, on: PUSH2 }), PUSH3); // on = E2
      expect(
        gmEditVerdict({ row: e3, own: own(wire(P), S0), local: P, chain: recA }),
        'a push built on a later held push of his, over the publish E1 was applied over, keeps their undo',
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: e3, own: own(wire(P), S0), local: E1, chain: recA }),
        'no undo: E1 still exactly here → his third gesture lands',
      ).toBe('apply');
      expect(
        gmEditVerdict({ row: row(built({ xp: 40 }), base(P, { at: PUSH3 }), PUSH3), own: own(wire(P), S0), local: P, chain: recA }),
        'a push built on the PUBLISHED sheet (`on` null) is never caught — no stuck refusals (case 17)',
      ).toBe('apply');
    });

    /*
     * F1 (2026-10-09): case 21 failed when this version's LOAD migrates `play` (refuter probe
     * zz-f1-probe-rulings-2; App leg (34b)). The older version published play with a legacy field this
     * load drops (normalizePlay → bankedParts); the GM's between-session push carries the hash of THAT.
     * The launch republish of the loaded entry changed the hash, and the push was REFUSED though the
     * player changed nothing. The content this device's own load made of the base counts as the base.
     * MUTATION (run 2026-10-09): drop `|| (!!a.loaded && a.loaded(b.hash) === S)` from `atBase` in
     * gmSync.gmEditVerdict — and this fails —
     *   AssertionError: the launch republished what this load made of his base: not a change of theirs: expected 'refuse' to be 'apply'
     */
    it('(10g) a load is not an edit: what this device’s load made of the base counts as the base (`on` null only)', () => {
      const legacy = { ...P, play: { ...(P.play as object), bankedParts: [{ id: 'legacy' }] } } as unknown as SavedChar;
      const loadedAs = (h: string) => (h === H(legacy) ? authoredKey(P) : undefined);
      const onLegacy = base(legacy);
      expect(
        gmEditVerdict({ row: row(E, onLegacy), own: own(wire(P), S1), local: P, loaded: loadedAs }),
        'the launch republished what this load made of his base: not a change of theirs',
      ).toBe('apply');
      expect(
        gmEditVerdict({ row: row(E, onLegacy), own: own(wire(P), S1), local: P }),
        'fixture: without the load’s pair it is refused',
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: row(E, onLegacy), own: own(built({ potions: 3 }), S1), local: built({ potions: 3 }), loaded: loadedAs }),
        'a real change of theirs after the load is still refused',
      ).toBe('refuse');
      expect(
        gmEditVerdict({ row: row(E, base(legacy, { on: '2026-10-09T09:00:00.000Z' })), own: own(wire(P), S1), local: P, loaded: loadedAs }),
        'a push built on an earlier push of his still needs the very publish (10d)',
      ).toBe('refuse');
    });
  });
});

describe('the GM’s write path — what his next push is built on', () => {
  const P = built();
  const E = built({ xp: 80 });
  beforeEach(() => {
    clearGmPendingEdits();
    setGmPendingAccount('gm-1');
  });
  const hold = (sheet = E, at = PUSH) => rememberGmEdit('c1', 'pc-1', sheet, at, S0, 'player-1', H(P));

  it('(13) built on his held edit only while the read is exactly its base and unrefused', () => {
    /*
     * MUTATION (run 2026-10-09): restore the display rule on the write path — `edit &&
     * pendingEditStillStands(edit, published)` in gmSync.gmPushBuiltOn — and this fails —
     *   AssertionError: their second device stamped its newer sheet EARLIER: expected { id: 'pc-1', …(3) } to be { id: 'pc-1', …(3) }
     */
    hold();
    const earlier = { sheet: built({ potions: 3 }), updatedAt: '2026-10-09T09:59:00.000Z' };
    expect(gmPushBuiltOn('c1', 'pc-1', earlier).sheet, 'their second device stamped its newer sheet EARLIER').toBe(earlier.sheet);
    expect(gmPushBuiltOn('c1', 'pc-1', earlier).on).toBeNull();
    const later = { sheet: built({ potions: 3 }), updatedAt: S1 };
    expect(gmPushBuiltOn('c1', 'pc-1', later).sheet).toBe(later.sheet);
    const same = { sheet: wire(P), updatedAt: '2026-10-09T10:00:00+00:00' };
    expect(gmPushBuiltOn('c1', 'pc-1', same)).toEqual({ sheet: E, on: PUSH });
    expect(gmPushBuiltOn('c1', 'pc-1', { ...same, gmRefusedAt: '2026-10-09T10:02:00+00:00' }).sheet, 'their app refused it').toBe(same.sheet);
  });

  it('(13b) …and never when their sheet only came BACK to his base content under a new publish (A-B-A)', () => {
    /*
     * F1 (2026-10-09), found while building: content alone let his held hit stand after their app
     * applied it and they healed it back — the next push carried the hit over the heal (the seam's
     * PROBE-OWN-ABA leg). The stamp must be the same publish too.
     * MUTATION (run 2026-10-09): drop the `sameInstant(published.updatedAt, edit.baseUpdatedAt)` term from
     * gmSync.pendingEditStandsOnFreshRead — and this fails (with the seam's PROBE-OWN-ABA leg and "his next
     * gesture does not carry his own overtaken push back") —
     *   AssertionError: their heal back to his base content is a publish of theirs: expected { id: 'pc-1', …(3) } to be { id: 'pc-1', …(3) }
     */
    hold();
    const healedBack = { sheet: wire(P), updatedAt: S1 };
    expect(gmPushBuiltOn('c1', 'pc-1', healedBack).sheet, 'their heal back to his base content is a publish of theirs').toBe(healedBack.sheet);
  });

  it('(13c) premise of (10f): with no receipt on his fresh read yet, his third gesture is built on his held second, over the same publish', () => {
    /*
     * F1 (2026-10-09): refuter probe zz-f1-probe-rulings-1, GM leg. E3 replaced E2 before the player's
     * app pulled, or their refusal of E2 has not reached his read: his held E2 stands on the unmoved
     * publish, so E3 carries `on` = E2 and E2's base publish — the case the player's chain record must
     * catch by `stamp` (gm-sync (10f), race (31b)). A premise leg: it pins what the GM side sends, no rule
     * of its own (no mutation).
     */
    hold(built({ xp: 80, potions: 5 }), PUSH2); // his held E2 (E1 was PUSH)
    const read = { sheet: wire(P), updatedAt: S0 };
    expect(gmPushBuiltOn('c1', 'pc-1', read).on, 'E3 is built on his held E2').toBe(PUSH2);
    expect(gmHeldEdit('c1', 'pc-1')?.baseUpdatedAt, '…over the very publish E1 was built on').toBe(S0);
  });

  it('(14) pendingEditStillStands: a refusal receipt for THIS push stands it down; one for another does not', () => {
    /*
     * MUTATION (run 2026-10-09): delete the receipt clause from gmSync.pendingEditStillStands — and this fails —
     *   AssertionError: their app refused this push: expected true to be false
     */
    hold();
    const edit = gmHeldEdit('c1', 'pc-1')!;
    expect(pendingEditStillStands(edit, { sheet: null, updatedAt: S0, gmRefusedAt: '2026-10-09T10:02:00+00:00' }), 'their app refused this push').toBe(false);
    expect(pendingEditStillStands(edit, { sheet: null, updatedAt: S0, gmRefusedAt: '2026-10-09T09:00:00.000Z' }), 'an older push’s receipt').toBe(true);
  });

  it('(15) a receipt drops the held edit and says "not applied"; only an answer clears it; never on his own character', () => {
    /*
     * MUTATION (run 2026-10-09): drop the `noteGmReceipt(campaignId, charId, published);` call from
     * gmSync.resolvePendingGmEdit — and this fails —
     *   AssertionError: the GM is told: expected false to be true
     */
    hold();
    resolvePendingGmEdit('c1', 'pc-1', { sheet: P, updatedAt: S0, gmRefusedAt: PUSH, ownerId: 'player-1' });
    expect(gmHeldEdit('c1', 'pc-1'), 'the receipt stands it down').toBeUndefined();
    expect(gmEditRefused('c1', 'pc-1'), 'the GM is told').toBe(true);
    hold(built({ xp: 90 }), PUSH2);
    // F1 (2026-10-09): "a new push is a new question" erased the only sign his refused push never landed
    // when the new one did not carry it (leg (15b)). It stays until a push carries it, or a full-sheet
    // Update he makes after it answers it.
    expect(gmEditRefused('c1', 'pc-1'), 'a push that does not carry the refused one keeps "not applied"').toBe(true);
    acknowledgeGmEditRefused('c1', 'pc-1');
    expect(gmEditRefused('c1', 'pc-1'), 'a full-sheet Update he made after it answers it').toBe(false);
    // Dropped first (their publish overtook it), receipt later: still told.
    resolvePendingGmEdit('c1', 'pc-1', { sheet: null, updatedAt: S1 });
    expect(gmHeldEdit('c1', 'pc-1')).toBeUndefined();
    resolvePendingGmEdit('c1', 'pc-1', { sheet: null, updatedAt: S1, gmRefusedAt: PUSH2 });
    expect(gmEditRefused('c1', 'pc-1'), 'the receipt matches the edit dropped earlier').toBe(true);
    // His own character: never.
    rememberGmEdit('c1', 'pc-9', E, PUSH, S0, 'gm-1', H(P));
    resolvePendingGmEdit('c1', 'pc-9', { sheet: P, updatedAt: S0, gmRefusedAt: PUSH, ownerId: 'gm-1' });
    expect(gmEditRefused('c1', 'pc-9'), 'his own app refused his own push').toBe(false);
  });

  /*
   * F1 (2026-10-09): the GM's next push erased the "not applied" notice for a refused edit it does not
   * carry, so a refused Update vanished silently (round-3 refuter probe, timing lens). He awards XP with
   * a full-sheet Update (E1, built on their sheet P at s0). They pick up a potion first (P', s1); their
   * app refuses E1 and writes the receipt. He then hits them in the tracker: the seam's fresh read carries
   * that receipt, `gmPushBuiltOn` rightly builds E2 on P' (no XP), and `pushGmEdit` → `rememberGmEdit`
   * cleared the notice and the dropped record. From then on the receipt named a push his app no longer
   * knew (`noteGmReceipt` consulted the dropped stamp only when NOTHING was held, and E2 is held). Same
   * calls, in the same order, as pcSheetTruth `send()` and the party read (PartyMembers' pruner).
   * MUTATION (run 2026-10-09): drop `else supersededPending.set(key, replaced);` from
   * gmSync.rememberGmEdit — and the second leg fails —
   *   AssertionError: his refused XP award either rides on his next push or stays marked "not applied": expected { told: false, carriesXp: false } to not deeply equal { told: false, carriesXp: false }
   * MUTATION (run 2026-10-09): restore an unconditional `refusedNotice.delete(key);` in
   * gmSync.rememberGmEdit — and the first leg fails (with (15)) —
   *   AssertionError: the card still says "not applied" the moment his next push lands: expected false to be true // Object.is equality
   */
  describe('(15b) a refused Update is never silently replaced by his next push', () => {
    const sheetOf = (xp: number, potions: number, damage: number): SavedChar =>
      ({ id: 'c', character: { name: 'Synthetic Kyra' }, build: { name: 'Synthetic Kyra', xp }, play: { damage, potions } }) as unknown as SavedChar;
    for (const seen of ['before his next push', 'never (his party list had not re-read)'] as const) {
      it(`receipt read ${seen}`, () => {
        const CAMP = 'camp';
        const P0 = sheetOf(0, 3, 0);
        const s0 = '2026-10-09T12:00:01.000Z';
        const E1 = sheetOf(1000, 3, 0); // his XP award
        const T1 = '2026-10-09T09:01:00.000Z';
        rememberGmEdit(CAMP, 'c', E1, T1, s0, 'player-1', H(P0)); // pushGmEdit's success path
        // They picked up a potion first; their app refused E1 and wrote the receipt.
        const theirs = { sheet: sheetOf(0, 4, 0), updatedAt: '2026-10-09T12:00:02.000Z', ownerId: 'player-1', gmRefusedAt: T1 };
        if (seen === 'before his next push') {
          resolvePendingGmEdit(CAMP, 'c', theirs);
          expect(gmEditRefused(CAMP, 'c'), 'fixture: the card said "not applied"').toBe(true);
        }
        // His tracker hit: the seam's fresh read is `theirs`, receipt included.
        const built2 = gmPushBuiltOn(CAMP, 'c', theirs);
        expect(built2.on, 'fixture: built on their sheet, not on his refused E1').toBeNull();
        const E2 = { ...built2.sheet!, play: { ...(built2.sheet!.play as object), damage: 5 } } as SavedChar;
        rememberGmEdit(CAMP, 'c', E2, '2026-10-09T09:02:00.000Z', theirs.updatedAt, 'player-1', H(theirs.sheet), built2.on);
        if (seen === 'before his next push')
          expect(gmEditRefused(CAMP, 'c'), 'the card still says "not applied" the moment his next push lands').toBe(true);
        // His party list reads their row again (same receipt, E2 not applied yet).
        resolvePendingGmEdit(CAMP, 'c', theirs);
        const carriesXp = (E2.build as unknown as { xp: number }).xp === 1000;
        expect(
          { told: gmEditRefused(CAMP, 'c'), carriesXp },
          'his refused XP award either rides on his next push or stays marked "not applied"',
        ).not.toEqual({ told: false, carriesXp: false });
      });
    }
    it('a push that CARRIES the refused one (built on it) answers it', () => {
      const P0 = sheetOf(0, 3, 0);
      rememberGmEdit('camp', 'c', sheetOf(1000, 3, 0), '2026-10-09T09:01:00.000Z', '2026-10-09T12:00:01.000Z', 'player-1', H(P0));
      resolvePendingGmEdit('camp', 'c', { sheet: P0, updatedAt: '2026-10-09T12:00:01.000Z', ownerId: 'player-1', gmRefusedAt: '2026-10-09T09:01:00.000Z' });
      expect(gmEditRefused('camp', 'c'), 'fixture').toBe(true);
      rememberGmEdit('camp', 'c', sheetOf(1000, 3, 5), '2026-10-09T09:02:00.000Z', '2026-10-09T12:00:01.000Z', 'player-1', H(P0), '2026-10-09T09:01:00+00:00');
      expect(gmEditRefused('camp', 'c'), 'it rides on the new push').toBe(false);
    });
  });

  it('(16) reconcile: a DIFFERENT push on the server replaces ours, even stamped earlier — unless ours was pushed during the read', () => {
    /*
     * MUTATION (run 2026-10-09): restore `if (have && have.pushedAt >= r.pushedAt) continue;` in the add
     * loop of gmSync.reconcileGmPendingEdits, in place of the `before.get(key) !== have` test — and this
     * fails —
     *   AssertionError: his other device's push (slow clock) is the current one: expected { id: 'pc-1', …(3) } to be { id: 'pc-1', …(3) }
     */
    hold();
    const before = snapshotGmPending('c1');
    const other: PendingGmEdit = { campaignId: 'c1', charId: 'pc-1', sheet: built({ xp: 70 }), pushedAt: '2026-10-09T10:01:00.000Z' };
    reconcileGmPendingEdits('c1', [other], before);
    expect(gmHeldEdit('c1', 'pc-1')?.sheet, "his other device's push (slow clock) is the current one").toBe(other.sheet);
    // …but one he pushed HERE while the read was out beats the read's answer.
    const before2 = snapshotGmPending('c1');
    hold(built({ xp: 95 }), PUSH2);
    reconcileGmPendingEdits('c1', [other], before2);
    expect(gmHeldEdit('c1', 'pc-1')?.pushedAt, 'pushed during the read').toBe(PUSH2);
    // …and the same push in another spelling keeps OUR object (rule E identity).
    const mine = gmHeldEdit('c1', 'pc-1')!;
    reconcileGmPendingEdits('c1', [{ ...other, pushedAt: '2026-10-09T10:03:00+00:00' }], snapshotGmPending('c1'));
    expect(gmHeldEdit('c1', 'pc-1'), 'the same push').toBe(mine);
  });

  describe('(17) gmUpdateBase — the full-sheet Update’s proof', () => {
    const published = (sheet: SavedChar, updatedAt = S0, gmRefusedAt?: string): PublishedRow => ({ sheet: wire(sheet), updatedAt, gmRefusedAt });

    it('a failed read, or nothing published, sends nothing', () => {
      expect(gmUpdateBase(P, null, undefined)).toEqual({ ok: false, reason: 'read-failed' });
      expect(gmUpdateBase(P, { sheet: null, updatedAt: S0 }, undefined)).toEqual({ ok: false, reason: 'unpublished' });
    });

    it('his copy IS the published sheet (a derived-only difference) — ok, on the read, built on nothing of his', () => {
      const res = gmUpdateBase(built({ hp: 30, extra: true }), published(P), undefined);
      expect(res).toEqual({ ok: true, base: { stamp: S0, hash: H(P) }, on: null });
    });

    it('his copy IS his held edit standing on the read — ok, on = that push', () => {
      hold();
      expect(gmUpdateBase(E, published(P), gmHeldEdit('c1', 'pc-1'))).toEqual({ ok: true, base: { stamp: S0, hash: H(P) }, on: PUSH });
    });

    it('judge 1-H1: a copy of P0 while his edit stands on their newer P1 — moved, current = that edit', () => {
      /*
       * MUTATION (run 2026-10-09): take the base from the fresh read whenever it succeeds — `if (base)
       * return { ok: true, base, on: null };` right after `if (!base) …` in gmSync.gmUpdateBase — and this
       * fails (with the held-edit leg above and the tracker-push leg below) —
       *   AssertionError: expected { ok: true, base: { …(2) }, on: null } to match object { ok: false, reason: 'moved' }
       */
      const P1 = built({ potions: 3 });
      rememberGmEdit('c1', 'pc-1', built({ potions: 3, xp: 80 }), PUSH, S1, 'player-1', H(P1));
      const res = gmUpdateBase(P, published(P1, S1), gmHeldEdit('c1', 'pc-1'));
      expect(res).toMatchObject({ ok: false, reason: 'moved' });
      expect(res.ok === false && res.reason === 'moved' && res.current).toBe(gmHeldEdit('c1', 'pc-1')!.sheet);
    });

    it('his own tracker push replaced the held edit while he was dirty — moved, current = that push', () => {
      const hit = { ...P, play: { ...(P.play as object), damage: 5 } } as SavedChar; // his tracker gesture
      hold(hit);
      const res = gmUpdateBase(built({ xp: 10 }), published(P), gmHeldEdit('c1', 'pc-1'));
      expect(res).toMatchObject({ ok: false, reason: 'moved', on: PUSH });
    });

    it('a held edit their app refused is judged against the published sheet', () => {
      hold();
      expect(gmUpdateBase(P, published(P, S0, PUSH), gmHeldEdit('c1', 'pc-1'))).toEqual({ ok: true, base: { stamp: S0, hash: H(P) }, on: null });
    });
  });

  it('(18) rememberGmEdit with no base keeps the base an earlier push proved', () => {
    /*
     * The `?? had` rule, moved here from bug-gm-edit-visibility (k) — `pushGmEdit` itself no longer sends
     * a base-less push (F1), so only a direct caller can reach it.
     * MUTATION (run 2026-10-09): write the arguments straight through — `baseUpdatedAt` and `baseHash`
     * instead of `baseUpdatedAt ?? had?.baseUpdatedAt` / `baseHash ?? had?.baseHash` — and this fails —
     *   AssertionError: the base an earlier push proved is not thrown away: expected undefined to be '2026-10-09T10:00:00.000Z'
     */
    hold();
    rememberGmEdit('c1', 'pc-1', built({ xp: 99 }), PUSH2);
    expect(gmHeldEdit('c1', 'pc-1')!.baseUpdatedAt, 'the base an earlier push proved is not thrown away').toBe(S0);
    expect(gmHeldEdit('c1', 'pc-1')!.baseHash).toBe(H(P));
  });
});

describe('(19) one way to build a stamp-only row', () => {
  it('no `{ sheet: null, updatedAt` literal anywhere in src/ outside gmSync.ts', () => {
    /*
     * Every reader that hands a member's stamp to the overlay rules must carry the refusal receipt
     * with it (`memberPublishedRow`); a hand-built row silently drops it and the chip never shows.
     * MUTATION (run 2026-10-09): put `{ sheet: null, updatedAt: m.updatedAt }` back in PartyMembers'
     * `pending` test — and this fails —
     *   AssertionError: build stamp-only rows with memberPublishedRow: expected [ 'src/sheet/PartyMembers.tsx' ] to deeply equal []
     */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && p.replace(/\\/g, '/') !== 'src/sheet/gmSync.ts' && /\{\s*sheet:\s*null,\s*updatedAt/.test(readFileSync(p, 'utf8')))
          offenders.push(p.replace(/\\/g, '/'));
      }
    };
    walk('src');
    expect(offenders, 'build stamp-only rows with memberPublishedRow').toEqual([]);
  });
});
