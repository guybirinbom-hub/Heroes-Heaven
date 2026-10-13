// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content, build } from './_content';
import type { SavedChar } from '../src/data/storage';

/**
 * THE NEVER-OVERWRITE DOOR IN THE TRACKER → SHEET SEAM (item 3, step 0) — synthetic data only.
 *
 * src/integration/pcSheetTruth.ts used to publish a PC row to the player's own sheet whenever the
 * row differed from the last agreed state and the sheet had not moved. Its memory of "agreed" is
 * kept per CHARACTER for the life of the mount, so every path that puts a different row under the
 * same character — Clear then re-add, Remove then re-add, Load encounter, Ctrl+Z after a plain Next
 * Turn, a board from the GM's other device — published that row (full HP and no conditions, or a
 * stale snapshot) over the player's own damage and conditions as if the GM had typed it.
 *
 * The rules now (the header of pcSheetTruth.ts):
 *   A. Undo and Redo never push. For a PC row they are a load, and the row is re-based on the sheet;
 *      the GM takes a change back with the opposite gesture (Restore, heal, remove the condition).
 *      Nor does a load call back a change of his that is already out; it does drop one only owed.
 *   B. A gesture is the only thing that pushes.
 *   C. A push needs a fresh read, built on the newest thing the server holds (his own pending edit
 *      included, on his own character too, while it stands on a proved base; else the published
 *      sheet) and recorded on that read's stamp: a failed read, or no published sheet, owes the
 *      gesture;
 *      a sheet that no longer carries what the row showed when he made it wins, and the gesture is
 *      dropped. One change out at a time per character; a gesture made meanwhile is made ON it and
 *      goes out next.
 *   D. An unmounted seam writes nothing.
 *   E. Nothing decides "did the player move this" or "is this our echo" by value: a push of his
 *      coming back is told by object, and is never a sheet ARRIVING.
 *   WHICH ROW: charId first (`isSamePc`); a row two members answer to is neither's.
 * Five refute rounds each found a timing hole in the licence that let a Ctrl+Z push the GM's own
 * earlier push back; that licence is gone (rule A), and the round 1–7 probes are legs below, as are
 * round 9's PX1–PX5 and round 10's ZA–ZD and PZ1–PZ3 (the write base).
 * The store's half (which actions are gestures) is pinned in tracker/src/store/vitalsGesture.test.ts.
 * Every MUTATION marked "round 7" was re-tried on 2026-10-01 against round 8's code, and this file
 * still fails on each.
 */

const server = vi.hoisted(() => ({
  /** `campaign_characters`, keyed campaign|char. */
  chars: new Map<string, Record<string, unknown>>(),
  /** `gm_character_edits`, keyed campaign|char. */
  edits: new Map<string, Record<string, unknown>>(),
  /** EVERY push the seam made, in order — the thing these legs count. */
  editWrites: [] as Record<string, unknown>[],
  /** Single-row reads of `campaign_characters` — the fresh read every push re-bases on. */
  sheetReads: 0,
  /** Make those reads FAIL (offline, a blip) — `fetchPublishedSheet` then answers null. */
  failSheetReads: false,
  /** Hold the NEXT single-row read of `campaign_characters` until `releaseRead()` — a push's fresh
   *  read still on the wire. It answers with what the server holds WHEN released (a publish made
   *  meanwhile is in it), or fails if `failSheetReads` is set by then. */
  holdNextRead: false,
  releaseRead: null as null | (() => void),
  /** Hold the NEXT GM edit in flight until `release()` — a push the server has not answered yet. It
   *  is answered as the server would answer at release: refused, if `refuseEdits` is set by then. */
  holdNextEdit: false,
  release: null as null | (() => void),
  /** Make the server REFUSE every GM edit (an RLS refusal) — nothing lands, and each try is counted. */
  refuseEdits: false,
  editRefusals: 0,
  /** Make the NEXT GM edit THROW (a dropped socket) instead of answering. */
  throwNextEdit: false,
  /** F1 (2026-10-09): a database the SQL was never re-run on — `gm_character_edits` has no `gm_base`. */
  noGmBaseColumn: false,
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [
    ...(table === 'campaign_characters' ? server.chars : server.edits).values(),
  ];
  /** jsonb's own key order — shorter keys first, then byte order — never the order they were written in. */
  const jsonbOrder = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(jsonbOrder)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
              .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]),
          )
        : v;
  /**
   * What a read over the network hands back: a COPY of the row, never the object that was written —
   * and, as the `sheet` jsonb column does, with every object's keys in jsonb's order rather than the
   * order they were written in. So a JSON-equality coincidence can never stand in for a guard here
   * (gmSync.pendingEditStillStands compares the published sheet and the edit canonically).
   */
  const wire = (row: Record<string, unknown> | undefined): Record<string, unknown> | null =>
    row ? (jsonbOrder(JSON.parse(JSON.stringify(row))) as Record<string, unknown>) : null;
  /** F1 (2026-10-09): PostgREST's answer for a column the schema cache does not know. */
  const noColumn = (col: string, t: string) => ({
    code: 'PGRST204',
    message: `Could not find the '${col}' column of '${t}' in the schema cache`,
  });
  function from(table: string) {
    const where: Record<string, unknown> = {};
    let cols = '';
    const matched = () => rows(table).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    const answer = () =>
      server.noGmBaseColumn && table === 'gm_character_edits' && cols.includes('gm_base')
        ? { data: null, error: noColumn('gm_base', table) }
        : { data: matched(), error: null };
    const q = {
      select: (c?: string) => {
        cols = c ?? '';
        return q;
      },
      // F1 (2026-10-09): the receipt is a column-only UPDATE of the player's own row.
      update: (fields: Record<string, unknown>) => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => {
            for (const r of rows(table)) if (r[c1] === v1 && r[c2] === v2) Object.assign(r, fields);
            return Promise.resolve({ error: null });
          },
        }),
      }),
      eq: (col: string, val: unknown) => {
        where[col] = val;
        return q;
      },
      order: () => Promise.resolve(answer()),
      maybeSingle: () => {
        if (table === 'campaign_characters') {
          server.sheetReads++;
          if (server.holdNextRead) {
            server.holdNextRead = false;
            return new Promise((done) => {
              server.releaseRead = () =>
                done(
                  server.failSheetReads
                    ? { data: null, error: { message: 'offline' } }
                    : { data: wire(matched()[0]), error: null },
                );
            });
          }
          if (server.failSheetReads) return Promise.resolve({ data: null, error: { message: 'offline' } });
          return Promise.resolve({ data: wire(matched()[0]), error: null });
        }
        return Promise.resolve({ data: matched()[0] ?? null, error: null });
      },
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: Record<string, unknown>) => {
        const key = `${row.campaign_id as string}|${row.char_id as string}`;
        if (table === 'campaign_characters') {
          server.chars.set(key, row);
          return Promise.resolve({ error: null });
        }
        if (server.refuseEdits) {
          server.editRefusals++;
          return Promise.resolve({ error: { message: 'new row violates row-level security policy' } });
        }
        if (server.throwNextEdit) {
          server.throwNextEdit = false;
          return Promise.reject(new Error('socket hang up'));
        }
        if (server.noGmBaseColumn && 'gm_base' in row) return Promise.resolve({ error: noColumn('gm_base', table) });
        // F1 (2026-10-09): MERGE-duplicates, as PostgREST's upsert does — only the columns sent are
        // rewritten, so an older app's upsert leaves the previous push's `gm_base` beside its sheet.
        const land = () => {
          server.edits.set(key, { ...(server.edits.get(key) ?? {}), ...row });
          server.editWrites.push(row);
        };
        if (server.holdNextEdit) {
          server.holdNextEdit = false;
          return new Promise<{ error: null | { message: string } }>((done) => {
            server.release = () => {
              if (server.refuseEdits) {
                server.editRefusals++;
                done({ error: { message: 'new row violates row-level security policy' } });
                return;
              }
              land();
              done({ error: null });
            };
          });
        }
        land();
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

const { computeSummary } = await import('../src/sheet/partySummary');
const { applyPlayState, initialPlay } = await import('../src/rules/play');
const { fetchMemberSheet, fetchParty, fetchPendingGmEdits, fetchPublishedSheet, forgetMissingColumns, gmEditFromRow, pushGmEdit } =
  await import('../src/data/party');
const { clearGmPendingEdits, gmBaseOf, gmEditRefused, gmEditSchemaOutdated, gmEditVerdict, gmPendingEdit, snapshotGmPending } =
  await import('../src/sheet/gmSync');
const { authoredKey, hash53 } = await import('../src/data/authored');
const { usePcSheetTruth, useMemberSheets, vitalsFromSheet } = await import('../src/integration/pcSheetTruth');
const { useCombatStore, scopeKey, flushPersist, invalidateEncounterCache, downedMarker } = await import(
  '../tracker/src/store/combatStore'
);
type PartyMember = import('../src/data/party').PartyMember;

const db = content();
const CAMPAIGN = 'camp-nvo';
const PLAYER = 'player-nvo';
/** The signed-in account (the mocked session): a character of HIS is one the GM plays himself. */
const GM = 'gm-1';
const CHAR = 'pc-nvo';
const NAME = 'Isolde Marrow'; // synthetic
const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T11:00:00.000Z';

function freshSheet(): SavedChar {
  const character = { ...build('fighter', 3), name: NAME };
  return { id: CHAR, character, play: initialPlay(character, db) } as SavedChar;
}
const MAX = vitalsFromSheet(freshSheet(), db).maxHP;

/** The player's OWN sheet: down to 25 HP and Wounded 1 — their damage and their condition. */
function hurt(): SavedChar {
  const sc = freshSheet();
  return { ...sc, play: { ...sc.play!, damage: MAX - 25, conditions: [{ id: 'wounded', value: 1 }] } };
}
/** The same player later, on their own device: stabilised and patched up to 6 HP, Wounded 2. */
function patchedUp(): SavedChar {
  const sc = freshSheet();
  return { ...sc, play: { ...sc.play!, damage: MAX - 6, conditions: [{ id: 'wounded', value: 2 }] } };
}
/**
 * The player's OWN app recording the knock-out the GM marks: 0 HP, Unconscious, Dying 2 (1 + their
 * Wounded 1). Exactly the vitals Mark defeated gives the row — applyPCDefeat mirrors play.ts — so the
 * two sides agree on every value and differ only in WHO wrote it.
 */
function knockedOut(): SavedChar {
  const sc = freshSheet();
  return {
    ...sc,
    play: { ...sc.play!, damage: MAX, conditions: [{ id: 'wounded', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 2 }] },
  };
}

/** What the PLAYER's app does when it publishes: summary + sheet, one row, their own stamp. */
function publish(sc: SavedChar, at: string, owner = PLAYER): void {
  const live = applyPlayState(sc.character, sc.play, db);
  server.chars.set(`${CAMPAIGN}|${sc.id}`, {
    campaign_id: CAMPAIGN,
    owner_id: owner,
    char_id: sc.id,
    name: live.name,
    summary: computeSummary(live, db),
    sheet: sc,
    updated_at: at,
  });
}
/** The player's row on the server — the thing that must never be overwritten. */
const theirs = () => server.chars.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
/** The vitals a pushed sheet carries. */
const pushed = (i: number) => vitalsFromSheet(server.editWrites[i].sheet as SavedChar, db);

/** The seam as the tracker mounts it, with the sheets handed in so a leg decides when one arrives. */
function Seam({ members, sheets }: { members: PartyMember[]; sheets: Map<string, SavedChar> }): ReactElement {
  usePcSheetTruth({ campaignId: CAMPAIGN, members, sheetById: sheets, content: db });
  return <div />;
}

let root: Root | null = null;
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const store = () => useCombatStore.getState();
const pc = () => store().combatants.find((c) => c.isPC)!;
const rowConds = () => pc().conditions.map((c) => `${c.name}:${c.value ?? ''}`).sort();
const frightened = (value: number) => act(() => store().addCondition(pc().id, { name: 'frightened', value, isPermanent: false }));

/** Publish the player's sheet, mount the seam on it, and put them in the initiative order. */
async function mount(sc: SavedChar, owner = PLAYER) {
  publish(sc, T0, owner);
  const members = (await fetchParty(CAMPAIGN))!;
  const sheets = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Seam members={members} sheets={sheets} />));
  await settle();
  const addPc = () =>
    act(() => store().addCombatant(null, { name: NAME, isPC: true, maxHP: members[0].summary.hpMax, charId: CHAR }));
  addPc();
  await settle();
  /** Hand the seam exactly this sheet, as a member read that answered with it does. */
  async function show(sc: SavedChar): Promise<void> {
    const next = new Map([[CHAR, sc]]);
    await act(async () => {
      root!.render(<Seam members={members} sheets={next} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
  }
  return {
    addPc,
    show,
    /** The player's newest publish reaches this screen, as the live subscription delivers it. */
    async deliver() {
      await show((await fetchMemberSheet(CAMPAIGN, CHAR))!);
    },
    /** The GM leaves the campaign: the seam unmounts. */
    unmount() {
      act(() => root!.unmount());
      root = null;
    },
  };
}

/**
 * The seam as the app REALLY wires it (CampaignTracker.tsx feeds useMemberSheets into it): nothing is
 * handed over by hand, and the only reads are the ones the hook makes itself — at mount, and the
 * re-pull a push of the GM's own sets off. The player's 25 HP + Wounded 1, in the initiative order.
 */
async function mountWired(): Promise<void> {
  publish(hurt(), T0);
  const members = (await fetchParty(CAMPAIGN))!;
  function Wired(): ReactElement {
    const sheets = useMemberSheets(CAMPAIGN, members);
    usePcSheetTruth({ campaignId: CAMPAIGN, members, sheetById: sheets, content: db });
    return <div />;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Wired />));
  await settle();
  act(() => store().addCombatant(null, { name: NAME, isPC: true, maxHP: members[0].summary.hpMax, charId: CHAR }));
  await settle();
  expect(pc().currentHP, 'the sheet drives the row').toBe(25);
}

/** The row shows the player's own 25 HP + Wounded 1, and nothing reached their sheet. */
function untouched(why: string): void {
  expect(pc().currentHP, why).toBe(25);
  expect(rowConds(), why).toEqual(['wounded:1']);
  expect(server.editWrites, `${why} — nothing may be pushed to the player`).toEqual([]);
  expect(theirs().play!.damage).toBe(MAX - 25);
  expect(theirs().play!.conditions).toEqual([{ id: 'wounded', value: 1 }]);
}

/** The row shows exactly the knock-out (theirs or his). */
function showsKnockOut(why: string): void {
  expect(pc().currentHP, why).toBe(0);
  expect(rowConds(), why).toEqual(['dying:2', 'unconscious:', 'wounded:1']);
}

beforeEach(() => {
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  server.chars.clear();
  server.edits.clear();
  server.editWrites.length = 0;
  server.sheetReads = 0;
  server.failSheetReads = false;
  server.holdNextRead = false;
  server.releaseRead = null; // a read still held stays unanswered, like a held push below
  server.holdNextEdit = false;
  server.release = null; // a push still held stays unanswered: it must not land in the next leg
  server.refuseEdits = false;
  server.editRefusals = 0;
  server.throwNextEdit = false;
  server.noGmBaseColumn = false;
  forgetMissingColumns();
  clearGmPendingEdits();
  flushPersist();
  localStorage.clear();
});

/*
 * MUTATION (tried 2026-10-01, round 7, on this block alone: `-t a.load.is.not.an.edit`): push on any
 * difference again — `const gesture = true || takeVitalsGesture(c.id);` in reconcile
 * (src/integration/pcSheetTruth.ts) — and all five legs below fail, (1) on `the sheet drives the row:
 * expected 38 to be 25` (the re-created full-HP row is pushed, never rewritten).
 * MUTATION (tried 2026-10-01, round 7): drop the sheet-wins write (`if (ck !== vitalsKey(show))
 * writeVitals(…)`) and all five fail, with most of the file.
 */
describe('a load is not an edit — rows the GM did not touch never reach the player', () => {
  it('(1) Clear the board, then re-add the PC: the sheet stays 25 HP + Wounded 1', async () => {
    const m = await mount(hurt());
    expect(pc().currentHP, 'the sheet drives the row').toBe(25);
    expect(rowConds()).toEqual(['wounded:1']);

    act(() => store().clearAllCombatants());
    m.addPc(); // a brand-new row: full HP, no conditions
    await settle();
    untouched('Clear, then re-add');
  });

  it('(7) Remove the PC, then re-add them: nothing is pushed', async () => {
    const m = await mount(hurt());
    act(() => store().removeCombatant(pc().id));
    m.addPc();
    await settle();
    untouched('Remove, then re-add');
  });

  it('(3) Load encounter: the loaded full-HP row is not pushed', async () => {
    await mount(hurt());
    invalidateEncounterCache();
    act(() => store().saveEncounter('Bridge ambush (never-overwrite)'));
    act(() => store().loadEncounter('Bridge ambush (never-overwrite)', new Map()));
    await settle();
    untouched('Load encounter');
  });

  it('(4) a stale board from the GM’s other device (reloadFromStorage): nothing is pushed', async () => {
    await mount(hurt());
    flushPersist(); // this device's own pending write lands first, then the other device's board over it
    const stale = { ...pc(), id: 'cmb-elsewhere-1', currentHP: MAX, conditions: [], isDefeated: false };
    localStorage.setItem(
      scopeKey('pf2e-current-combat'),
      JSON.stringify({ combatants: [stale], round: 3, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 1, condCounter: 0 }),
    );
    act(() => store().reloadFromStorage());
    await settle();
    expect(pc().id, 'the board really was replaced').toBe('cmb-elsewhere-1');
    untouched('reloadFromStorage');
  });

  it('(2) Next Turn, then the player takes damage on their sheet, then Ctrl+Z: their damage survives', async () => {
    /*
     * The widest door: Next Turn records an undo snapshot (combatStore nextTurn → record), and the
     * sheet writing the row never does. So Ctrl+Z after a plain turn advance put back the row from
     * BEFORE the player's own damage, and that difference was pushed over their sheet.
     *
     * MUTATION (tried 2026-10-01, round 7): make Undo a gesture again — wrap undo's `set(…)` in
     * `asGesture(() => …)` and mark the rows it puts back (tracker/src/store/combatStore.ts) — and this
     * fails, with the rule A legs below —
     *   AssertionError: the player’s own damage survives the GM’s Ctrl+Z: expected 25 to be 18
     * (the undone 25 is pushed over their 18, and the row follows the push). Dropping the sheet-wins
     * write in reconcile fails it too.
     */
    const m = await mount(hurt());
    act(() => store().nextTurn());
    await settle();

    // The player takes 7 on their own sheet and their app publishes it.
    const mine = theirs();
    publish({ ...mine, play: { ...mine.play!, damage: mine.play!.damage + 7 } }, T1);
    await m.deliver();
    expect(pc().currentHP, 'the sheet drives the row').toBe(18);

    act(() => store().undo());
    await settle();
    expect(pc().currentHP, 'the player’s own damage survives the GM’s Ctrl+Z').toBe(18);
    expect(server.editWrites, 'and nothing is pushed over it').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX - 18);

    // Ctrl+Y is the same story the other way round.
    act(() => store().redo());
    await settle();
    expect(pc().currentHP).toBe(18);
    expect(server.editWrites).toEqual([]);
  });
});

