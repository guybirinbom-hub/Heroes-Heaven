// @vitest-environment jsdom
/*
 * G8 settle round 3 (2026-10-01): the Homebrew page's import against the REAL campaign-homebrew pull
 * (src/data/campaignHomebrew.ts) and a fake `campaign_homebrew` table, as test/campaign-homebrew-pull.test.ts
 * runs it. The refuter's probes, each kept as a leg:
 *   - a campaign joined AFTER the last pull read as "known" (the copy's stamp only named the account),
 *     so the import skipped the pull and wrote that campaign GM's shared ids as the player's own — where
 *     they sit on top of her live copy for good (data/index.ts mergeWithSeed, own = layer 3);
 *   - a pull that could not read one campaign (one bad row) still stamped the whole copy, so the same
 *     happened through the pull.
 * A copy now names the campaigns it holds a FULL read of (pullOnce → saveCampaignHbCache's `pulledFor`),
 * and storage.ts campaignHbCacheKnown checks the player's campaigns against it.
 * Settle round 4 adds the refuter's next probes: signed in before this session's first cloud pull (the
 * membership list is unsynced — empty on a fresh device), signed out (no pull can run), and a pull that
 * could not keep what it read for want of room. Settle round 5: that storage-full answer ends with its
 * session (stop()), and a campaign the player LEFT never makes it. All names are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

const sb = vi.hoisted(() => {
  type Filter = [op: 'eq' | 'in', col: string, val: unknown];
  type Call = { table: string; filters: Filter[]; range?: [number, number] };
  const state = {
    rows: [] as Record<string, unknown>[],
    selects: 0,
    /** Offline: every read fails. */
    failSelect: false,
    /** Signed out: the auth client holds no session (and says so without an error). */
    signedOut: false,
    /** The auth client can't answer: an expired token it couldn't refresh offline (no session, an error). */
    authError: false,
  };
  const match = (r: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) => (op === 'eq' ? r[col] === val : (val as unknown[]).includes(r[col])));
  const from = (table: string) => {
    const c: Call = { table, filters: [] };
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => (c.filters.push(['eq', col, val]), q),
      in: (col: string, val: unknown) => (c.filters.push(['in', col, val]), q),
      order: () => q,
      range: (a: number, b: number) => ((c.range = [a, b]), q),
      abortSignal: () => q,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            state.selects++;
            if (state.failSelect) return { data: null, error: { message: 'TypeError: Failed to fetch' }, count: null };
            const hit = state.rows.filter((r) => match(r, c.filters));
            const page = c.range ? hit.slice(c.range[0], c.range[1] + 1) : hit;
            return { data: JSON.parse(JSON.stringify(page)), error: null, count: hit.length };
          })
          .then(res, rej),
    };
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-player-syn' } }, error: null }),
      getSession: async () =>
        state.authError
          ? { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }
          : { data: { session: state.signedOut ? null : { user: { id: 'u-player-syn' } } }, error: null },
    },
    from,
    channel: () => channel,
    removeChannel: () => undefined,
  };
  return { state, client };
});

// This session's first cloud pull has landed, unless a leg says otherwise.
const session = vi.hoisted(() => ({ synced: true }));
vi.mock('../src/data/supabase', () => ({ supabase: sb.client, isCloudConfigured: true, isCloudSyncEnabled: true }));
vi.mock('../src/data/cloudSync', () => ({ hasSyncedOnce: () => session.synced }));
// core.json: the pull waits on it so a printed id is never converted.
vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ feats: { 'core-feat-syn': { id: 'core-feat-syn', name: 'Printed Feat' } } }) }));

import { HomebrewPage } from '../src/sheet/HomebrewPage';
import {
  CAMPAIGN_HB_CACHE_KEY,
  campaignHbCacheKnown,
  loadCampaignHbCache,
  loadHomebrewContent,
  loadHomebrewSources,
  saveCampaigns,
  saveSyncOwner,
} from '../src/data/storage';
import { campaignHomebrewStorageFull, refreshCampaignHomebrew, startCampaignHomebrew } from '../src/data/campaignHomebrew';
import { renderDom } from './_render';
import type { ContentDatabase } from '../src/rules/types';

