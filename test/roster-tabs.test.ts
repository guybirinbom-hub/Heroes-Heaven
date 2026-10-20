// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * H1 (2026-10-18): the bookkeeping two tabs of one browser profile fold each other's roster writes
 * with — what a tab KNOWS the key holds, the lineage record every write leaves (src/data/rosterLineage.ts),
 * the base a foreign write is merged against (src/data/rosterTabs.ts), and the persist module's two
 * hooks (src/data/persist.ts reconcile + foldIntoPersist). The App-level legs are
 * test/bug-two-tabs-roster.test.tsx. Each test gets fresh module state (vi.resetModules); "the other
 * tab" is simulated by writing the two keys the way its saveRoster does. Synthetic rosters only.
 */
const ROSTER_KEY = 'wanderers-codex:roster:v1';
const LINEAGE_KEY = 'wanderers-codex:roster-lineage:v1';

type C = { id: string; character: { name: string }; play?: { damage: number } };
const pc = (id: string, name: string, damage = 0): C => ({ id, character: { name }, play: { damage } });

async function modules() {
  vi.resetModules();
  const storage = await import('../src/data/storage');
  const lineage = await import('../src/data/rosterLineage');
  const tabs = await import('../src/data/rosterTabs');
  const persist = await import('../src/data/persist');
  return { storage, lineage, tabs, persist };
}

/** What another tab's saveRoster leaves behind: its lineage record, then the roster. */
function otherTabWrites(roster: C[], on: string | null, sig: (raw: string) => string): string {
  const raw = JSON.stringify(roster);
  localStorage.setItem(LINEAGE_KEY, JSON.stringify({ sig: sig(raw), on }));
  localStorage.setItem(ROSTER_KEY, raw);
  return raw;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('saveRoster: every write says what it replaced', () => {
  it('writes the lineage record BEFORE the roster, naming the value it replaced, and the value becomes known', async () => {
    const { storage, lineage } = await modules();
    const p = [pc('a', 'Ayla')];
    localStorage.setItem(ROSTER_KEY, JSON.stringify(p));
    const order: string[] = [];
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      order.push(k);
      real.call(this, k, v);
    });
    const next = [pc('a', 'Ayla', 3)];
    expect(storage.saveRoster(next as never)).toBe(true);
    expect(order).toEqual([LINEAGE_KEY, ROSTER_KEY]);
    const rec = JSON.parse(localStorage.getItem(LINEAGE_KEY)!) as { sig: string; on: string };
    expect(rec.on).toBe(lineage.rosterSig(JSON.stringify(p)));
    expect(rec.sig).toBe(lineage.rosterSig(JSON.stringify(next)));
    expect(lineage.knownRoster().raw).toBe(JSON.stringify(next));
    expect(lineage.knownRoster().roster).toBe(next);
  });

  it('never writes a value the key already holds — no storage event, so no echo for the other tab', async () => {
    const { storage } = await modules();
    const p = [pc('a', 'Ayla')];
    localStorage.setItem(ROSTER_KEY, JSON.stringify(p));
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    expect(storage.saveRoster(JSON.parse(JSON.stringify(p)) as never)).toBe(true);
    expect(spy.mock.calls.filter(([k]) => k === ROSTER_KEY)).toHaveLength(0);
  });
});

