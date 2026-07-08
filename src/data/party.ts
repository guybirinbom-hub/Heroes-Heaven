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

/** Player: drop a GM edit once it's been applied. */
export async function deleteGmEdit(campaignId: string, charId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('gm_character_edits').delete().eq('campaign_id', campaignId).eq('char_id', charId);
  } catch {
    /* best-effort */
  }
}
