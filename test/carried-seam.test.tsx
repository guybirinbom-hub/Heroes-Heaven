// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { SavedChar } from '../src/data/storage';
import type { BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * OWNER RULING 2026-10-20 (Guy): "the others should see the same item as the player". The sites that
 * derive a sheet that is not this device's own, beyond the sheet views carried-view.test.tsx covers —
 * each with a planted case (2026-10-20, checker finding coverage-F2: reverting any of them to plain
 * `content` left every suite green):
 *   - the tracker's PC stats (CampaignTracker → sheetPcStats),
 *   - the tracker seam's vitals (vitalsFromSheet) and its push (pushSheetWithVitals: rule E identity),
 *   - the roster card and the roster search (RosterScreen, the character's own view).
 * The record is a custom ANCESTRY the player made: it names the character's ancestry and gives its
 * Ancestry HP, so a view without it shows a blank ancestry and 12 fewer Hit Points.
 *
 * Every character and record here is synthetic.
 */

const server = vi.hoisted(() => ({
  chars: new Map<string, Record<string, unknown>>(),
  edits: new Map<string, Record<string, unknown>>(),
  editWrites: [] as Record<string, unknown>[],
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [...(table === 'campaign_characters' ? server.chars : server.edits).values()];
  function from(table: string) {
    const where: Record<string, unknown> = {};
    const matched = () => rows(table).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    const answer = () => ({ data: matched(), error: null });
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        where[col] = val;
        return q;
      },
      order: () => Promise.resolve(answer()),
      maybeSingle: () => Promise.resolve({ data: matched()[0] ?? null, error: null }),
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: Record<string, unknown>) => {
        const key = `${row.campaign_id as string}|${row.char_id as string}`;
        if (table === 'campaign_characters') server.chars.set(key, row);
        else {
          server.edits.set(key, row);
          server.editWrites.push(row);
        }
        return Promise.resolve({ error: null });
      },
      delete: () => q,
    };
    return q;
  }
  const channel = {
    on: () => channel,
    subscribe(cb?: (s: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    supabase: {
      from,
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'gm-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'gm-1' } } }),
        signOut: async () => ({ error: null }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { applyPlayState, initialPlay } = await import('../src/rules/play');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { computePcStats, sheetPcStats } = await import('../src/integration/computePcStats');
const { pushSheetWithVitals, vitalsFromSheet } = await import('../src/integration/pcSheetTruth');
const { fetchPublishedSheet, forgetMissingColumns, pushGmEdit } = await import('../src/data/party');
const { clearGmPendingEdits, gmBaseOf, gmPendingEdit } = await import('../src/sheet/gmSync');
const { collectCarried } = await import('../src/data/carried');
const { deriveMaxHp } = await import('../src/rules/derive');
const { RosterScreen } = await import('../src/sheet/RosterScreen');

const db = content(); // the GM's / this viewer's database: no Tidekin
const CAMPAIGN = 'camp-seam-carry';
const PLAYER = 'player-tide';
const CHAR = 'pc-tide';
const AT = '2026-10-20T10:00:00.000Z';

const TIDEKIN = {
  ...(db.ancestries.human as object),
  id: 'hb-anc-tidekin',
  name: 'Tidekin',
  hp: 12,
  source: { license: 'homebrew', book: 'Shoal Notes' },
};
/** The PLAYER's database: the viewer's plus their own ancestry. */
const ownerDb = { ...db, ancestries: { ...db.ancestries, [TIDEKIN.id]: TIDEKIN } } as unknown as ContentDatabase;

/** A level-2 Tidekin fighter, published the way App's publish does: `carried` collected from the player's view. */
function playerSheet(opts: { withCarried?: boolean } = {}): SavedChar {
  const build = { ...emptyBuild(), name: 'Maren Shoal', level: 2, ancestryId: TIDEKIN.id, classId: 'fighter', keyAbility: 'str' } as BuildState;
  const character = buildCharacter(build, ownerDb);
  const sc = { id: CHAR, character, build, play: initialPlay(character, ownerDb) } as SavedChar;
  if (opts.withCarried === false) return sc;
  const carried = collectCarried(sc, ownerDb);
  return { ...sc, ...(carried ? { carried } : {}) };
}
const ownerMaxHp = () => {
  const sc = playerSheet();
  return deriveMaxHp(applyPlayState(sc.character, sc.play, ownerDb), ownerDb);
};

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  server.chars.clear();
  server.edits.clear();
  server.editWrites.length = 0;
  forgetMissingColumns();
  clearGmPendingEdits();
  localStorage.clear();
});

describe('fixture', () => {
  it('the ancestry is the player’s own, carried, and worth 12 Hit Points', () => {
    expect(db.ancestries[TIDEKIN.id], 'the viewer lacks it').toBeUndefined();
    expect(Object.keys(playerSheet().carried?.ancestries ?? {})).toEqual([TIDEKIN.id]);
    const sc = playerSheet();
    const without = deriveMaxHp(applyPlayState(sc.character, sc.play, db), db);
    expect(ownerMaxHp() - without, 'the planted bad case: without the record, 12 HP short').toBe(12);
  });
});

describe("the tracker's PC stats (CampaignTracker → sheetPcStats)", () => {
  it("name the carried ancestry and count its Hit Points, as the player's own sheet does", () => {
    // mutation-proof: make sheetPcStats `computePcStats(livePlay(sheet, view), content)` (src/integration/
    // computePcStats.ts) and this goes red: no "Tidekin" and 12 HP short.
    const sc = playerSheet();
    const own = computePcStats(applyPlayState(sc.character, sc.play, ownerDb), ownerDb);
    const gm = sheetPcStats(sc, db);
    expect(gm.ancestryClass).toContain('Tidekin');
    expect(gm.maxHP).toBe(own.maxHP);
    expect(gm.maxHP).toBe(ownerMaxHp());
  });
});

describe('the tracker seam (pcSheetTruth)', () => {
  it("vitalsFromSheet's maximum HP is the player's", () => {
    // mutation-proof: make vitalsFromSheet `maxHpOf(live, content)` (src/integration/pcSheetTruth.ts) and this
    // goes red: 12 HP short, so every GM hit and heal would clamp against the wrong maximum.
    expect(vitalsFromSheet(playerSheet(), db).maxHP).toBe(ownerMaxHp());
  });

  it("a push is the very object the row and the pending overlay hold — even when the published sheet carried nothing", async () => {
    // Rule E: the seam knows its own push coming back by OBJECT (`ours`). An older player app published no
    // `carried`; the GM's database has the record, so the push carries it — attached before pushGmEdit, so
    // pushGmEdit sends, and remembers, that very object.
    // mutation-proof: make pushSheetWithVitals return `sheetWithVitals(...)` alone (src/integration/
    // pcSheetTruth.ts) and this goes red: the overlay holds a copy, and his push comes back as an arrival.
    const published = playerSheet({ withCarried: false });
    server.chars.set(`${CAMPAIGN}|${CHAR}`, { campaign_id: CAMPAIGN, owner_id: PLAYER, char_id: CHAR, name: 'Maren Shoal', sheet: published, updated_at: AT });
    const gmDb = ownerDb; // he holds the player's record some other way
    const v = { ...vitalsFromSheet(published, gmDb), currentHP: 5 };
    const sent = pushSheetWithVitals(published, v, gmDb);
    expect(Object.keys(sent.carried?.ancestries ?? {}), 'the push carries the ancestry').toEqual([TIDEKIN.id]);
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, sent, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null, gmDb);
    expect(res.ok, 'fixture: the push went').toBe(true);
    // `[length - 1]`, not `.at(-1)`: the repo's tsconfig lib is ES2020 (round 3, 2026-10-20, finding N-d).
    expect(server.editWrites[server.editWrites.length - 1].sheet, 'the row holds the very object').toBe(sent);
    expect(gmPendingEdit(CAMPAIGN, CHAR)?.sheet, 'and so does the overlay rule E reads').toBe(sent);
  });
});

describe('the roster (RosterScreen): the character’s own view', () => {
  function renderRoster(roster: SavedChar[]): HTMLElement {
    if (!window.matchMedia)
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => undefined;
    act(() =>
      root!.render(
        createElement(RosterScreen, {
          roster,
          activeId: CHAR,
          content: db,
          onOpen: noop,
          onNew: noop,
          onImport: noop,
          onDuplicate: noop,
          onArchive: noop,
          onDelete: noop,
        }),
      ),
    );
    return host;
  }

  it('the card names a carried custom ancestry, and searching that name finds the character', () => {
    // 2026-10-20, checker finding coverage-F4: the card read the character's view, the search did not.
    // mutation-proof: make RosterScreen's `originOf` read `content` (not `ownContent(content, c)`) and this goes
    // red at the search; make the card's `db` plain `content` and it goes red at the card.
    const host = renderRoster([playerSheet()]);
    const card = host.querySelector('.rcard');
    expect(card?.textContent ?? '', 'the card names the ancestry').toContain('Tidekin');
    const search = host.querySelector<HTMLInputElement>('input[placeholder="Search characters"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(search, 'tidekin');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.rcard').length, 'searching the ancestry the card shows finds the character').toBe(1);
    act(() => {
      setValue.call(search, 'no-such-origin');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.rcard').length, 'fixture: a search that matches nothing hides it').toBe(0);
  });
});
