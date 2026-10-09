// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content, build } from './_content';
import type { SavedChar } from '../src/data/storage';
import type { PartySummary } from '../src/sheet/partySummary';

/**
 * THE OWNER'S GM REPORT, 2026-09-18 — his live campaign, reproduced here from synthetic data only.
 *
 *   "when i look at a character of a player in the party page in the initiative tracker it sayes he
 *    is encumbered, when i enter the character page it dosent say that in any place, when i try to
 *    update the character to be encumbered and press the update button and then go back to that
 *    character i didnt see the condition put on it like it didnt update the character at all."
 *
 * Two separate defects, both about the GM seeing something other than what the app actually holds.
 *
 * (A) THE CARD AND THE SHEET ANSWERED FROM DIFFERENT PLACES. The card draws
 *     `campaign_characters.summary` — computed by the PLAYER's app, on the player's device, against
 *     the PLAYER's content database. The sheet re-derives the live character from
 *     `campaign_characters.sheet` against THIS device's content database. Encumbered comes out of
 *     item Bulk (`deriveBulk` reads `db.items[…].bulk`), so the two disagree the moment the two
 *     databases do — a player on a newer release, homebrew gear, a data update only one side has —
 *     and nothing reconciled them or even said they disagreed. `memberConditions` is now the one
 *     function both go through.
 *
 *     A second, self-inflicted half of the same symptom: a MANUAL `encumbered` in `play.conditions`
 *     used to switch the Bulk derivation off completely, so the character kept a plain, unlocked
 *     "Encumbered" that no longer tracked Bulk at all — no cause, no lock, and it outlived the gear.
 *
 * (B) UPDATE CHANGED NOTHING THE GM COULD SEE. A GM's Update writes `gm_character_edits`; the
 *     PLAYER's app applies it and re-publishes. Every GM-side surface reads the published row, so
 *     until the player's device had been open and synced — days, between sessions — the GM's own
 *     change was invisible to them. There is now a pending overlay: the last pushed edit per
 *     (campaign, character) is shown wherever the GM reads that character, with a "waiting" chip,
 *     until the player's published row overtakes it.
 *
 * NEVER-OVERWRITE holds throughout: the overlay is a local view of a row already on the server, it
 * is never written into `campaign_characters` (leg f), and a player publish newer than the push
 * wins outright (leg d).
 */