describe('rule B — the GM’s own gestures reach the player, and only they do', () => {
  it('(5) Mark defeated pushes exactly once', async () => {
    // MUTATION: drop `markGesture(c)` from setDefeated (tracker/src/store/combatStore.ts) and this
    // fails — expected [] to have a length of 1 but got +0.
    await mount(hurt());
    act(() => store().setDefeated(pc().id, true));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pushed(0).currentHP).toBe(0);
    expect(pushed(0).conditions.map((c) => c.id).sort()).toEqual(['dying', 'unconscious', 'wounded']);

    // …and once only: the passes that follow (another creature, the turn engine) push nothing more.
    act(() => store().addCombatant(null, { name: 'Ash Wight', maxHP: 20 }));
    act(() => store().nextTurn());
    await settle();
    expect(server.editWrites, 'one gesture, one push').toHaveLength(1);
  });

  it('(6) GM damage and a GM condition each push, carrying the player’s own Wounded along', async () => {
    // MUTATION: drop `markGesture(c)` from applyDamage and this fails — expected [] to have a length
    // of 1; drop it from addCondition instead and this fails on `expected [ …(1) ] to have a length of 2`.
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);

    frightened(2);
    await settle();
    expect(server.editWrites).toHaveLength(2);
    expect(pushed(1).currentHP, 'the damage before it is kept').toBe(21);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('(8) a gesture that changes nothing a push carries — temp HP, max HP — pushes nothing', async () => {
    // MUTATION (tried 2026-10-01, round 7): drop `&& ck !== vitalsKey(was)` from the gesture test in
    // reconcile and this fails — expected [ …(2) ] to deeply equal [].
    await mount(hurt());
    act(() => store().setTempHP(pc().id, 5));
    await settle();
    act(() => store().setMaxHP(pc().id, MAX + 10));
    await settle();
    expect(server.editWrites).toEqual([]);
    expect(pc().maxHP, 'his max HP stays on his row').toBe(MAX + 10);
  });
});

describe('rule A — Undo and Redo never push; he takes a change back with the opposite gesture', () => {
  it('Ctrl+Z after his Mark defeated pushes nothing and reads nothing; Restore takes it back', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): Undo a gesture again (as in (2)) and this fails.
     * MUTATION (tried 2026-10-01, round 7): drop `if (st.arrived === arrived) st.shown = held;` from
     * the landed branch of `send` and this fails — the row goes back to the sheet from before his
     * Mark defeated, which the server no longer answers with.
     */
    await mount(hurt());
    act(() => store().setDefeated(pc().id, true));
    await settle();
    expect(server.editWrites).toHaveLength(1);

    const reads = server.sheetReads;
    act(() => store().undo());
    await settle();
    expect(server.editWrites, 'Ctrl+Z pushes nothing').toHaveLength(1);
    expect(server.sheetReads, '…and asks the server nothing').toBe(reads);
    showsKnockOut('the row is re-based on the sheet — his Mark defeated, which the server holds');

    act(() => store().redo());
    await settle();
    expect(server.editWrites, 'Ctrl+Y pushes nothing either').toHaveLength(1);

    // The opposite GESTURE is how he takes it back — and it pushes, like any gesture.
    act(() => store().setDefeated(pc().id, false));
    await settle();
    expect(server.editWrites, 'Restore is a gesture').toHaveLength(2);
    expect(pushed(1).conditions).toEqual([{ id: 'wounded', value: 2 }]);
    expect(rowConds()).toEqual(['wounded:2']);
  });

  const onTheWire = [
    ['the server takes it', 'lands'],
    ['the server refuses it, so it is owed and goes out on the next pass', 'refused'],
  ] as const;
  for (const [how, mode] of onTheWire) {
    it(`a Ctrl+Z while his Mark defeated is on the wire cannot call it back, so the row keeps it — ${how}`, async () => {
      /*
       * Rule A: no load calls back a change that is OUT. Round 6 re-based the row on the sheet here,
       * showing the GM a value the server was about to stop holding — and a gesture he then made on
       * it was dropped when his push landed (the round-6 refuter's PROBE-UNDO-THEN-GESTURE, the legs
       * after this one). Ctrl+Z on a PC row never takes back what was sent; Restore does.
       *
       * MUTATION (tried 2026-10-01, round 7): drop `?? st.out?.v` from `show` in reconcile and both
       * fail —
       *   AssertionError: his change is on its way, and the row keeps it: expected 25 to be +0
       */
      await mount(hurt());
      server.holdNextEdit = true;
      act(() => store().setDefeated(pc().id, true)); // read, sent — the server has not answered
      await settle();
      const reads = server.sheetReads;
      act(() => store().undo());
      await settle();
      expect(pc().currentHP, 'his change is on its way, and the row keeps it').toBe(0);
      showsKnockOut('the Ctrl+Z puts back nothing of his that was sent');
      expect(server.sheetReads, 'and asks the server nothing').toBe(reads);

      if (mode === 'refused') server.refuseEdits = true;
      server.release!();
      await settle();
      server.refuseEdits = false;
      showsKnockOut(mode === 'lands' ? 'the server holds it' : 'refused, it is owed — on his row');
      act(() => store().addCombatant(null, { name: 'Ash Wight', maxHP: 20 })); // any later pass
      await settle();
      expect(server.editRefusals).toBe(mode === 'refused' ? 1 : 0);
      expect(server.editWrites, 'his Mark defeated, once').toHaveLength(1);
      showsKnockOut('the row shows what the server holds');
      expect(theirs().play!.damage, 'the player’s own published sheet is untouched').toBe(MAX - 25);
    });
  }

  it('a Ctrl+Z while a change of his WAITS behind one that is out takes the waiting one off the row, and it never goes out', async () => {
    /*
     * The round-7 refuter's minor: the header and the README said a load takes off only a change
     * that reached nobody. It takes off any change of his not sent yet — owed, or waiting behind the
     * one that is out — and leaves the one that is out alone.
     *
     * MUTATION (tried 2026-10-01, round 8): keep an unsent change through a load — drop
     * `st.want = undefined;` from the load branch of reconcile — and this fails —
     *   AssertionError: the waiting change is off the row: expected [ 'frightened:2', 'wounded:1' ] to deeply equal [ 'wounded:1' ]
     */
    await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // out: 21 HP
    await settle();
    frightened(2); // waits behind it
    await settle();
    act(() => store().undo()); // a load: the board from before his Frightened
    await settle();
    expect(rowConds(), 'the waiting change is off the row').toEqual(['wounded:1']);
    expect(pc().currentHP, 'the change that is out stays on it').toBe(21);

    server.release!(); // his 4 lands
    await settle();
    await settle();
    expect(server.editWrites, 'only the change that was out goes out').toHaveLength(1);
    expect(pushed(0).conditions).toEqual([{ id: 'wounded', value: 1 }]);
    expect(pc().currentHP).toBe(21);
    expect(rowConds()).toEqual(['wounded:1']);
  });

  for (const [whose, owner] of [
    ['a player’s character', PLAYER],
    ['his OWN character', GM],
  ] as const) {
    it(`on ${whose}, a gesture made after a Ctrl+Z while his push is out is made on that push, and lands on it`, async () => {
      /*
       * The round-6 refuter's PROBE-UNDO-THEN-GESTURE, and on his own character the leg that had
       * pinned the undone 25 going out with his next gesture. The Ctrl+Z cannot call his 4 back, so
       * the row keeps it; his Frightened is made on it and goes out on top of it once it lands. The
       * server never ends on the undone 25, and his Frightened is never lost.
       *
       * MUTATION (tried 2026-10-01, round 7): drop `?? st.out?.v` from `was` and from `show` in
       * reconcile and this fails —
       *   AssertionError: the Ctrl+Z cannot call his 4 back: expected 25 to be 21
       * (and, past that line, his Frightened goes out on the undone 25).
       */
      await mount(hurt(), owner);
      server.holdNextEdit = true;
      act(() => store().applyDamage(pc().id, 4)); // read, sent — not answered
      await settle();
      act(() => store().undo());
      await settle();
      expect(pc().currentHP, 'the Ctrl+Z cannot call his 4 back').toBe(21);
      frightened(2);
      await settle();
      expect(server.editWrites, 'his Frightened waits for the push that is out').toEqual([]);
      server.release!(); // his 4 lands
      await settle();
      await settle();
      expect(server.editWrites, 'his Frightened goes out after it').toHaveLength(2);
      expect(pushed(1).currentHP, 'never the undone 25').toBe(21);
      expect(pushed(1).conditions).toEqual(
        expect.arrayContaining([
          { id: 'frightened', value: 2 },
          { id: 'wounded', value: 1 },
        ]),
      );
      expect(pc().currentHP).toBe(21);
      expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);
    });
  }

  it('two Ctrl+Z in a row (Next Turn, the player’s own 7, his Frightened): nothing is pushed', async () => {
    // The round-1 refuter's P1: the second Ctrl+Z reached the snapshot Next Turn took BEFORE the
    // player's own 7 damage, and was pushed as 25 HP over their 18.
    const m = await mount(hurt());
    act(() => store().nextTurn()); // records a snapshot with the row at 25
    await settle();
    const mine = theirs();
    publish({ ...mine, play: { ...mine.play!, damage: mine.play!.damage + 7 } }, T1);
    await m.deliver();
    expect(pc().currentHP, 'the sheet drives the row').toBe(18);

    frightened(2);
    await settle();
    expect(server.editWrites).toHaveLength(1);

    act(() => store().undo());
    await settle();
    act(() => store().undo());
    await settle();
    expect(server.editWrites, 'Ctrl+Z pushes nothing at all').toHaveLength(1);
    expect(pc().currentHP).toBe(18);
    expect(rowConds(), 'the row shows what the server holds: their 7 and his Frightened').toEqual(['frightened:2', 'wounded:1']);
    expect(theirs().play!.damage).toBe(MAX - 18);
  });

  it('…and so do they with every echo delivered (Mark defeated after the player’s own 3)', async () => {
    // The round-1 refuter's P5: the same two Ctrl+Z, with each push of his coming back through the
    // overlay before the next key press.
    const m = await mount(hurt());
    act(() => store().nextTurn());
    await settle();
    const mine = theirs();
    publish({ ...mine, play: { ...mine.play!, damage: mine.play!.damage + 3 } }, T1);
    await m.deliver();
    expect(pc().currentHP).toBe(22);

    act(() => store().setDefeated(pc().id, true));
    await settle();
    await m.deliver(); // his push comes back through the overlay
    expect(server.editWrites).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      act(() => store().undo());
      await settle();
      await m.deliver();
    }
    expect(server.editWrites, 'Ctrl+Z pushes nothing at all').toHaveLength(1);
    expect(pc().currentHP, 'the row shows what the server holds: his Mark defeated').toBe(0);
  });

  /*
   * The round-5 refuter's blocker, as legs. After his Mark defeated has echoed back, the player's
   * side records the knock-out — their own (P4), or their app picking up his (P1c), delivered after
   * his echo or before it (P1b). Every value agrees with his push. Then one more gesture of his, then
   * Ctrl+Z twice: the licence that was there pushed 25 HP + Wounded 1, a value from before their
   * change, over it. Under rule A the Ctrl+Z pushes nothing at all, whatever order things arrived in.
   */
  const knockOuts = [
    ['P4: the player’s OWN knock-out, published after his echo', 'own', 'after'],
    ['P1c: their app picks up his Mark defeated, delivered after his echo', 'pickup', 'after'],
    ['P1b: their app picks up his Mark defeated, delivered before his echo', 'pickup', 'before'],
  ] as const;
  for (const [label, who, when] of knockOuts) {
    it(`${label}, then his Frightened, then Ctrl+Z twice: the last push is his Frightened on the knock-out`, async () => {
      /*
       * MUTATION (tried 2026-10-01, round 7): Undo a gesture again (as in (2)) and these fail.
       */
      const m = await mount(hurt());
      act(() => store().setDefeated(pc().id, true));
      await settle();
      if (when === 'after') await m.deliver(); // his push comes back through the overlay
      const theirKo = who === 'own' ? knockedOut() : ({ ...(server.editWrites[0].sheet as SavedChar), archived: false } as SavedChar);
      publish(theirKo, T1);
      await m.deliver();
      expect(gmPendingEdit(CAMPAIGN, CHAR), 'their publish overtook his push').toBeUndefined();
      showsKnockOut('the row shows their sheet');

      frightened(1);
      await settle();
      expect(server.editWrites, 'his Frightened lands on their knock-out').toHaveLength(2);

      const reads = server.sheetReads;
      act(() => store().undo());
      await settle();
      act(() => store().undo());
      await settle();
      expect(server.editWrites, 'Ctrl+Z pushes nothing at all').toHaveLength(2);
      expect(server.sheetReads, '…and asks the server nothing').toBe(reads);
      expect(pushed(1).currentHP, 'the last push is never a value from before their knock-out').toBe(0);
      expect(pushed(1).conditions).toEqual(
        expect.arrayContaining([
          { id: 'dying', value: 2 },
          { id: 'frightened', value: 1 },
          { id: 'unconscious' },
          { id: 'wounded', value: 1 },
        ]),
      );
      expect(pc().currentHP, 'the row shows what the server holds').toBe(0);
      expect(rowConds()).toEqual(['dying:2', 'frightened:1', 'unconscious:', 'wounded:1']);
    });
  }

  it('a player publish carrying the very HP the GM pushed is still the player’s — Ctrl+Z pushes nothing', async () => {
    // The round-1 refuter's P3: the player recording the same hit on their own sheet.
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 5));
    await settle();
    expect(server.editWrites).toHaveLength(1);

    const own = hurt();
    publish({ ...own, play: { ...own.play!, damage: MAX - 20 } }, T1); // the same hit, on their own sheet
    await m.deliver();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'their publish is newer than our push').toBeUndefined();

    act(() => store().undo());
    await settle();
    expect(server.editWrites, 'no push over the player’s own publish').toHaveLength(1);
    expect(pc().currentHP).toBe(20);
    expect(theirs().play!.damage).toBe(MAX - 20);
  });

  it('an owed push the row stopped holding is owed no longer: Ctrl+Z, then Ctrl+Y, pushes nothing', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): drop `|| ck !== vitalsKey(st.want.v)` from the load test
     * in reconcile and this fails —
     *   AssertionError: expected 21 to be 25
     * (the Ctrl+Z left his refused 4 owed, and the row on it).
     */
    await mount(hurt());
    server.refuseEdits = true;
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editRefusals).toBe(1);
    server.refuseEdits = false;

    act(() => store().undo()); // a load: the row is the player's sheet again
    await settle();
    expect(pc().currentHP).toBe(25);
    expect(server.editWrites).toEqual([]);

    act(() => store().redo()); // …and so is this one
    await settle();
    untouched('a Redo is not his refused damage still owed');
  });

  it('an owed push belongs to its ROW: a board from his other device holding the same value pushes nothing', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): drop `st.want.rowId !== c.id ||` from the load test in
     * reconcile and this fails —
     *   AssertionError: a row he never touched on this screen: expected 21 to be 25
     * (the replaced row's 21 was pushed as his refused damage, owed). A load is not an edit.
     */
    await mount(hurt());
    server.refuseEdits = true;
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editRefusals).toBe(1);
    expect(pc().currentHP, 'owed, so still on his row').toBe(21);
    server.refuseEdits = false;

    // A board from the GM's other device: ITS OWN row for this PC, showing the very same 21 HP.
    flushPersist();
    const elsewhere = { ...pc(), id: 'cmb-elsewhere-2' };
    localStorage.setItem(
      scopeKey('pf2e-current-combat'),
      JSON.stringify({ combatants: [elsewhere], round: 1, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 1, condCounter: 0 }),
    );
    act(() => store().reloadFromStorage());
    await settle();
    expect(pc().id, 'the board really was replaced').toBe('cmb-elsewhere-2');
    untouched('a row he never touched on this screen');
  });
});

