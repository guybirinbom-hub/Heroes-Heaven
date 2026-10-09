// Party data layer — publish a character to the campaigns it's attached to, and read the party back.
// The campaign itself lives in `campaigns`; the attached characters live in `campaign_characters`
// (see supabase-campaign-characters.sql). All calls degrade to no-op/empty when signed out or the
// table is missing, so the rest of the app never has to special-case it.
import { supabase } from './supabase';
import type { PartySummary } from '../sheet/partySummary';
import {
  boundGmBase,
  gmHeldEdit,
  markGmEditSchemaOutdated,
  reconcileGmPendingEdits,
  rememberGmEdit,
  resolvePendingGmEdit,
  sameInstant,
  setGmPendingAccount,
  snapshotGmPending,
  type GmBase,
  type PendingGmEdit,
  type PublishedRow,
} from '../sheet/gmSync';
import type { SavedChar } from './storage';
import type { CampaignResult } from './campaigns';

/** A pending GM edit for one of the current user's characters (judged on sync — src/App.tsx). */
export interface GmEdit {
  campaignId: string;
  charId: string;
  sheet: SavedChar;
  updatedAt: string;
  /** `gm_base` — which published sheet the push was built on (gmSync.GmBase). `'future'` = a NEWER
   *  app's format this one cannot read: it waits, never refused, never applied. Undefined = none. */
  gmBase?: GmBase | 'future';
}

/** `gm_character_edits.gm_base` as the database hands it back — unknown is not empty. */
export function parseGmBase(v: unknown): GmBase | 'future' | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;
  if (b.v === 1 && typeof b.at === 'string' && typeof b.stamp === 'string')
    return { v: 1, at: b.at, stamp: b.stamp, hash: typeof b.hash === 'string' ? b.hash : '', on: typeof b.on === 'string' ? b.on : null };
  if (typeof b.v === 'number' && b.v > 1) return 'future';
  return undefined;
}