const server = vi.hoisted(() => ({
  /** `campaign_characters`, keyed campaign|char. */
  chars: new Map<string, Record<string, unknown>>(),
  /** `gm_character_edits`, keyed campaign|char. */
  edits: new Map<string, Record<string, unknown>>(),
  /** EVERY push, in order — a second push overwrites the row, and leg (j) needs the first one back. */
  editWrites: [] as Record<string, unknown>[],
  /** EVERY write that reached `campaign_characters`, in order — leg (f) reads this. */
  charWrites: [] as Record<string, unknown>[],
  /** Every Realtime topic ever joined, in order — leg (h) counts these. */
  channels: [] as string[],
  /** The Realtime handlers the app registered, so a leg can publish a row and deliver the event. */
  listeners: [] as (() => void)[],
  /** SINGLE-ROW reads of `campaign_characters` — what one GM push costs. Leg (k) counts these. */
  reads: 0,
  /** F1 (2026-10-09): a database the SQL was never re-run on — `gm_character_edits` has no `gm_base`. */
  noGmBaseColumn: false,
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [
    ...(table === 'campaign_characters' ? server.chars : server.edits).values(),
  ];
  function from(table: string) {
    const where: Record<string, unknown> = {};
    let cols = '';
    const matched = () => rows(table).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    // F1 (2026-10-09): PostgREST's answer for a column the schema cache does not know.
    const missing = () => server.noGmBaseColumn && table === 'gm_character_edits' && cols.includes('gm_base');
    const noColumn = { code: 'PGRST204', message: `Could not find the 'gm_base' column of '${table}' in the schema cache` };
    const answer = () => (missing() ? { data: null, error: noColumn } : { data: matched(), error: null });
    const q = {
      select: (c?: string) => {
        cols = c ?? '';
        return q;
      },
      eq: (col: string, val: unknown) => {
        where[col] = val;
        return q;
      },
      order: () => Promise.resolve(answer()),
      maybeSingle: () => {
        if (table === 'campaign_characters') server.reads += 1;
        return Promise.resolve({ data: matched()[0] ?? null, error: null });
      },
      // The Supabase builder is thenable, and fetchPendingGmEdits awaits it directly.
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: Record<string, unknown>) => {
        const key = `${row.campaign_id as string}|${row.char_id as string}`;
        if (table === 'campaign_characters') {
          server.chars.set(key, row);
          server.charWrites.push(row);
        } else {
          if (server.noGmBaseColumn && 'gm_base' in row) return Promise.resolve({ error: noColumn });
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
    on(_event: string, _filter: unknown, cb?: () => void) {
      if (cb) server.listeners.push(cb);
      return channel;
    },
    subscribe(cb?: (s: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    supabase: {
      from,
      channel: (topic: string) => {
        server.channels.push(topic);
        return channel;
      },
      removeChannel: () => undefined,
      auth: {
        // `getSession` is what src/data/party.ts reads — a LOCAL answer, no round-trip and no
        // failure mode that reports a signed-in user as signed out. `getUser` stays for the modules
        // that still call it (cloudSync, trackerSync).
        getSession: async () => ({ data: { session: { user: { id: 'gm-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'gm-1' } } }),
        signOut: async () => ({ error: null }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { computeSummary, memberConditions, memberSummary } = await import('../src/sheet/partySummary');
const { applyPlayState, initialPlay, addCondition } = await import('../src/rules/play');
const { fetchMemberRow, fetchMemberSheet, fetchPublishedSheet, fetchParty, fetchPendingGmEdits, forgetMissingColumns, pushGmEdit } =
  await import('../src/data/party');
const { clearGmPendingEdits, gmBaseOf, gmPendingEdit, pendingEditStillStands, setGmPendingAccount } = await import('../src/sheet/gmSync');
const { authoredKey, hash53 } = await import('../src/data/authored');
const { signOut } = await import('../src/data/useAuth');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { PartyCard, PartyMembers, useMemberViewer } = await import('../src/sheet/PartyMembers');
const { PartyPage } = await import('../src/sheet/PartyPage');
const { memberCardSummary, useMemberSheets, usePcSheetTruth } = await import('../src/integration/pcSheetTruth');
const { useCombatStore } = await import('../tracker/src/store/combatStore');
type PartyMember = import('../src/data/party').PartyMember;
type CampaignMembership = import('../src/data/campaigns').CampaignMembership;

const db = content();
const CAMPAIGN = 'camp-1';
const PLAYER = 'player-1';
const CHAR = 'pc-1';

/** A character carrying far more Bulk than they can (20 Bulk of coins, earned in play). */
function encumbered(name = 'Thessaly Vane'): SavedChar {
  const character = { ...build('fighter', 3), name };
  return { id: CHAR, character, play: { ...initialPlay(character, db), currency: { gp: 20000 } } } as SavedChar;
}

/** The same character carrying nothing worth counting. */
function light(name = 'Thessaly Vane'): SavedChar {
  const character = { ...build('fighter', 3), name };
  return { id: CHAR, character, play: initialPlay(character, db) } as SavedChar;
}

/** What the OWNER's app does when it publishes: summary + sheet, in one row, with their stamp. */
function publish(sc: SavedChar, at: string, summaryFrom: SavedChar = sc): void {
  const live = applyPlayState(summaryFrom.character, summaryFrom.play, db);
  server.chars.set(`${CAMPAIGN}|${sc.id}`, {
    campaign_id: CAMPAIGN,
    owner_id: PLAYER,
    char_id: sc.id,
    name: live.name,
    summary: computeSummary(live, db),
    sheet: sc,
    updated_at: at,
  });
}

/**
 * What the GM's sheet does on Update: read the PUBLISHED row (never the overlay — that would be the
 * GM's own work compared against itself), then push, carrying the read the edit is built on.
 * F1 (2026-10-09): that base is the read's stamp AND its authored hash (`gmBaseOf`), not a stamp alone.
 */
async function gmPush(sheet: SavedChar): Promise<void> {
  const row = await fetchPublishedSheet(CAMPAIGN, CHAR);
  await pushGmEdit(CAMPAIGN, CHAR, PLAYER, sheet, gmBaseOf(row));
}
/** The base of what the server publishes for a character right now. */
const baseNow = async (charId = CHAR) => gmBaseOf(await fetchPublishedSheet(CAMPAIGN, charId));

/** The teammate viewer, opened on our one character — the surface that keeps a channel per sheet. */
function Viewer(): ReactElement {
  const { sheetEl, open } = useMemberViewer(db);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(CAMPAIGN, CHAR, PLAYER);
  });
  return <div>{sheetEl}</div>;
}

/** The same viewer in GM-edit mode — the sheet a card opens on the GM's campaign page. */
function GmViewer(): ReactElement {
  const { sheetEl, open } = useMemberViewer(db, { gmEdit: true });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(CAMPAIGN, CHAR, PLAYER);
  });
  return <div>{sheetEl}</div>;
}

let live: Root | null = null;
function render(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}
/** Let the component's own fetches land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!window.matchMedia)
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  document.body.innerHTML = '';
  server.chars.clear();
  server.edits.clear();
  server.editWrites.length = 0;
  server.charWrites.length = 0;
  server.channels.length = 0;
  server.listeners.length = 0;
  server.reads = 0;
  server.noGmBaseColumn = false;
  forgetMissingColumns();
  clearGmPendingEdits();
  localStorage.clear();
});

/** Deliver a Realtime event to everything currently subscribed (the player published again). */
async function realtime(): Promise<void> {
  await act(async () => {
    for (const l of [...server.listeners]) l();
    await new Promise((r) => setTimeout(r, 0));
  });
  await settle();
}

const gmSheet = (sheet: SavedChar, summary?: PartySummary) => (
  <GmEditSheet
    initial={sheet}
    live={sheet}
    summary={summary}
    content={db}
    campaignId={CAMPAIGN}
    playerOwnerId={PLAYER}
    onExit={() => undefined}
  />
);

describe('(a) the card and the GM-edit sheet agree about Encumbered', () => {
  it('both say it, from the same published row', async () => {
    publish(encumbered(), '2026-09-18T10:00:00.000Z');
    const party = await fetchParty(CAMPAIGN);
    const mem = party![0];
    expect(mem.summary.conditions.map((c) => c.name)).toContain('Encumbered');

    // The card the owner was reading.
    const card = render(<PartyCard member={mem} isMine={false} onOpen={() => undefined} />);
    expect(card.textContent).toContain('Encumbered');
    act(() => live!.unmount());
    live = null;

    // …and the sheet he opened from it.
    const sheet = await fetchMemberSheet(CAMPAIGN, CHAR);
    const host = render(gmSheet(sheet!, mem.summary));
    expect(host.textContent).toContain('Encumbered');
  });

  it('the sheet still says it when THIS device cannot work it out for itself', async () => {
    /*
     * The real divergence: the owner's app published "Encumbered — Bulk", this device's content
     * database reaches a different Bulk for the same gear (a newer release, homebrew, a data update
     * one side has), and the sheet fell silent while the card kept showing the chip.
     *
     * Published here as exactly that: the summary the OWNER's app computed (encumbered), against a
     * sheet this device derives as unencumbered.
     *
     * MUTATION: drop the `memberConditions(...)` merge from the `character` memo in
     * src/sheet/GmEditSheet.tsx (i.e. `return live;`) and this fails —
     *   AssertionError: expected '…' to contain 'Encumbered'
     */
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered());
    const mem = (await fetchParty(CAMPAIGN))![0];
    expect(mem.summary.conditions.map((c) => c.name)).toContain('Encumbered');

    const sheet = await fetchMemberSheet(CAMPAIGN, CHAR);
    expect(applyPlayState(sheet!.character, sheet!.play, db).conditions).toEqual([]);

    const host = render(gmSheet(sheet!, mem.summary));
    expect(host.textContent, 'the sheet must not be silent about a condition the card shows').toContain('Encumbered');
  });

  it('the carried condition keeps the owner’s cause, and says whose device reached it', () => {
    /*
     * The cause is RE-LABELLED on the way in, and that is the point: this device's own Inventory
     * still says "Bulk 3 / 5" (it is why the condition had to be carried at all), so a pill reading
     * only "from Bulk — carrying 20 of 5" contradicts the number printed beside it. Naming the
     * device makes the two readable together. It stays `derivedFrom`, so it stays locked.
     */
    const published = computeSummary(applyPlayState(encumbered().character, encumbered().play, db), db);
    const merged = memberConditions([], published.conditions);
    expect(merged).toEqual([{ id: 'encumbered', derivedFrom: 'the player’s own app — Bulk — carrying 20 of 5' }]);
    // A condition somebody APPLIED is already inside the published play state — never carried twice.
    expect(memberConditions([], [{ id: 'frightened', name: 'Frightened', value: 2 }])).toEqual([]);
    // And an id-less row (published before `id` existed) still joins, on the lower-cased name.
    expect(memberConditions([], [{ name: 'Encumbered', derivedFrom: 'Bulk — carrying 9 of 5' }])).toEqual([
      { id: 'encumbered', derivedFrom: 'the player’s own app — Bulk — carrying 9 of 5' },
    ]);
    // Re-reconciling an already-reconciled list must not stack the label (the tracker reconciles for
    // the card, then the sheet reconciles again over the top).
    expect(memberConditions([], merged.map((c) => ({ ...c, name: 'Encumbered' })))).toEqual(merged);
  });

  it('a CARD built from this device’s sheet carries it too — the two tracker cards agree', () => {
    /*
     * MUTATION: put `computeSummary(livePlay(sheet, content), content)` back in `summaryFor`
     * (src/integration/CampaignTracker.tsx) and this fails —
     *   AssertionError: expected [] to deeply equal [ 'Encumbered' ]
     *
     * The tracker held TWO answers to this question at once: the dashboard grid card drew the
     * player's published summary (Encumbered), while a PC's pane card re-derived its own from the
     * sheet (no Encumbered). Same character, same screen, two answers. `memberSummary` is the join.
     */
    const publishedSummary = computeSummary(applyPlayState(encumbered().character, encumbered().play, db), db);
    const mine = applyPlayState(light().character, light().play, db);
    expect(computeSummary(mine, db).conditions).toEqual([]);
    const card = memberSummary(mine, db, publishedSummary);
    expect(card.conditions.map((c) => c.name)).toEqual(['Encumbered']);
    expect(card.conditions[0].derivedFrom).toContain('the player’s own app');
    // And with no published summary to lend anything (a pending GM edit), it is a plain derivation.
    expect(memberSummary(mine, db).conditions).toEqual([]);
  });
});

describe('(B1) adding Encumbered by hand — what it means, and why a GM no longer needs to', () => {
  it('a GM never has to: over the limit the sheet already shows it, locked', () => {
    // The row the GM reads in the picker is `derivedFrom`-marked, which is what disables its toggle
    // and prints the note (ConditionsModal). Hand-applying it is not a thing this sheet asks of them.
    const sc = encumbered();
    expect(applyPlayState(sc.character, sc.play, db).conditions).toEqual([
      { id: 'encumbered', derivedFrom: 'Bulk — carrying 20 of 5' },
    ]);
  });

  it('a hand-applied one OVER the limit is replaced by the derived pill — owner ruling 2026-09-22', () => {
    /*
     * REVERSES the over-limit half of 2026-09-16: `applyPlayState` no longer skips the Bulk derivation
     * just because `encumbered` is already in `play.conditions`. Bulk is still the real cause while it
     * holds, so the sheet renders ONE locked pill with the cause — the same one the leg above proves
     * for the auto-derived case — and the stored copy is left in `play.conditions` exactly as it was
     * (never deleted, see the `over.conditions` assertion below); it just stops being what's rendered.
     * test/bug-owner-2026-09-16-sheet.test.tsx carries the engine-level legs for this ruling.
     */
    const over = addCondition(encumbered().play!, 'encumbered');
    expect(over.conditions, 'the manual copy itself is untouched').toEqual([{ id: 'encumbered' }]);
    expect(applyPlayState(encumbered().character, over, db).conditions).toEqual([
      { id: 'encumbered', derivedFrom: 'Bulk — carrying 20 of 5' },
    ]);
  });

  it('a hand-applied one UNDER the limit still stays the PLAYER’s — owner ruling 2026-09-16, unchanged there', () => {
    // Below the limit Bulk derives nothing at all, so there is no derived entry to collide with — a
    // hand-applied one is exactly what it always was: theirs, no cause, no lock.
    const under = addCondition(light().play!, 'encumbered');
    expect(applyPlayState(light().character, under, db).conditions).toEqual([{ id: 'encumbered' }]);
  });
});

describe('(b) after Update the GM sees the change straight away', () => {
  it('the card shows the edited condition and the waiting chip, without the player’s app', async () => {
    /*
     * MUTATION: make the `shown` memo in src/sheet/PartyMembers.tsx ignore the pending edit
     * (`if (pending) return m;`) and this fails —
     *   AssertionError: expected 'THThessaly VaneHuman Fighter 3 waitin…' to contain 'Frightened'
     *
     * Two things worth recording from the other mutations. Deleting `rememberGmEdit` from pushGmEdit
     * does NOT fail this leg — the card recovers through `fetchPendingGmEdits`, the server read-back
     * (it fails (c), (d) and (e), which have no component to run that read). And neutering
     * `withPendingGmEdit` does not fail it either: the CARD is re-summarised from the pending sheet
     * directly, while the SHEET comes through fetchMemberSheet. Two paths, deliberately, so losing
     * either one is visible here.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const edited: SavedChar = { ...base, play: addCondition(base.play!, 'frightened', 2) };
    await gmPush(edited);

    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent).toContain('Frightened');
    expect(host.textContent, 'the GM must be able to tell "sent" from "landed"').toContain('waiting');

    // The player's published row is untouched — this is a view of gm_character_edits, nothing else.
    const published = server.chars.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
    expect(published.play?.conditions ?? []).toEqual([]);
  });

  it('and the sheet reopened from that card shows it too (c)', async () => {
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });

    // Reopening is exactly this call — the one every GM-side surface goes through.
    const reopened = await fetchMemberSheet(CAMPAIGN, CHAR);
    expect(reopened!.play?.conditions).toEqual([{ id: 'frightened', value: 2 }]);
    const host = render(gmSheet(reopened!));
    expect(host.textContent).toContain('Frightened');
    expect(host.textContent).toContain('waiting');
  });

  it('a REFUSED push is never shown as landed', async () => {
    // F1 (2026-10-09): the push carries a real base (the read at 10:00), so this still tests a SERVER
    // refusal and not the new "no base, nothing sent" refusal of pushGmEdit itself.
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const proved = await baseNow();
    expect(proved?.stamp).toBe('2026-09-18T10:00:00.000Z');
    const from = (await import('../src/data/supabase')).supabase!.from;
    const spy = vi
      .spyOn((await import('../src/data/supabase')).supabase!, 'from')
      .mockImplementation(((table: string) =>
        table === 'gm_character_edits'
          ? { upsert: async () => ({ error: { message: 'row-level security' } }) }
          : from(table)) as typeof from);
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: addCondition(base.play!, 'frightened', 2) }, proved);
    spy.mockRestore();
    expect(res.ok).toBe(false);
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeUndefined();
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions ?? []).toEqual([]);
  });
});

describe('(d/e) whose version wins', () => {
  it('a player publish NEWER than the edit replaces the overlay', async () => {
    /*
     * MUTATION: drop the `published.updatedAt > (edit.baseUpdatedAt ?? edit.pushedAt)` clause from
     * `pendingEditStillStands` (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: expected [ { id: 'frightened', value: 2 } ] to deeply equal [ { id: 'fatigued' } ]
     * i.e. the GM's stale edit would sit on top of work the player did afterwards, which is the one
     * thing this app must never do.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeDefined();

    // The player went on playing: their app published again, after the push.
    publish({ ...base, play: addCondition(base.play!, 'fatigued') }, '2026-09-18T23:59:00.000Z');
    const seen = await fetchMemberSheet(CAMPAIGN, CHAR);
    expect(seen!.play?.conditions).toEqual([{ id: 'fatigued' }]);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'and the chip goes with it').toBeUndefined();
  });

  it('an OLDER player publish does not', async () => {
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });

    // A row stamped BEFORE the push — a late-arriving write, a device with a slow clock.
    publish({ ...base, play: addCondition(base.play!, 'fatigued') }, '2026-09-18T09:00:00.000Z');
    const seen = await fetchMemberSheet(CAMPAIGN, CHAR);
    expect(seen!.play?.conditions).toEqual([{ id: 'frightened', value: 2 }]);
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeDefined();
  });

  it('a read that FAILED is not an answer, and never drops the edit', () => {
    const edit = { campaignId: CAMPAIGN, charId: CHAR, sheet: light(), pushedAt: '2026-09-18T10:00:00.000Z' };
    expect(pendingEditStillStands(edit, null)).toBe(true);
    // The player applied it and published the result: nothing left to overlay.
    expect(pendingEditStillStands(edit, { sheet: edit.sheet, updatedAt: '2026-09-18T09:00:00.000Z' })).toBe(false);
  });

  it('the published sheet IS the edit whatever order jsonb hands its keys back in', () => {
    /*
     * `campaign_characters.sheet` is jsonb, which returns an object's keys in its own order, never
     * the order they were written in. Compared as plain JSON text, the player's app publishing the
     * edit exactly as applied never matched it, and that half of the rule only ever held in a test
     * harness that kept key order.
     *
     * MUTATION (tried 2026-10-01, round 7): compare `JSON.stringify(published.sheet) ===
     * JSON.stringify(edit.sheet)` again in
     * `pendingEditStillStands` (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: the same sheet, keys reordered: expected true to be false
     */
    const edit = { campaignId: CAMPAIGN, charId: CHAR, sheet: light(), pushedAt: '2026-09-18T10:00:00.000Z', baseUpdatedAt: '2026-09-18T10:00:00.000Z' };
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed((v as Record<string, unknown>)[k])]))
          : v;
    const back = reversed(JSON.parse(JSON.stringify(edit.sheet))) as SavedChar;
    expect(JSON.stringify(back), 'the copy really is in another key order').not.toBe(JSON.stringify(edit.sheet));
    const older = '2026-09-18T09:00:00.000Z'; // no stamp says the player published after it
    expect(pendingEditStillStands(edit, { sheet: back, updatedAt: older }), 'the same sheet, keys reordered').toBe(false);
    // …and one value apart, it is still the GM's edit to show.
    expect(pendingEditStillStands(edit, { sheet: { ...back, play: { ...back.play!, damage: 3 } }, updatedAt: older })).toBe(true);
  });

  it('the GM’s clock cannot decide it — the comparison is the player’s clock on both sides', () => {
    /*
     * MUTATION: compare against `edit.pushedAt` instead of `edit.baseUpdatedAt` in
     * `pendingEditStillStands` (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: expected true to be false
     *
     * `campaign_characters.updated_at` is stamped on the PLAYER's device; `pushedAt` on the GM's. A
     * GM whose machine runs an hour fast therefore read every publish the player made in that hour
     * as older than their own push, kept the overlay up over it, and — because the push guard used
     * to re-read through that same overlay — pushed straight over the player's newer work with no
     * warning at all. `baseUpdatedAt` is the published stamp the edit was BUILT on, so both sides of
     * the comparison come off the player's own clock and skew cannot reach it.
     */
    const skewed = {
      campaignId: CAMPAIGN,
      charId: CHAR,
      sheet: light(),
      pushedAt: '2026-09-19T09:00:00.000Z', // the GM's clock, running a day fast
      baseUpdatedAt: '2026-09-18T10:00:00.000Z', // what the player's row said at push time
    };
    // The player applied it AND played on, so the republished sheet is not byte-identical either.
    const theirs = { sheet: encumbered(), updatedAt: '2026-09-18T10:05:00.000Z' };
    expect(pendingEditStillStands(skewed, theirs), 'the player’s newer work wins').toBe(false);
    // And a publish genuinely older than the base still doesn't displace the edit.
    expect(pendingEditStillStands(skewed, { sheet: encumbered(), updatedAt: '2026-09-18T09:00:00.000Z' })).toBe(true);
  });

  it('a push re-bases on the PUBLISHED row, never on the GM’s own overlay', async () => {
    /*
     * MUTATION: make `fetchPublishedSheet` hand back the overlay too — `sheet: resolvePendingGmEdit(
     * campaignId, charId, row)` (src/data/party.ts) — and three legs fail, this one on
     *   AssertionError: expected [ { id: 'frightened', value: 2 } ] to deeply equal []
     * with (c) and (h) going with it, because the overlay would then be resolved twice per read.
     *
     * The overlay is this device's own unapplied edit. A WRITE that re-reads through it is comparing
     * the GM's work against itself: it finds nothing changed and can overwrite whatever the player
     * published since. So `pushToPlayer` and the tracker seam's push both read THIS call, and it is a
     * separate function rather than a flag precisely so the difference survives the next refactor. It
     * is also where the published stamp comes from, which is the skew-free base every later comparison
     * uses.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });

    // The GM's screen shows their edit…
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions).toEqual([{ id: 'frightened', value: 2 }]);
    // …and the write path still sees the player's real row underneath it.
    const row = await fetchPublishedSheet(CAMPAIGN, CHAR);
    expect(row?.updatedAt).toBe('2026-09-18T10:00:00.000Z');
    expect((row?.sheet as SavedChar).play?.conditions ?? []).toEqual([]);
  });
});

describe('(f) the pending overlay is never uploaded', () => {
  it('nothing the GM pushed ever reaches campaign_characters', async () => {
    publish(light(), '2026-09-18T10:00:00.000Z');
    server.charWrites.length = 0; // the publish above is the PLAYER's own, not a GM write
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const edited: SavedChar = { ...base, play: addCondition(base.play!, 'frightened', 2) };
    await gmPush(edited);

    // Every GM-side surface reads the overlay…
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent).toContain('Frightened');
    await fetchMemberSheet(CAMPAIGN, CHAR);

    // …and not one of them wrote it back to the player's own row.
    expect(server.charWrites, 'the GM side must never publish a player character').toEqual([]);
    expect(server.edits.size).toBe(1);
  });
});

describe('(g) the waiting chip can be cleared — from the party page itself', () => {
  /*
   * REPRODUCED, then fixed. The party card read the pending store with NO staleness test, and nothing
   * reachable from that page could prune it: the only pruner is `resolvePendingGmEdit`, which is
   * reached through `fetchMemberSheet` — and this page calls `fetchParty`, which did not even select
   * `updated_at`. So the card showed the GM's pushed sheet and the "waiting" chip FOREVER, HIDING the
   * player's real current state, across reloads, unless the GM happened to tap the card or open the
   * tracker. Both halves are guarded below: the server's own answer, and the card's own stamp test.
   */
  const played = (base: SavedChar): SavedChar => ({
    ...base,
    play: addCondition(addCondition(base.play!, 'frightened', 2), 'fatigued'),
  });

  it('the player applies it and plays on — the card shows THEIR state, chip gone', async () => {
    /*
     * The whole scenario, end to end — the probe that reproduced the fault. It passes while ANY of
     * the two pruners works, which is deliberate: the two legs below each pin one of them on its own,
     * and this one says the owner's actual situation comes out right. Before the fix nothing on this
     * page could clear the chip at all, so it failed with:
     *   AssertionError: expected 'THThessaly VaneHuman Fighter 3 waitin…' to contain 'Fatigued'
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });

    // The player's app: applied the edit, deleted the row, then kept playing and published again.
    server.edits.clear();
    publish(played(base), '2026-09-18T23:59:00.000Z');

    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent, 'the player’s current state, not the GM’s old push').toContain('Fatigued');
    expect(host.textContent, 'and the chip goes with it').not.toContain('waiting');
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'for every other surface too').toBeUndefined();
  });

  it('…and still clears on a database whose cleanup DELETE removes nothing', async () => {
    /*
     * The `gce_owner_delete` gap the app already warns about (src/App.tsx): the row lingers on the
     * server after the player applied it, so the server read cannot help. The card's own stamp test
     * is then the only thing that can clear the chip, and the drop has to STICK — re-seeding the
     * surviving row on the next GM mount is what made the chip permanent for that character.
     *
     * MUTATION: drop `updatedAt` from what `fetchParty` maps (src/data/party.ts) and this fails —
     *   AssertionError: expected 'THThessaly VaneHuman Fighter 3 waitin…' to contain 'Fatigued'
     * Dropping the `droppedPending` tombstone in gmSync.ts fails the last line instead.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    publish(played(base), '2026-09-18T23:59:00.000Z'); // applied + played on; the row stays behind

    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(server.edits.size, 'the row really is still there').toBe(1);
    expect(host.textContent).toContain('Fatigued');
    expect(host.textContent).not.toContain('waiting');

    // A fresh GM mount re-reads that surviving row: it must not come back as pending.
    await fetchPendingGmEdits(CAMPAIGN);
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeUndefined();
  });

  it('a row the server no longer has stops being pending, but a push mid-read does not', async () => {
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeDefined();

    // The player's app applied it and the delete worked: a successful read that does not list it IS
    // an answer about this campaign, so the chip goes.
    server.edits.clear();
    await fetchPendingGmEdits(CAMPAIGN);
    expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeUndefined();

    // But an edit pushed AFTER the read began is not missing from it — it is newer than it.
    await gmPush({ ...base, play: addCondition(base.play!, 'fatigued') });
    server.edits.clear();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'a race must not eat a push').toBeDefined();
  });
});

describe('(h) the GM’s own Update must not churn the Realtime channels', () => {
  it('re-reads the sheet without tearing a channel down and re-joining it', async () => {
    /*
     * MUTATION: put `pendingVersion` back in the subscription effect's deps in `useMemberViewer`
     * (src/sheet/PartyMembers.tsx) and this fails —
     *   AssertionError: expected 2 to be 1
     *
     * Every Update bumps that counter, and so does every point of damage the GM applies in the
     * tracker (its push → pushGmEdit → rememberGmEdit). Having it in a SUBSCRIPTION effect tore the
     * channel down and re-joined the same deterministic topic in the same tick, leave still in
     * flight — and a Realtime feed that quietly stops delivering is the very "the GM is looking at
     * stale data" fault being fixed here. Only the re-PULL follows the store.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const host = render(<Viewer />);
    await settle();
    const joined = () => server.channels.filter((t) => t.startsWith('member:')).length;
    expect(joined()).toBe(1);

    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await act(async () => {
      await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(joined(), 'the push re-reads; it does not re-subscribe').toBe(1);
    expect(host.textContent, 'and the re-read really happened').toContain('Frightened');
  });
});

describe('(i) a carried condition clears on an OPEN sheet, the moment its cause goes', () => {
  it('the player drops the loot and republishes — the pill goes, without closing the sheet', async () => {
    /*
     * MUTATION: put the summary back in `ViewingState` at open time only — `{ ...v, sheet }` in the
     * viewer's `pull` (src/sheet/PartyMembers.tsx) — and this fails:
     *   AssertionError: a locked pill goes when its cause goes: expected ' Viewing Thessaly Vane · read-only He…' not to contain 'Encumbered'
     *
     * A carried pill is LOCKED and its whole promise is that it disappears when its cause does. The
     * summary it is joined from used to be handed to the viewer once, by the card that opened it, and
     * the live re-read replaced only the sheet half — so the GM watched the player's HP and inventory
     * update around a stale "Encumbered — the player's own app", and only closing and reopening the
     * sheet could clear it. Sheet and summary are one row, so they are now one read.
     */
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered()); // their app derived it; this device can't
    const host = render(<Viewer />);
    await settle();
    expect(host.textContent).toContain('Encumbered');

    publish(light(), '2026-09-18T10:30:00.000Z'); // they dropped the loot and published again
    await realtime();
    expect(host.textContent, 'a locked pill goes when its cause goes').not.toContain('Encumbered');
  });
});

describe('(j) the tracker’s two cards for one character cannot disagree', () => {
  /** What the tracker hands the cards: THIS device's derivation of the sheet it holds, plus the
   *  chips only the player's app could reach — `roster.byId`'s summary, in one line. */
  const hostSummary = (sheets: Map<string, SavedChar>) => (mem: PartyMember) => {
    const s = sheets.get(mem.charId);
    return s ? memberSummary(applyPlayState(s.character, s.play, db), db, mem.summary) : undefined;
  };

  it('the dashboard card draws what this device derives, not the player’s raw summary', async () => {
    /*
     * MUTATION: drop the `summarize` branch from the `shown` memo (src/sheet/PartyMembers.tsx) and
     * this fails:
     *   AssertionError: the dashboard card cannot be the one surface that disagrees: expected 'THThessaly VaneHuman Fighter 3HP38 / …' to contain 'Encumbered'
     *
     * The mirror image of the owner's report, and it was still live: the PC's pane card and the sheet
     * a card opens both went through `memberSummary`, while the DASHBOARD card — the grid he was
     * actually reading — drew `m.summary` raw. A GM on a newer data release (or holding a homebrew
     * item the player's copy lacks) derives Encumbered for gear the player's app does not, so the
     * pane card said Encumbered and the dashboard card two clicks away said nothing.
     */
    publish(light(), '2026-09-18T10:00:00.000Z'); // the PLAYER's app: nothing derived
    const mem = (await fetchParty(CAMPAIGN))![0];
    expect(mem.summary.conditions, 'the published summary really is silent').toEqual([]);
    // …and this device, with its own data, works the same gear out as over the limit.
    const mine = new Map([[CHAR, encumbered()]]);

    const host = render(
      <PartyMembers campaignId={CAMPAIGN} isGm content={db} summarize={hostSummary(mine)} onView={() => undefined} />,
    );
    await settle();
    expect(host.textContent, 'the dashboard card cannot be the one surface that disagrees').toContain('Encumbered');
  });

  it('and it is the same function the pane card and the sheet use', async () => {
    // One rule, three surfaces: whatever the host answers for a card is what the pane card draws and
    // what the sheet a card opens merges in. The join is `memberSummary` / `memberConditions`.
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered());
    const mem = (await fetchParty(CAMPAIGN))![0];
    const mine = new Map([[CHAR, light()]]);
    const card = hostSummary(mine)(mem)!;
    expect(card.conditions.map((c) => c.name)).toEqual(['Encumbered']);
    expect(card.conditions[0].derivedFrom).toContain('the player’s own app');
    const sheetSays = memberConditions(applyPlayState(light().character, light().play, db).conditions ?? [], mem.summary.conditions);
    expect(sheetSays.map((c) => c.id)).toEqual(['encumbered']);
  });
});

describe('(k) a failed read never downgrades an edit that was already protected', () => {
  it('a push whose read failed sends NOTHING — the held edit and its base are untouched, so the GM’s clock still cannot decide it', async () => {
    /*
     * F1 (2026-10-09): rewritten. Its old mutation (write `baseUpdatedAt` straight through in
     * `rememberGmEdit`) can no longer be reached through `pushGmEdit`, which now refuses a push that
     * proves no base — that `?? had` rule is pinned in test/gm-sync.test.ts (18). What this leg holds now
     * is the stronger half: the failed read's push never reaches the server at all.
     * MUTATION (run 2026-10-09): allow base-less pushes — `if (!base) base = { stamp: '', hash: '' };`
     * in place of pushGmEdit's guard — and this fails —
     *   AssertionError: a push that proves no base is never sent: expected true to be false
     *
     * `fetchPublishedSheet` answers `null` when the read FAILS. A push sent then would carry no proof,
     * the player's app would have to refuse it, and the held edit would be downgraded to comparing the
     * GM's clock against the player's — the comparison `baseUpdatedAt` exists to remove.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z')); // the GM's machine, years fast
    try {
      publish(light(), '2026-09-18T10:00:00.000Z');
      const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
      await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
      expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt).toBe('2026-09-18T10:00:00.000Z');
      const held = gmPendingEdit(CAMPAIGN, CHAR);

      // The next push — a point of damage — reads the published row and the read FAILS: no base.
      const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: addCondition(base.play!, 'sickened', 1) }, undefined);
      expect(res.ok, 'a push that proves no base is never sent').toBe(false);
      expect(server.editWrites, 'nothing reached the server').toHaveLength(1);
      expect(gmPendingEdit(CAMPAIGN, CHAR), 'the held edit is untouched').toBe(held);
      expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'the base an earlier push proved is not thrown away').toBe(
        '2026-09-18T10:00:00.000Z',
      );

      // The player was playing through that blip, and published after the base. They win.
      publish({ ...base, play: addCondition(base.play!, 'fatigued') }, '2026-09-18T10:05:00.000Z');
      expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions).toEqual([{ id: 'fatigued' }]);
      expect(gmPendingEdit(CAMPAIGN, CHAR)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('(l) the tracker seam — one push, one read, and an echo is not the sheet moving', () => {
  /** The seam as the tracker mounts it, but with the sheets handed in, so a leg can deliver the
   *  GM's own push back at the exact moment the real overlay would. */
  function Seam({ members, sheets }: { members: PartyMember[]; sheets: Map<string, SavedChar> }): ReactElement {
    usePcSheetTruth({ campaignId: CAMPAIGN, members, sheetById: sheets, content: db });
    return <div />;
  }
  /** The seam's own sheet map, exactly as the tracker builds it. */
  function Sheets({ members }: { members: PartyMember[] }): ReactElement {
    const sheets = useMemberSheets(CAMPAIGN, members);
    return <div>{[...sheets.keys()].sort().join(',')}</div>;
  }
  const other = (charId: string, name: string): SavedChar => ({ ...light(name), id: charId });

  beforeEach(() => {
    useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  });

  it('a push echoing back never drags the row to an earlier value', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 8): follow every sheet that arrives — `if (true)` for
     * `if (!ours.has(sheet))` in the arrival test in `reconcile` (src/integration/pcSheetTruth.ts) —
     * and this fails:
     *   AssertionError: the second five must survive the first push coming back: expected 33 to be 28
     * So does never recording the sheet a landed push sent (`ours.add(sent);` dropped from `send`):
     * a late echo is recognised by that very object, which is what this leg hands back — never by
     * the value it carries.
     *
     * `fetchMemberSheet` overlays this device's own pending edit, so a GM push MOVES the sheet this
     * seam reads. Two damage entries inside one round trip, then a read that answered while the
     * first was the pending edit, ran V1 → V2 → V1 in front of the GM.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const members = (await fetchParty(CAMPAIGN))!;
    const sheets = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
    render(<Seam members={members} sheets={sheets} />);
    await settle();
    const max = members[0].summary.hpMax;
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Thessaly Vane', isPC: true, maxHP: max }));
    await settle();
    const pc = () => useCombatStore.getState().combatants.find((c) => c.isPC)!;
    expect(pc().currentHP, 'the sheet drives the row').toBe(max);

    // The GM types five, then five again.
    await act(async () => {
      useCombatStore.getState().applyDamage(pc().id, 5);
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      useCombatStore.getState().applyDamage(pc().id, 5);
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(pc().currentHP).toBe(max - 10);
    expect(server.editWrites.length, 'both entries reached the server').toBe(2);

    // Now the FIRST push's overlay lands — which is exactly the sheet it pushed.
    const first = new Map([[CHAR, server.editWrites[0].sheet as SavedChar]]);
    await act(async () => {
      live!.render(<Seam members={members} sheets={first} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(pc().currentHP, 'the second five must survive the first push coming back').toBe(max - 10);
  });

  it('one push costs ONE member read, not one per member', async () => {
    /*
     * MUTATION (re-tried 2026-10-01 through a throwaway copy): drop the per-member stamp test from
     * the re-pull effect of `useMemberSheets` in src/sheet/memberSheets.ts (where it moved from
     * pcSheetTruth.ts) — `if (had === undefined) continue;` for
     * `if (had === undefined || had === sig) continue;` — and this fails:
     *   AssertionError: one push, one re-read — not one per member: expected 3 to be 1
     *
     * Every single point of damage bumps the pending counter, and the counter is campaign-wide. A
     * bare re-run refetched every member's sheet on every entry, and a drop inside one of those reads
     * bumps the counter again and re-runs the whole fan-out.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    publish(other('pc-2', 'Bran Ashgrove'), '2026-09-18T10:00:00.000Z');
    publish(other('pc-3', 'Neve Calder'), '2026-09-18T10:00:00.000Z');
    const members = (await fetchParty(CAMPAIGN))!;
    expect(members).toHaveLength(3);
    const host = render(<Sheets members={members} />);
    await settle();
    expect(host.textContent).toBe('pc-1,pc-2,pc-3');

    server.reads = 0;
    const base = (await fetchMemberSheet(CAMPAIGN, 'pc-2'))!;
    const proved = await baseNow('pc-2'); // F1 (2026-10-09): a push carries the read it was built on
    server.reads = 0; // the lines above are the test's own reads, not the app's
    await act(async () => {
      await pushGmEdit(CAMPAIGN, 'pc-2', PLAYER, { ...base, play: addCondition(base.play!, 'frightened', 2) }, proved);
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(server.reads, 'one push, one re-read — not one per member').toBe(1);
  });

  it('a burst of damage is ONE disk write, not one per point', async () => {
    /*
     * MUTATION: call `writePending()` straight from `persistPending` (src/sheet/gmSync.ts) and this
     * fails:
     *   AssertionError: a burst of damage must not stringify every pending sheet five times over: expected 5 to be +0
     *
     * Each pending edit is a whole character sheet and can carry an inline portrait; that write is
     * synchronous and on the main thread. It is only ever read back at startup, and best-effort even
     * there, so a burst collapses into one.
     */
    await new Promise((r) => setTimeout(r, 500)); // drain any write an earlier leg scheduled
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const ours = () => setItem.mock.calls.filter((c) => String(c[0]).includes('gm-pending-edits')).length;
    try {
      publish(light(), '2026-09-18T10:00:00.000Z');
      const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
      const proved = await baseNow(); // F1 (2026-10-09): a push carries the read it was built on
      for (let i = 1; i <= 5; i++)
        await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: { ...base.play!, damage: i } }, proved);
      expect(ours(), 'a burst of damage must not stringify every pending sheet five times over').toBe(0);
      await new Promise((r) => setTimeout(r, 500));
      expect(ours(), 'and the chip still reaches the disk').toBe(1);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('(m) a waiting GM edit never costs the GM what only the PLAYER’s app can derive', () => {
  /*
   * THE FIX FOR (b), UNDOING (a). Every GM surface used to WITHHOLD the published summary while an
   * edit of ours was waiting — `pendingFor(mem) ? undefined : mem.summary` in the tracker, the same
   * test in the viewer and a bare `computeSummary` on the card. The reasoning was that the pending
   * sheet describes a character the published summary is older than; the effect was that pressing
   * Update made the owner's original symptom come back and stay for the whole pending window, which
   * is days between sessions: the card said Encumbered, the GM pressed Update on something else,
   * and Encumbered vanished from the card, the pane card and the sheet at once.
   *
   * It cannot carry anything back. Only entries the player's app marked DERIVED are ever carried,
   * and a derived chip is locked on every surface — there is none a GM edit could have removed. It
   * is the PLAYER's verdict about their own device, and only their next publish can change it.
   */

  /** The owner's situation exactly: their app derived Encumbered from THEIR item Bulk, this device's
   *  data cannot reach it — and then the GM pressed Update on something else entirely. */
  async function pendingOverACarriedChip(): Promise<PartyMember> {
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered());
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    const mem = (await fetchParty(CAMPAIGN))![0];
    expect(mem.summary.conditions.map((c) => c.name), 'the player’s own app says it').toContain('Encumbered');
    expect(applyPlayState(base.character, base.play, db).conditions, 'and this device cannot').toEqual([]);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'with an edit of ours waiting').toBeDefined();
    return mem;
  }

  it('the party card shows BOTH — the GM’s own edit and the player’s carried chip', async () => {
    /*
     * MUTATION: put `computeSummary(live, content)` back in the pending branch of the `shown` memo
     * (src/sheet/PartyMembers.tsx) and this fails —
     *   AssertionError: pressing Update must not take the player’s own chip off the card: expected 'THThessaly VaneHuman Fighter 3 waitin…' to contain 'Encumbered'
     */
    await pendingOverACarriedChip();
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent, 'the GM’s own change').toContain('Frightened');
    expect(host.textContent, 'pressing Update must not take the player’s own chip off the card').toContain('Encumbered');
    expect(host.textContent).toContain('waiting');

    // …and for the WHOLE pending window: a party refresh with no new publish changes nothing.
    await realtime();
    expect(host.textContent).toContain('Encumbered');
    expect(host.textContent).toContain('Frightened');
  });

  it('so do the tracker’s cards — through the one function the tracker calls', async () => {
    /*
     * MUTATION: withhold the member's own summary inside `memberCardSummary`
     * (src/sheet/memberSheets.ts) — `memberSummary(livePlay(sheet, content), content)` — and
     * this fails —
     *   AssertionError: expected [ 'Frightened' ] to deeply equal [ 'Encumbered', 'Frightened' ]
     *
     * It takes the whole MEMBER for this reason: the published half is not an optional extra a
     * surface may decide to leave out, so there is no argument at the call site to get wrong.
     */
    const mem = await pendingOverACarriedChip();
    // The sheet the tracker holds for this member is the overlaid one — the GM's own pending edit.
    const sheets = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
    const card = memberCardSummary(mem, sheets.get(CHAR)!, db);
    expect(card.conditions.map((c) => c.name).sort()).toEqual(['Encumbered', 'Frightened']);
    expect(card.conditions.find((c) => c.name === 'Encumbered')!.derivedFrom).toContain('the player’s own app');

    // And the dashboard grid, drawing exactly what the tracker hands it.
    const host = render(
      <PartyMembers
        campaignId={CAMPAIGN}
        isGm
        content={db}
        summarize={(x) => memberCardSummary(x, sheets.get(x.charId)!, db)}
        onView={() => undefined}
      />,
    );
    await settle();
    expect(host.textContent).toContain('Encumbered');
    expect(host.textContent).toContain('Frightened');
    expect(host.textContent).toContain('waiting');
  });

  it('and the sheet reopened from that card shows both too', async () => {
    /*
     * MUTATION: stand the summary down while an edit is pending in `useMemberViewer`
     * (src/sheet/PartyMembers.tsx) — `viewing && gmPendingEdit(…) ? undefined : viewing?.summary` —
     * and this fails —
     *   AssertionError: the sheet the GM opens must not be the one surface that goes quiet: expected 'Your changes to Thessaly Vane are sav…' to contain 'Encumbered'
     */
    await pendingOverACarriedChip();
    const host = render(<GmViewer />);
    await settle();
    expect(host.textContent, 'the GM’s own change').toContain('Frightened');
    expect(host.textContent, 'the sheet the GM opens must not be the one surface that goes quiet').toContain('Encumbered');
    expect(host.textContent).toContain('waiting');
  });

  it('only a NEWER player publish changes what is carried', async () => {
    // The one thing that may take the carried chip away is the player saying so themselves.
    await pendingOverACarriedChip();
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent).toContain('Encumbered');

    publish(light(), '2026-09-18T23:59:00.000Z'); // they dropped the loot and published again
    await realtime();
    expect(host.textContent, 'their own newer verdict is the one that counts').not.toContain('Encumbered');
    expect(host.textContent, 'and their newer publish takes the overlay with it').not.toContain('waiting');
  });
});

describe('(n) a GM’s pending edit is private to the account that pushed it', () => {
  /*
   * REPRODUCED, then fixed. The pending store was ONE localStorage key for the whole browser
   * profile, with nothing clearing it on sign-out. localStorage is per ORIGIN, not per account — so
   * the next person to sign in on a machine the GM had used (the family laptop, the shared table
   * tablet, the GM's own second account) got the GM's secret sheet drawn onto their party page: the
   * card re-summarised from an edit nobody had told them about, "waiting" chip and all.
   *
   * A GM's edit is silent by design. That is the whole reason the player must never be shown it.
   */
  const stored = (): string[] =>
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter((k) =>
      k.includes('gm-pending-edits'),
    );

  it('signing out takes it with them — memory and disk', async () => {
    /*
     * MUTATION: drop the `setGmPendingAccount(null)` from `signOut` (src/data/useAuth.ts) — the
     * auth listener beside it says the same thing — and this fails:
     *   AssertionError: nothing of it is still held: expected { campaignId: 'camp-1', …(4) } to be undefined
     *
     * MUTATION: make `pendingStoreKey()` answer the bare `PENDING_STORE_KEY` (src/sheet/gmSync.ts),
     * i.e. one store for the whole browser profile again, and it fails on the line before it:
     *   AssertionError: the key carries the uid of the account that pushed: expected [ Array(1) ] to deeply equal [ Array(1) ]
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    await new Promise((r) => setTimeout(r, 500)); // the disk copy is debounced
    expect(stored(), 'the key carries the uid of the account that pushed').toEqual([
      'wanderers-codex:gm-pending-edits:v1:gm-1',
    ]);

    await signOut();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'nothing of it is still held').toBeUndefined();
    expect(stored(), 'the next person to sign in must inherit nothing').toEqual([]);
  });

  it('another account on the same browser profile sees none of it', async () => {
    /*
     * MUTATION: drop `pendingStore = null` from `setGmPendingAccount` (src/sheet/gmSync.ts) — so the
     * key is scoped but the map in memory is not re-read for the new account — and this fails:
     *   AssertionError: the GM’s private edit is not theirs to see: expected { campaignId: 'camp-1', …(4) } to be undefined
     */
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered());
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    await new Promise((r) => setTimeout(r, 500));

    // A PLAYER signs in on the browser profile the GM was using.
    setGmPendingAccount('player-9');
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the GM’s private edit is not theirs to see').toBeUndefined();
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm={false} content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent, 'a GM edit is silent — the player is not told').not.toContain('Frightened');
    expect(host.textContent).not.toContain('waiting');
    expect(host.textContent, 'they see the published character, exactly as everyone else does').toContain('Encumbered');
  });

  it('and it is never drawn on the viewer’s OWN character — on any surface', async () => {
    /*
     * The one account that is both: a GM who plays a character in their own campaign. Their card,
     * the pane card in the tracker and the sheet they open are their own PUBLISHED character, never
     * an overlay of it — their own app is what applies the edit and republishes it.
     *
     * The rule was written out at the dashboard card alone, so the other two surfaces drew the
     * edited numbers with no "waiting" chip to explain them. It lives in the one read they all go
     * through now.
     *
     * MUTATION: drop the `edit.ownerId === pendingAccount` test from `gmPendingEdit`
     * (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: but no surface of theirs is ever shown it: expected { campaignId: 'camp-1', …(5) } to be undefined
     * taking the sheet and the opened-viewer assertions below with it (the overlay then answers
     * every read of their own character).
     */
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered());
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.owner_id = 'gm-1'; // the GM plays this one themselves
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    // F1 (2026-10-09): a push carries the read it was built on.
    await pushGmEdit(CAMPAIGN, CHAR, 'gm-1', { ...base, play: addCondition(base.play!, 'frightened', 2) }, await baseNow());
    expect(server.editWrites.length, 'the push reaches the server exactly as any other').toBe(1);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'but no surface of theirs is ever shown it').toBeUndefined();

    // The sheet the pane card, the tracker's roster and the viewer all read through.
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions ?? []).toEqual([]);

    // The dashboard card.
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent, 'your own card is your own published character').not.toContain('Frightened');
    expect(host.textContent).not.toContain('waiting');
    expect(host.textContent, 'which is what they published, carried chip and all').toContain('Encumbered');
    act(() => live!.unmount());
    live = null;

    // …and the sheet that card opens.
    const opened = render(<GmViewer />);
    await settle();
    expect(opened.textContent, 'the sheet a card opens is the same answer').not.toContain('Frightened');
  });

  it('the card is still the belt for an edit whose row recorded no owner', async () => {
    /*
     * MUTATION: drop `m.ownerId !== myId` from the `pending` test in the `shown` memo
     * (src/sheet/PartyMembers.tsx) and this fails —
     *   AssertionError: your own card is your own published character: expected 'THThessaly Vane · youHuman Fighter 3 …' not to contain 'Frightened'
     *
     * `gmPendingEdit` can only judge an edit that knows whose character it is. A row with no owner
     * recorded still reaches the cards — and this page is a page PLAYERS open.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.owner_id = 'gm-1';
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    server.edits.set(`${CAMPAIGN}|${CHAR}`, {
      campaign_id: CAMPAIGN,
      char_id: CHAR,
      editor_id: 'gm-1',
      sheet: { ...base, play: addCondition(base.play!, 'frightened', 2) },
      updated_at: '2026-09-18T10:05:00.000Z',
    });
    await fetchPendingGmEdits(CAMPAIGN);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the store cannot tell whose this one is').toBeDefined();

    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    expect(host.textContent, 'your own card is your own published character').not.toContain('Frightened');
    expect(host.textContent).not.toContain('waiting');
  });
});

describe('(o) a push is recorded on the publish its own read saw', () => {
  it('a push built on their newer publish keeps THAT base, so the next read does not take it for overtaken — and a publish after it still wins', async () => {
    /*
     * MUTATION (tried 2026-10-02, S0c round 11): keep the OLDER of the push's base and the replaced
     * edit's in `rememberGmEdit` (src/sheet/gmSync.ts), the rule this leg pinned until then —
     * `baseUpdatedAt && had?.baseUpdatedAt && had.baseUpdatedAt < baseUpdatedAt ? had.baseUpdatedAt :
     * baseUpdatedAt ?? had?.baseUpdatedAt` — and this fails —
     *   AssertionError: recorded on the publish it read: expected '2026-09-18T10:00:00.000Z' to be '2026-09-18T11:00:00.000Z'
     *
     * The older base was kept "so the overlay only stands down sooner". But a push's base is the
     * stamp its own read saw, so a newer one means that read had already seen the earlier edit
     * overtaken: kept older, the push built on (or confirmed over) the player's newer publish was
     * dropped at the next read for that very publish, and the tracker seam's next gesture replaced it
     * on the server (test/bug-tracker-seam-never-overwrite.test.tsx, PX1 and PZ3).
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt).toBe('2026-09-18T10:00:00.000Z');

    // The player publishes after it; his next push reads that publish and is built on it.
    const theirs = { ...base, play: addCondition(base.play!, 'fatigued') };
    publish(theirs, '2026-09-18T11:00:00.000Z');
    await gmPush({ ...theirs, play: addCondition(theirs.play!, 'sickened', 1) });
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'recorded on the publish it read').toBe('2026-09-18T11:00:00.000Z');
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions, 'the next read keeps it').toEqual([
      { id: 'fatigued' },
      { id: 'sickened', value: 1 },
    ]);

    // …and a publish of theirs after THAT base still wins.
    publish({ ...base, play: addCondition(base.play!, 'clumsy', 1) }, '2026-09-18T12:00:00.000Z');
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions).toEqual([{ id: 'clumsy', value: 1 }]);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'and the chip goes with it').toBeUndefined();
  });
});

describe('(p) an echo is recognised by the PUSH, not by the value it carried', () => {
  function Seam({ members, sheets }: { members: PartyMember[]; sheets: Map<string, SavedChar> }): ReactElement {
    usePcSheetTruth({ campaignId: CAMPAIGN, members, sheetById: sheets, content: db });
    return <div />;
  }

  beforeEach(() => {
    useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  });

  it('a player publish that lands on a value we pushed is still the player moving', async () => {
    /*
     * MUTATION (tried 2026-10-01, round 8): set aside every sheet that is not the pending edit —
     * `if (false)` for `if (!ours.has(sheet))` in the arrival test in `reconcile`
     * (src/integration/pcSheetTruth.ts) — and this fails:
     *   AssertionError: the player’s own healing is not our echo: expected 28 to be 33
     *
     * A record of the VALUES we had put on the server once swallowed any later player publish that
     * happened to land on one of them — they healed back to where they were, they took the same
     * five — as our own echo, and the GM went on reading an HP the player no longer had. Whether a
     * sheet is a push of ours is a question about THAT SHEET, not its contents: the overlay hands back
     * the very object our push sent, and a publish of theirs is always a new one.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const members = (await fetchParty(CAMPAIGN))!;
    const sheets = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
    render(<Seam members={members} sheets={sheets} />);
    await settle();
    const max = members[0].summary.hpMax;
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Thessaly Vane', isPC: true, maxHP: max }));
    await settle();
    const pc = () => useCombatStore.getState().combatants.find((c) => c.isPC)!;

    // The GM types five, twice: the row sits at max-10 and both pushes are on the server.
    for (let i = 0; i < 2; i++)
      await act(async () => {
        useCombatStore.getState().applyDamage(pc().id, 5);
        await new Promise((r) => setTimeout(r, 0));
      });
    await settle();
    expect(pc().currentHP).toBe(max - 10);
    expect(server.editWrites.length, 'both entries reached the server').toBe(2);

    // The player treated their own wounds, back to exactly the HP the FIRST push carried, and
    // published it — after the push, on their own clock.
    const theirSheet = server.chars.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar;
    publish({ ...theirSheet, play: { ...theirSheet.play!, damage: 5 } }, '2026-09-18T23:59:00.000Z');
    const theirs = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'their publish is newer than our push').toBeUndefined();

    const before = server.editWrites.length;
    await act(async () => {
      live!.render(<Seam members={members} sheets={theirs} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(pc().currentHP, 'the player’s own healing is not our echo').toBe(max - 5);
    expect(server.editWrites.length, 'and nothing of ours is pushed back over it').toBe(before);
  });
});

describe('(q) a read that FAILED is not the player publishing an empty summary', () => {
  /** Make every single-row read of `campaign_characters` fail — offline, a Supabase blip, the table
   *  momentarily unreadable. Everything else still answers. */
  async function blipReads(): Promise<() => void> {
    const mod = await import('../src/data/supabase');
    const from = mod.supabase!.from;
    const spy = vi.spyOn(mod.supabase!, 'from').mockImplementation(((table: string) =>
      table === 'campaign_characters'
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'network' } }) }),
                order: async () => ({ data: null, error: { message: 'network' } }),
              }),
            }),
          }
        : from(table)) as typeof from);
    return () => spy.mockRestore();
  }

  it('keeps the player’s carried chip on the GM’s open sheet right through the blip', async () => {
    /*
     * `fetchMemberRow` answered `{ sheet: <the pending overlay>, summary: undefined }` on a failed
     * read: the SHEET half honoured "a read that failed is not an answer", while the SUMMARY half
     * silently became "the player's app derives nothing" — and the viewer wrote that in, because
     * "had a summary, now undefined" is a difference like any other. One dropped response therefore
     * took the player's own "Encumbered" off the GM's open sheet (the owner's exact symptom) until
     * some later read happened to succeed, which inside a pending window is days away.
     *
     * A network blip is not a publish, and only a NEWER player publish may change what is carried.
     *
     * MUTATION: drop the `read` test from the viewer's `pull` (src/sheet/PartyMembers.tsx) — back to
     * `{ ...v, sheet, summary }` — and this fails:
     *   AssertionError: a blip is not the player republishing: expected 'Your changes to Thessaly Vane are sav…' to contain 'Encumbered'
     */
    publish(light(), '2026-09-18T10:00:00.000Z', encumbered()); // their app derived it; this device can't
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) }); // …and an edit is waiting
    const host = render(<GmViewer />);
    await settle();
    expect(host.textContent).toContain('Encumbered');
    expect(host.textContent).toContain('Frightened');

    const restore = await blipReads();
    try {
      const blip = await fetchMemberRow(CAMPAIGN, CHAR);
      expect(blip.read, 'the read did not answer').toBe(false);
      expect(blip.sheet?.character, 'so the overlay stands — the sheet half always did this').toBeDefined();
      expect(blip.summary, 'and the summary half has nothing to say either').toBeUndefined();
      await realtime(); // the open sheet re-reads, and gets the same nothing
      expect(host.textContent, 'a blip is not the player republishing').toContain('Encumbered');
      expect(host.textContent, 'and the GM’s own edit is still there').toContain('Frightened');
    } finally {
      restore();
    }

    // …and their own newer publish still is the one thing that changes it.
    publish(light(), '2026-09-18T23:59:00.000Z');
    await realtime();
    expect(host.textContent, 'their own newer verdict is the one that counts').not.toContain('Encumbered');
  });
});