describe('takeForeignRoster: the other tab’s write, and the roster it grew from', () => {
  it('nothing new: the key still holds what this tab knows, or holds nothing at all (UNKNOWN is not EMPTY)', async () => {
    const { tabs } = await modules();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla')]));
    tabs.loadRosterKnown();
    expect(tabs.takeForeignRoster()).toBeNull();
    localStorage.removeItem(ROSTER_KEY);
    expect(tabs.takeForeignRoster(), 'an emptied key is never "every character deleted"').toBeNull();
  });

  it('a write built on what this tab knows: merged against that; taking it makes it known (folded once)', async () => {
    const { tabs, lineage } = await modules();
    const p = [pc('a', 'Ayla')];
    const pRaw = JSON.stringify(p);
    localStorage.setItem(ROSTER_KEY, pRaw);
    const known = tabs.loadRosterKnown();
    otherTabWrites([pc('a', 'Ayla', 5)], lineage.rosterSig(pRaw), lineage.rosterSig);
    const f = tabs.takeForeignRoster();
    expect(f?.kind).toBe('write');
    if (f?.kind !== 'write') return;
    expect(f.base).toBe(known);
    expect(f.incoming.map((c) => [c.id, c.play?.damage])).toEqual([['a', 5]]); // parsed as loadRoster parses
    expect(tabs.takeForeignRoster(), 'the same write is never folded twice').toBeNull();
  });

  it('a write built on an OLDER roster than this tab’s last write: merged against THAT roster (leg 4’s case)', async () => {
    /*
     * MUTATION (run 2026-10-18): `const base = k.roster as SavedChar[];` in takeForeignRoster — the base
     * is then this tab's own last write, and this fails on `expected [...] to be [...]`.
     */
    const { tabs, storage, lineage } = await modules();
    const p = [pc('a', 'Ayla')];
    const pRaw = JSON.stringify(p);
    localStorage.setItem(ROSTER_KEY, pRaw);
    const launch = tabs.loadRosterKnown();
    storage.saveRoster([pc('a', 'Ayla', 2)] as never); // this tab's own write (the player's damage)
    // The other tab never saw it: its write replaces P, as far as it knows.
    otherTabWrites([pc('a', 'GM Version')], lineage.rosterSig(pRaw), lineage.rosterSig);
    const f = tabs.takeForeignRoster();
    expect(f?.kind).toBe('write');
    if (f?.kind === 'write') expect(f.base, 'the roster the other tab built on').toBe(launch);
  });

  it('a lineage record that belongs to another write (two tabs interleaving) is not used: the base is what this tab knows', async () => {
    const { tabs, lineage, storage } = await modules();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla')]));
    tabs.loadRosterKnown();
    storage.saveRoster([pc('a', 'Ayla', 1)] as never);
    const mine = lineage.knownRoster().roster;
    localStorage.setItem(LINEAGE_KEY, JSON.stringify({ sig: 'not-this-one', on: null }));
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla', 9)]));
    const f = tabs.takeForeignRoster();
    expect(f?.kind === 'write' && f.base).toBe(mine);
  });

  it('an OLD app version (no lineage) writing back an earlier write of ours is an echo, not new work', async () => {
    const { tabs, persist, storage } = await modules();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla')]));
    tabs.loadRosterKnown();
    persist.setupPersist(storage.saveRoster as never, () => undefined);
    const v1 = [pc('a', 'Ayla', 1)];
    persist.persistNow(v1);
    persist.persistNow([pc('a', 'Ayla', 2)]);
    localStorage.removeItem(LINEAGE_KEY);
    localStorage.setItem(ROSTER_KEY, JSON.stringify(v1)); // the old tab's late echo of v1
    expect(tabs.takeForeignRoster()).toEqual({ kind: 'echo' });
  });
});

describe('another tab signs in as ANOTHER ACCOUNT (S3, 2026-10-20)', () => {
  /*
   * cloudSync's startSync, in the other tab: the account-scoped keys wiped, the new sync owner saved,
   * then the new account's roster written by its first adopt — onto an EMPTY key, so its lineage says it
   * replaced nothing (`on: null`). On 6393b29 this tab merged it against its old-account roster: an
   * old-account character it held an edit on was kept ("they deleted it, we changed it") and written back
   * into the new account's key (the App-level leg is test/bug-two-tabs-roster.test.tsx (8)).
   */
  const OWNER_KEY = 'pf2e-codex.syncOwner';
  async function switched() {
    const m = await modules();
    localStorage.setItem(OWNER_KEY, 'acct-old');
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('old', 'Old Account Hero')]));
    m.tabs.loadRosterKnown();
    // The other tab switches accounts.
    localStorage.removeItem(ROSTER_KEY);
    localStorage.setItem(OWNER_KEY, 'acct-new');
    return m;
  }

  it('while the key is emptied and not filled yet: nothing to take, and this tab may write nothing', async () => {
    const { tabs } = await switched();
    expect(tabs.takeForeignRoster()).toBeNull();
    expect(tabs.rosterOwnerSwitched()).toBe(true);
  });

  it('the new account’s roster is taken WHOLE — never merged with the old one — and the switch is then over', async () => {
    const { tabs, lineage } = await switched();
    otherTabWrites([pc('new', 'New Account Hero')], null, lineage.rosterSig);
    const f = tabs.takeForeignRoster();
    expect(f?.kind).toBe('replace');
    if (f?.kind === 'replace') expect(f.incoming.map((c) => c.id)).toEqual(['new']);
    expect(tabs.rosterOwnerSwitched()).toBe(false);
    expect(tabs.takeForeignRoster(), 'taken once').toBeNull();
  });

  it('a FIRST sign-in (no owner before) is not a switch: the write merges as any other', async () => {
    const { tabs, lineage } = await modules();
    const p = [pc('a', 'Ayla')];
    const pRaw = JSON.stringify(p);
    localStorage.setItem(ROSTER_KEY, pRaw);
    tabs.loadRosterKnown();
    localStorage.setItem(OWNER_KEY, 'acct-first');
    expect(tabs.rosterOwnerSwitched()).toBe(false);
    otherTabWrites([pc('a', 'Ayla', 1)], lineage.rosterSig(pRaw), lineage.rosterSig);
    expect(tabs.takeForeignRoster()?.kind).toBe('write');
  });

  /*
   * …and the player is TOLD (a checker's finding, 2026-10-20): a held write used to be dropped without a
   * word, so in a tab whose key stayed empty every edit was lost with no "can't save" banner. The result
   * callback (App: the save-failed banner) now hears `false`; the next write that lands clears it.
   * MUTATION (run 2026-10-20): `if (roster === HOLD_WRITE) return;` (no onResult) in persist.writePending —
   * this fails on `the player is told it was not saved: expected [] to deeply equal [ false ]`.
   * Fix-up F2 (2026-10-20): the result says WHY — 'held' — so App's banner names the account switch
   * instead of blaming browser storage. MUTATION (run 2026-10-20): `onResult(false)` (no reason) in
   * writePending → `held back, not refused by storage: expected [ undefined ] to deeply equal [ 'held' ]`.
   */
  it('persist: a roster the reconcile step holds back is not written, remembered or handed to cloud sync — and is reported unsaved', async () => {
    const { persist } = await modules();
    const writer = vi.fn((_r: unknown) => true);
    const after = vi.fn();
    const results: boolean[] = [];
    const reasons: unknown[] = [];
    persist.setupPersist(
      writer,
      (ok, reason) => {
        results.push(ok);
        reasons.push(reason);
      },
      () => persist.HOLD_WRITE,
    );
    persist.setOnPersisted(after);
    persist.persistNow([pc('old', 'Old Account Hero')]);
    expect(writer).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(persist.recentPersists()).toEqual([]);
    expect(persist.hasPendingPersist()).toBe(false);
    expect(results, 'the player is told it was not saved').toEqual([false]);
    expect(reasons, 'held back, not refused by storage').toEqual(['held']);
  });
});

