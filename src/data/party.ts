// Party data layer — publish a character to the campaigns it's attached to, and read the party back.
// The campaign itself lives in `campaigns`; the attached characters live in `campaign_characters`
// (see supabase-campaign-characters.sql). All calls degrade to no-op/empty when signed out or the
// table is missing, so the rest of the app never has to special-case it.
import { supabase } from './supabase';
import type { PartySummary } from '../sheet/partySummary';
import type { SavedChar } from './storage';
import type { CampaignResult } from './campaigns';

/** A pending GM edit for one of the current user's characters (applied silently on sync). */
export interface GmEdit {
  campaignId: string;
  charId: string;
  sheet: SavedChar;
  updatedAt: string;
}

export interface PartyMember {
  ownerId: string;
  charId: string;
  name: string;
  summary: PartySummary;
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

/** The party for a campaign — small summaries for the cards. Empty on any error. */
export async function fetchParty(campaignId: string): Promise<PartyMember[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('campaign_characters')
    .select('owner_id,char_id,name,summary')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error || !data) return [];
  return data.map((r) => ({
    ownerId: r.owner_id as string,
    charId: r.char_id as string,
    name: (r.name as string) || 'Unnamed',
    summary: (r.summary ?? {}) as PartySummary,
  }));
}

/** The full published character (SavedChar: character + build + play) for a party member — fetched
 *  lazily when a card is tapped. Used for the read-only view and for GM editing. */
export async function fetchMemberSheet(campaignId: string, charId: string): Promise<SavedChar | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('campaign_characters')
    .select('sheet')
    .eq('campaign_id', campaignId)
    .eq('char_id', charId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.sheet ?? null) as SavedChar | null;
}

/** GM: push an edited copy of a member's character. Their app applies it on its next sync — silently.
 *  Requires the caller to own the campaign (enforced by RLS). */
export async function pushGmEdit(
  campaignId: string,
  charId: string,
  playerOwnerId: string,
  sheet: SavedChar,
): Promise<CampaignResult<null>> {
  if (!supabase) return { ok: false, error: 'Sign in to edit a player.' };
  const editor = await currentUserId();
  if (!editor) return { ok: false, error: 'Sign in to edit a player.' };
  const { error } = await supabase.from('gm_character_edits').upsert({
    campaign_id: campaignId,
    char_id: charId,
    owner_id: playerOwnerId,
    editor_id: editor,
    sheet,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message || 'Could not push the change.' };
  return { ok: true, value: null };
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
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