describe('rule C — a push needs a fresh read, and lands only on the sheet its gesture was made on', () => {
  it('GM damage never lands over a newer sheet of the player’s that this screen has not seen yet', async () => {
    /*
     * The round-1 refuter's P2. The push re-based on the fresh read but wrote the ROW's whole vitals
     * over it, so the player's own 6 HP + Wounded 2 became the GM's 21 HP + Wounded 1.
     *
     * MUTATION (tried 2026-10-01, round 7): land every push — `if (false)` for
     * `if (vitalsKey(now) !== w.on)` in `send` (src/integration/pcSheetTruth.ts) — and this fails —
     *   AssertionError: the GM’s 4 must not land on a sheet he never saw: expected [ { campaign_id: 'camp-nvo', …(5) } ] to deeply equal []
     * MUTATION (tried 2026-10-01, round 7): drop `st.shown = now;` from that branch and this fails —
     *   AssertionError: the row is re-based on what the read returned: expected 25 to be 6
     */
    await mount(hurt());
    publish(patchedUp(), T1); // on the server — not yet on this screen
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites, 'the GM’s 4 must not land on a sheet he never saw').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX - 6);
    expect(theirs().play!.conditions).toEqual([{ id: 'wounded', value: 2 }]);
    expect(pc().currentHP, 'the row is re-based on what the read returned').toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);
  });

  it('his next gesture does not carry his own overtaken push back over the player taking it back', async () => {
    /*
     * The player's app picked up his 4 damage, then the player took it back on their own sheet —
     * neither publish has reached this screen. His next gesture is made on a row that still shows
     * the 4; carried across, it would undo the player.
     *
     * MUTATION (tried 2026-10-01, round 7): judge a gesture against the sheet this screen was handed
     * rather than what the row showed — `on: vitalsKey(sv)` for `on: vitalsKey(was)` in reconcile —
     * and this fails —
     *   AssertionError: his Frightened must not carry the 4 back: expected [ …(2) ] to have a length of 1 but got 2
     * (the handed-in sheet is their 25 from before his push, and so is the server's: by value they
     * match, and his 21 went out over their heal). Dropping `st.shown = now;` from the sheet-wins
     * branch of `send` fails it on `the row is the player’s sheet again: expected 21 to be 25`.
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);

    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applies it…
    publish(hurt(), '2026-10-01T11:30:00.000Z'); // …and they take it back: 25 HP + Wounded 1

    frightened(2);
    await settle();
    expect(server.editWrites, 'his Frightened must not carry the 4 back').toHaveLength(1);
    expect(pc().currentHP, 'the row is the player’s sheet again').toBe(25);
    expect(rowConds()).toEqual(['wounded:1']);

    // …and he is not locked out: his next gesture lands on the sheet he now sees.
    frightened(2);
    await settle();
    expect(server.editWrites).toHaveLength(2);
    expect(pushed(1).currentHP).toBe(25);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('his next gesture still lands once the player’s app has picked up his last one', async () => {
    /*
     * The other side of that rule: the sheet winning is for a change of the PLAYER's. When their app
     * has applied his push and republished, the server carries exactly what his row shows.
     *
     * MUTATION (tried 2026-10-01, round 7): drop `if (st.arrived === arrived) st.shown = held;` from
     * the landed branch of `send` (src/integration/pcSheetTruth.ts) and this fails on `his Frightened
     * lands` (the row went back to the sheet from before his 4, his Frightened was made on that, and
     * the server no longer holds it).
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applied it — not yet on this screen
    frightened(2);
    await settle();
    expect(server.editWrites, 'his Frightened lands').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(21);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('three quick hits: the third rides the push after the second, and the server ends on the LAST', async () => {
    /*
     * The round-2 refuter's PROBE-A/B. The third hit was sent while the second was still unanswered;
     * the second then landed LAST and overwrote it, so the server and the GM's own pending copy ended
     * on his second hit (22) while his row showed the third (19).
     *
     * MUTATION (tried 2026-10-01, round 7): send without waiting — drop `&& !st.out` from the send
     * test in reconcile — and this fails —
     *   AssertionError: the third waits for the second’s answer: expected [ …(2) ] to have a length of 1 but got 2
     * MUTATION (tried 2026-10-01, round 7): treat a landed push as one that reached nobody — `if
     * (false)` for `if (res.ok)` in `send` — and this fails —
     *   AssertionError: all three, in the order he made them: expected [ 24, 21 ] to deeply equal [ 24, 22, 19 ]
     * Dropping `if (rerun) again.current();` in reconcile fails it on `expected [ 24, 22 ]`, and
     * dropping `st.out = undefined;` fails it too. (The landed branch's `if (st.want) st.want.on = vitalsKey(held);` is pinned by "…and a
     * gesture made while that push is out lands on what the sheet holds" below: here the server holds
     * the second hit whole, so the third was already made on exactly that.)
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1));
    await settle();
    expect(server.editWrites).toHaveLength(1);

    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 2)); // sent; the server has not answered yet
    await settle();
    act(() => store().applyDamage(pc().id, 3));
    await settle();
    expect(server.editWrites, 'the third waits for the second’s answer').toHaveLength(1);
    server.release!();
    await settle();
    await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'all three, in the order he made them').toEqual([24, 22, 19]);
    const onServer = server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
    expect(vitalsFromSheet(onServer, db).currentHP, 'the server ends on his LAST hit').toBe(19);
    expect(vitalsFromSheet(gmPendingEdit(CAMPAIGN, CHAR)!.sheet, db).currentHP, '…and so does his pending copy').toBe(19);
    expect(pc().currentHP).toBe(19);

    // The player's app applies the server's edit and republishes: what the GM sees is what they have.
    publish(onServer, T1);
    await m.deliver();
    expect(pc().currentHP, 'what the GM sees is what they have').toBe(19);
    expect(theirs().play!.damage).toBe(MAX - 19);
    expect(server.editWrites).toHaveLength(3);
  });

  it('a hit, then a heal back to where he started while the hit is out: the heal goes out after it', async () => {
    /*
     * A gesture is judged against what the row showed — his hit that is out — not the sheet the hit
     * has not reached yet.
     *
     * MUTATION (tried 2026-10-01, round 7): judge it against the sheet alone while a push is out —
     * `const was = st.want?.v ?? st.shown;` — and this fails —
     *   AssertionError: the hit, then the heal: expected [ 21 ] to deeply equal [ 21, 25 ]
     * (the heal looks like no change at all, so it is never sent, and the row ends on the hit).
     */
    await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // out
    await settle();
    act(() => store().applyHealing(pc().id, 4)); // back to 25, made on the hit that is out
    await settle();
    server.release!();
    await settle();
    await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'the hit, then the heal').toEqual([21, 25]);
    expect(pc().currentHP).toBe(25);
    expect(rowConds()).toEqual(['wounded:1']);
  });

  it('a push the sheet could not hold whole: the row shows what the sheet holds, and his next gesture lands on it', async () => {
    /*
     * He raised the row's max HP and healed past the SHEET's max, so the push clamped to what the
     * sheet can hold. What the server holds is that clamped sheet.
     *
     * MUTATION (tried 2026-10-01, round 7): take what the row held for what the server holds —
     * `const held = w.v;` for `const held = vitalsFromSheet(sent, content);` in the landed branch of
     * `send` — and this fails —
     *   AssertionError: and the row shows what the sheet holds: expected 48 to be 38
     */
    await mount(hurt());
    act(() => store().setMaxHP(pc().id, MAX + 10));
    await settle();
    act(() => store().applyHealing(pc().id, MAX));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pushed(0).currentHP, 'the sheet holds no more than its own max').toBe(MAX);
    expect(pc().currentHP, 'and the row shows what the sheet holds').toBe(MAX);

    frightened(2);
    await settle();
    expect(server.editWrites, 'his Frightened lands').toHaveLength(2);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('…and a gesture made while that push is out lands on what the sheet holds', async () => {
    /*
     * His Frightened is made on the push that is out — the row's MAX+10 — and the server ends up
     * holding MAX. It goes out on what the server holds, not on what the row held.
     *
     * MUTATION (tried 2026-10-01, round 7): drop `if (st.want) st.want.on = vitalsKey(held);` from the
     * landed branch of `send` and this fails —
     *   AssertionError: his Frightened lands on what the server holds: expected [ …(1) ] to have a length of 2 but got 1
     * (judged against the MAX+10 the sheet never held, it stands down).
     */
    await mount(hurt());
    act(() => store().setMaxHP(pc().id, MAX + 10));
    await settle();
    server.holdNextEdit = true;
    act(() => store().applyHealing(pc().id, MAX)); // out: the row's MAX+10, which the sheet clamps to MAX
    await settle();
    frightened(2); // made on the push that is out
    await settle();
    server.release!();
    await settle();
    await settle();
    expect(server.editWrites, 'his Frightened lands on what the server holds').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(MAX);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
    expect(pc().currentHP).toBe(MAX);
    expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);
  });

  it('a newer sheet with a bigger max (they levelled up) that his push read first: the row shows it whole, at once', async () => {
    /*
     * The push stands down on their level-4 sheet, and the row is re-based on it — with ITS max. The
     * row is written with the max of what it shows, which is also why the pass that write sets off
     * finds nothing left to write: there is no re-entry guard.
     *
     * MUTATION (tried 2026-10-01, round 8): write the row with the max of the sheet this screen was
     * handed — `writeVitals(c.id, { ...show, maxHP: sv.maxHP }, content)` for
     * `writeVitals(c.id, show, content)` in reconcile — and this fails: the row is clamped to the old
     * max, and the pass its own write sets off chases it until the stack runs out —
     *   AssertionError: the row takes the max of the sheet it shows: expected 38 to be 48
     *   RangeError: Maximum call stack size exceeded
     */
    const m = await mount(hurt());
    const levelled = { ...build('fighter', 4), name: NAME };
    const up = { id: CHAR, character: levelled, play: initialPlay(levelled, db) } as SavedChar;
    const upMax = vitalsFromSheet(up, db).maxHP;
    expect(upMax, 'a level-4 sheet holds more').toBeGreaterThan(MAX);
    publish(up, T1); // on the server — not yet on this screen
    act(() => store().applyDamage(pc().id, 4)); // its fresh read finds their level-4 sheet: it stands down
    await settle();
    expect(server.editWrites).toEqual([]);
    expect(pc().maxHP, 'the row takes the max of the sheet it shows').toBe(upMax);
    expect(pc().currentHP).toBe(upMax);
    expect(rowConds()).toEqual([]);

    await m.deliver();
    expect(pc().maxHP).toBe(upMax);
    expect(pc().currentHP).toBe(upMax);
  });

  it('a failed read never lets GM damage over a newer sheet of the player’s that nobody read (PROBE-D)', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): owe nothing that reached nobody — drop
     * `st.want = st.want ? { ...st.want, on: w.on } : w;` from the end of `send` — and this fails —
     *   AssertionError: the player’s own sheet is what the row shows: expected 25 to be 6
     * (his 2 is forgotten, never re-read, and the row goes back to the sheet he last saw), with the
     * refused legs here and "re-pushes a GM change the server refused" in bug-tracker-seam.test.tsx.
     */
    const m = await mount(hurt());
    publish(patchedUp(), T1); // on the server — not yet on this screen
    server.failSheetReads = true; // …and the read the push would build on blips
    act(() => store().applyDamage(pc().id, 2));
    await settle();
    expect(server.editWrites, 'nothing lands on a sheet nobody read').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX - 6);
    expect(pc().currentHP, 'his 2 is still on his row — owed, not dropped').toBe(23);

    // The reads come back and the next pass re-sends it: the fresh read shows a sheet he never saw.
    server.failSheetReads = false;
    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 }));
    await settle();
    expect(server.editWrites, 'the owed 2 does not land on a sheet it was not made against').toEqual([]);
    expect(pc().currentHP, 'the player’s own sheet is what the row shows').toBe(6);

    await m.deliver();
    expect(pc().currentHP).toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);
    expect(server.editWrites).toEqual([]);
  });

  it('…nor his next gesture on top of his own push still standing (PROBE-C)', async () => {
    /*
     * The failed read is owed (the overlay would answer it with his own pending copy, which proves
     * nothing); when the reads come back, the owed Frightened reads their newer sheet and stands down.
     *
     * MUTATION (tried 2026-10-01, round 7): land every push — `if (false)` for
     * `if (vitalsKey(now) !== w.on)` in `send` — and this fails.
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);

    publish(patchedUp(), T1); // newer than his push — on the server only
    server.failSheetReads = true;
    frightened(2);
    await settle();
    expect(server.editWrites, 'his Frightened must not ride a read that never came back').toHaveLength(1);
    expect(theirs().play!.damage).toBe(MAX - 6);

    server.failSheetReads = false;
    await m.deliver();
    expect(pc().currentHP).toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);
    expect(server.editWrites).toHaveLength(1);
  });

  it('a read that finds NO published sheet is no answer either — not even over his own push still standing', async () => {
    /*
     * The player unpublished (or left) and this screen has not heard yet. The read answers, with no
     * sheet; his own pending edit is all the overlay has left to hand back.
     *
     * MUTATION (tried 2026-10-01, round 7): `row && gmPushBase(…)` in place of
     * `row?.sheet && gmPushBase(…)` in `send` and this fails —
     *   AssertionError: nothing is built on a sheet the server no longer has: expected [ …(2) ] to have a length of 1 but got 2
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    server.chars.delete(`${CAMPAIGN}|${CHAR}`);
    frightened(2);
    await settle();
    expect(server.editWrites, 'nothing is built on a sheet the server no longer has').toHaveLength(1);
  });

  it('a failed read OWES the gesture: it lands, once, when the reads come back and nothing moved', async () => {
    await mount(hurt());
    server.failSheetReads = true;
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toEqual([]);
    expect(pc().currentHP, 'his 4 stays on his row while it is owed').toBe(21);

    server.failSheetReads = false;
    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 }));
    await settle();
    expect(server.editWrites, 'sent once the reads come back').toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);
    expect(pushed(0).conditions).toEqual([{ id: 'wounded', value: 1 }]);

    act(() => store().nextTurn());
    await settle();
    expect(server.editWrites, '…and once only').toHaveLength(1);
  });

  it('a gesture made while another is owed carries it along: both land, on the sheet the first was made on', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): always start a new change on a gesture — `if (false)` for
     * `if (st.want?.rowId === c.id)` in reconcile — and this fails —
     *   AssertionError: his 4 and his Frightened, together: expected [] to have a length of 1 but got +0
     * (the new change is made on the owed 21, which the server never took, so it stands down and
     * takes the 4 with it).
     */
    await mount(hurt());
    server.failSheetReads = true;
    act(() => store().applyDamage(pc().id, 4)); // owed
    await settle();
    frightened(2); // made while the 4 is owed
    await settle();
    expect(server.editWrites).toEqual([]);
    expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);

    server.failSheetReads = false;
    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 })); // any later pass
    await settle();
    expect(server.editWrites, 'his 4 and his Frightened, together').toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);
    expect(pushed(0).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('a push the server REFUSED is owed too, and re-sent on the next pass', async () => {
    /*
     * test/bug-tracker-seam.test.tsx pins this through the whole tracker too; this is the seam alone,
     * with the fresh read answering.
     *
     * MUTATION (tried 2026-10-01, round 7): take a refusal for a landing — `if (true)` for
     * `if (res.ok)` in `send` — and this fails —
     *   AssertionError: re-sent on the next pass: expected 1 to be 2
     * (with "re-pushes a GM change the server refused" in test/bug-tracker-seam.test.tsx).
     */
    await mount(hurt());
    server.refuseEdits = true;
    act(() => store().addCondition(pc().id, { name: 'sickened', value: 1, isPermanent: false }));
    await settle();
    expect(server.editRefusals, 'sent once, and refused').toBe(1);
    expect(server.editWrites).toEqual([]);

    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 }));
    await settle();
    expect(server.editRefusals, 're-sent on the next pass').toBe(2);

    server.refuseEdits = false;
    act(() => store().addCombatant(null, { name: 'Ash Wight', maxHP: 20 }));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pushed(0).conditions).toEqual(
      expect.arrayContaining([
        { id: 'sickened', value: 1 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('a push that THREW is owed as well, and his pushes go on after it', async () => {
    /*
     * One push at a time per character means a push that never answers cleanly must not take the
     * rest of his pushes down with it, nor be mistaken for one that landed.
     *
     * MUTATION (tried 2026-10-01, round 7): drop the `try { … } catch {}` around the body of `send`
     * (the throw then skips the step that frees the character) and this fails —
     *   AssertionError: re-sent after the push that threw: expected [] to have a length of 1 but got +0
     */
    await mount(hurt());
    server.throwNextEdit = true;
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toEqual([]);
    expect(pc().currentHP, 'owed, so still on his row').toBe(21);

    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 }));
    await settle();
    expect(server.editWrites, 're-sent after the push that threw').toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);

    frightened(2);
    await settle();
    expect(server.editWrites, 'and the next gesture goes out behind it').toHaveLength(2);
  });

  it('a refused push never rolls back the gesture that rode it out: both go on the next pass', async () => {
    /*
     * His 4 is refused while his Frightened, made on it, waits behind it. The refusal is owed with the
     * Frightened on it, on the sheet the 4 was made on — the row keeps both, and the next pass sends
     * both.
     *
     * MUTATION (tried 2026-10-01, round 7): re-owe the refused push alone — `st.want = w;` for
     * `st.want = st.want ? { ...st.want, on: w.on } : w;` in `send` — and this fails —
     *   AssertionError: his Frightened goes out, carrying his 4: expected [] to have a length of 1 but got +0
     * (his Frightened is lost, and the row that still shows it no longer matches what is owed, so
     * that goes too). Keeping the waiting gesture's own base instead (`st.want = st.want ?? w;`)
     * fails it the same way — judged against a 4 the server never took, it stands down.
     */
    await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    frightened(2); // rides the push that is out
    await settle();

    server.refuseEdits = true;
    server.release!(); // the 4 is refused
    await settle();
    server.refuseEdits = false;
    expect(server.editRefusals).toBe(1);
    expect(pc().currentHP, 'the refusal rolls nothing back').toBe(21);
    expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);

    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 })); // any later pass
    await settle();
    expect(server.editWrites, 'his Frightened goes out, carrying his 4').toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);
    expect(pushed(0).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('the player publishes the very vitals of his gesture while its push is out: his push lands, the gesture riding it stands down', async () => {
    /*
     * The round-3 refuter's case (a). His 4 is on the wire; his Frightened 2 is made on it and waits.
     * The player's own app records the same hit and the same fear and publishes. His 4 lands; the
     * Frightened push then reads their sheet, which it was not made on, and stands down — so nothing
     * of his goes out over their sheet, even with every value equal.
     *
     * MUTATION (tried 2026-10-01, round 7): build the waiting gesture on the sheet that arrived —
     * `st.want.on = vitalsKey(st.shown)` for `st.want.on = vitalsKey(held)` in the landed branch of
     * `send` — and this fails —
     *   AssertionError: his 4 landed, his Frightened stood down: expected [ …(2) ] to have a length of 1 but got 2
     */
    const m = await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // read, sent — the server has not answered
    await settle();
    frightened(2); // rides it
    await settle();

    const own = hurt();
    publish(
      { ...own, play: { ...own.play!, damage: MAX - 21, conditions: [{ id: 'wounded', value: 1 }, { id: 'frightened', value: 2 }] } },
      T1,
    );
    await m.deliver();

    server.release!(); // his 4 lands; the Frightened push then reads the player's sheet
    await settle();
    await settle();
    expect(server.editWrites, 'his 4 landed, his Frightened stood down').toHaveLength(1);
    expect(pc().currentHP, 'the row follows the player’s own sheet').toBe(21);
    expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);

    act(() => store().undo());
    await settle();
    act(() => store().undo());
    await settle();
    expect(server.editWrites, 'Ctrl+Z pushes nothing over the player').toHaveLength(1);
    expect(pc().currentHP).toBe(21);
    expect(theirs().play!.damage).toBe(MAX - 21);
  });

  const ends = [
    ['its fresh read answers with their sheet (it stands down)', 'read'],
    ['its fresh read FAILS (it is owed, then stands down)', 'read-fails'],
    ['the server REFUSES it (it is owed, then stands down)', 'refused'],
  ] as const;
  for (const [how, mode] of ends) {
    it(`Mark defeated while the player’s own sheet records the same knock-out, and ${how}: nothing of his goes out`, async () => {
      /*
       * The round-3 refuter's case (b), all three ways the push can end without landing. Mark
       * defeated is a real control on a linked PC, and applyPCDefeat mirrors play.ts, so a player
       * recording the same knock-out on their own sheet gives the identical vitals.
       *
       * MUTATION (tried 2026-10-01, round 7): land every push (as in "GM damage never lands over a
       * newer sheet") and all three fail.
       */
      const m = await mount(hurt());
      if (mode === 'refused') server.holdNextEdit = true;
      else server.holdNextRead = true;
      act(() => store().setDefeated(pc().id, true));
      await settle();
      expect(mode === 'refused' ? server.release : server.releaseRead, 'the push is still waiting').not.toBeNull();

      publish(knockedOut(), T1); // the player's own app, recording the same knock-out
      await m.deliver();
      showsKnockOut('the row shows the knock-out');

      if (mode === 'read-fails') server.failSheetReads = true;
      if (mode === 'refused') server.refuseEdits = true;
      if (mode === 'refused') server.release!();
      else server.releaseRead!();
      await settle();
      server.failSheetReads = false;
      server.refuseEdits = false;
      showsKnockOut('the late answer leaves the row on the knock-out');

      // Any later pass (another creature joins): what is owed reads their sheet, and stands down.
      act(() => store().addCombatant(null, { name: 'Ash Wight', maxHP: 20 }));
      await settle();
      expect(server.editWrites, 'nothing of his goes out over the player’s own sheet').toEqual([]);
      showsKnockOut('their sheet');

      act(() => store().undo()); // Ctrl+Z on his Mark defeated
      await settle();
      expect(server.editWrites, 'Ctrl+Z pushes nothing').toEqual([]);
      showsKnockOut('the row shows the sheet after Ctrl+Z');
      expect(theirs().play!.damage).toBe(MAX);
    });
  }
});