describe('two tabs settle', () => {
  it('a parsed roster re-parses to itself — a tab writing back what it parsed from the other tab’s write ends the exchange', async () => {
    // Each tab writes what it merged; a merge of a write it only adopted is that write PARSED (normalised
    // by loadRoster's parse). Were parsing not a fixed point on its own output, two open tabs would
    // rewrite the same roster at each other forever.
    const { storage } = await modules();
    const { content } = await import('./_content');
    const { buildCharacter, emptyBuild } = await import('../src/rules/build');
    const { initialPlay } = await import('../src/rules/play');
    const db = content();
    const build = { ...emptyBuild(), name: 'Settle', level: 3, ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'acolyte', classId: 'fighter', keyAbility: 'str' as const };
    const character = buildCharacter(build, db);
    const once = JSON.stringify(storage.parseRoster(JSON.stringify([{ id: 's1', character, build, play: initialPlay(character, db) }])));
    expect(JSON.stringify(storage.parseRoster(once))).toBe(once);
  }, 120_000);
});

describe('persist: the write carries what the other tab wrote', () => {
  it('reconcile runs on the queued roster before the write, and what it returns is what is written and remembered', async () => {
    const { persist } = await modules();
    const writer = vi.fn((_r: unknown) => true);
    persist.setupPersist(writer, () => undefined, (r: { v: number }) => ({ v: r.v + 100 }));
    persist.persistNow({ v: 1 });
    expect(writer).toHaveBeenCalledWith({ v: 101 });
    expect(persist.recentPersists()).toEqual([{ v: 101 }]);
  });

  it('foldIntoPersist rewrites the QUEUED roster (its timer kept), or queues the fold when nothing is', async () => {
    vi.useFakeTimers();
    try {
      const { persist } = await modules();
      const writer = vi.fn((_r: unknown) => true);
      persist.setupPersist(writer, () => undefined);
      persist.schedulePersist({ mine: 1 });
      vi.advanceTimersByTime(200);
      persist.foldIntoPersist((r: object) => ({ ...r, theirs: 2 }), { stale: true });
      vi.advanceTimersByTime(200); // the ORIGINAL 400 ms
      expect(writer).toHaveBeenCalledWith({ mine: 1, theirs: 2 });
      persist.foldIntoPersist((r: object) => ({ ...r, theirs: 3 }), { current: true });
      expect(persist.hasPendingPersist(), 'nothing was queued: the fold of the current roster is').toBe(true);
      persist.flushPersist(); // a tab closing before React rendered the fold
      expect(writer).toHaveBeenLastCalledWith({ current: true, theirs: 3 });
    } finally {
      vi.useRealTimers();
    }
  });
});
