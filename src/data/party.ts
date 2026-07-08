// Party data layer — publish a character to the campaigns it's attached to, and read the party back.
// The campaign itself lives in `campaigns`; the attached characters live in `campaign_characters`
// (see supabase-campaign-characters.sql). All calls degrade to no-op/empty when signed out or the
// table is missing, so the rest of the app never has to special-case it.
import { supabase } from './supabase';
import type { PartySummary } from '../sheet/partySummary';
import type { Character } from '../rules/types';
import type { CampaignResult } from './campaigns';

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

/** Publish (upsert) one character into one campaign. Silent on failure — publishing is best-effort. */
export async function publishCharacter(
  campaignId: string,
  charId: string,
  name: string,
  summary: PartySummary,
  sheet: Character,
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

/** The full (read-only) sheet for a party member — fetched lazily when a card is tapped. */
export async function fetchMemberSheet(campaignId: string, charId: string): Promise<Character | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('campaign_characters')
    .select('sheet')
    .eq('campaign_id', campaignId)
    .eq('char_id', charId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.sheet ?? null) as Character | null;
}