/*
 * WHAT THE ROW SHOWS while a push is out and sheets arrive around it. The round-4 and round-5
 * refuters' probes: a push that lands after the sheet moved, and a publish of the player's that a
 * member read picked up before his push landed and handed over after it.
 */
describe('what the row shows — the sheet that arrives, his own push, and never a late echo', () => {
  /**
   * His 4 lands at once. The player's app picks it up and republishes, but that has not reached this
   * screen. His Frightened 2 goes out with its fresh read held on the wire. Their republish then
   * arrives, and only after that does the Frightened push read: it finds exactly the sheet it was
   * made on, so it lands.
   */
  async function landsAfterTheSheetMoved() {
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applied his 4 — not on this screen yet

    server.holdNextRead = true;
    frightened(2); // its read is on the wire
    await settle();
    await m.deliver(); // their republish of his 4 arrives
    expect(pc().currentHP).toBe(21);

    server.releaseRead!(); // the read finds the very sheet his Frightened was made on: it lands
    await settle();
    await settle();
    expect(server.editWrites, 'his Frightened landed').toHaveLength(2);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
    return m;
  }
  const onServer = () => vitalsFromSheet(server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar, db);

  it('his push that lands after the sheet moved is what his row shows, and what the player then has', async () => {
    const m = await landsAfterTheSheetMoved();
    expect(rowConds(), 'his landed Frightened is on his row').toEqual(['frightened:2', 'wounded:1']);
    await m.deliver(); // his Frightened comes back through the overlay
    expect(pc().currentHP).toBe(21);
    expect(rowConds()).toEqual(['frightened:2', 'wounded:1']);

    // The player's app applies it and republishes.
    publish(server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar, '2026-10-01T12:00:00.000Z');
    await m.deliver();
    expect(rowConds(), 'what the GM sees is what they have').toEqual(['frightened:2', 'wounded:1']);
    expect(theirs().play!.conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
    expect(server.editWrites).toHaveLength(2);
  });

  it('…and his next gesture, made before that overlay arrives, carries his landed Frightened along', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): never let a landed push move the row on — `if (false)` for
     * `if (st.arrived === arrived)` in `send` — and this fails inside the setup it shares with the leg
     * above —
     *   AssertionError: expected 25 to be 21
     * (his 4 left his row the moment it landed), with the rule A legs and the P4/P1 legs.
     */
    await landsAfterTheSheetMoved();
    act(() => store().applyDamage(pc().id, 1));
    await settle();
    expect(server.editWrites, 'his 1 lands on his own Frightened').toHaveLength(3);
    expect(onServer().currentHP).toBe(20);
    expect(onServer().conditions, 'his Frightened stays on the server').toEqual(
      expect.arrayContaining([{ id: 'frightened', value: 2 }]),
    );
  });

  it('(i) a publish of the player’s read before his push landed, and handed over after, is the player moving — not his echo', async () => {
    /*
     * The round-5 refuter's PROBE-1, exactly. His 4 is read and sent. The player is patched up to
     * 6 HP + Wounded 2 on their own device and publishes. A member read picks that up BEFORE his push
     * lands and reaches the seam only AFTER, by when his push is the pending edit.
     *
     * MUTATION (tried 2026-10-01, round 8): set aside every sheet that is not the pending edit —
     * `if (false)` for `if (!ours.has(sheet))` in the arrival test in reconcile — and this fails —
     *   AssertionError: what the GM sees is what the player has: expected 21 to be 6
     */
    const m = await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // read, sent — the server has not answered
    await settle();
    publish(patchedUp(), T1); // the player, on their own device
    const early = (await fetchMemberSheet(CAMPAIGN, CHAR))!; // a member read answers before his push lands
    server.release!(); // his push lands: it is the pending edit now
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'his push is pending on this screen').toBeDefined();

    await m.show(early); // …and only now does that read reach the seam
    expect(pc().currentHP, 'what the GM sees is what the player has').toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);

    act(() => store().undo()); // Ctrl+Z on his 4
    await settle();
    expect(server.editWrites, 'nothing of his goes out over their sheet').toHaveLength(1);
    expect(pc().currentHP).toBe(6);

    act(() => store().applyDamage(pc().id, 1));
    await settle();
    expect(server.editWrites, 'his next gesture lands on their sheet').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(5);
    expect(pushed(1).conditions).toEqual([{ id: 'wounded', value: 2 }]);
  });

  it('(j) …and so is one carrying the very vitals of an earlier push of his: the sheet that came back decides, never its values', async () => {
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1)); // lands: 24 HP
    await settle();
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 2)); // read, sent: 22 HP
    await settle();
    const own = hurt();
    publish({ ...own, play: { ...own.play!, damage: MAX - 24 } }, T1); // the same 1, on their own sheet
    const early = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    server.release!(); // his 2 lands
    await settle();
    expect(server.editWrites).toHaveLength(2);

    await m.show(early);
    expect(pc().currentHP, 'the row follows the player’s own sheet').toBe(24);
    expect(rowConds()).toEqual(['wounded:1']);

    await m.deliver();
    expect(pc().currentHP, 'what the GM sees is what the player has').toBe(24);
    expect(rowConds()).toEqual(['wounded:1']);
  });

  it('a sheet that arrives while his push is out is what the row shows once it lands — this screen cannot tell which is newer', async () => {
    /*
     * The player publishes AFTER his push read the server, and that publish reaches this screen while
     * the push is still out. His push lands on the sheet it read; their publish is the newer one, and
     * the server's next read drops his overlay for it. Showing his push would leave the row on a
     * value the player no longer has — and the read that follows his landing answers with the same
     * sheet this screen already holds, so nothing would ever move it back.
     *
     * MUTATION (tried 2026-10-01, round 7): move the row on at every landing — `if (true)` for
     * `if (st.arrived === arrived)` in `send` — and this fails —
     *   AssertionError: the row follows the sheet that arrived: expected 21 to be 6
     * Dropping `st.arrived++;` from the arrival branch of reconcile fails it the same way.
     */
    const m = await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // read, sent — the server has not answered
    await settle();
    publish(patchedUp(), T1); // after his read
    await m.deliver(); // reaches this screen while his push is out
    expect(pc().currentHP, 'his 4 stays on his row while it is out').toBe(21);

    server.release!(); // his 4 lands
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pc().currentHP, 'the row follows the sheet that arrived').toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);

    act(() => store().applyDamage(pc().id, 1));
    await settle();
    expect(server.editWrites, 'his next gesture lands on their sheet').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(5);
  });

  it('…and when that sheet is older than his push, his own push coming back is what the row ends on', async () => {
    /*
     * The other order: the player changed something that is not vitals (their gold) BEFORE his push
     * read the server, so his push is built on it — but their publish reaches this screen only while
     * the push is out. The row shows that sheet when the push lands; the read his landing triggers
     * then hands back his own push, through the overlay, and the row follows it.
     *
     * MUTATION (tried 2026-10-01, round 8): set aside every sheet of ours — drop the
     * `else if (sheet === gmPendingEdit(campaignId, mem.charId)?.sheet) { st.shown = sv; }` branch of
     * the arrival test in reconcile — and this fails —
     *   AssertionError: his own push coming back is what the row shows: expected 25 to be 21
     */
    const m = await mount(hurt());
    const own = hurt();
    publish({ ...own, play: { ...own.play!, currency: { gp: 7 } } } as SavedChar, T1); // their gold
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // his read sees their gold: same vitals, so it is sent on it
    await settle();
    await m.deliver(); // their gold reaches this screen while his push is out
    server.release!(); // his 4 lands
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pc().currentHP, 'this screen cannot tell which is newer: it shows the sheet it was handed').toBe(25);

    await m.deliver(); // the read his landing triggers: his own push, through the overlay
    expect(pc().currentHP, 'his own push coming back is what the row shows').toBe(21);
    expect(server.editWrites).toHaveLength(1);
  });

  it('(k) his own echo does not drag the row back, and a push refused after it is still owed', async () => {
    /*
     * A sheet that arrives while his change is out never takes it off the row: only that push's own
     * fresh read decides (rule C). The owed half is "a push the server REFUSED" above.
     *
     * MUTATION (tried 2026-10-01, round 7): drop `?? st.out?.v` from `show` in reconcile and this
     * fails —
     *   AssertionError: his echo does not drag the row back: expected 24 to be 22
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1)); // lands: 24 HP
    await settle();
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 2)); // read, sent: 22 HP
    await settle();
    await m.deliver(); // his 1 comes back through the overlay: his own echo
    expect(pc().currentHP, 'his echo does not drag the row back').toBe(22);

    server.refuseEdits = true;
    server.release!(); // his 2 is refused
    await settle();
    server.refuseEdits = false;
    expect(server.editRefusals).toBe(1);
    expect(pc().currentHP, 'owed, so still on his row').toBe(22);

    act(() => store().addCombatant(null, { name: 'Cave Lurker', maxHP: 30 })); // any later pass
    await settle();
    expect(server.editWrites, 'his refused 2 is owed and re-sent').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(22);
    expect(pc().currentHP).toBe(22);
  });

  it('his own push coming back while his next is out is no sheet ARRIVING: the row ends on his LAST push, and his next gesture lands on it', async () => {
    /*
     * The round-7 refuter's finding 1. His 1 lands; his 2 is out; the read his landed 1 set off hands
     * back his 1 — still the pending edit — before his 2 is answered. Counted as a sheet arriving, it
     * kept his landed 2 off the row (back to 24), and a Frightened made then was made on 24, read his
     * pending 22 and stood down: lost.
     *
     * MUTATION (tried 2026-10-01, round 8): count his pending push coming back as an arrival again —
     * `if (!ours.has(sheet) || sheet === gmPendingEdit(campaignId, mem.charId)?.sheet)` around the
     * `st.shown = sv; st.arrived++;` branch in reconcile, as round 7 had it — and this fails —
     *   AssertionError: the row ends on his last push: expected 24 to be 22
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1)); // lands: 24 HP
    await settle();
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 2)); // read, sent: 22 HP
    await settle();
    await m.deliver(); // his 1 comes back through the overlay — still the pending edit
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.sheet, 'what came back is his pending 1').toBe(server.editWrites[0].sheet);
    server.release!(); // his 2 lands
    await settle();
    await settle();
    expect(server.editWrites).toHaveLength(2);
    expect(pc().currentHP, 'the row ends on his last push').toBe(22);

    frightened(1);
    await settle();
    expect(server.editWrites, 'his Frightened lands on his 22').toHaveLength(3);
    expect(pushed(2).currentHP).toBe(22);
    expect(pushed(2).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 1 },
        { id: 'wounded', value: 1 },
      ]),
    );
    expect(pc().currentHP).toBe(22);
    expect(rowConds()).toEqual(['frightened:1', 'wounded:1']);
  });

  it('…and so through the REAL wiring: the member read his landed push sets off answers while his next is out', async () => {
    /*
     * The same case as the app builds it (CampaignTracker.tsx feeds useMemberSheets into the seam):
     * that read takes one round trip, his next push takes two (read + upsert), so two hits inside a
     * round trip are all it takes.
     *
     * MUTATION (tried 2026-10-01, round 8): the round-7 arrival test, as in the leg above, and this
     * fails —
     *   AssertionError: the row ends on his last push: expected 24 to be 22
     * (Hold the read his landed 2 sets off, as below: when it answers, his 2 comes back and the row
     * mends — round 7's flicker was the window before that, and a gesture made in it was lost.)
     */
    await mountWired();

    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 1)); // his 1: read, sent — not answered
    await settle();
    act(() => store().applyDamage(pc().id, 2)); // his 2: made on it, waiting behind it
    await settle();
    server.holdNextEdit = true; // his 2 will be on the wire in its turn
    const first = server.release!;
    server.release = null;
    first(); // his 1 lands: his 2 goes out, and the read his 1 set off brings his 1 back
    await settle();
    await settle();
    expect(server.editWrites, 'his 1 landed, his 2 is out').toHaveLength(1);
    expect(server.release, 'his 2 is on the wire').not.toBeNull();
    server.holdNextRead = true; // the read his landed 2 sets off stays on the wire…
    server.release!(); // his 2 lands
    await settle();
    await settle();
    expect(server.editWrites).toHaveLength(2);
    expect(server.releaseRead, 'the read his 2 set off has not answered').not.toBeNull();
    expect(pc().currentHP, 'the row ends on his last push').toBe(22);

    frightened(1); // …and he acts before it answers
    await settle();
    await settle();
    expect(server.editWrites, 'his Frightened lands').toHaveLength(3);
    expect(pushed(2).currentHP).toBe(22);
    expect(rowConds()).toEqual(['frightened:1', 'wounded:1']);
  });

  it('a late echo of an OLDER push of his never drags the row back', async () => {
    /*
     * His 1 and his 2 both land; then a member read that answered while his 1 was the pending edit
     * reaches the seam. It is his own sheet, by object — and not the pending edit any more.
     *
     * MUTATION (tried 2026-10-01, round 8): follow every sheet that arrives — `if (true)` for
     * `if (!ours.has(sheet))` in the arrival test in reconcile — and this fails —
     *   AssertionError: the late echo of his 1 is set aside: expected 24 to be 22
     * Dropping `ours.add(sent);` from `send` fails it the same way (and the two legs on his own push
     * coming back while his next is out).
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1)); // lands: 24 HP
    await settle();
    const late = (await fetchMemberSheet(CAMPAIGN, CHAR))!; // his 1, through the overlay
    act(() => store().applyDamage(pc().id, 2)); // lands: 22 HP
    await settle();
    expect(server.editWrites).toHaveLength(2);

    await m.show(late);
    expect(pc().currentHP, 'the late echo of his 1 is set aside').toBe(22);

    await m.deliver(); // the newest read: his 2
    expect(pc().currentHP).toBe(22);
  });

  it('their app applying his EARLIER push after his later one was built on it stands that one down — the row shows it, his next push is built on what it shows, and nothing of theirs is written over', async () => {
    /*
     * The round-7 refuter's finding 3 — the one case of the header's rule C that is still open. His 1
     * and his 2 both land, his 2 built on his PENDING 1, so its base is the publish from before
     * either; their app applies his 1 (fetched before his 2 replaced it) and republishes after that
     * base. No stamp can tell that republish from a change of their own, and the sheets' content may
     * not (rule E), so the overlay rule takes it for theirs. Pinned here is the seam's half: the GM
     * SEES his 2 go, his next gesture is built on exactly what the row showed, and the player's own
     * sheet is never touched. When the published row says which GM edit it applied, this leg flips:
     * the row stays on 22 and his Frightened goes out on it.
     * Round 9's PX1 — his later push built ON their republish, which the docs had filed under this
     * same limit — is not this case, and is fixed: the write-base legs below (PX1, PX1-real, PX2).
     *
     * MUTATION (tried 2026-10-01, round 8; re-tried 2026-10-02, round 11): drop the stamp
     * test from gmSync.pendingEditStillStands (`if (published.updatedAt && published.updatedAt >
     * (edit.baseUpdatedAt ?? edit.pushedAt)) return false;`) and this fails —
     *   AssertionError: the overlay takes it for a change of theirs: expected { campaignId: 'camp-nvo', …(5) } to be undefined
     * It is the line that would have to learn the difference; nothing here may compare values to.
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 1)); // lands: 24 HP
    await settle();
    act(() => store().applyDamage(pc().id, 2)); // lands: 22 HP, built on his pending 24
    await settle();
    expect(server.editWrites).toHaveLength(2);

    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applies his 1, and republishes
    await m.deliver();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the overlay takes it for a change of theirs').toBeUndefined();
    expect(pc().currentHP, 'the GM sees his 2 go').toBe(24);

    frightened(1);
    await settle();
    expect(server.editWrites, 'built on what the row showed').toHaveLength(3);
    expect(pushed(2).currentHP).toBe(24);
    expect(theirs().play!.damage, 'the player’s own sheet is never written').toBe(MAX - 24);
  });

  it('on his OWN character no overlay is drawn — but his push is still the newest thing there, and his next gesture lands on it', async () => {
    /*
     * A GM who plays in his own campaign is both parties. His push is recorded and never drawn over
     * his own character (gmSync.gmPendingEdit) — but until his own app applies it, it is still the
     * newest thing the server holds for him, so his next push is built on it (gmSync.gmPushBase).
     *
     * MUTATION (tried 2026-10-01, round 7): build on what is DRAWN instead — `resolvePendingGmEdit(…)`
     * for `gmPushBase(…)` in `send` — and this fails —
     *   AssertionError: his Frightened lands: expected [ { campaign_id: 'camp-nvo', …(5) } ] to have a length of 2 but got 1
     * (made on his 21, it reads the 25 from before his push and stands down).
     */
    await mount(hurt(), GM);
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'nothing is drawn over his own character').toBeUndefined();
    expect(pc().currentHP, 'his 4 stays on his row').toBe(21);

    frightened(2);
    await settle();
    expect(server.editWrites, 'his Frightened lands').toHaveLength(2);
    expect(pushed(1).currentHP).toBe(21);
    expect(pushed(1).conditions).toEqual(
      expect.arrayContaining([
        { id: 'frightened', value: 2 },
        { id: 'wounded', value: 1 },
      ]),
    );
  });

  it('…and a heal of his own, published after his app applied his hit, is never overwritten by that hit', async () => {
    /*
     * The round-6 refuter's PROBE-OWN-ABA. His 4 lands; his own app applies it and publishes, then he
     * heals it back on his own sheet and publishes again — neither has reached this screen. His
     * Frightened is made on the row's 21; the fresh read finds his 25, so it stands down and the row
     * follows his sheet. Round 6 judged it against the sheet from BEFORE his push (no overlay is
     * drawn here), which matched his heal by value, and wrote his 21 over it.
     *
     * MUTATION (tried 2026-10-01, round 7): judge a gesture against the sheet this screen was handed —
     * `on: vitalsKey(sv)` for `on: vitalsKey(was)` in reconcile — and this fails —
     *   AssertionError: his earlier hit is never written over his heal: expected [ …(2) ] to have a length of 1 but got 2
     */
    await mount(hurt(), GM);
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    publish(server.editWrites[0].sheet as SavedChar, T1, GM); // his own app applies it…
    publish(hurt(), '2026-10-01T11:30:00.000Z', GM); // …and he heals it back: 25 HP + Wounded 1

    frightened(2);
    await settle();
    expect(server.editWrites, 'his earlier hit is never written over his heal').toHaveLength(1);
    expect(theirs().play!.damage).toBe(MAX - 25);
    expect(pc().currentHP, 'the row follows his own sheet').toBe(25);
    expect(rowConds()).toEqual(['wounded:1']);
  });
});