/** One `gm_character_edits` row, as the player's applier judges it. */
export function gmEditFromRow(r: Record<string, unknown>): GmEdit {
  return {
    campaignId: r.campaign_id as string,
    charId: r.char_id as string,
    sheet: (r.sheet ?? null) as SavedChar,
    updatedAt: r.updated_at as string,
    gmBase: parseGmBase(r.gm_base),
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * THE F1 COLUMNS ON A DATABASE THAT DOES NOT HAVE THEM YET
 * ────────────────────────────────────────────────────────────────────────────── */

/** PostgREST / Postgres saying a named column does not exist (the SQL has not been re-run). */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, col: string): boolean {
  const m = String(error?.message ?? '');
  return m.includes(col) && (error?.code === 'PGRST204' || error?.code === '42703' || /does not exist|could not find/i.test(m));
}

/** Optional columns this session has found missing — asked for once, then left out. */
const missingCols = new Set<string>();

/** Tests only: forget which optional columns were found missing. */
export function forgetMissingColumns(): void {
  missingCols.clear();
}

/**
 * A select that reads an OPTIONAL column when the database has it, and falls back without it when it
 * does not — saying so (`markGmEditSchemaOutdated`), so the GM sees the strip naming the SQL file. A
 * GM-side DISPLAY read must never fail outright because of a column the owner has not added yet.
 */
async function selectWithOptional<T>(
  run: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  base: string,
  optional: string,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  if (missingCols.has(optional)) return run(base);
  const first = await run(`${base},${optional}`);
  if (first.error && isMissingColumn(first.error, optional)) {
    missingCols.add(optional);
    markGmEditSchemaOutdated();
    return run(base);
  }
  return first;
}

const SCHEMA_MESSAGE =
  'This campaign’s database needs one update before GM changes can reach players: run supabase-campaign-characters.sql once in the Supabase SQL editor.';

/* ──────────────────────────────────────────────────────────────────────────────
 * THE PUBLISH LANE — one per (campaign, character)
 * ────────────────────────────────────────────────────────────────────────────── */

/** What became of one publish: it landed, it failed, or a newer one for the same key replaced it
 *  before it was sent. */
export type PublishResult = 'ok' | 'failed' | 'superseded';

/**
 * Upserts for one (campaign, character) go out ONE AT A TIME, in call order, and a send still waiting
 * is replaced by a newer one. Two upserts in flight could land in either order, and the older one
 * landing last put an older sheet on the published row — which a GM edit is then judged against. The
 * stamp is taken at SEND time, so landing order and stamp order agree; an unpublish takes the same lane,
 * so an upsert in flight can no longer land after a detach.
 */
const lanes = new Map<string, { busy: boolean; next: { run: () => Promise<boolean>; resolve: (r: PublishResult) => void } | null }>();

function enqueue(key: string, run: () => Promise<boolean>): Promise<PublishResult> {
  return new Promise((resolve) => {
    const lane = lanes.get(key) ?? { busy: false, next: null };
    lanes.set(key, lane);
    lane.next?.resolve('superseded');
    lane.next = { run, resolve };
    if (!lane.busy) void drain(key, lane);
  });
}

async function drain(
  key: string,
  lane: { busy: boolean; next: { run: () => Promise<boolean>; resolve: (r: PublishResult) => void } | null },
): Promise<void> {
  lane.busy = true;
  while (lane.next) {
    const op = lane.next;
    lane.next = null;
    let ok = false;
    try {
      ok = await op.run();
    } catch {
      ok = false;
    }
    op.resolve(ok ? 'ok' : 'failed');
  }
  lane.busy = false;
  lanes.delete(key);
}

/** The published row as the write paths read it, plus the player's own card summary — the display
 *  side wants both and they live in the same row. */
export interface PublishedMemberRow extends PublishedRow {
  summary?: PartySummary;
}

export interface PartyMember {
  ownerId: string;
  charId: string;
  name: string;
  summary: PartySummary;
  /**
   * `campaign_characters.updated_at` — when the PLAYER last published this character.
   *
   * The party list carries it because the cards are a GM-side surface too, and a card showing the
   * GM's own pending edit has to be able to find out the player has published since. Without it the
   * party page had no way of telling a waiting edit from a landed one, and the "waiting" chip stayed
   * on a card forever. Optional: a row read before this column was selected simply has no stamp.
   */
  updatedAt?: string;
  /** `campaign_characters.gm_refused_at` — the stamp of the last GM push the player's app REFUSED
   *  (gmSync.PublishedRow.gmRefusedAt). Absent on a database without the column. */
  gmRefusedAt?: string;
}

/**
 * The signed-in account's id, read LOCALLY.
 *
 * ⚠ `getSession()`, never `getUser()`. `getUser` issues a `GET /auth/v1/user` on every single call —
 * auth-js 2.110's `_getUser` has no cache, it re-requests unconditionally — and this is now asked on
 * the way into every member card, so each tap waited on an auth round-trip before the row fetch even
 * started. The worse half: when that request fails (expired refresh token, a 429, a flaky link) it
 * answers `{ user: null }`, which is indistinguishable from signed out — and "signed out" is exactly
 * the answer that sends a GM into the EDIT sheet on their own character. `getSession` reads the
 * persisted session out of storage (autoRefreshToken keeps it current in the background) and answers
 * the same question with no network and no such failure mode.
 */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** Publish (upsert) one character into one campaign. `sheet` is the full SavedChar (character + build +
 *  play) so a GM can fully edit it; the read-only party view derives the live character from it.
 *
 *  It SAYS how it went (F1, 2026-10). A failure swallowed into "done" made a publish that never
 *  landed look in sync, and a GM edit is judged against what the server really holds — so the caller
 *  forgets a failed send and sends it again (src/App.tsx's publish retry). */
export function publishCharacter(
  campaignId: string,
  charId: string,
  name: string,
  summary: PartySummary,
  sheet: SavedChar,
): Promise<PublishResult> {
  if (!supabase) return Promise.resolve('failed');
  const client = supabase;
  return enqueue(`${campaignId}|${charId}`, async () => {
    const owner = await currentUserId();
    if (!owner) return false;
    const { error } = await client
      .from('campaign_characters')
      .upsert({ campaign_id: campaignId, owner_id: owner, char_id: charId, name, summary, sheet, updated_at: new Date().toISOString() });
    return !error;
  });
}

/** Remove a character from a campaign (on detach / delete) — on the same lane as its publishes. */
export function unpublishCharacter(campaignId: string, charId: string): Promise<PublishResult> {
  if (!supabase) return Promise.resolve('failed');
  const client = supabase;
  return enqueue(`${campaignId}|${charId}`, async () => {
    const { error } = await client.from('campaign_characters').delete().eq('campaign_id', campaignId).eq('char_id', charId);
    return !error;
  });
}

/** GM only: remove a member from the campaign — ban them (so they can't re-publish) and drop their
 *  published characters. Requires the caller to own the campaign (enforced by RLS). */
export async function kickFromParty(campaignId: string, memberOwnerId: string): Promise<CampaignResult<null>> {
  if (!supabase) return { ok: false, error: 'Sign in to manage the party.' };
  const { data: camp, error: e1 } = await supabase.from('campaigns').select('removed').eq('id', campaignId).maybeSingle();
  if (e1) return { ok: false, error: e1.message || 'Could not read the campaign.' };
  const removed = Array.from(new Set([...(((camp?.removed as string[] | null) ?? []) as string[]), memberOwnerId]));
  const { error: e2 } = await supabase.from('campaigns').update({ removed }).eq('id', campaignId);
  if (e2) return { ok: false, error: e2.message || 'Could not remove the member.' };
  await supabase.from('campaign_characters').delete().eq('campaign_id', campaignId).eq('owner_id', memberOwnerId);
  return { ok: true, value: null };
}

/**
 * The party for a campaign — small summaries for the cards.
 *
 * `null` means THE READ FAILED (offline, a Supabase blip, a missing table), which is a different
 * answer from "nobody has shared a character yet". Swallowing the failure into `[]` made the two
 * indistinguishable, and a caller that mirrors the list — the tracker's party bridge — then pruned
 * every real member on one bad response, taking the GM's per-player notes and turn history with it.
 * Adversarially confirmed. With no cloud configured at all there is genuinely no server party, so
 * that stays `[]`.
 */
export async function fetchParty(campaignId: string): Promise<PartyMember[] | null> {
  if (!supabase) return [];
  const client = supabase;
  const { data, error } = await selectWithOptional<Record<string, unknown>[]>(
    (cols) =>
      client
        .from('campaign_characters')
        // `updated_at` travels with the card: it is how a card drawn from the GM's own pending edit
        // finds out the player has published since, which is the only thing that clears the chip there.
        // `gm_refused_at` is the player's app saying it refused his push — the "not applied" chip.
        .select(cols)
        .eq('campaign_id', campaignId)
        .order('name') as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
    'owner_id,char_id,name,summary,updated_at',
    'gm_refused_at',
  );
  if (error || !data) return null;
  return data.map((r) => ({
    ownerId: r.owner_id as string,
    charId: r.char_id as string,
    name: (r.name as string) || 'Unnamed',
    summary: (r.summary ?? {}) as PartySummary,
    updatedAt: (r.updated_at as string | undefined) ?? undefined,
    gmRefusedAt: (r.gm_refused_at as string | null | undefined) ?? undefined,
  }));
}

/**
 * The full published character (SavedChar: character + build + play) for a party member — fetched
 * lazily when a card is tapped. Used for the read-only view and for GM editing.
 *
 * THE ONE CHOKEPOINT for reading somebody else's character, which is why the GM's pending edit is
 * folded in here rather than at each caller: the cards, the tracker's pane card, the GM-edit sheet's
 * working copy and the seam's down-sync all come through this call, and a GM who pressed Update has
 * to see the same character in every one of them. `resolvePendingGmEdit` hands back the published
 * sheet again the moment the player's own row overtakes the push — see ../sheet/gmSync.ts.
 *
 * Nothing here writes: the overlay is a local view of a row already sitting in `gm_character_edits`,
 * and `campaign_characters` is still only ever written by the character's own owner.
 */
export async function fetchMemberSheet(campaignId: string, charId: string): Promise<SavedChar | null> {
  return (await fetchMemberRow(campaignId, charId)).sheet;
}

/**
 * The same read, with the PLAYER's own card summary beside the sheet — they are one row.
 *
 * Reading them together is what keeps an OPEN sheet honest. The viewer used to be handed the summary
 * once, by the card that opened it, and then refreshed only the sheet half: a carried
 * "Encumbered — the player's own app" pill therefore outlived the player dropping the loot and
 * republishing, and only closing and reopening the sheet could clear it. Same row, same read, same
 * refresh.
 *
 * ⚠ `read` — UNKNOWN IS NOT EMPTY, for the summary half too. A FAILED read (offline, a blip) gives
 * `row === null`, which the sheet half already treats as "not an answer": the pending overlay stands
 * and the caller keeps what it had. The summary half silently became `undefined` on the same
 * response, and `undefined` means "the player publishes nothing derived" — so one bad response took
 * the player's carried "Encumbered" off the GM's open sheet until some later read happened to
 * succeed, which in a pending window is days. A network blip is not a publish, and only a publish
 * may change what is carried; this flag is how the caller tells the two apart.
 */
export async function fetchMemberRow(
  campaignId: string,
  charId: string,
): Promise<{ sheet: SavedChar | null; summary?: PartySummary; read: boolean }> {
  const row = await fetchPublishedSheet(campaignId, charId);
  return { sheet: resolvePendingGmEdit(campaignId, charId, row), summary: row?.summary, read: !!row };
}

/**
 * THE PUBLISHED ROW, WITH NO OVERLAY — what the player's own device actually holds.
 *
 * ⚠ EVERY WRITE PATH RE-BASES ON THIS, never on `fetchMemberSheet`. The overlay is this device's own
 * unapplied edit: a push that re-based on it would be comparing the GM's work against itself, so the
 * "the player changed this while you were editing" guard would see no change and quietly overwrite
 * whatever the player published in the meantime. Displaying the overlay is right; building a write on
 * it is not, and the two calls are separate so the difference can't be lost in a refactor.
 *
 * `null` means THE READ FAILED — a different answer from "there is no such row", and the reason a
 * blip never drops a pending edit.
 */
export async function fetchPublishedSheet(campaignId: string, charId: string): Promise<PublishedMemberRow | null> {
  if (!supabase) return null;
  const client = supabase;
  const { data, error } = await selectWithOptional<Record<string, unknown>>(
    (cols) =>
      client
        .from('campaign_characters')
        // `updated_at` comes back too: it is how a pending GM edit finds out the player has published
        // since, which is the one thing that makes the overlay stand down. `summary` rides along for the
        // display side (fetchMemberRow) — it costs nothing extra, it is the same row. `gm_refused_at`
        // is the player's app's receipt for a push of his it refused.
        .select(cols)
        .eq('campaign_id', campaignId)
        .eq('char_id', charId)
        .maybeSingle() as unknown as PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>,
    'owner_id,sheet,summary,updated_at',
    'gm_refused_at',
  );
  if (error) return null;
  return {
    sheet: (data?.sheet ?? null) as SavedChar | null,
    // WHOSE character this row is. An older `gm_character_edits` row can't say, and an edit nobody
    // can place is one that must never be overlaid on the signed-in account's own character — this
    // column is what the read judges that by (../sheet/gmSync.ts → resolvePendingGmEdit).
    ownerId: (data?.owner_id as string | undefined) ?? undefined,
    summary: (data?.summary ?? undefined) as PartySummary | undefined,
    updatedAt: (data?.updated_at as string | undefined) ?? undefined,
    gmRefusedAt: (data?.gm_refused_at as string | null | undefined) ?? undefined,
  };
}

/** GM: push an edited copy of a member's character. Their app applies it on its next sync — silently —
 *  but only while their published sheet is still the one this push was built on (F1, 2026-10:
 *  gmSync.gmEditVerdict). Requires the caller to own the campaign (enforced by RLS). */
export async function pushGmEdit(
  campaignId: string,
  charId: string,
  playerOwnerId: string,
  sheet: SavedChar,
  /** The published row the caller just read, as `gmBaseOf(row)` gives it: its stamp and the hash of
   *  its authored sheet. Passed rather than read here so it is the read the push was ACTUALLY built
   *  on, with no window in between. Undefined (the read failed, or found nothing) → NOTHING is sent:
   *  a push that proves no base is one the player's app must refuse anyway. */
  base: { stamp: string; hash: string } | undefined,
  /** The `updated_at` of the earlier push of his this one was built on (gmSync.gmPushBuiltOn), or
   *  null when it was built on the published sheet. Omitted (direct callers only) → inferred from the
   *  held edit, erring towards "built on it", the player-safe direction. */
  builtOn?: string | null,
): Promise<CampaignResult<null>> {
  if (!supabase) return { ok: false, error: 'Sign in to edit a player.' };
  const editor = await currentUserId();
  if (!editor) return { ok: false, error: 'Sign in to edit a player.' };
  if (!base?.stamp || !base?.hash)
    return { ok: false, error: 'Couldn’t read the player’s current sheet, so nothing was sent. Try again.' };
  // Bound to the EDITOR first: the overlay is private to the account that pushed it, and the store
  // is keyed by that account so no other sign-in on this browser profile can see it (gmSync.ts). It
  // comes before the upsert now because the `on` inference below reads that account's store.
  setGmPendingAccount(editor);
  const on =
    builtOn !== undefined
      ? builtOn
      : (() => {
          const h = gmHeldEdit(campaignId, charId);
          return h?.baseHash && h.baseHash === base.hash ? h.pushedAt : null;
        })();
  const pushedAt = new Date().toISOString();
  const { error } = await supabase.from('gm_character_edits').upsert({
    campaign_id: campaignId,
    char_id: charId,
    owner_id: playerOwnerId,
    editor_id: editor,
    sheet,
    updated_at: pushedAt,
    gm_base: { v: 1, at: pushedAt, stamp: base.stamp, hash: base.hash, on },
  });
  if (error) {
    // NO legacy retry without the column: a base-less row is exactly the F1 row.
    if (isMissingColumn(error, 'gm_base')) {
      markGmEditSchemaOutdated();
      return { ok: false, error: SCHEMA_MESSAGE };
    }
    return { ok: false, error: error.message || 'Could not push the change.' };
  }
  // Only once the server took it. The GM's own views read the published row, which doesn't change
  // until the player's app applies this and re-publishes — so remember the push and show it in the
  // meantime, with the "not picked up yet" chip. A REFUSED push records nothing, so the GM is never
  // shown a change that isn't on the server. It carries WHOSE character it is, so the one read every
  // surface goes through can keep the overlay off the editor's own card (gmSync.gmPendingEdit).
  rememberGmEdit(campaignId, charId, sheet, pushedAt, base.stamp, playerOwnerId, base.hash, on);
  return { ok: true, value: null };
}

/**
 * GM: the edits this campaign still has waiting for its players, so the pending overlay survives a
 * reload and reaches the GM's other devices.
 *
 * Readable because `gce_gm_write` is `for all` (SELECT included) for the campaign's owner — no new
 * policy, nothing for the owner to re-run.
 *
 * A read that FAILED returns early and changes nothing (UNKNOWN is not EMPTY). A read that SUCCEEDED
 * is an answer about the whole campaign, so it both adds and PRUNES: a row the player's app has
 * applied and deleted is gone from the server, and its "waiting" chip has to go with it. Without the
 * prune the party page had no way at all of clearing a chip — it could only ever grow.
 */
export async function fetchPendingGmEdits(campaignId: string): Promise<void> {
  if (!supabase || !campaignId) return;
  // OUR OWN edits, and only ours. The overlay is a private view of a change this account has not
  // told the player about, so it is bound to the account that pushed it (the store is keyed by that
  // uid — see gmSync.setGmPendingAccount) and a co-GM's row is not something we re-draw as "ours".
  const me = await currentUserId();
  if (!me) return;
  setGmPendingAccount(me);
  // Taken BEFORE the read: an edit pushed while it was in flight is newer than the answer, not
  // missing from it, and comparing the entries themselves says so without involving any clock.
  const before = snapshotGmPending(campaignId);
  const client = supabase;
  try {
    const { data, error } = await selectWithOptional<Record<string, unknown>[]>(
      (cols) =>
        client
          .from('gm_character_edits')
          // `owner_id` comes back so a seeded edit knows whose character it is — the overlay is never
          // drawn on the editor's own card, and a row read back from the server must not be the one
          // exception to that (see gmSync.gmPendingEdit). `gm_base` is what PROVES a seeded edit, so
          // his next push can be built on it like any he made here.
          .select(cols)
          .eq('campaign_id', campaignId)
          .eq('editor_id', me) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
      'char_id,owner_id,sheet,updated_at',
      'gm_base',
    );
    if (error || !data) return;
    reconcileGmPendingEdits(
      campaignId,
      data
        .filter((r) => !!r.sheet)
        .map((r): PendingGmEdit => {
          const pushedAt = (r.updated_at as string) ?? '';
          const bound = boundGmBase({ updatedAt: pushedAt, gmBase: parseGmBase(r.gm_base) });
          return {
            campaignId,
            charId: r.char_id as string,
            sheet: r.sheet as SavedChar,
            pushedAt,
            baseUpdatedAt: bound?.stamp,
            baseHash: bound?.hash,
            ownerId: (r.owner_id as string | undefined) ?? undefined,
          };
        }),
      before,
    );
  } catch {
    /* best-effort */
  }
}

let warnedNoGmBase = false;

/**
 * Player: any GM edits pending for MY characters (judged on sync). Empty on any error.
 *
 * FAILS CLOSED (F1, 2026-10): `gm_base` is what proves an edit loses nothing of theirs, so a database
 * without the column answers nothing at all — no edit is applied, consumed or deleted, and they wait
 * there until supabase-campaign-characters.sql is re-run.
 */
export async function fetchGmEdits(): Promise<GmEdit[]> {
  if (!supabase) return [];
  const me = await currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('gm_character_edits')
    .select('campaign_id,char_id,sheet,updated_at,gm_base')
    .eq('owner_id', me);
  if (error && isMissingColumn(error, 'gm_base') && !warnedNoGmBase) {
    warnedNoGmBase = true;
    console.warn(
      '[HeavesParty] gm_character_edits has no gm_base column — GM edits wait until supabase-campaign-characters.sql is re-run.',
    );
  }
  if (error || !data) return [];
  return data.map((r) => gmEditFromRow(r as Record<string, unknown>));
}

/**
 * Player: drop a GM edit once it has been handled. Returns HOW MANY rows the delete removed (null on
 * error/unreachable, or when the row is already gone). Under RLS a missing `gce_owner_delete` policy
 * makes the delete "succeed" while removing NOTHING — which left the row re-applying on every poll
 * tick forever — so the caller wants to see the 0, not a void.
 *
 * CONDITIONED on the judged row's own stamp (F1, 2026-10): a NEWER push of the GM's that replaced the
 * row meanwhile must survive to be judged next, never be deleted unseen. If that filter removes
 * nothing, the row is read back once: still the same push (the filter's spelling of the stamp, not a
 * newer push, was why) → it is deleted on the stamp exactly as the read-back spelled it; a newer push →
 * left alone. Never an unconditioned delete: a push landing after the read-back must survive too.
 */
export async function deleteGmEdit(campaignId: string, charId: string, updatedAt?: string): Promise<number | null> {
  if (!supabase) return null;
  const client = supabase;
  try {
    let q = client.from('gm_character_edits').delete().eq('campaign_id', campaignId).eq('char_id', charId);
    if (updatedAt) q = q.eq('updated_at', updatedAt);
    const { data, error } = await q.select('char_id');
    if (error) return null;
    const n = data?.length ?? 0;
    if (n > 0 || !updatedAt) return n;
    const { data: row, error: readError } = await client
      .from('gm_character_edits')
      .select('updated_at')
      .eq('campaign_id', campaignId)
      .eq('char_id', charId)
      .maybeSingle();
    if (readError) return null; // unknown, not "removed nothing": no RLS warning for a network blip
    if (!row) return null; // already gone — nothing to say
    const stored = (row as { updated_at?: string }).updated_at;
    if (!stored || !sameInstant(stored, updatedAt)) return 0; // a newer push: leave it
    // Still conditioned — on the stamp as the SERVER spelled it. A newer push of his can land between
    // the read-back and this delete (back-to-back tracker gestures), and an unconditioned delete removed
    // it unjudged: no apply, no receipt, nothing on either screen.
    // F1 (2026-10-09): test/party-publish-queue.test.ts "the A3 fallback never deletes a newer push".
    const again = await client
      .from('gm_character_edits')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('char_id', charId)
      .eq('updated_at', stored)
      .select('char_id');
    if (again.error) return null;
    return again.data?.length ?? 0;
  } catch {
    return null; /* best-effort */
  }
}

/**
 * Player: the refusal RECEIPT — "my app refused the GM push stamped `rowUpdatedAt`" — written on their
 * own published row, one column and nothing else (the sheet is never re-sent from here). The GM's app
 * reads it to stand his overlay down and say "not applied" (gmSync.noteGmReceipt).
 *
 * True only when the UPDATE landed. F1 (2026-10-09): this used to swallow every failure and resolve
 * the same either way (it never even read supabase's `{ error }`), and the caller had already consumed
 * the row — so one blip meant the GM was never told: his overlay stood down at their next publish and
 * no screen ever said "not applied". The caller now consumes a refused row only once this says true
 * (App.tsx); otherwise the row is judged, and receipted, again on the next event.
 */
export async function markGmEditRefused(campaignId: string, charId: string, rowUpdatedAt: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('campaign_characters')
      .update({ gm_refused_at: rowUpdatedAt })
      .eq('campaign_id', campaignId)
      .eq('char_id', charId);
    return !error;
  } catch {
    return false;
  }
}

/** Player: subscribe (Supabase Realtime) to GM edits landing for MY characters, so a GM's change
 *  applies the INSTANT they push it — as long as this app is open. `onEdit` fires on any insert/update
 *  of a row this user owns (RLS scopes the stream to their own rows); the caller then pulls + applies.
 *  DELETE is intentionally not watched, so the player's own post-apply delete doesn't re-trigger.
 *  Returns an unsubscribe fn; no-op when signed out / cloud not configured. The open/focus pull in the
 *  app stays as the fallback for when the app was closed while the GM edited. */
export function subscribeGmEdits(playerId: string, onEdit: () => void, onLive?: (live: boolean) => void): () => void {
  if (!supabase || !playerId) {
    onLive?.(false);
    return () => {};
  }
  const client = supabase;
  const filter = `owner_id=eq.${playerId}`;
  const channel = client
    .channel(`gm-edits:${playerId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gm_character_edits', filter }, () => onEdit())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gm_character_edits', filter }, () => onEdit())
    .subscribe((status) => {
      // Realtime doesn't replay events missed while disconnected, and the initial connect can fail. Fire
      // a pull on every successful (re)subscribe — the initial connect AND each auto-rejoin after a drop —
      // so nothing is silently missed while the app stays open and focused. apply() is idempotent.
      if (status === 'SUBSCRIBED') onEdit();
      // Whether the live stream is actually up. A project whose `gm_character_edits` never made it into
      // the supabase_realtime publication (an older setup script, a restored database) fails here — and
      // the only symptom used to be that a GM's change appeared when the player next focused the app,
      // which reads as "the sync lags". The caller polls while this is false; see App.
      onLive?.(status === 'SUBSCRIBED');
    });
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * Subscribe to ONE published character — the one whose sheet is currently open.
 *
 * `subscribeParty` watches the whole campaign and drives the CARDS; this watches a single row so an
 * open sheet can follow the player's edits live. Without it, the sheet a GM opens is a snapshot from
 * the moment they tapped the card: the player could take twenty damage and the GM would keep reading
 * their old hit points for the rest of the session.
 *
 * No-op when signed out / cloud not configured; returns an unsubscribe fn.
 */
export function subscribeMemberSheet(campaignId: string, charId: string, onChange: () => void): () => void {
  if (!supabase || !campaignId || !charId) return () => {};
  const client = supabase;
  const channel = client
    .channel(`member:${campaignId}:${charId}`)
    // Postgres-changes filters take a single equality, so this narrows to the character and the
    // campaign is re-checked by the caller's fetch (a char_id is unique per campaign in practice).
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'campaign_characters', filter: `char_id=eq.${charId}` },
      () => onChange(),
    )
    .subscribe((status) => {
      // Realtime replays nothing missed while disconnected, so re-pull on every successful (re)join.
      if (status === 'SUBSCRIBED') onChange();
    });
  return () => {
    void client.removeChannel(channel);
  };
}

/** Subscribe (Supabase Realtime) to a campaign's party changes — any member publishing/updating/
 *  unpublishing a character, or a kick. `onChange` fires so the caller can refetch the party live.
 *  Needs `campaign_characters` in the supabase_realtime publication (supabase-campaign-characters.sql).
 *  No-op when signed out / cloud not configured; returns an unsubscribe fn. */
export function subscribeParty(campaignId: string, onChange: () => void): () => void {
  if (!supabase || !campaignId) return () => {};
  const client = supabase;
  const channel = client
    .channel(`party:${campaignId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'campaign_characters', filter: `campaign_id=eq.${campaignId}` },
      () => onChange(),
    )
    .subscribe((status) => { if (status === 'SUBSCRIBED') onChange(); }); // Realtime replays nothing missed while disconnected, so re-pull on every successful (re)join — this is the only retry a party read that failed (offline, a blip) ever gets.
  return () => {
    void client.removeChannel(channel);
  };
}