const UID = 'u-player-syn';
const CAMP1 = { id: 'camp-syn-1', code: 'SYN111', role: 'player' as const, name: 'Synthetic Marches' };
const CAMP2 = { id: 'camp-syn-2', code: 'SYN222', role: 'player' as const, name: 'Synthetic Hollows' };
const AT = '2026-10-01T10:00:00.000Z';
const srcRow = (cid: string, id: string, name: string) => ({ campaign_id: cid, kind: 'source', id, source_id: id, data: { id, name }, updated_at: AT });
const featRow = (cid: string, id: string, sid: string, data: Record<string, unknown> = { id, name: id, homebrewSourceId: sid }) => ({
  campaign_id: cid,
  kind: 'feats',
  id,
  source_id: sid,
  data,
  updated_at: AT,
});

// What a GM shares, and her own Homebrew export file carrying the very same ids, plus one of the player's own.
const GM_SRC = 'hbsrc-syn-gm';
const GM_FEAT = 'syn-gm-feat';
const OWN_SRC = { id: 'hbsrc-syn-own', name: 'Synthetic Own Book' };
const OWN_FEAT = { id: 'syn-own-feat', name: 'Synthetic Own Step', homebrewSourceId: OWN_SRC.id };
const gmShares = (cid: string) => [srcRow(cid, GM_SRC, 'Synthetic GM Book'), featRow(cid, GM_FEAT, GM_SRC)];
const FILE = JSON.stringify({
  app: 'heroes-heaven',
  kind: 'homebrew',
  version: 1,
  sources: { [GM_SRC]: { id: GM_SRC, name: 'Synthetic GM Book' }, [OWN_SRC.id]: OWN_SRC },
  content: { feats: { [GM_FEAT]: { id: GM_FEAT, name: GM_FEAT, homebrewSourceId: GM_SRC }, [OWN_FEAT.id]: OWN_FEAT } },
});
const CONTENT_KEY = 'wanderers-codex:homebrew-content:v1';
const SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const dialog = () => document.body.querySelector('.confirm-modal');