/*
 * THE WRITE BASE — the round-9 refuter's probes PX1–PX5 and the round-10 refuters' ZA–ZD and PZ1–PZ3,
 * as legs. What a push is BUILT on (gmSync.gmPushBase) and the base it is RECORDED on
 * (gmSync.rememberGmEdit) decide whether his next push stands. A push is recorded on the read it was
 * built on, so one built on their republish of an earlier push of his (PX1, PX2), or an Update he
 * confirmed over their newer sheet (PZ3), stands; finding an edit stood down sets off no re-pull
 * while the push is out (ZD); an edit with no proved base is never built on (PX4) — his gestures go
 * out at once on their sheet and replace it, his loss and never theirs (ZA–ZC, PZ1); and two lines
 * of the seam that no leg pinned are pinned (PX3: `was` in reconcile, PX5: the sheet-wins branch of
 * `send`).
 */
describe('the write base — a push is recorded on the publish it was built on, and never built on an unproved edit', () => {
  const heldEdit = () => vitalsFromSheet(server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar, db);

  it('PX1: their app applies his 4 and republishes before his 1 is made — his 1 is built on that publish, recorded on it, and stands', async () => {
    /*
     * MUTATION (tried 2026-10-02, round 11): record a push on the OLDER of its base and the replaced
     * edit's, the rule this replaced — `baseUpdatedAt && had?.baseUpdatedAt && had.baseUpdatedAt <
     * baseUpdatedAt ? had.baseUpdatedAt : baseUpdatedAt ?? had?.baseUpdatedAt` in
     * gmSync.rememberGmEdit — and this fails, with PX1-real, ZD, PX2 and PZ3 (and (o) in
     * bug-gm-edit-visibility.test.tsx) —
     *   AssertionError: his 1 is recorded on the publish it was built on: expected '2026-10-01T10:00:00.000Z' to be '2026-10-01T11:00:00.000Z'
     * (his stood-down 4 hands its older base to his 1; the next read takes his 1 for overtaken, the
     * row snaps back to 21, and his Frightened replaces his 1 on the server: [21, 20, 21]).
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    await settle();
    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applies it — not on this screen yet
    act(() => store().applyDamage(pc().id, 1)); // its fresh read finds their republish
    await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP)).toEqual([21, 20]);
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'his 1 is recorded on the publish it was built on').toBe(T1);

    await m.deliver(); // the next member read
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'his 1 still stands').toBeDefined();
    expect(pc().currentHP, 'the row stays on his 1').toBe(20);

    frightened(1);
    await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'his Frightened lands on his 1').toEqual([21, 20, 20]);
    expect(heldEdit().conditions).toEqual(expect.arrayContaining([{ id: 'frightened', value: 1 }, { id: 'wounded', value: 1 }]));
    expect(theirs().play!.damage, 'the player’s sheet is their republish of his 4').toBe(MAX - 21);
  });

  it('PX1-real: …and so through the REAL wiring, with nothing handed over — only the re-pull his own push sets off', async () => {
    /*
     * MUTATION (tried 2026-10-02, round 11): as in PX1, and this fails —
     *   AssertionError: the row stays on his 1: expected 21 to be 20
     */
    await mountWired();
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    await settle();
    await settle();
    expect(pc().currentHP).toBe(21);
    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applies it — nothing delivers it here
    act(() => store().applyDamage(pc().id, 1));
    for (let i = 0; i < 4; i++) await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP)).toEqual([21, 20]);
    expect(pc().currentHP, 'the row stays on his 1').toBe(20);

    frightened(1);
    for (let i = 0; i < 3; i++) await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'his Frightened lands on his 1').toEqual([21, 20, 20]);
    expect(rowConds()).toEqual(['frightened:1', 'wounded:1']);
  });

  it('ZD: …and finding his 4 stood down sets off no read while his 1 is out, so his 1 is what the row lands on, however late the re-pull it sets off answers', async () => {
    /*
     * The round-10 refuter's ZD. Dropped on the spot, his stood-down 4 told every watcher, and the
     * member re-pull that set off answered with their republish of his 4 — no push of his — while his
     * 1 was out: a sheet ARRIVING, so his landed 1 was kept off the row (back to 21) until the next
     * read, and a gesture made in that window stood down against his own 1.
     *
     * MUTATION (tried 2026-10-02, round 11): drop it there again — `if (edit &&
     * !pendingEditStillStands(edit, published)) dropGmPendingEdit(campaignId, charId);` at the top of
     * gmSync.gmPushBase — and this fails, alone in this file —
     *   AssertionError: his 1’s own read is the only one while it is out: expected 2 to be 1
     */
    await mountWired();
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    for (let i = 0; i < 2; i++) await settle();
    publish(server.editWrites[0].sheet as SavedChar, T1); // their app applies it — nothing delivers it here
    const before = server.sheetReads;
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 1)); // its read finds their republish; his 1 goes out
    for (let i = 0; i < 3; i++) await settle();
    expect(server.release, 'his 1 is on the wire').not.toBeNull();
    expect(server.sheetReads - before, 'his 1’s own read is the only one while it is out').toBe(1);
    expect(pc().currentHP).toBe(20);

    server.holdNextRead = true; // the re-pull his landed 1 sets off stays on the wire…
    server.release!();
    for (let i = 0; i < 2; i++) await settle();
    expect(server.releaseRead, 'the re-pull his 1 set off has not answered').not.toBeNull();
    expect(pc().currentHP, 'the row lands on his 1').toBe(20);

    frightened(1); // …and he acts before it answers
    for (let i = 0; i < 3; i++) await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'his Frightened lands on his 1').toEqual([21, 20, 20]);
    server.releaseRead!();
    for (let i = 0; i < 2; i++) await settle();
    expect(pc().currentHP).toBe(20);
    expect(rowConds()).toEqual(['frightened:1', 'wounded:1']);
  });

  it('PX2: on his OWN character, after his app applied his 4, a gesture made while his 1 is unapplied lands on his 1', async () => {
    /*
     * His own character's edit is never drawn (gmSync.gmPendingEdit), and judged through that it was
     * never dropped either: the base it was recorded on stayed at his first push, and every later
     * push of his stood down once his app had applied any. Nothing is handed over here, so the only
     * read that sees his app's republish is his next push's own (PX2b has the member read).
     *
     * MUTATION (tried 2026-10-02, round 11): as in PX1, and this fails —
     *   AssertionError: his Frightened lands on his 1: expected [ 21, 20 ] to deeply equal [ 21, 20, 20 ]
     */
    await mount(hurt(), GM);
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    publish(server.editWrites[0].sheet as SavedChar, T1, GM); // his own app applies it
    expect(pc().currentHP).toBe(21);
    act(() => store().applyDamage(pc().id, 1)); // built on that publish
    await settle();
    expect(pc().currentHP).toBe(20);

    frightened(1); // his 1 is not applied yet
    await settle();
    expect(server.editWrites.map((_, i) => pushed(i).currentHP), 'his Frightened lands on his 1').toEqual([21, 20, 20]);
    expect(pushed(2).conditions).toEqual(expect.arrayContaining([{ id: 'frightened', value: 1 }, { id: 'wounded', value: 1 }]));
    expect(pc().currentHP).toBe(20);
    expect(rowConds()).toEqual(['frightened:1', 'wounded:1']);
  });

  it('PX2b: …and his full-sheet Update of his own character, made after the read that saw his app apply his 4, is recorded on that publish — his next gesture never builds over it', async () => {
    /*
     * The member read is where an edit that stood down is dropped, and judged through what is DRAWN
     * it skipped his own character's: held for the session on its first base.
     *
     * MUTATION (tried 2026-10-01, round 10; re-tried 2026-10-02, round 11, alone in this file):
     * judge that drop through what is drawn — `const held =
     * gmPendingEdit(campaignId, charId);` in gmSync.resolvePendingGmEdit — and this fails —
     *   AssertionError: the read dropped his stood-down 4: expected 1 to be +0
     * (the Update past that line is recorded on its own read either way: gmSync.rememberGmEdit).
     */
    const m = await mount(hurt(), GM);
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    await settle();
    publish(server.editWrites[0].sheet as SavedChar, T1, GM); // his own app applies it
    await m.deliver();
    expect(snapshotGmPending(CAMPAIGN).size, 'the read dropped his stood-down 4').toBe(0);

    // The full-sheet Update (GmEditSheet's push): his own working copy, on the read it made.
    // F1 (2026-10-09): the base is that read's stamp AND its authored hash (`gmBaseOf`), not a stamp alone.
    const opened = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const sick = { ...opened, play: { ...opened.play!, conditions: [...(opened.play!.conditions ?? []), { id: 'sickened', value: 1 }] } };
    expect((await pushGmEdit(CAMPAIGN, CHAR, GM, sick, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null)).ok).toBe(true);
    expect(snapshotGmPending(CAMPAIGN).get(`${CAMPAIGN}|${CHAR}`)!.baseUpdatedAt).toBe(T1);

    frightened(1); // made on the row's 21: the read finds his Update standing, so it stands down
    await settle();
    expect(heldEdit().conditions, 'his Sickened is still what the server holds').toEqual(
      expect.arrayContaining([{ id: 'sickened', value: 1 }]),
    );
    expect(rowConds(), 'the row shows his Update').toEqual(['sickened:1', 'wounded:1']);

    frightened(1); // …and lands on it
    await settle();
    expect(heldEdit().conditions).toEqual(
      expect.arrayContaining([{ id: 'frightened', value: 1 }, { id: 'sickened', value: 1 }, { id: 'wounded', value: 1 }]),
    );
  });

  it('PX3: a condition he adds and takes off again while his hit is out — the removal sticks, and that condition never goes out', async () => {
    /*
     * What the row showed when he made a gesture is his change not sent yet, before the one that is
     * out (`was` in reconcile).
     *
     * MUTATION (tried 2026-10-01, round 10; re-tried 2026-10-02, round 11): put the change that is
     * out first —
     * `const was = st.out?.v ?? st.want?.v ?? st.shown;` — and this fails —
     *   AssertionError: his removal sticks: expected [ 'frightened:2', 'wounded:1' ] to deeply equal [ 'wounded:1' ]
     * (against his hit the removal looks like no change, so the waiting Frightened is written back
     * onto the row and goes out after the hit). Dropping `st.want?.v ??` from `was` fails it the same
     * way. Each fails this leg alone in this file.
     */
    await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().applyDamage(pc().id, 4)); // out
    await settle();
    frightened(2); // waits behind it
    await settle();
    const fear = pc().conditions.find((c) => c.name === 'frightened')!;
    act(() => store().removeCondition(pc().id, fear.id)); // …and he takes it off again
    await settle();
    expect(rowConds(), 'his removal sticks').toEqual(['wounded:1']);

    server.release!(); // his 4 lands; what waits goes out behind it
    await settle();
    await settle();
    const fearOut = server.editWrites.some((_, i) => pushed(i).conditions.some((c) => c.id === 'frightened'));
    expect(fearOut, 'the Frightened he took off never goes out').toBe(false);
    expect(heldEdit().currentHP).toBe(21);
    expect(heldEdit().conditions).toEqual([{ id: 'wounded', value: 1 }]);
    expect(pc().currentHP).toBe(21);
    expect(rowConds()).toEqual(['wounded:1']);
  });

  it('PX4: an edit seeded from his other device (no base) under a fast GM clock is never built on — their newer sheet wins at once, and his next gesture lands on it', async () => {
    /*
     * With no base the stamp test falls back to the edit's own push stamp — the GM's clock — so a GM
     * device running fast keeps a stale edit standing over the player's newer publish. That is what
     * is DRAWN (best-effort, display only); a push is never built on it (gmSync.gmPushBase). His
     * gesture, made on the stale 21 the row showed, reads their 6 and stands down; the next is made on
     * their 6 and lands on it — nothing waits for a publish past his fast clock.
     *
     * MUTATION (tried 2026-10-02, round 11): build on any edit that stands, proved or not — drop
     * `edit?.baseUpdatedAt &&` from gmSync.gmPushBase — and this fails, with ZA–ZC —
     *   AssertionError: nothing is built on his stale copy over their 6: expected [ { campaign_id: 'camp-nvo', …(5) } ] to deeply equal []
     * MUTATION (tried 2026-10-02, round 11): make the gesture WAIT while such an edit stands, as the
     * round-10 fix did — `if (edit && !edit.baseUpdatedAt && pendingEditStillStands(edit, published))
     * return null;` at the top of gmSync.gmPushBase — and this fails, with ZA–ZC —
     *   AssertionError: their sheet wins at once: expected 21 to be 6
     */
    const m = await mount(hurt());
    const stale = hurt();
    server.edits.set(`${CAMPAIGN}|${CHAR}`, {
      campaign_id: CAMPAIGN,
      char_id: CHAR,
      owner_id: PLAYER,
      editor_id: GM,
      sheet: { ...stale, play: { ...stale.play!, damage: MAX - 21 } }, // his 4, from his other device
      updated_at: '2026-10-01T12:00:00.000Z', // that device's clock, an hour fast
    });
    await fetchPendingGmEdits(CAMPAIGN);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'seeded from the server').toBeDefined();
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, '…with no base').toBeUndefined();
    publish(patchedUp(), T1); // the player, after it — 11:00 on their own clock
    await m.deliver();
    expect(pc().currentHP, 'the overlay still draws his stale copy (display only)').toBe(21);

    frightened(1);
    await settle();
    expect(server.editWrites, 'nothing is built on his stale copy over their 6').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX - 6);
    expect(pc().currentHP, 'their sheet wins at once').toBe(6);
    expect(rowConds()).toEqual(['wounded:2']);

    frightened(1); // made on their 6: it lands there
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(pushed(0).currentHP).toBe(6);
    expect(pushed(0).conditions).toEqual(expect.arrayContaining([{ id: 'frightened', value: 1 }, { id: 'wounded', value: 2 }]));
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'recorded on their publish').toBe(T1);
    expect(theirs().play!.damage, 'the player’s own sheet is never written').toBe(MAX - 6);
  });

  /*
   * The round-10 refuters' ZA–ZC and PZ1: an edit of his with no proved base — a full-sheet Update
   * pushed after its read failed, or one seeded from his other device or by a sign-in — while the
   * player's app stays closed. Built ON, it is PX4 (a fast GM clock puts a stale copy over their
   * newer sheet). Held back until it settled (the round-10 fix), every tracker gesture on that
   * character stayed on the row for the whole session, drawn as if sent, and was gone when he left
   * the campaign. So his gestures go out at once, built on their published sheet, and the push
   * REPLACES his unproved edit on the server: his loss, never theirs, and the header's rule C names
   * it. Where that edit changed vitals, the first gesture (made on them) stands down and the row
   * snaps to their sheet; where it did not, nothing shows it.
   * When such an edit can carry a proved base (a stamp on the `gm_character_edits` row: party.ts and
   * the SQL), this leg flips for it: his gestures land on his edit.
   *
   * MUTATION (tried 2026-10-02, round 11): build on it — drop `edit?.baseUpdatedAt &&` from
   * gmSync.gmPushBase — and all three fail, with PX4 —
   *   ZB: AssertionError: built on their sheet: expected 80 to be +0 (ZA alike)
   *   ZC: AssertionError: made on his 21, it stands down on their 25: expected [ { campaign_id: 'camp-nvo', …(5) } ] to have a length of +0 but got 1
   * MUTATION (tried 2026-10-02, round 11): hold the gestures back, as in PX4 — and all three fail —
   *   ZA: AssertionError: his gesture goes out at once: expected [ { campaign_id: 'camp-nvo', …(5) } ] to have a length of 2 but got 1
   *   ZB: AssertionError: his gesture goes out at once: expected [] to have a length of 1 but got +0
   *   ZC: AssertionError: the row snaps to their sheet: expected 21 to be 25
   */
  // F1 (2026-10-09): ZA's premise — a full-sheet Update pushed after its read failed, with no base — no
  // longer exists: `pushGmEdit` sends nothing without a base (leg 42 below pins that). ZB and ZC stay as
  // written: they model rows an OLDER GM app wrote (no `gm_base`).
  for (const [label, hp] of [
    ['ZB: his other device awarded 80 XP', 25],
    ['ZC: his other device dealt 4 damage', 21],
  ] as const) {
    it(`${label} (no proved base, still standing): never built on — his gestures go out at once on their sheet, and replace it`, async () => {
      const m = await mount(hurt());
      const own = hurt();
      const theirXp = own.play!.xp;
      expect(theirXp, 'their sheet carries no award').not.toBe(80);
      const edit: SavedChar = { ...own, play: { ...own.play!, ...(hp === 25 ? { xp: 80 } : { damage: MAX - 21 }) } };
      // 10:30 on a clock in step with theirs: after their 10:00 publish. A row an OLDER GM app wrote.
      server.edits.set(`${CAMPAIGN}|${CHAR}`, {
        campaign_id: CAMPAIGN,
        char_id: CHAR,
        owner_id: PLAYER,
        editor_id: GM,
        sheet: edit,
        updated_at: '2026-10-01T10:30:00.000Z',
      });
      await fetchPendingGmEdits(CAMPAIGN);
      expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'no proved base').toBeUndefined();
      const writes = server.editWrites.length;
      await m.deliver();
      expect(pc().currentHP, 'the row shows his edit').toBe(hp);

      frightened(1);
      await settle();
      if (hp === 25) {
        expect(server.editWrites, 'his gesture goes out at once').toHaveLength(writes + 1);
      } else {
        expect(server.editWrites, 'made on his 21, it stands down on their 25').toHaveLength(writes);
        expect(pc().currentHP, 'the row snaps to their sheet').toBe(25);
        expect(rowConds()).toEqual(['wounded:1']);
      }
      act(() => store().applyDamage(pc().id, 1));
      await settle();
      const out = server.editWrites.slice(writes);
      expect(out, 'every gesture made on what the row showed went out').toHaveLength(hp === 25 ? 2 : 1);
      for (const w of out) expect((w.sheet as SavedChar).play!.xp, 'built on their sheet').toBe(theirXp);
      const held = server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
      expect(held, 'his unproved edit is replaced — the known loss').toBe(out[out.length - 1].sheet);
      expect(vitalsFromSheet(held, db).currentHP).toBe(24);
      expect(vitalsFromSheet(held, db).conditions.map((c) => `${c.id}:${c.value ?? ''}`).sort()).toEqual(
        hp === 25 ? ['frightened:1', 'wounded:1'] : ['wounded:1'],
      );
      expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'recorded on their publish').toBe(T0);
      expect(pc().currentHP).toBe(24);
      expect(theirs().play!.damage, 'the player’s own sheet is never written').toBe(MAX - 25);
    });
  }

  it('PZ3: his full-sheet Update, confirmed over their newer publish, is recorded on the read it was built on — the next read keeps it, and his next gesture lands on it', async () => {
    /*
     * The round-10 refuter's PZ3. His 4 lands on T0; their app applies it and they note 10 XP (T1).
     * His full-sheet Update builds his Update on the read that showed T1 (./GmEditSheet.tsx): their
     * sheet, with 90 XP. Recorded on the OLDER base of his 4, the next read took it for overtaken by
     * the very publish it was built on, and his next tracker gesture, built on that publish,
     * replaced it on the server: his confirmed 90 XP gone.
     *
     * MUTATION (tried 2026-10-02, round 11): the older-base rule, as in PX1, and this fails —
     *   AssertionError: his Update is recorded on the read it was built on: expected '2026-10-01T10:00:00.000Z' to be '2026-10-01T11:00:00.000Z'
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    await settle();
    const applied = server.editWrites[0].sheet as SavedChar;
    publish({ ...applied, play: { ...applied.play!, xp: 10 } } as SavedChar, T1); // their app applies it; 10 XP of theirs
    const opened = theirs();
    const update = { ...opened, play: { ...opened.play!, xp: 90 } } as SavedChar;
    // F1 (2026-10-09): the base is the read that showed T1 — its stamp and its authored hash.
    expect((await pushGmEdit(CAMPAIGN, CHAR, PLAYER, update, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null)).ok).toBe(true);
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'his Update is recorded on the read it was built on').toBe(T1);

    await m.deliver(); // the next member read
    expect(gmPendingEdit(CAMPAIGN, CHAR)?.sheet, 'his Update still stands').toBe(update);
    expect(pc().currentHP).toBe(21);

    frightened(1);
    await settle();
    const held = server.edits.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
    expect(held.play!.xp, 'his Update is still what the server holds').toBe(90);
    expect(vitalsFromSheet(held, db).conditions).toEqual(
      expect.arrayContaining([{ id: 'frightened', value: 1 }, { id: 'wounded', value: 1 }]),
    );
    expect(theirs().play!.xp, 'the player’s own sheet is never written').toBe(10);
  });

  it('PX5: his hit stands down on their own same hit, read first — the Frightened riding it stands down with it and never goes out', async () => {
    /*
     * Rule C: the sheet wins over his change AND over anything made on top of it. His Frightened was
     * made on his 21 — and their sheet carries that very 21, so judged alone it would land on a sheet
     * he never saw.
     *
     * MUTATION (tried 2026-10-01, round 10; re-tried 2026-10-02, round 11): keep what rides a push
     * that stood down — drop `st.want = undefined;` from the sheet-wins branch of `send` — and this
     * fails, alone in this file —
     *   AssertionError: nothing of his goes out over a sheet he never saw: expected [ { campaign_id: 'camp-nvo', …(5) } ] to deeply equal []
     */
    await mount(hurt());
    server.holdNextRead = true;
    act(() => store().applyDamage(pc().id, 4)); // its fresh read is on the wire
    await settle();
    frightened(2); // rides it
    await settle();
    const own = hurt();
    publish({ ...own, play: { ...own.play!, damage: MAX - 21 } }, T1); // the player records the same hit
    server.releaseRead!(); // his 4 reads their sheet: it stands down
    await settle();
    await settle();
    expect(server.editWrites, 'nothing of his goes out over a sheet he never saw').toEqual([]);
    expect(pc().currentHP, 'the row follows their sheet').toBe(21);
    expect(rowConds()).toEqual(['wounded:1']);
    expect(theirs().play!.conditions).toEqual([{ id: 'wounded', value: 1 }]);
  });
});

