// Party data layer — publish a character to the campaigns it's attached to, and read the party back.
// The campaign itself lives in `campaigns`; the attached characters live in `campaign_characters`
// (see supabase-campaign-characters.sql). All calls degrade to no-op/empty when signed out or the
// table is missing, so the rest of the app never has to special-case it.
import { supabase } from './supabase';
import type { PartySummary } from '../sheet/partySummary';
import {
  reconcileGmPendingEdits,
  rememberGmEdit,
  resolvePendingGmEdit,
  setGmPendingAccount,
  snapshotGmPending,
  type PendingGmEdit,
  type PublishedRow,
} from '../sheet/gmSync';
import type { SavedChar } from './storage';
import type { CampaignResult } from './campaigns';

/** A pending GM edit for one of the current user's characters (applied silently on sync). */
export interface GmEdit {
  campaignId: string;
  charId: string;
  sheet: SavedChar;
  updatedAt: string;
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
}

export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Publish (upsert) one character into one campaign. `sheet` is the full SavedChar (character + build +
 *  play) so a GM can fully edit it; the read-only party view derives the live character from it. Silent
 *  on failure — publishing is best-effort. */
export async function publishCharacter(
  campaignId: string,
  charId: string,
  name: string,
  summary: PartySummary,
  sheet: SavedChar,
): Promise<void> {
  if (!supabase) return;
  const owner = await currentUserId();
  if (!owner) return;
  try {
    await supabase
      .from('campaign_characters')
      .upsert({ campaign_id: campaignId, owner_id: owner, char_id: charId, name, summary, sheet, updated_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
}

/** Remove a character from a campaign (on detach / delete). */
export async function unpublishCharacter(campaignId: string, charId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('campaign_characters').delete().eq('campaign_id', campaignId).eq('char_id', charId);
  } catch {
    /* best-effort */
  }
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
  const { data, error } = await supabase
    .from('campaign_characters')
    // `updated_at` travels with the card: it is how a card drawn from the GM's own pending edit
    // finds out the player has published since, which is the only thing that clears the chip there.
    .select('owner_id,char_id,name,summary,updated_at')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error || !data) return null;
  return data.map((r) => ({
    ownerId: r.owner_id as string,
    charId: r.char_id as string,
    name: (r.name as string) || 'Unnamed',
    summary: (r.summary ?? {}) as PartySummary,
    updatedAt: (r.updated_at as string | undefined) ?? undefined,
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
  const { data, error } = await supabase
    .from('campaign_characters')
    // `updated_at` comes back too: it is how a pending GM edit finds out the player has published
    // since, which is the one thing that makes the overlay stand down. `summary` rides along for the
    // display side (fetchMemberRow) — it costs nothing extra, it is the same row.
    .select('owner_id,sheet,summary,updated_at')
    .eq('campaign_id', campaignId)
    .eq('char_id', charId)
    .maybeSingle();
  if (error) return null;
  return {
    sheet: (data?.sheet ?? null) as SavedChar | null,
    // WHOSE character this row is. An older `gm_character_edits` row can't say, and an edit nobody
    // can place is one that must never be overlaid on the signed-in account's own character — this
    // column is what the read judges that by (../sheet/gmSync.ts → resolvePendingGmEdit).
    ownerId: (data?.owner_id as string | undefined) ?? undefined,
    summary: (data?.summary ?? undefined) as PartySummary | undefined,
    updatedAt: (data?.updated_at as string | undefined) ?? undefined,
  };
}

/** GM: push an edited copy of a member's character. Their app applies it on its next sync — silently.
 *  Requires the caller to own the campaign (enforced by RLS). */
export async function pushGmEdit(
  campaignId: string,
  charId: string,
  playerOwnerId: string,
  sheet: SavedChar,
  /** `campaign_characters.updated_at` as the caller just read it — the stamp this edit is built on.
   *  Passed rather than read here so it is the value the push was ACTUALLY based on, with no window
   *  in between. See PendingGmEdit.baseUpdatedAt for what it protects. */
  baseUpdatedAt?: string,
): Promise<CampaignResult<null>> {
  if (!supabase) return { ok: false, error: 'Sign in to edit a player.' };
  const editor = await currentUserId();
  if (!editor) return { ok: false, error: 'Sign in to edit a player.' };
  const pushedAt = new Date().toISOString();
  const { error } = await supabase.from('gm_character_edits').upsert({
    campaign_id: campaignId,
    char_id: charId,
    owner_id: playerOwnerId,
    editor_id: editor,
    sheet,
    updated_at: pushedAt,
  });
  if (error) return { ok: false, error: error.message || 'Could not push the change.' };
  // Only once the server took it. The GM's own views read the published row, which doesn't change
  // until the player's app applies this and re-publishes — so remember the push and show it in the
  // meantime, with the "not picked up yet" chip. A REFUSED push records nothing, so the GM is never
  // shown a change that isn't on the server.
  //
  // Bound to the EDITOR first: the overlay is private to the account that pushed it, and the store
  // is keyed by that account so no other sign-in on this browser profile can see it (gmSync.ts).
  setGmPendingAccount(editor);
  // …and it carries WHOSE character it is, so the one read every surface goes through can keep the
  // overlay off the editor's own card (gmSync.gmPendingEdit).
  rememberGmEdit(campaignId, charId, sheet, pushedAt, baseUpdatedAt, playerOwnerId);
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
  try {
    const { data, error } = await supabase
      .from('gm_character_edits')
      // `owner_id` comes back so a seeded edit knows whose character it is — the overlay is never
      // drawn on the editor's own card, and a row read back from the server must not be the one
      // exception to that (see gmSync.gmPendingEdit).
      .select('char_id,owner_id,sheet,updated_at')
      .eq('campaign_id', campaignId)
      .eq('editor_id', me);
    if (error || !data) return;
    reconcileGmPendingEdits(
      campaignId,
      data
        .filter((r) => !!r.sheet)
        .map(
          (r): PendingGmEdit => ({
            campaignId,
            charId: r.char_id as string,
            sheet: r.sheet as SavedChar,
            pushedAt: (r.updated_at as string) ?? '',
            ownerId: (r.owner_id as string | undefined) ?? undefined,
          }),
        ),
      before,
    );
  } catch {
    /* best-effort */
  }
}

/** Player: any GM edits pending for MY characters (to apply on sync). Empty on any error. */
export async function fetchGmEdits(): Promise<GmEdit[]> {
  if (!supabase) return [];
  const me = await currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('gm_character_edits')
    .select('campaign_id,char_id,sheet,updated_at')
    .eq('owner_id', me);
  if (error || !data) return [];
  return data.map((r) => ({
    campaignId: r.campaign_id as string,
    charId: r.char_id as string,
    sheet: (r.sheet ?? null) as SavedChar,
    updatedAt: r.updated_at as string,
  }));
}

/** Player: drop a GM edit once it's been applied. Returns HOW MANY rows the delete removed (null on
 *  error/unreachable). Under RLS a missing `gce_owner_delete` policy makes the delete "succeed"
 *  while removing NOTHING — which left the row re-applying on every poll tick forever — so the
 *  caller wants to see the 0, not a void. */
export async function deleteGmEdit(campaignId: string, charId: string): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('gm_character_edits')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('char_id', charId)
      .select('char_id');
    if (error) return null;
    return data?.length ?? 0;
  } catch {
    return null; /* best-effort */
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
