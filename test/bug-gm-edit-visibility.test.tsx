// @vitest-environment jsdom
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
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [
    ...(table === 'campaign_characters' ? server.chars : server.edits).values(),
  ];
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
const { fetchMemberRow, fetchMemberSheet, fetchPublishedSheet, fetchParty, fetchPendingGmEdits, pushGmEdit } = await import('../src/data/party');
const { clearGmPendingEdits, gmPendingEdit, pendingEditStillStands, setGmPendingAccount } = await import('../src/sheet/gmSync');
const { signOut } = await import('../src/data/useAuth');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { PartyCard, PartyMembers, useMemberViewer } = await import('../src/sheet/PartyMembers');
const { gmMemberSummary, useMemberSheets, usePcSheetTruth } = await import('../src/integration/pcSheetTruth');
const { useCombatStore } = await import('../tracker/src/store/combatStore');
type PartyMember = import('../src/data/party').PartyMember;

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
 * GM's own work compared against itself), then push, carrying the stamp the edit is built on.
 */
async function gmPush(sheet: SavedChar): Promise<void> {
  const row = await fetchPublishedSheet(CAMPAIGN, CHAR);
  await pushGmEdit(CAMPAIGN, CHAR, PLAYER, sheet, row?.updatedAt);
}

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
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    const from = (await import('../src/data/supabase')).supabase!.from;
    const spy = vi
      .spyOn((await import('../src/data/supabase')).supabase!, 'from')
      .mockImplementation(((table: string) =>
        table === 'gm_character_edits'
          ? { upsert: async () => ({ error: { message: 'row-level security' } }) }
          : from(table)) as typeof from);
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: addCondition(base.play!, 'frightened', 2) });
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
     * published since. So `pushToPlayer` and `pushVitals` both read THIS call, and it is a separate
     * function rather than a flag precisely so the difference survives the next refactor. It is also
     * where the published stamp comes from, which is the skew-free base every later comparison uses.
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
     * tracker (pushVitals → pushGmEdit → rememberGmEdit). Having it in a SUBSCRIPTION effect tore the
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
  it('keeps the base stamp an earlier push proved — so the GM’s clock still cannot decide it', async () => {
    /*
     * MUTATION: write the argument straight through in `rememberGmEdit` (src/sheet/gmSync.ts) —
     * `baseUpdatedAt` instead of `baseUpdatedAt ?? had?.baseUpdatedAt` — and this fails:
     *   AssertionError: the base an earlier push proved is not thrown away: expected undefined to be '2026-09-18T10:00:00.000Z'
     * and the player's newer sheet then loses to the stale overlay on the line after it.
     *
     * `fetchPublishedSheet` answers `null` when the read FAILS, and the push still goes ahead on the
     * newest thing this device holds. Passing that `undefined` base on left the edit comparing the
     * GM's clock against the player's — the comparison `baseUpdatedAt` exists to remove — and the
     * damage path has no confirm dialog to catch what follows.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z')); // the GM's machine, years fast
    try {
      publish(light(), '2026-09-18T10:00:00.000Z');
      const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
      await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
      expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt).toBe('2026-09-18T10:00:00.000Z');

      // The next push — a point of damage — reads the published row and the read FAILS: no stamp.
      await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: addCondition(base.play!, 'sickened', 1) }, undefined);
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
     * MUTATION: drop the `echo` test from `reconcile` (src/integration/pcSheetTruth.ts) — back to
     * `if (!st || st.sheet !== skey)` — and this fails:
     *   AssertionError: the second five must survive the first push coming back: expected 33 to be 28
     *
     * `fetchMemberSheet` overlays this device's own pending edit, so a GM push MOVES the sheet this
     * seam reads: our own value arrives looking exactly like the player publishing it. Two damage
     * entries inside one round trip therefore ran V1 → V2 → (push 1 lands) V1, in front of the GM.
     * And if push 2 were refused, the rollback would restore `agreed` while `sheet` had already
     * advanced, dropping V2 with nothing left to re-push it.
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
     * MUTATION: drop the per-member stamp test from the re-pull effect in
     * src/integration/pcSheetTruth.ts and this fails:
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
    server.reads = 0; // the line above is the test's own read, not the app's
    await act(async () => {
      await pushGmEdit(CAMPAIGN, 'pc-2', PLAYER, { ...base, play: addCondition(base.play!, 'frightened', 2) }, '2026-09-18T10:00:00.000Z');
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
      for (let i = 1; i <= 5; i++)
        await pushGmEdit(CAMPAIGN, CHAR, PLAYER, { ...base, play: { ...base.play!, damage: i } }, '2026-09-18T10:00:00.000Z');
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
     * MUTATION: withhold the member's own summary inside `gmMemberSummary`
     * (src/integration/pcSheetTruth.ts) — `memberSummary(livePlay(sheet, content), content)` — and
     * this fails —
     *   AssertionError: expected [ 'Frightened' ] to deeply equal [ 'Encumbered', 'Frightened' ]
     *
     * It takes the whole MEMBER for this reason: the published half is not an optional extra a
     * surface may decide to leave out, so there is no argument at the call site to get wrong.
     */
    const mem = await pendingOverACarriedChip();
    // The sheet the tracker holds for this member is the overlaid one — the GM's own pending edit.
    const sheets = new Map([[CHAR, (await fetchMemberSheet(CAMPAIGN, CHAR))!]]);
    const card = gmMemberSummary(mem, sheets.get(CHAR)!, db);
    expect(card.conditions.map((c) => c.name).sort()).toEqual(['Encumbered', 'Frightened']);
    expect(card.conditions.find((c) => c.name === 'Encumbered')!.derivedFrom).toContain('the player’s own app');

    // And the dashboard grid, drawing exactly what the tracker hands it.
    const host = render(
      <PartyMembers
        campaignId={CAMPAIGN}
        isGm
        content={db}
        summarize={(x) => gmMemberSummary(x, sheets.get(x.charId)!, db)}
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
    await pushGmEdit(CAMPAIGN, CHAR, 'gm-1', { ...base, play: addCondition(base.play!, 'frightened', 2) }, '2026-09-18T10:00:00.000Z');
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

describe('(o) a newer base stamp never extends an overlay’s life', () => {
  it('the OLDER of the two is kept, so a publish between them still wins', async () => {
    /*
     * MUTATION: back to `baseUpdatedAt ?? had?.baseUpdatedAt` in `rememberGmEdit`
     * (src/sheet/gmSync.ts) and this fails —
     *   AssertionError: the older base is the one that is kept: expected '2026-09-18T12:00:00.000Z' to be '2026-09-18T10:00:00.000Z'
     * and the player's 11:00 work then loses to the overlay on the lines after it.
     *
     * The comment there promised "keeping the older one errs towards the player's work winning" —
     * but the code only kept it when the NEW one was missing, so a newer stamp (a second GM screen,
     * a re-read between two pushes) silently replaced a base the player's own publish had already
     * passed. An older base can only make the overlay stand down SOONER, which is the safe way.
     */
    publish(light(), '2026-09-18T10:00:00.000Z');
    const base = (await fetchMemberSheet(CAMPAIGN, CHAR))!;
    await gmPush({ ...base, play: addCondition(base.play!, 'frightened', 2) });
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt).toBe('2026-09-18T10:00:00.000Z');

    // A second push arriving with a NEWER base than the one we already hold.
    await pushGmEdit(
      CAMPAIGN,
      CHAR,
      PLAYER,
      { ...base, play: addCondition(base.play!, 'sickened', 1) },
      '2026-09-18T12:00:00.000Z',
    );
    expect(gmPendingEdit(CAMPAIGN, CHAR)!.baseUpdatedAt, 'the older base is the one that is kept').toBe(
      '2026-09-18T10:00:00.000Z',
    );

    // …so the player, who published between the two, is still the one who wins.
    publish({ ...base, play: addCondition(base.play!, 'fatigued') }, '2026-09-18T11:00:00.000Z');
    expect((await fetchMemberSheet(CAMPAIGN, CHAR))!.play?.conditions).toEqual([{ id: 'fatigued' }]);
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
     * MUTATION: back to the value test in `reconcile` (src/integration/pcSheetTruth.ts) —
     * `const echo = !!st && st.sheet !== skey && st.pushed.has(skey)` — and this fails:
     *   AssertionError: the player’s own healing is not our echo: expected 28 to be 33
     *
     * `pushed` held the VALUES we had put on the server, so any later player publish that happened
     * to land on one of them — they healed back to where they were, they took the same five — was
     * swallowed as our own echo, and the GM went on reading an HP the player no longer had. Whether
     * a sheet is our push is a question about the ROW, not its contents: a pending edit only stands
     * while no newer publish exists, so "a push of ours is still standing" answers it on the
     * player's own clock, and their newer publish can never read as an echo of ours.
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