/*
 * F1 (2026-10-09) — THE BASE A PUSH CARRIES, AND WHAT THE PLAYER'S APP MAKES OF IT.
 *
 * Every push writes `gm_base` (the fresh read it was built on: stamp + authored hash, and `on` — the
 * push of his it was built on), so the player's app can refuse one built on a sheet they have changed
 * since (src/sheet/gmSync.ts → gmEditVerdict), and the GM's own write path builds on his held edit only
 * while the published sheet is still exactly its base (`pendingEditStandsOnFreshRead`). The player's
 * side runs here as the pure verdict over the rows this harness stores; the real <App/> runs it in
 * test/bug-gm-edit-race.test.tsx.
 */
describe('F1 — the base a push carries, and what the player’s app makes of it', () => {
  const editRow = () => server.edits.get(`${CAMPAIGN}|${CHAR}`)!;
  const theirRow = async () => (await fetchPublishedSheet(CAMPAIGN, CHAR))!;
  const hashOf = (sc: SavedChar) => hash53(authoredKey(sc));

  it('(36) every seam push writes gm_base bound to itself, on the read it was built on — and `on` names the push it was built on', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the `gm_base: { … }` line from pushGmEdit's upsert — and this fails,
     * with (37), (38), (39) and (43) —
     *   AssertionError: expected undefined to deeply equal { v: 1, …(4) }
     * MUTATION (run 2026-10-09): pass `null` for `on` in pcSheetTruth's `send()` — and this fails, with (38) —
     *   AssertionError: his 1 was built on his 4: expected null to be '2026-10-09T14:53:55.854Z'
     * (the stamp is the push's own, so it differs run to run).
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    const first = server.editWrites[0];
    expect(first.gm_base).toEqual({ v: 1, at: first.updated_at, stamp: T0, hash: hashOf(hurt()), on: null });
    act(() => store().applyDamage(pc().id, 1)); // built on his held 4: the published sheet has not moved
    await settle();
    const second = server.editWrites[1];
    expect((second.gm_base as { on: string | null }).on, 'his 1 was built on his 4').toBe(first.updated_at);
    expect((second.gm_base as { stamp: string }).stamp).toBe(T0);
    expect((second.gm_base as { at: string }).at).toBe(second.updated_at);
  });

  it('(37) F2: their second device publishes a newer sheet stamped EARLIER than his base — his next gesture is built on THEIR sheet', async () => {
    /*
     * MUTATION (run 2026-10-09): build on the display rule — `edit && pendingEditStillStands(edit,
     * published)` in gmSync.gmPushBuiltOn — and this fails —
     *   AssertionError: nothing is built on his stale 4 over their 6: expected [ …(2) ] to have a length of 1 but got 2
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // lands: 21, on T0
    await settle();
    const early = '2026-10-01T09:59:00.000Z';
    publish(patchedUp(), early); // their phone, whose clock runs behind
    await m.deliver();
    frightened(1); // made on the row
    await settle();
    expect(server.editWrites, 'nothing is built on his stale 4 over their 6').toHaveLength(1);
    expect(pc().currentHP, 'the row snaps to their sheet').toBe(6);
    frightened(1); // made on their 6: it lands there
    await settle();
    expect(server.editWrites).toHaveLength(2);
    expect(pushed(1).currentHP).toBe(6);
    expect((server.editWrites[1].gm_base as { stamp: string }).stamp, 'built on their publish').toBe(early);
    expect(theirs().play!.damage, 'the player’s own sheet is never written').toBe(MAX - 6);
  });

  it('(38) an edit seeded from a row WITH a bound gm_base is proved, and his next gesture is built on it (the inverse of ZB)', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the base from fetchPendingGmEdits' mapping (`baseUpdatedAt:
     * undefined, baseHash: undefined`) — and this fails —
     *   AssertionError: seeded with its base: expected undefined to be '2026-10-01T10:00:00.000Z'
     */
    const m = await mount(hurt());
    const own = hurt();
    const at = '2026-10-01T10:30:00.000Z';
    server.edits.set(`${CAMPAIGN}|${CHAR}`, {
      campaign_id: CAMPAIGN,
      char_id: CHAR,
      owner_id: PLAYER,
      editor_id: GM,
      sheet: { ...own, play: { ...own.play!, damage: MAX - 21 } }, // his 4, from his other device
      updated_at: at,
      gm_base: { v: 1, at, stamp: T0, hash: hashOf(own), on: null },
    });
    await fetchPendingGmEdits(CAMPAIGN);
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'seeded with its base').toBe(T0);
    await m.deliver();
    expect(pc().currentHP).toBe(21);
    frightened(1);
    await settle();
    expect(server.editWrites, 'his gesture lands on his seeded 4').toHaveLength(1);
    expect(pushed(0).currentHP).toBe(21);
    expect((server.editWrites[0].gm_base as { on: string }).on).toBe(at);
  });

  it('(39) a stale survivor: an OLD GM app upserts over a new app’s row — the base no longer proves anything', async () => {
    /*
     * MUTATION (run 2026-10-09): skip the binding term (`sameInstant(b.at, row.updatedAt)`) in
     * gmSync.boundGmBase — and this fails —
     *   AssertionError: an old app's push never borrows the new one's proof: expected 'apply' to be 'refuse'
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // the new app's push, with its base
    await settle();
    const { supabase } = await import('../src/data/supabase');
    const own = hurt();
    await supabase!.from('gm_character_edits').upsert({
      campaign_id: CAMPAIGN,
      char_id: CHAR,
      owner_id: PLAYER,
      editor_id: GM,
      sheet: { ...own, play: { ...own.play!, xp: 500 } },
      updated_at: '2026-10-01T10:45:00.000Z', // an older GM app: no gm_base column sent
    });
    expect(editRow().gm_base, 'merge-duplicates kept the earlier push’s base').toBeDefined();
    const verdict = gmEditVerdict({ row: gmEditFromRow(editRow()), own: await theirRow(), local: theirs() });
    expect(verdict, "an old app's push never borrows the new one's proof").toBe('refuse');
  });

  it('(40) the P2b2 / P2c / P5c replay: they publish after his read — the stored push is refused, and their sheet keeps their change', async () => {
    /*
     * MUTATION (run 2026-10-09): drop `atBase` from the general rule (`if (A === S) return 'apply';`) —
     * and this fails —
     *   AssertionError: his push built on T0 is refused: expected 'apply' to be 'refuse'
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // his push, built on their T0 sheet
    await settle();
    const own = hurt();
    const drank = { ...own, play: { ...own.play!, xp: 12 } } as SavedChar; // their own change after his read
    publish(drank, T1); // their app published it before picking his push up
    const verdict = gmEditVerdict({ row: gmEditFromRow(editRow()), own: await theirRow(), local: drank });
    expect(verdict, 'his push built on T0 is refused').toBe('refuse');
    expect(theirs().play!.xp, 'their change stays').toBe(12);
    expect(theirs().play!.damage).toBe(MAX - 25);
  });

  it('(41) the refusal receipt stands his overlay down, says "not applied", and his row snaps to their sheet', async () => {
    /*
     * MUTATION (run 2026-10-09): delete the receipt clause from gmSync.pendingEditStillStands — and this
     * fails, alone among the F1 legs —
     *   AssertionError: the overlay stands down: expected { campaignId: 'camp-nvo', …(6) } to be undefined
     */
    const m = await mount(hurt());
    act(() => store().applyDamage(pc().id, 4)); // lands: 21
    await settle();
    expect(pc().currentHP).toBe(21);
    const { markGmEditRefused } = await import('../src/data/party');
    await markGmEditRefused(CAMPAIGN, CHAR, server.editWrites[0].updated_at as string); // their app refused it
    expect(server.chars.get(`${CAMPAIGN}|${CHAR}`)!.updated_at, 'a receipt is one column — the stamp never moves').toBe(T0);
    await m.deliver();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the overlay stands down').toBeUndefined();
    expect(gmEditRefused(CAMPAIGN, CHAR), 'the GM is told').toBe(true);
    expect(pc().currentHP, 'the row snaps to their sheet').toBe(25);
  });

  it('(42) ZA rewritten: a push with no base sends NOTHING, and his held edit is untouched', async () => {
    /*
     * ZA's premise — a full-sheet Update pushed after its read failed — is closed at the source: a push
     * that proves no base is one the player's app must refuse anyway.
     * MUTATION (run 2026-10-09): allow base-less pushes — `if (!base) base = { stamp: '', hash: '' };` in
     * place of the guard in pushGmEdit — and this fails —
     *   AssertionError: a push with no base is refused: expected true to be false
     */
    await mount(hurt());
    act(() => store().applyDamage(pc().id, 4));
    await settle();
    const held = gmPendingEdit(CAMPAIGN, CHAR)!;
    const own = hurt();
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...own, play: { ...own.play!, xp: 80 } }, undefined);
    expect(res.ok, 'a push with no base is refused').toBe(false);
    expect(res.ok === false && res.error, 'said plainly').toContain('nothing was sent');
    expect(server.editWrites, 'no row lands').toHaveLength(1);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'his held edit is untouched').toBe(held);
  });

  it('(43) a database without gm_base: the push is refused with the SQL file named, and no base-less row ever lands', async () => {
    /*
     * MUTATION (run 2026-10-09): retry without the column — a legacy upsert of the same row minus
     * `gm_base`, returning ok, in pushGmEdit's missing-column branch — and this fails —
     *   AssertionError: refused until the SQL is re-run: expected true to be false
     */
    await mount(hurt());
    server.noGmBaseColumn = true;
    const own = hurt();
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...own, play: { ...own.play!, xp: 80 } }, gmBaseOf(await theirRow()), null);
    expect(res.ok, 'refused until the SQL is re-run').toBe(false);
    expect(res.ok === false && res.error).toContain('supabase-campaign-characters.sql');
    expect(gmEditSchemaOutdated(), 'the GM is shown the strip').toBe(true);
    act(() => store().applyDamage(pc().id, 4)); // a tracker gesture is owed, never sent base-less
    await settle();
    expect(server.editWrites, 'no base-less row ever lands').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX - 25);
  });
});