describe('(P) the PLAIN party page — the cards, not just the sheet behind them', () => {
  /*
   * "the cards need to be updated." — the owner, 2026-09-22.
   *
   * (a)–(q) above put every surface INSIDE the initiative tracker through one answer and left the
   * two outside it drawing `campaign_characters.summary` raw: a character's Party button
   * (src/sheet/PartyPage.tsx — a page PLAYERS open) and the campaign detail's party section
   * (src/sheet/CampaignsPage.tsx). Neither loaded a member's sheet, because the loader lived in the
   * tracker seam (src/integration/pcSheetTruth.ts), which imports the tracker's combat store and is
   * therefore behind the lazily-split tracker chunk. It is src/sheet/memberSheets.ts now, and
   * PartyMembers loads through it whenever the host has not already done the job.
   *
   * Which makes these cards the SAME defect as (a), on the other two surfaces, and in the direction
   * only these can produce: a condition THIS device works out from the published sheet, which the
   * player's own app never wrote into the summary column.
   */

  const MEMBERSHIP: CampaignMembership = { id: CAMPAIGN, code: 'ABC234', name: 'The Fall of Plaguestone', role: 'player' };
  /** The real page, as App mounts it from a character's Party button. */
  const partyPage = (role: 'gm' | 'player' = 'player') => (
    <PartyPage content={db} campaigns={[{ ...MEMBERSHIP, role }]} onClose={() => undefined} />
  );
  /** The campaign detail's own mount (src/sheet/CampaignsPage.tsx → CampaignDetail): same component,
   *  same props, GM tools on. Asserted against the real file below, so the two can't drift. */
  const campaignDetail = () => <PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />;
  const other = (charId: string, name: string): SavedChar => ({ ...light(name), id: charId });

  it('the card says what THIS device works out from the member’s sheet', async () => {
    /*
     * MUTATION: `const summarizeFor = (m: PartyMember) => summarize?.(m);` in
     * src/sheet/PartyMembers.tsx — the cards go back to the published column unless a host hands
     * them an answer — and this fails, taking two more legs of this group with it —
     *   AssertionError: the card and the sheet it opens are one answer now: expected ' PartyTHThessaly VaneHuman Fighter 3H…' to contain 'Encumbered'
     */
    // Their app published a summary that says nothing; the sheet in the same row is over the limit.
    publish(encumbered(), '2026-09-22T10:00:00.000Z', light());
    expect((await fetchParty(CAMPAIGN))![0].summary.conditions, 'the column the card used to draw').toEqual([]);

    const host = render(partyPage());
    await settle();
    expect(host.textContent, 'the card and the sheet it opens are one answer now').toContain('Encumbered');
    act(() => live!.unmount());
    live = null;

    const detail = render(campaignDetail());
    await settle();
    expect(detail.textContent, 'and the GM’s campaign detail is the same component, same answer').toContain('Encumbered');
  });

  it('…and it still carries the chip only the PLAYER’s app could reach', async () => {
    /*
     * The other direction, which the raw column used to get right for free: their app derived it
     * from THEIR item Bulk and this device's data cannot reach it. Reconciling must not cost it.
     *
     * MUTATION: `computeSummary(livePlay(sheet, content), content)` inside `memberCardSummary`
     * (src/sheet/memberSheets.ts) and this fails —
     *   AssertionError: reconciling must never subtract: expected ' PartyTHThessaly VaneHuman Fighter 3H…' to contain 'Encumbered'
     */
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    const host = render(partyPage());
    await settle();
    expect(host.textContent, 'reconciling must never subtract').toContain('Encumbered');
    const chip = host.querySelector('.party-cond.is-auto');
    expect(chip?.getAttribute('title'), 'locked, and it says whose device worked it out').toContain('the player’s own app');
  });

  it('a member whose sheet never arrives keeps their published card', async () => {
    // No flash of the wrong thing and no blank: the published summary is the card until (and unless)
    // a sheet lands. A row written by an older client has no sheet at all, and that is this forever.
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.sheet = null;
    const host = render(partyPage());
    await settle();
    expect(host.textContent).toContain('Thessaly Vane');
    expect(host.textContent, 'what the card had before is what the card still has').toContain('Encumbered');
  });

  it('the GM’s Update shows on both plain surfaces, with the waiting chip', async () => {
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });

    const page = render(partyPage('gm'));
    await settle();
    expect(page.textContent, 'the GM’s own change, on a card they reached from their own character').toContain('Frightened');
    expect(page.textContent, 'and never at the cost of the player’s own chip').toContain('Encumbered');
    expect(page.textContent, 'said plainly: this is your Update, not what they published').toContain('waiting');
    act(() => live!.unmount());
    live = null;

    const detail = render(campaignDetail());
    await settle();
    expect(detail.textContent).toContain('Frightened');
    expect(detail.textContent).toContain('Encumbered');
    expect(detail.textContent).toContain('waiting');
  });

  it('a PLAYER on the same page sees no overlay and no chip', async () => {
    // The overlay is private to the account that pushed it. The store is keyed by that uid, so
    // another sign-in on the same browser profile holds nothing to draw — and the sheets the cards
    // now load come through the same one read, so they arrive un-overlaid for them too.
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    await new Promise((r) => setTimeout(r, 500)); // the disk copy is debounced

    setGmPendingAccount('player-9'); // a player signs in where the GM was
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the GM’s private edit is not theirs to see').toBeUndefined();
    const host = render(partyPage());
    await settle();
    expect(host.textContent, 'a GM edit is silent — the player is not told').not.toContain('Frightened');
    expect(host.textContent).not.toContain('waiting');
    expect(host.textContent, 'they see the published character, exactly as everyone else does').toContain('Encumbered');
  });

  /**
   * An edit row from before `gm_character_edits.owner_id` existed — the one the store cannot place
   * on its own. Seeded through the server read, exactly as a GM's other device or a reload gets it.
   */
  async function ownerlessEdit(): Promise<SavedChar> {
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const edited: SavedChar = { ...base, play: addCondition(base.play!, 'frightened', 2) };
    server.edits.set(`${CAMPAIGN}|${CHAR}`, {
      campaign_id: CAMPAIGN,
      char_id: CHAR,
      editor_id: 'gm-1',
      sheet: edited,
      updated_at: '2026-09-22T10:05:00.000Z',
    });
    await fetchPendingGmEdits(CAMPAIGN);
    return edited;
  }

  it('and never on the viewer’s OWN character, even from an edit row that recorded no owner', async () => {
    /*
     * The belt, now needed twice. `gmPendingEdit` refuses an edit ABOUT the signed-in account's own
     * character — but only when the edit row says whose character it is, and an older row doesn't.
     * `fetchMemberSheet` overlays that unjudgeable edit onto the sheet it answers with, so the cards
     * (which now read sheets) would draw somebody's unapplied change to OUR character as if we had
     * published it, with no chip beside it. The card's `pending` test already refused it the chip.
     *
     * MUTATION: drop `m.ownerId === myId && gmPendingEdit(...)` from `summarizeOwn`
     * (src/sheet/PartyMembers.tsx) and this fails —
     *   AssertionError: your own card is your own published character: expected ' PartyTHThessaly Vane · youHuman Figh…' not to contain 'Frightened'
     */
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.owner_id = 'gm-1'; // the GM plays this one themselves
    await ownerlessEdit();
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the store cannot tell whose this one is — yet').toBeDefined();

    const host = render(partyPage('gm'));
    await settle();
    expect(host.textContent, 'your own card is your own published character').not.toContain('Frightened');
    expect(host.textContent).not.toContain('waiting');
    expect(host.textContent, 'carried chip and all — it is what they published').toContain('Encumbered');
  });

  it('…and neither does the SHEET that card opens — the rule belongs at the READ', async () => {
    /*
     * The other half of the same hole, and the half nothing covered. The card refused the overlay
     * (the leg above) while `fetchMemberRow` — the one read every surface goes through — handed the
     * sheet BEHIND that card the very same unjudgeable edit. Tap your own card on the GM's campaign
     * page and somebody's unapplied change to YOUR character opened as if you had published it,
     * with the "waiting" strip over the top of it.
     *
     * The read is where it is answered now: the published row carries `owner_id`, so the store is
     * told whose character this edit is about and the one rule
     * (`gmPendingEdit` — never our own) covers the sheet, the strip, the card and the tracker's pane
     * from a single place.
     *
     * MUTATION: drop the `learnPendingOwner(campaignId, charId, published?.ownerId)` line from
     * `resolvePendingGmEdit` (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: no strip: an edit nobody can place is not an edit of ours to announce: expected <div class="gm-pending-strip" …(1)>…(2)</div> to be null
     *
     * (The sheet's CONTENT survives that mutation on its own — the refusal below it in the same
     * function catches "the row says the owner is us". Take THAT line out instead and the unit leg
     * in test/gm-sync.test.ts is the one that falls over: with no row and no owner on the edit,
     * nobody can place it and it must not be drawn.)
     */
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered());
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.owner_id = 'gm-1'; // the GM plays this one themselves
    await ownerlessEdit();

    const host = render(<GmViewer />);
    await settle();
    expect(host.textContent, 'the sheet is the character this account published').not.toContain('Frightened');
    expect(
      host.querySelector('.gm-pending-strip'),
      'no strip: an edit nobody can place is not an edit of ours to announce',
    ).toBeNull();
    expect(host.textContent, 'and the player’s own carried chip is untouched by any of it').toContain('Encumbered');
    expect(gmPendingEdit(CAMPAIGN, CHAR), 'the read placed it: ours, so no surface draws it').toBeUndefined();
  });

  it('…while another player’s character still gets the overlay it always did', async () => {
    // The same unjudgeable row, on a character this account does NOT own. Nothing about it changes:
    // the GM's Update is what they see, with the strip that says the player hasn't picked it up.
    publish(light(), '2026-09-22T10:00:00.000Z', encumbered()); // owner_id stays the player's
    await ownerlessEdit();

    const host = render(<GmViewer />);
    await settle();
    expect(host.textContent, 'their character, our Update — shown, exactly as before').toContain('Frightened');
    expect(host.querySelector('.gm-pending-strip'), 'and said to be waiting').not.toBeNull();
    expect(gmPendingEdit(CAMPAIGN, CHAR)?.ownerId, 'the read placed it: theirs').toBe(PLAYER);
  });

  it('a member publishing again moves their card, live', async () => {
    publish(light(), '2026-09-22T10:00:00.000Z');
    const host = render(partyPage());
    await settle();
    expect(host.textContent).not.toContain('Encumbered');

    // They pick the hoard up. Their app's own summary still says nothing about it, so only the
    // per-member subscription + this device's derivation can put it on the card.
    publish(encumbered(), '2026-09-22T11:00:00.000Z', light());
    await realtime();
    expect(host.textContent, 'the per-member subscription is what carries it').toContain('Encumbered');
  });

  it('costs one row read per member on open, and one — not four — when one member changes', async () => {
    publish(light(), '2026-09-22T10:00:00.000Z');
    publish(other('pc-2', 'Bran Ashgrove'), '2026-09-22T10:00:00.000Z');
    publish(other('pc-3', 'Neve Calder'), '2026-09-22T10:00:00.000Z');
    publish(other('pc-4', 'Orin Vale'), '2026-09-22T10:00:00.000Z');
    expect(await fetchParty(CAMPAIGN)).toHaveLength(4);

    server.reads = 0; // single-row reads of campaign_characters — the party LIST is not one of these
    const host = render(partyPage());
    await settle();
    expect(host.textContent).toContain('Bran Ashgrove');
    /*
     * TWO per member, and both are the existing shape:
     *   • the loader's own pull, which is the answer when Realtime is down or unconfigured, and
     *   • the pull `subscribeMemberSheet` fires on a successful join — Realtime replays nothing
     *     missed while it was disconnected, so every caller of it re-reads on (re)join.
     * The third one this used to cost (the pending-edit effect re-pulling every member it had never
     * seen before) is gone; see `pendingSig` in src/sheet/memberSheets.ts.
     */
    expect(server.reads, 'four members, no polling').toBe(8);

    // One member publishes: only that member's row is re-read. The channel is per member, so this
    // cannot become an N-read fan-out when the party grows.
    const idx = server.channels.indexOf(`member:${CAMPAIGN}:pc-2`);
    expect(idx, 'one channel per member, on its own topic').toBeGreaterThanOrEqual(0);
    server.reads = 0;
    await act(async () => {
      server.listeners[idx]();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(server.reads, 'one member changed — one row read').toBe(1);
  });

  it('and both plain pages really do hand the cards a content database', async () => {
    // Without `content` the loader is off by design (there is nothing to derive against) and the
    // cards fall back to the published column — silently, which is the whole defect. Dropping the
    // prop is a one-word edit, so it gets a guard rather than a comment.
    for (const f of ['src/sheet/PartyPage.tsx', 'src/sheet/CampaignsPage.tsx']) {
      const mount = readFileSync(f, 'utf8').match(/<PartyMembers[\s\S]*?\/>/);
      expect(mount, `${f} must still mount PartyMembers`).not.toBeNull();
      expect(mount![0], `${f}: no content= means cards drawn from the player's own column again`).toContain('content=');
    }
  });
});