/** Import FILE through the real page; hand back the notice's text (and close it). */
async function importFile(): Promise<string> {
  const r = renderDom(<HomebrewPage content={{} as ContentDatabase} onChanged={() => undefined} onClose={() => undefined} />);
  const input = r.host.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([FILE], 'gm-export.json', { type: 'application/json' })] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The real pull is several awaits deep: let it run out.
  for (let i = 0; i < 5 && !dialog(); i++) await settle();
  const text = dialog()?.textContent ?? '';
  act(() => {
    (dialog()?.querySelector('.confirm-actions button') as HTMLButtonElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
  r.stop();
  return text;
}

let stop = () => {};

beforeEach(async () => {
  document.body.innerHTML = '';
  localStorage.clear();
  Object.assign(sb.state, { rows: [], selects: 0, failSelect: false, signedOut: false, authError: false });
  session.synced = true;
  saveSyncOwner(UID);
  saveCampaigns([CAMP1]);
  stop = startCampaignHomebrew({ onChanged: () => undefined });
  await refreshCampaignHomebrew(); // the start's own pull: camp-syn-1 shares nothing
});

afterEach(() => stop());

describe('the import against the real campaign-homebrew pull', () => {
  it('a pull that went through is known for the campaigns it read, and only those', () => {
    expect(campaignHbCacheKnown(UID)).toBe(true);
    saveCampaigns([CAMP1, CAMP2]); // joined since that pull
    // MUTATION PROOF (tried 2026-10-01, round 3): storage.ts campaignHbCacheKnown without the `.every(…)`
    // coverage check (the stamp alone) — AssertionError: expected true to be false
    expect(campaignHbCacheKnown(UID)).toBe(false);
  });

  it('joined a campaign after the last pull, offline: the import tries a pull, refuses, and writes nothing', async () => {
    saveCampaigns([CAMP1, CAMP2]);
    sb.state.rows = gmShares(CAMP2.id);
    sb.state.failSelect = true;
    const content = localStorage.getItem(CONTENT_KEY);
    const sources = localStorage.getItem(SOURCES_KEY);
    const reads = sb.state.selects;
    // The refuter's probe P1 — before this round: 'Homebrew importedAdded 1 feat and 1 source.' with
    // own feats ["syn-gm-feat"]. MUTATION PROOF (tried 2026-10-01, round 3): storage.ts campaignHbCacheKnown
    // without the coverage check — AssertionError: expected 'Homebrew importedAdded 2 feats and 2 …' to contain 'Can\'t import yet'
    const text = await importFile();
    expect(text).toContain("Can't import yet");
    expect(sb.state.selects).toBeGreaterThan(reads); // the pull was tried
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
  });

  it('joined a campaign after the last pull, online: the import pulls first and skips what the new campaign shares', async () => {
    saveCampaigns([CAMP1, CAMP2]);
    sb.state.rows = gmShares(CAMP2.id);
    const reads = sb.state.selects;
    // MUTATION PROOF (each tried 2026-10-01, round 3) — pullOnce's saveCampaignHbCache without the read
    // list (`pulledFor` left to its default): the pull lands but the copy still vouches for nothing —
    //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
    // storage.ts campaignHbCacheKnown without the coverage check: no pull is tried and the GM's ids land (P1b) —
    //   AssertionError: expected 2 to be greater than 2
    const text = await importFile();
    expect(sb.state.selects).toBeGreaterThan(reads);
    expect(text).toContain('Homebrew imported');
    expect(text).toContain('Added 1 feat and 1 source.');
    expect(text).toContain('Skipped 1 feat and 1 source a campaign already shares with you.');
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toMatchObject(OWN_FEAT);
    expect(loadHomebrewContent().feats[GM_FEAT]).toBeUndefined();
    expect(loadHomebrewSources()[GM_SRC]).toBeUndefined();
    expect(campaignHbCacheKnown(UID)).toBe(true);
  });

  it('a campaign with a row the pull cannot read stays UNKNOWN: refused until the GM fixes it', async () => {
    // The refuter's probe P2: one entry row whose data has no name.
    sb.state.rows = [...gmShares(CAMP1.id), featRow(CAMP1.id, 'syn-gm-broken', GM_SRC, { id: 'syn-gm-broken', homebrewSourceId: GM_SRC })];
    await refreshCampaignHomebrew(); // a background pull reads it
    // MUTATION PROOF (tried 2026-10-01, round 3): pullOnce writes every id it asked for as read (no
    // `!bad.has(cid)` filter) — AssertionError: expected true to be false
    expect(campaignHbCacheKnown(UID)).toBe(false);
    expect(loadCampaignHbCache()[CAMP1.id]).toBeUndefined(); // no old copy to keep
    const content = localStorage.getItem(CONTENT_KEY);
    const sources = localStorage.getItem(SOURCES_KEY);
    // The import's own pull meets the same row: still unknown, refused.
    expect(await importFile()).toContain("Can't import yet");
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);

    // The GM fixes the row: the import's own pull reads it whole, and the GM's ids are skipped.
    sb.state.rows = gmShares(CAMP1.id);
    const text = await importFile();
    expect(text).toContain('Homebrew imported');
    expect(text).toContain('Skipped 1 feat and 1 source a campaign already shares with you.');
    expect(loadHomebrewContent().feats[GM_FEAT]).toBeUndefined();
  });

  it('a campaign whose conversion the storage refused stays UNKNOWN until a pull finishes it', async () => {
    sb.state.rows = gmShares(CAMP1.id);
    await refreshCampaignHomebrew();
    expect(campaignHbCacheKnown(UID)).toBe(true);
    sb.state.rows = []; // the GM unshares: her book becomes the player's own (convertGone)
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === CONTENT_KEY && value.includes(GM_FEAT)) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    try {
      await refreshCampaignHomebrew();
    } finally {
      spy.mockRestore();
    }
    // The cache holds the OLD copy of camp-syn-1, not a read of what is shared now.
    // MUTATION PROOF (tried 2026-10-01, round 3): pullOnce without the `!unfinished.has(cid)` filter —
    //   AssertionError: expected true to be false
    expect(loadCampaignHbCache()[CAMP1.id]).toBeDefined();
    expect(campaignHbCacheKnown(UID)).toBe(false);
    await refreshCampaignHomebrew(); // room again: it finishes
    expect(loadHomebrewContent().feats[GM_FEAT]).toMatchObject({ homebrewSourceId: `hbsrc-kept-${GM_SRC}` });
    expect(campaignHbCacheKnown(UID)).toBe(true);
  });

  /* ---- Settle round 4 (2026-10-01) ------------------------------------------------------------------- */

  /** Make every write the predicate picks fail as a full device does; the rest still write. */
  function full(when: (key: string, value: string) => boolean) {
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (when(key, value)) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    return () => spy.mockRestore();
  }

  it('signed in before the first cloud pull lands (a fresh device): refused, nothing written; once it lands the GM’s ids are skipped', async () => {
    // The refuter's probe P1 — before this round: 'Homebrew imported Added 2 feats and 2 sources.' with the
    // GM's feat as the player's own, which went on shadowing her live copy after the sync landed.
    stop();
    localStorage.clear();
    saveSyncOwner(UID); // startCloudSync saves it BEFORE its first pull
    session.synced = false;
    sb.state.rows = gmShares(CAMP1.id);
    stop = startCampaignHomebrew({ onChanged: () => undefined });
    expect(await refreshCampaignHomebrew()).toBe(false); // nothing is pulled before the first sync
    // MUTATION PROOF (tried 2026-10-01, round 4): drop `if (account === 'signed-in' && !hasSyncedOnce()) return true;`
    // from HomebrewPage campaignHomebrewUnknown — AssertionError: expected 'Homebrew importedAdded 2 feats and 2 …' to contain 'Can\'t import yet'
    const text = await importFile();
    expect(text).toContain("Can't import yet");
    expect(text).toContain("Try again when you're online.");
    expect(localStorage.getItem(CONTENT_KEY)).toBeNull();
    expect(localStorage.getItem(SOURCES_KEY)).toBeNull();
    // Offline long enough for the token to expire: the auth client answers "no session" WITH an error.
    // That is not a sign-out, and the import still waits.
    // MUTATION PROOF (tried 2026-10-01, round 4): drop `!res.error &&` from campaignHomebrew.ts accountStateHere —
    //   AssertionError: expected 'Homebrew importedAdded 2 feats and 2 …' to contain 'Can\'t import yet'
    sb.state.authError = true;
    expect(await importFile()).toContain("Can't import yet");
    expect(localStorage.getItem(CONTENT_KEY)).toBeNull();
    sb.state.authError = false;

    // The sync lands, and the list it brings holds the campaign: the import pulls it first.
    saveCampaigns([CAMP1]);
    session.synced = true;
    const after = await importFile();
    expect(after).toContain('Homebrew imported');
    expect(after).toContain('Skipped 1 feat and 1 source a campaign already shares with you.');
    expect(loadHomebrewContent().feats[GM_FEAT]).toBeUndefined();
    expect(loadHomebrewSources()[GM_SRC]).toBeUndefined();
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toMatchObject(OWN_FEAT);
  });

  it('signed out with a campaign this device has not read: refused with "Sign in", and no read is tried', async () => {
    // The refuter's probe P2: memberships and the sync owner survive a sign-out, and signed out the
    // campaign homebrew is stopped — "Try again when you're online" could never help.
    stop(); // what App does on a sign-out
    sb.state.signedOut = true;
    session.synced = false;
    saveCampaigns([CAMP1, CAMP2]); // camp-syn-2 was never read here
    sb.state.rows = gmShares(CAMP2.id);
    const reads = sb.state.selects;
    // MUTATION PROOF (tried 2026-10-01, round 4): drop the signed-out branch of HomebrewPage cantImportYet —
    //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Your campaign homebrew couldn\'t be r…'
    const text = await importFile();
    expect(text).toContain("Can't import yet");
    expect(text).toContain("Your campaign homebrew couldn't be read on this device yet. Sign in, then try again.");
    expect(text).not.toContain('online');
    expect(sb.state.selects).toBe(reads);
    expect(loadHomebrewContent().feats[GM_FEAT]).toBeUndefined();
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toBeUndefined();
  });

  it('a pull that could not keep a conversion for want of room says the storage is full — not "go online", not "ask your GM"', async () => {
    // The refuter's probe P4: the GM unshares, and the storage refuses the conversion of her book.
    sb.state.rows = gmShares(CAMP1.id);
    await refreshCampaignHomebrew();
    sb.state.rows = [];
    const restore = full((key, value) => key === CONTENT_KEY && value.includes(GM_FEAT));
    try {
      await refreshCampaignHomebrew();
      expect(campaignHomebrewStorageFull()).toBe(true);
      const reads = sb.state.selects;
      // MUTATION PROOF (each tried 2026-10-01, round 4) — campaignHomebrew.ts pullOnce without its
      // `pullFull = …` answer, or with `ids.some(…)` → `false`: the flag check above fails —
      //   AssertionError: expected false to be true
      // HomebrewPage cantImportYet without its storage branch —
      //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Your campaign homebrew couldn\'t be s…'
      const text = await importFile(); // its own pull meets the same full storage
      expect(sb.state.selects).toBeGreaterThan(reads);
      expect(text).toContain("Can't import yet");
      expect(text).toContain("Your campaign homebrew couldn't be saved on this device — its storage is full. Free up some space, then try again.");
      expect(text).not.toContain('online');
      expect(text).not.toContain('ask your GM');
      // Offline now: the pull that stopped short answers for itself — the connection, not the storage.
      // MUTATION PROOF (tried 2026-10-01, round 4): drop pullOnce's opening `pullFull = false;` —
      //   AssertionError: expected true to be false
      sb.state.failSelect = true;
      const offline = await importFile();
      expect(campaignHomebrewStorageFull()).toBe(false);
      expect(offline).toContain("Can't import yet");
      expect(offline).toContain("Try again when you're online.");
      sb.state.failSelect = false;
    } finally {
      restore();
    }
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toBeUndefined(); // the refusals wrote nothing
    // Room again: the import's pull finishes the conversion, and the import goes through.
    const text = await importFile();
    expect(text).toContain('Homebrew imported');
    expect(campaignHomebrewStorageFull()).toBe(false);
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toMatchObject(OWN_FEAT);
  });

  it('a pull whose own cache write the storage refuses leaves a new campaign unread, and says the storage is full', async () => {
    saveCampaigns([CAMP1, CAMP2]); // joined since the last pull
    sb.state.rows = gmShares(CAMP2.id);
    const restore = full((key) => key === CAMPAIGN_HB_CACHE_KEY);
    let text = '';
    try {
      // MUTATION PROOF (each tried 2026-10-01, round 4) — pullOnce's answer without `!saved ||`, or
      // storage.ts saveCampaignHbCache answering true from its catch —
      //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'its storage is full'
      text = await importFile();
    } finally {
      restore();
    }
    expect(text).toContain("Can't import yet");
    expect(text).toContain('its storage is full');
    expect(campaignHbCacheKnown(UID)).toBe(false);
    expect(loadHomebrewContent().feats[GM_FEAT]).toBeUndefined();
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toBeUndefined();
  });

  /* ---- Settle round 5 (2026-10-01) ------------------------------------------------------------------- */

  it('the storage-full answer ends with its session: signed out and in again, an import before the first pull hears about the sync', async () => {
    // The refuter's probe P-A: the flag outlived stop(), so after a sign-out and a sign-in an import made
    // before the new session's first cloud pull was told the storage is full — the cause is the sync, and
    // the device may have room by now.
    sb.state.rows = gmShares(CAMP1.id);
    await refreshCampaignHomebrew();
    sb.state.rows = []; // the GM unshares, and the storage refuses the conversion of her book
    const restore = full((key, value) => key === CONTENT_KEY && value.includes(GM_FEAT));
    try {
      await refreshCampaignHomebrew();
    } finally {
      restore(); // room again from here on
    }
    expect(campaignHomebrewStorageFull()).toBe(true);
    stop(); // what App does on a sign-out
    session.synced = false; // signed in again: this session's first cloud pull has not landed
    const reads = sb.state.selects;
    // MUTATION PROOF (tried 2026-10-01, round 5): drop `pullFull = false;` from campaignHomebrew.ts stop() —
    //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Try again when you\'re online.'
    const between = await importFile();
    expect(between).toContain("Can't import yet");
    expect(between).toContain("Try again when you're online.");
    expect(between).not.toContain('its storage is full');
    expect(campaignHomebrewStorageFull()).toBe(false);
    expect(sb.state.selects).toBe(reads); // stopped: no pull ran to answer afresh
    // The new session starts (its first cloud pull still not landed): the same answer.
    stop = startCampaignHomebrew({ onChanged: () => undefined });
    const started = await importFile();
    expect(started).toContain("Try again when you're online.");
    expect(started).not.toContain('its storage is full');
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toBeUndefined(); // the refusals wrote nothing
    // It lands, with room: the import's own pull finishes the conversion, and the import goes through.
    session.synced = true;
    const after = await importFile();
    expect(after).toContain('Homebrew imported');
    expect(campaignHomebrewStorageFull()).toBe(false);
    expect(loadHomebrewContent().feats[GM_FEAT]).toMatchObject({ homebrewSourceId: `hbsrc-kept-${GM_SRC}` });
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toMatchObject(OWN_FEAT);
  });

  it("a LEFT campaign whose conversion the storage refused does not turn another campaign's refusal into a storage one", async () => {
    // Only a campaign the player is still in counts toward "storage is full" (pullOnce's
    // `ids.some((cid) => unfinished.has(cid))`): a left one converts too, but the read list never asks
    // about it — so its failure must not relabel why a campaign she IS in can't be read.
    const GM2_SRC = 'hbsrc-syn-gm2';
    const GM2_FEAT = 'syn-gm2-feat';
    saveCampaigns([CAMP1, CAMP2]);
    sb.state.rows = [srcRow(CAMP2.id, GM2_SRC, 'Synthetic Hollows Book'), featRow(CAMP2.id, GM2_FEAT, GM2_SRC)];
    await refreshCampaignHomebrew();
    expect(campaignHbCacheKnown(UID)).toBe(true);
    // She leaves camp-syn-2 (its book becomes her own, and the storage refuses it), and camp-syn-1 now holds
    // a row the pull can't read: unknown for a reason that is not the storage.
    saveCampaigns([CAMP1]);
    sb.state.rows = [...gmShares(CAMP1.id), featRow(CAMP1.id, 'syn-gm-broken', GM_SRC, { id: 'syn-gm-broken', homebrewSourceId: GM_SRC })];
    const restore = full((key, value) => key === CONTENT_KEY && value.includes(GM2_FEAT));
    let text = '';
    try {
      await refreshCampaignHomebrew(); // a background pull leaves camp-syn-1 unread, so the import pulls again
      expect(campaignHbCacheKnown(UID)).toBe(false);
      text = await importFile(); // its own pull meets the same two
    } finally {
      restore();
    }
    // The leg's premise: the left campaign's conversion really did not finish (its old copy is kept in the
    // cache until it lands; a finished one drops out), and nothing of it reached her store.
    expect(loadCampaignHbCache()[CAMP2.id]).toBeDefined();
    expect(loadHomebrewContent().feats[GM2_FEAT]).toBeUndefined();
    // MUTATION PROOF (tried 2026-10-01, round 5): widen pullOnce's answer to any unfinished campaign —
    // `ids.some((cid) => unfinished.has(cid))` → `unfinished.size > 0` —
    //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Try again when you\'re online.'
    expect(text).toContain("Can't import yet");
    expect(text).toContain("Try again when you're online.");
    expect(text).not.toContain('its storage is full');
    expect(campaignHomebrewStorageFull()).toBe(false);
    expect(loadHomebrewContent().feats[OWN_FEAT.id]).toBeUndefined(); // refused: nothing written
  });
});