/*
 * WHICH ROW — the round-7 refuter's SAMENAME. The seam joined a member to the first PC row of the
 * member's NAME; two members of one name both joined the same row, each pass wrote it to its own
 * sheet, and each write set off the other's pass: `Maximum call stack size exceeded` on the next
 * dispatch, with the store's listeners cut off. The join is now the tracker's own (`isSamePc`:
 * charId first), and a row two members answer to is neither's.
 */
describe('which row — the tracker’s own “same character”, and a row two members answer to is neither’s', () => {
  const TWIN = 'pc-nvo-twin';
  /** Two members whose characters share a NAME: the player's (25 HP + Wounded 1) and a second one at
   *  full HP — a rebuilt copy attached beside the old one. */
  async function twins(): Promise<void> {
    publish(hurt(), T0);
    publish({ ...freshSheet(), id: TWIN }, T0);
    const members = (await fetchParty(CAMPAIGN))!;
    expect(members.map((x) => x.name), 'two members, one name').toEqual([NAME, NAME]);
    const sheets = new Map<string, SavedChar>();
    for (const x of members) sheets.set(x.charId, (await fetchMemberSheet(CAMPAIGN, x.charId))!);
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Seam members={members} sheets={sheets} />));
    await settle();
  }
  const row = (charId: string | undefined) => store().combatants.find((c) => c.isPC && c.charId === charId)!;

  it('a row typed in by hand that both names match: no sheet drives it, nothing is pushed from it, and the tracker keeps working', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 8): drop `|| members.some((o) => o !== mem && rowOf(o) === c)`
     * from the row test in reconcile and this fails on the add itself —
     *   RangeError: Maximum call stack size exceeded
     */
    await twins();
    act(() => store().addCombatant(null, { name: NAME, isPC: true, maxHP: 40 })); // typed in: no charId
    await settle();
    expect(row(undefined).currentHP, 'neither sheet is written onto it').toBe(40);
    expect(row(undefined).conditions).toEqual([]);

    act(() => store().applyDamage(row(undefined).id, 4));
    await settle();
    expect(row(undefined).currentHP, 'the GM’s own number stays on his own row').toBe(36);
    expect(server.editWrites, 'nothing reaches either character').toEqual([]);

    act(() => {
      store().addCombatant(null, { name: 'Ash Wight', maxHP: 20 });
      store().nextTurn();
    });
    await settle();
    expect(store().combatants, 'later dispatches still run').toHaveLength(2);
  });

  it('rows added from the party carry the character’s id: each follows its own sheet, and a gesture reaches only its own', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 8): join by name alone again —
     * `x.name.trim().toLowerCase() === mem.name.trim().toLowerCase()` for `isSamePc(x, mem)` in
     * `rowOf` — and this fails —
     *   AssertionError: the player’s own 25: expected 38 to be 25
     * (both members answer to the first row, so neither drives it, and the twin's row is joined by
     * nobody).
     */
    await twins();
    act(() => {
      store().addCombatant(null, { name: NAME, isPC: true, maxHP: MAX, charId: CHAR });
      store().addCombatant(null, { name: NAME, isPC: true, maxHP: MAX, charId: TWIN });
    });
    await settle();
    expect(row(CHAR).currentHP, 'the player’s own 25').toBe(25);
    expect(row(CHAR).conditions.map((c) => `${c.name}:${c.value ?? ''}`)).toEqual(['wounded:1']);
    expect(row(TWIN).currentHP, 'the twin at full HP').toBe(MAX);
    expect(row(TWIN).conditions).toEqual([]);

    act(() => store().applyDamage(row(TWIN).id, 4));
    await settle();
    expect(server.editWrites).toHaveLength(1);
    expect(server.editWrites[0].char_id, 'his 4 reaches the twin alone').toBe(TWIN);
    expect(pushed(0).currentHP).toBe(MAX - 4);
    expect(row(CHAR).currentHP).toBe(25);
    expect(theirs().play!.damage, 'the player’s own sheet is untouched').toBe(MAX - 25);
  });
});

/*
 * RULE D — the round-5 refuter's P2: an unmounted seam wrote the old campaign's vitals onto a
 * same-named PC row of the next board (CampaignTracker.tsx calls setScope(null) on unmount, and a push
 * that stood down re-ran the dead seam's pass).
 */
describe('rule D — an unmounted seam writes nothing', () => {
  /** The next board: a same-named PC row the old campaign's seam must never touch. */
  function nextBoard(): void {
    act(() => {
      store().clearAllCombatants();
      store().addCombatant(null, { name: NAME, isPC: true, maxHP: 40 });
    });
  }
  const row = () => ({ hp: pc().currentHP, max: pc().maxHP, conds: rowConds() });

  it('P2: a read answered after the GM left stands down without writing the next board’s row', async () => {
    /*
     * Two checks hold this, each alone: the read's answer sends nothing once the seam is gone, and
     * the pass the stand-down re-runs writes nothing (the microtask legs below pin that second one by
     * itself). MUTATION (tried 2026-10-01, round 7): drop both — `if (!alive.current) return false;`
     * after the read in `send` and `if (!alive.current) return;` at the top of `reconcile` — and this
     * fails —
     *   AssertionError: an unmounted seam writes nothing: expected { hp: 6, max: 38, …(1) } to deeply equal { hp: 40, max: 40, conds: [] }
     * Never marking the seam dead (`alive.current = false;` dropped from the effect cleanup) fails
     * all three legs here.
     */
    const m = await mount(hurt());
    server.holdNextRead = true;
    act(() => store().setDefeated(pc().id, true)); // its read is on the wire
    await settle();
    publish(patchedUp(), T1); // the player, meanwhile
    m.unmount();
    nextBoard();
    const before = row();
    server.releaseRead!(); // the push would stand down: their sheet moved
    await settle();
    expect(row(), 'an unmounted seam writes nothing').toEqual(before);
    expect(server.editWrites).toEqual([]);
  });

  it('…nor sends what it read', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 7): drop `if (!alive.current) return false;` after the read in
     * `send` and this fails —
     *   AssertionError: an unmounted seam sends nothing: expected [ { campaign_id: 'camp-nvo', …(5) } ] to deeply equal []
     */
    const m = await mount(hurt());
    server.holdNextRead = true;
    act(() => store().setDefeated(pc().id, true));
    await settle();
    m.unmount();
    nextBoard();
    server.releaseRead!();
    await settle();
    expect(server.editWrites, 'an unmounted seam sends nothing').toEqual([]);
    expect(row()).toEqual({ hp: 40, max: 40, conds: [] });
  });

  it('…nor writes the next board’s row when a push it sent lands after it left', async () => {
    /*
     * The push was on the wire before he left, so the server takes it — but this seam is gone, and
     * the row of that name now belongs to another board.
     *
     * MUTATION (tried 2026-10-01, round 7): drop `if (!alive.current) return;` from the top of
     * `reconcile` and this fails —
     *   AssertionError: an unmounted seam writes nothing: expected { hp: +0, max: 38, …(1) } to deeply equal { hp: 40, max: 40, conds: [] }
     */
    const m = await mount(hurt());
    server.holdNextEdit = true;
    act(() => store().setDefeated(pc().id, true)); // read, sent — the server has not answered
    await settle();
    m.unmount();
    nextBoard();
    const before = row();
    server.release!();
    await settle();
    expect(server.editWrites, 'it was already on the wire').toHaveLength(1);
    expect(row(), 'an unmounted seam writes nothing').toEqual(before);
  });

  /*
   * The round-6 refuter's PROBE-RULE-D-MICROTASK: the GM leaves a few microtasks after the answer —
   * after the read's own check, before the pass the answer re-runs. A check inside `send` cannot see
   * that gap; the one at the top of `reconcile` is where every late pass goes through.
   *
   * MUTATION (tried 2026-10-01, round 7): drop `if (!alive.current) return;` from the top of
   * `reconcile` and the legs whose hop count lands in the gap fail — today stand-down at 1 and landed
   * at 0 and 1 —
   *   AssertionError: an unmounted seam writes nothing, whenever he leaves: expected { hp: 6, max: 38, …(1) } to deeply equal { hp: 40, max: 40, conds: [] }
   */
  const hops = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) await Promise.resolve();
  };
  for (const path of ['stand-down', 'landed'] as const) {
    for (let n = 0; n <= 8; n++) {
      it(`…whenever he leaves after the answer: ${path}, ${n} microtask${n === 1 ? '' : 's'} later`, async () => {
        const m = await mount(hurt());
        if (path === 'stand-down') server.holdNextRead = true;
        else server.holdNextEdit = true;
        act(() => store().setDefeated(pc().id, true));
        await settle();
        if (path === 'stand-down') {
          publish(patchedUp(), T1); // their sheet moved: the push will stand down
          server.releaseRead!();
        } else {
          server.release!();
        }
        await hops(n);
        m.unmount();
        nextBoard();
        await settle();
        expect(row(), 'an unmounted seam writes nothing, whenever he leaves').toEqual({ hp: 40, max: 40, conds: [] });
      });
    }
  }
});

/*
 * OWNER'S LIST 2026-10-01, ITEM 2 — a player who drops to 0 on their OWN sheet. His answers (2026-10-10):
 * "the players need to change the dying themselves; if they drop to 0 it does need to be updated in the
 * tracker and move them to the correct initiative" and "The tracker moves a downed creature before
 * whoever's turn it is."
 *
 * So when a sheet ARRIVES taking the row from above 0 HP to 0 in a fight, the row moves to just before
 * the creature whose turn it is, on that creature's count (combatStore.moveBeforeActive, the store's
 * one rule for a creature going down) — inside writeVitals' plain write, which is no gesture: nothing
 * reaches the player, and the row's Dying / Unconscious are exactly their sheet's. The tracker adds no
 * condition of its own to a player character.
 */