/*
 * F1 (2026-10-09) — THE GM'S SIDE OF A REFUSED OR UNPROVABLE UPDATE.
 *
 * His full-sheet Update is sent only on top of the newest thing the server holds for the character
 * (gmSync.gmUpdateBase), and only with the read it was built on, so the player's app can prove it. When
 * it cannot be sent he is told why and keeps his work; when the player's app refused one, his card says
 * "not applied"; and a database without the F1 columns is named on his party page.
 */
describe('(F1) the full-sheet Update, the "not applied" chip and the SQL strip', () => {
  const dialog = () => document.querySelector<HTMLElement>('.confirm-modal');
  async function press(label: string): Promise<void> {
    const b = [...(dialog()?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label);
    expect(b, `the dialog offers “${label}”`).toBeDefined();
    await act(async () => {
      b!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
  }
  /** Open his sheet on what is published, make an edit (a hero point), and press Update → Update. */
  async function editAndUpdate(host: HTMLElement): Promise<void> {
    const pip = host.querySelector<HTMLButtonElement>('button[aria-label^="Set hero points to"]');
    expect(pip, 'fixture: the GM sheet can be edited').not.toBeNull();
    act(() => pip!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.gm-update-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    await press('Update'); // the confirm
  }

  it('(44) Update with the read failing sends NOTHING, says so, and keeps his work', async () => {
    /*
     * MUTATION (run 2026-10-09): push without the proof — `const proof = { ok: true, base: <the read's
     * stamp, or undefined when it failed>, on: null }` in place of gmUpdateBase in GmEditSheet.pushToPlayer
     * — and this fails (with both (45) legs: `expected 'Sent' to be 'Thessaly Vane changed since your copy'`) —
     *   AssertionError: expected 'Couldn’t update' to be 'Couldn’t check Thessaly Vane'
     * (pushGmEdit's own guard still refuses the base-less push, so nothing reaches the server either way.)
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const host = render(gmSheet((await fetchMemberSheet(CAMPAIGN, CHAR))!));
    await settle();
    const mod = await import('../src/data/supabase');
    const from = mod.supabase!.from;
    const spy = vi.spyOn(mod.supabase!, 'from').mockImplementation(((table: string) =>
      table === 'campaign_characters'
        ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'network' } }) }) }) }) }
        : from(table)) as typeof from);
    try {
      await editAndUpdate(host);
      expect(dialog()?.querySelector('.info-title')?.textContent).toBe('Couldn’t check Thessaly Vane');
      expect(dialog()?.textContent, 'said plainly').toContain('nothing was sent');
      expect(server.editWrites, 'no gm_character_edits write').toEqual([]);
      await press('OK');
    } finally {
      spy.mockRestore();
    }
    // Still dirty: leaving asks whether to update first.
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Back to campaign"]')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    expect(dialog()?.querySelector('.info-title')?.textContent, 'his changes are still here').toBe('Update before leaving?');
    await press('Cancel');
  });

  describe('(45) he edited P0, the player published P1 meanwhile', () => {
    async function moved(): Promise<HTMLElement> {
      publish(light(), '2026-09-18T10:00:00.000Z');
      const host = render(gmSheet((await fetchMemberSheet(CAMPAIGN, CHAR))!));
      await settle();
      const p1 = light();
      publish({ ...p1, play: addCondition(p1.play!, 'fatigued') }, '2026-09-18T11:00:00.000Z'); // their device
      await editAndUpdate(host);
      expect(dialog()?.querySelector('.info-title')?.textContent).toBe('Thessaly Vane changed since your copy');
      expect(server.editWrites, 'nothing was sent').toEqual([]);
      return host;
    }

    it('“Take current version” writes nothing and puts their P1 in front of him', async () => {
      /*
       * MUTATION (run 2026-10-09): the old "Overwrite anyway" path, auto-confirmed — `const choice =
       * (await Promise.resolve('overwrite')) || await chooseDialog({…})` in GmEditSheet.pushToPlayer —
       * and this fails (with the overwrite leg below) —
       *   AssertionError: expected 'Sent' to be 'Thessaly Vane changed since your copy'
       */
      const host = await moved();
      await press('Take current version');
      expect(server.editWrites, 'taking theirs sends nothing').toEqual([]);
      expect(host.textContent, 'his sheet is their current version').toContain('Fatigued');
    });

    it('“Overwrite anyway” is his knowing choice: the push carries the FRESH read, so their app can prove it', async () => {
      /*
       * A2: the app never overwrites a player's change; a GM shown "changed since your copy" who presses
       * the red button is not the app.
       * MUTATION (run 2026-10-09): drop the overwrite branch — `return false;` for `if (choice !==
       * 'overwrite') return false;` — and this fails —
       *   AssertionError: expected [] to have a length of 1 but got +0
       */
      await moved();
      expect(dialog()?.textContent, 'he is told what it does').toContain('cannot be taken back from here');
      await press('Overwrite anyway');
      expect(server.editWrites).toHaveLength(1);
      const b = server.editWrites[0].gm_base as { stamp: string; hash: string; on: string | null };
      expect(b.stamp, 'built on the read that showed P1').toBe('2026-09-18T11:00:00.000Z');
      expect(b.hash).toBe(hash53(authoredKey(server.chars.get(`${CAMPAIGN}|${CHAR}`)!.sheet as SavedChar)));
      expect(b.on).toBeNull();
    });
  });

  it('(46) a card whose player’s app refused his push says “not applied”, and no longer “waiting”', async () => {
    /*
     * MUTATION (run 2026-10-09): drop `refused={refused}` from the PartyCard in PartyMembers — and this fails —
     *   AssertionError: expected 'THThessaly VaneHuman Fighter 3HP38 / …' to contain 'not applied'
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    // Their app refused it (they changed the character first) and wrote the receipt on their row.
    server.chars.get(`${CAMPAIGN}|${CHAR}`)!.gm_refused_at = server.editWrites[0].updated_at;
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    await settle();
    expect(host.textContent).toContain('not applied');
    expect(host.textContent).not.toContain('waiting');
    expect(host.textContent, 'the card is their version').not.toContain('Frightened');
  });

  it('(47) a database without gm_base: the GM’s party page names the SQL file', async () => {
    /*
     * MUTATION (run 2026-10-09): drop `markGmEditSchemaOutdated();` from party.selectWithOptional — and
     * this fails —
     *   AssertionError: expected 'THThessaly VaneHuman Fighter 3HP38 / …' to contain 'supabase-campaign-characters.sql'
     */
    server.noGmBaseColumn = true;
    publish(light(), '2026-09-18T10:00:00.000Z');
    const host = render(<PartyMembers campaignId={CAMPAIGN} isGm content={db} onView={() => undefined} />);
    await settle();
    await settle();
    expect(host.textContent).toContain('supabase-campaign-characters.sql');
    expect(host.textContent, 'the party still loads').toContain('Thessaly Vane');
  });
});