describe('a player whose own sheet drops to 0 mid-fight moves in the order — and nothing is pushed', () => {
  const order = () => store().combatants.map((c) => c.name);
  const acting = () => store().combatants[store().activeIndex]?.name;

  /** The player's 25 HP + Wounded 1, in a fight: Cinder Goblin 20 (acting), the PC 15, Moss Ogre 10. */
  async function inFight(fight = true) {
    const m = await mount(hurt());
    act(() => {
      store().addCombatant(null, { name: 'Cinder Goblin', maxHP: 20, initiative: 20 });
      store().addCombatant(null, { name: 'Moss Ogre', maxHP: 40, initiative: 10 });
      store().setInitiative(pc().id, 15);
      if (fight) store().startCombat();
      else store().sortByInitiative();
    });
    await settle();
    expect(order(), 'fixture: the order as rolled').toEqual(['Cinder Goblin', NAME, 'Moss Ogre']);
    return m;
  }

  it('their knock-out moves the row before the acting creature, on its count; the row is their sheet, and nothing is pushed', async () => {
    /*
     * MUTATION (tried 2026-10-11, round 1, before `standing` joined the line): drop
     * `if (dropped && standing && c.currentHP === 0) moveBeforeActive(s, cid);` from writeVitals
     * (src/integration/pcSheetTruth.ts) and this fails — as it does (tried, round 2) when the arrival
     * stops counting as a fall (`follow(st, sv)` → `st.shown = sv` in reconcile) —
     *   AssertionError: expected [ 'Cinder Goblin', 'Isolde Marrow', …(1) ] to deeply equal [ 'Isolde Marrow', 'Cinder Goblin', …(1) ]
     */
    const m = await inFight();
    expect(acting()).toBe('Cinder Goblin');
    publish(knockedOut(), T1); // their own app: 0 HP, Unconscious, Dying 2
    await m.deliver();
    showsKnockOut('the row is exactly their sheet — the tracker adds no condition to a player');
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative, 'on the acting creature’s count, so a later edit or Sort keeps it there').toBe(20);
    expect(acting(), 'the turn stays where it was').toBe('Cinder Goblin');
    expect(downedMarker(pc()), 'the row’s marker is their own Dying').toBe('DYING 2');
    expect(server.editWrites, 'a sheet arriving is never pushed back').toEqual([]);
    expect(theirs().play!.damage).toBe(MAX);

    // …and the turn engine after it adds nothing of the tracker's either.
    act(() => store().nextTurn());
    await settle();
    expect(server.editWrites).toEqual([]);
    showsKnockOut('no recovery roll, no reminder, no Dying of the tracker’s');
  });

  it('a player ALREADY at 0 whose sheet arrives at 0 again (Dying 2 → 3) is not moved again', async () => {
    /*
     * Only a drop moves the row: their sheet going from above 0 HP to 0. Their failed recovery check
     * (Dying 2 → 3, still 0 HP) is no drop — the row follows their sheet where it already sits.
     * GUARDED TWICE since round 2 (2026-10-11): `follow`'s fall test (no new fall — since round 3,
     * 2026-10-13, `st.theirs > 0`: their own side's last HP) and writeVitals' `standing` (a row already
     * at 0 is not taken down) each keep this leg green alone. The single-guard legs are "…whose sheet
     * wins the GM’s heal…" and "…that LANDED and that their app then refused…" (follow) and "…the GM’s
     * own knock-out already took the row through…" (standing), below.
     */
    const m = await inFight();
    publish(knockedOut(), T1); // the drop: moved before Cinder Goblin, on its 20
    await m.deliver();
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    act(() => store().nextTurn()); // Cinder Goblin's turn ends: Moss Ogre acts
    await settle();
    expect(acting()).toBe('Moss Ogre');

    const worse = knockedOut();
    publish(
      { ...worse, play: { ...worse.play!, conditions: [{ id: 'wounded', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 3 }] } },
      '2026-10-01T11:30:00.000Z',
    );
    await m.deliver();
    expect(rowConds(), 'the row follows their sheet').toEqual(['dying:3', 'unconscious:', 'wounded:1']);
    expect(order(), 'still where the first drop put it').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(acting()).toBe('Moss Ogre');
    expect(server.editWrites, 'a sheet arriving is never pushed back').toEqual([]);
  });

  it('before the fight nothing moves, and the rolled number stays', async () => {
    /*
     * MUTATION (tried 2026-10-11): drop `if (!s.inCombat) return false` from combatStore.moveBeforeActive
     * and this fails —
     *   AssertionError: expected [ 'Isolde Marrow', 'Cinder Goblin', …(1) ] to deeply equal [ 'Cinder Goblin', 'Isolde Marrow', …(1) ]
     */
    const m = await inFight(false);
    publish(knockedOut(), T1);
    await m.deliver();
    showsKnockOut('the row is their sheet');
    expect(order()).toEqual(['Cinder Goblin', NAME, 'Moss Ogre']);
    expect(pc().initiative).toBe(15);
    expect(server.editWrites).toEqual([]);
  });

  it('a row that is only REWRITTEN at 0 — re-added mid-fight — is no drop, and stays where it was put', async () => {
    /*
     * A load is not an edit, and a re-add is not the character going down: only a sheet ARRIVING from
     * above 0 to 0 moves the row.
     * MUTATION (tried 2026-10-11): key the move on the write alone — `show.currentHP === 0` for
     * `dropped` in reconcile's writeVitals call — and this fails —
     *   AssertionError: expected [ 'Isolde Marrow', 'Cinder Goblin', …(1) ] to deeply equal [ 'Cinder Goblin', 'Moss Ogre', …(1) ]
     */
    const m = await inFight();
    publish(knockedOut(), T1);
    await m.deliver();
    act(() => store().removeCombatant(pc().id));
    m.addPc(); // a brand-new row at full HP, put at the end of the order
    await settle();
    showsKnockOut('the re-added row is their sheet');
    expect(order()).toEqual(['Cinder Goblin', 'Moss Ogre', NAME]);
    expect(server.editWrites).toEqual([]);
  });

  /*
   * ROUND 2 (refuter, 2026-10-11): their fall used to be read only on the pass their sheet ARRIVED, and
   * acted on only if the row showed that sheet on that same pass. With a change of the GM's out (or owed)
   * the row shows HIS change; when his push's fresh read then finds their newer sheet, the sheet wins and
   * the row reaches 0 on a later pass — which was no arrival, so the row stayed in its old seat for good.
   * The fall is kept now (SeenPc.drop) until the row shows their sheet.
   */
  it('their drop that arrives while a change of the GM’s is OUT moves the row once his push loses to it', async () => {
    /*
     * MUTATION (tried 2026-10-11): spend the drop on every pass — `if (show === st.shown) { … }` →
     * `{ … }` in reconcile (src/integration/pcSheetTruth.ts) — and this fails —
     *   AssertionError: moved before the acting creature: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     * (the round-1 code, which took the drop on the arrival pass alone, failed the same way).
     */
    const m = await inFight();
    server.holdNextRead = true;
    frightened(1); // his gesture: its push's fresh read stays on the wire
    await settle();
    expect(server.releaseRead, 'his push is still waiting').not.toBeNull();

    publish(knockedOut(), T1); // their own app: 0 HP, Unconscious, Dying 2
    await m.deliver();
    expect(pc().currentHP, 'his Frightened still stands over their sheet').toBe(25);
    expect(order()).toEqual(['Cinder Goblin', NAME, 'Moss Ogre']);

    server.releaseRead!(); // the read finds their knock-out: the sheet wins his Frightened
    await settle();
    await settle();
    showsKnockOut('the row is their sheet');
    expect(order(), 'moved before the acting creature').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative, 'on its count').toBe(20);
    expect(acting(), 'the turn stays where it was').toBe('Cinder Goblin');
    expect(server.editWrites, 'nothing reaches the player').toEqual([]);
  });

  it('…and one his push’s fresh read finds BEFORE the sheet itself arrives moves it too — once', async () => {
    /*
     * MUTATION (tried 2026-10-11): in send's sheet-wins branch, `follow(st, now)` → `st.shown = now`
     * (the round-1 line) and this fails —
     *   AssertionError: moved before the acting creature: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     */
    const m = await inFight();
    server.holdNextRead = true;
    frightened(1);
    await settle();
    publish(knockedOut(), T1); // published — the live subscription has not handed it over yet
    server.releaseRead!(); // his push's read finds it first
    await settle();
    await settle();
    showsKnockOut('the row is their sheet');
    expect(order(), 'moved before the acting creature').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);

    act(() => store().nextTurn()); // Cinder Goblin's turn ends: Moss Ogre acts
    await settle();
    expect(acting()).toBe('Moss Ogre');
    await m.deliver(); // only now does the subscription hand over the very same knock-out
    expect(order(), 'one fall, one move').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(server.editWrites).toEqual([]);
  });

  it('their fall that the GM’s own knock-out already took the row through is not moved a second time', async () => {
    /*
     * His hit took the row to 0 and moved it (applyDamage → applyPCDefeat, a gesture). Their own app
     * records the same fall, with Prone, and his push loses to it: the row follows their sheet, but it
     * is already down — the same fall does not move it again, to before whoever acts NOW.
     * MUTATION (tried 2026-10-11): drop `standing &&` from writeVitals' move
     * (src/integration/pcSheetTruth.ts) and this fails —
     *   AssertionError: one fall, one move: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     */
    const m = await inFight();
    server.holdNextRead = true;
    act(() => store().applyDamage(pc().id, 25)); // his hit: down, moved before Cinder Goblin on its 20
    await settle();
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    act(() => store().nextTurn()); // Cinder Goblin's turn ends: Moss Ogre acts
    await settle();
    expect(acting()).toBe('Moss Ogre');

    const ko = knockedOut();
    publish({ ...ko, play: { ...ko.play!, conditions: [...ko.play!.conditions!, { id: 'prone' }] } }, T1);
    await m.deliver();
    server.releaseRead!(); // the read finds their own record of it: the sheet wins his push
    await settle();
    await settle();
    expect(pc().currentHP).toBe(0);
    expect(rowConds(), 'the row is their sheet').toEqual(['dying:2', 'prone:', 'unconscious:', 'wounded:1']);
    expect(order(), 'one fall, one move').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(acting()).toBe('Moss Ogre');
    expect(server.editWrites, 'his push lost to their sheet').toEqual([]);
  });

  it('a player still down whose sheet wins the GM’s heal is not moved: they never got up, so no new fall', async () => {
    /*
     * His heal stood the row up at 5; their app never got it and records a failed recovery check
     * (Dying 3, still 0 HP); the sheet wins and the row goes back to 0 where their first fall put it.
     * MUTATION (tried 2026-10-11 on the round-2 line, re-tried 2026-10-13 on round 3's):
     * `if (st.theirs > 0 && v.currentHP === 0) st.drop = true;` → `if (v.currentHP === 0) st.drop = true;`
     * in follow (src/integration/pcSheetTruth.ts) and this fails —
     *   AssertionError: where their first fall put it: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     */
    const m = await inFight();
    publish(knockedOut(), T1);
    await m.deliver(); // their fall: moved before Cinder Goblin, on its 20
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    act(() => store().nextTurn()); // Moss Ogre acts
    await settle();
    expect(acting()).toBe('Moss Ogre');

    server.holdNextRead = true;
    act(() => store().applyHealing(pc().id, 5)); // his heal: its push's read stays on the wire
    await settle();
    expect(pc().currentHP).toBe(5);

    const worse = knockedOut();
    publish(
      { ...worse, play: { ...worse.play!, conditions: [{ id: 'wounded', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 3 }] } },
      '2026-10-01T11:30:00.000Z',
    );
    await m.deliver();
    server.releaseRead!(); // the read finds their Dying 3: the sheet wins his heal
    await settle();
    await settle();
    expect(pc().currentHP, 'the row is their sheet').toBe(0);
    expect(rowConds()).toEqual(['dying:3', 'unconscious:', 'wounded:1']);
    expect(order(), 'where their first fall put it').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(server.editWrites, 'his heal lost to their sheet').toEqual([]);
  });

  /*
   * ROUND 3 (refuter, 2026-10-13): a fall is THEIRS only from above 0 on THEIR side (SeenPc.theirs) —
   * never from what the row showed of his own landed push — and a sheet that arrives while no row of
   * theirs is on the board is followed then, so the row a later re-add puts there never takes it for
   * the fall.
   */
  it('his heal that LANDED and that their app then refused is no new fall: they never got up, so the row stays where their fall put it', async () => {
    /*
     * The round-3 refuter's probe S2. His heal lands (the server holds it; the row shows 5). Their app
     * never applies it: they publish their failed recovery check (Dying 3, still 0 HP) first, and their
     * app refuses his heal. The row goes back to 0 in the seat their first fall gave it.
     * MUTATION (tried 2026-10-13): `if (st.theirs > 0 && v.currentHP === 0)` → the round-2
     * `if (st.shown.currentHP > 0 && v.currentHP === 0)` in follow (src/integration/pcSheetTruth.ts) and
     * this fails, alone —
     *   AssertionError: where their first fall put it: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     */
    const m = await inFight();
    publish(knockedOut(), T1);
    await m.deliver(); // their fall: moved before Cinder Goblin, on its 20
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    act(() => store().nextTurn()); // Moss Ogre acts
    await settle();
    expect(acting()).toBe('Moss Ogre');

    act(() => store().applyHealing(pc().id, 5)); // his heal: it lands
    await settle();
    expect(server.editWrites, 'his heal landed').toHaveLength(1);
    expect(pc().currentHP).toBe(5);

    const worse = knockedOut();
    publish(
      { ...worse, play: { ...worse.play!, conditions: [{ id: 'wounded', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 3 }] } },
      '2026-10-01T11:30:00.000Z',
    );
    const { markGmEditRefused } = await import('../src/data/party');
    await markGmEditRefused(CAMPAIGN, CHAR, server.editWrites[0].updated_at as string); // their app refused it
    await m.deliver();
    expect(pc().currentHP, 'the row is their sheet').toBe(0);
    expect(rowConds()).toEqual(['dying:3', 'unconscious:', 'wounded:1']);
    expect(order(), 'where their first fall put it').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(acting()).toBe('Moss Ogre');
    expect(server.editWrites, 'nothing more is pushed').toHaveLength(1);
  });

  it('…nor when his next gesture is built on his own landed heal: that read is HIS, and they are still down', async () => {
    /*
     * As above, with his Frightened made on his landed heal before their app has picked either up: its
     * fresh read is built on his own pending edit (the heal), not on their sheet. Their failed recovery
     * check then arrives, and their app refuses his pushes: they never got up.
     * MUTATION (tried 2026-10-13): `if (built.on === null) st.theirs = now.currentHP;` →
     * `st.theirs = now.currentHP;` in send (src/integration/pcSheetTruth.ts) and this fails, alone —
     *   AssertionError: where their first fall put it: expected [ 'Cinder Goblin', …(2) ] to deeply equal [ 'Isolde Marrow', …(2) ]
     */
    const m = await inFight();
    publish(knockedOut(), T1);
    await m.deliver(); // their fall: moved before Cinder Goblin, on its 20
    act(() => store().nextTurn()); // Moss Ogre acts
    await settle();

    act(() => store().applyHealing(pc().id, 5)); // his heal lands
    await settle();
    frightened(1); // built on his own heal, which still stands on their sheet
    await settle();
    expect(server.editWrites, 'both of his land').toHaveLength(2);

    const worse = knockedOut();
    publish(
      { ...worse, play: { ...worse.play!, conditions: [{ id: 'wounded', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 3 }] } },
      '2026-10-01T11:30:00.000Z',
    );
    const { markGmEditRefused } = await import('../src/data/party');
    await markGmEditRefused(CAMPAIGN, CHAR, server.editWrites[1].updated_at as string); // their app refused it
    await m.deliver();
    expect(pc().currentHP, 'the row is their sheet').toBe(0);
    expect(order(), 'where their first fall put it').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    expect(pc().initiative).toBe(20);
    expect(server.editWrites).toHaveLength(2);
  });

  it('…but once a read of THEIR sheet finds them up (their app applied his heal), their next fall moves the row', async () => {
    /*
     * The other side of that rule. His heal lands; their app applies it and republishes (not yet handed
     * to this screen); his next gesture's fresh read is built on that publish and finds them at 5. When
     * their own sheet then goes to 0 again, that is a fall of theirs: the row moves before the creature
     * acting now, on its count.
     * MUTATION (tried 2026-10-13): drop `if (built.on === null) st.theirs = now.currentHP;` from send's
     * landed path (src/integration/pcSheetTruth.ts) and this fails, alone —
     *   AssertionError: a fall of theirs: moved before the creature acting now: expected [ 'Isolde Marrow', …(2) ] to deeply equal [ 'Cinder Goblin', …(2) ]
     */
    const m = await inFight();
    publish(knockedOut(), T1);
    await m.deliver();
    expect(order()).toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);
    act(() => store().nextTurn()); // Moss Ogre acts
    await settle();

    act(() => store().applyHealing(pc().id, 5)); // his heal lands…
    await settle();
    expect(server.editWrites).toHaveLength(1);
    publish(server.editWrites[0].sheet as SavedChar, '2026-10-01T11:10:00.000Z'); // …their app applies it — not yet on this screen
    frightened(1); // his next gesture: its fresh read is their 5
    await settle();
    expect(server.editWrites, 'his Frightened lands on their 5').toHaveLength(2);
    expect(order(), 'standing again, nothing moved').toEqual([NAME, 'Cinder Goblin', 'Moss Ogre']);

    const sc = freshSheet();
    publish(
      {
        ...sc,
        play: {
          ...sc.play!,
          damage: MAX,
          conditions: [{ id: 'wounded', value: 2 }, { id: 'frightened', value: 1 }, { id: 'unconscious' }, { id: 'dying', value: 3 }],
        },
      },
      '2026-10-01T11:30:00.000Z',
    ); // down again, on their own sheet
    await m.deliver();
    expect(pc().currentHP, 'the row is their sheet').toBe(0);
    expect(order(), 'a fall of theirs: moved before the creature acting now').toEqual(['Cinder Goblin', NAME, 'Moss Ogre']);
    expect(pc().initiative, 'on its count').toBe(10);
    expect(acting(), 'the turn stays where it was').toBe('Moss Ogre');
    expect(server.editWrites, 'a sheet arriving is never pushed back').toHaveLength(2);
  });

  it('their fall that arrives while their row is OFF the order is no fall of the row a re-add puts back', async () => {
    /*
     * The round-3 refuter's probe S1. The GM took their row out mid-fight; their knock-out arrives while
     * no row of theirs is on the board; he adds them back. The new row is their sheet, where the add put
     * it — a re-add is not the character going down.
     * MUTATION (tried 2026-10-13): drop `st.drop = false;` from reconcile's no-row branch
     * (src/integration/pcSheetTruth.ts) and this fails, alone —
     *   AssertionError: where the add put it: expected [ 'Isolde Marrow', …(2) ] to deeply equal [ 'Cinder Goblin', 'Moss Ogre', …(1) ]
     * MUTATION (tried 2026-10-13): put the no-row `continue` back ABOVE the arrival bookkeeping (the
     * round-2 order, where the arrival waited for the re-add) and this fails the same way, alone.
     */
    const m = await inFight();
    act(() => store().removeCombatant(pc().id));
    await settle();
    publish(knockedOut(), T1);
    await m.deliver(); // their fall, with no row of theirs on the board
    expect(order()).toEqual(['Cinder Goblin', 'Moss Ogre']);
    m.addPc(); // put back mid-fight: a brand-new row, at the end of the order
    await settle();
    showsKnockOut('the re-added row is their sheet');
    expect(order(), 'where the add put it').toEqual(['Cinder Goblin', 'Moss Ogre', NAME]);
    expect(acting()).toBe('Cinder Goblin');
    expect(server.editWrites).toEqual([]);
  });
});
