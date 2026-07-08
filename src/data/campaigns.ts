// Campaigns — GM-created, shareable-by-code play groups (cloud-only; needs a signed-in account).
//
// The campaign itself (name, description, GM defaults) lives in the shared Supabase `campaigns` table
// (see supabase-campaigns.sql) so a player on a different account can fetch it by code. A user's
// MEMBERSHIP list (which campaigns they're in, as GM or player) lives in their own synced bundle
// (storage.ts CAMPAIGNS_KEY) so it follows them across their devices. Everything degrades gracefully
// when Supabase isn't configured/reachable or the table hasn't been created yet.
import { supabase } from './supabase';
import type { VariantRules } from '../rules/types';

/** The campaign-level setup a GM picks — mirrors the character Setup page; a new character in the
 *  campaign can inherit these. Deliberately the campaign-scoped subset of a build's config. */
export interface CampaignDefaults {
  variantRules?: VariantRules;
  enabledSources?: string[];
  mythicEnabled?: boolean;
  kingmakerEnabled?: boolean;
}

/** A campaign as stored in the shared table. */
export interface Campaign {
  id: string;
  code: string;
  ownerId: string;
  name: string;
  description: string;
  defaults: CampaignDefaults;
}

/** A user's membership — stored in their synced bundle, NOT the shared table. Caches display fields
 *  so the list renders offline; the authoritative campaign (defaults) is refetched by code when opened. */
export interface CampaignMembership {
  id: string;
  code: string;
  role: 'gm' | 'player';
  name: string;
  description?: string;
  /** The player's answer to "use this campaign's default setup?", captured on join. */
  useDefaults?: boolean;
}

export type CampaignResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Unambiguous code alphabet — no 0/O, 1/I/L, so a shared code is easy to read + type.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A random share code (6 chars from the unambiguous alphabet). Collisions are caught on insert. */
export function genCampaignCode(len = 6): string {
  let out = '';
  const buf =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto.getRandomValues(new Uint32Array(len))
      : null;
  for (let i = 0; i < len; i++) {
    const r = buf ? buf[i] : Math.floor(Math.random() * 0xffffffff);
    out += CODE_CHARS[r % CODE_CHARS.length];
  }
  return out;
}

/** Normalize a typed code for lookup (uppercase, strip spaces/dashes). */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, '');
}

function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message || '';
  if (/PGRST205|Could not find the table|does not exist|schema cache/i.test(msg))
    return "Campaigns aren't set up on the server yet. Ask the app owner to run the campaigns SQL.";
  if (/JWT|not authenticated|Auth session/i.test(msg)) return 'Your session expired — sign in again.';
  return msg || 'Something went wrong. Please try again.';
}

interface CampaignRow {
  id: string;
  code: string;
  owner_id: string;
  name: string;
  description: string | null;
  defaults: CampaignDefaults | null;
}

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    code: row.code,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description ?? '',
    defaults: (row.defaults ?? {}) as CampaignDefaults,
  };
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** GM: create a campaign, retrying on the (rare) code collision. */
export async function createCampaign(
  name: string,
  description: string,
  defaults: CampaignDefaults,
): Promise<CampaignResult<Campaign>> {
  if (!supabase) return { ok: false, error: 'Sign in to use campaigns.' };
  const uid = await currentUserId();
  if (!uid) return { ok: false, error: 'Sign in to use campaigns.' };
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genCampaignCode();
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ code, owner_id: uid, name: name.trim() || 'Untitled campaign', description: description.trim(), defaults })
      .select()
      .single();
    if (!error && data) return { ok: true, value: rowToCampaign(data as CampaignRow) };
    if (error?.code === '23505') continue; // unique_violation on code → try another
    return { ok: false, error: friendlyError(error) };
  }
  return { ok: false, error: 'Could not generate a unique code — please try again.' };
}

/** Player: look up a campaign by its share code. */
export async function fetchCampaignByCode(code: string): Promise<CampaignResult<Campaign>> {
  if (!supabase) return { ok: false, error: 'Sign in to use campaigns.' };
  const norm = normalizeCode(code);
  if (!norm) return { ok: false, error: 'Enter a campaign code.' };
  const { data, error } = await supabase.from('campaigns').select('*').eq('code', norm).maybeSingle();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data) return { ok: false, error: 'No campaign with that code — double-check it with your GM.' };
  return { ok: true, value: rowToCampaign(data as CampaignRow) };
}

/** GM: edit name / description / defaults. */
export async function updateCampaign(
  id: string,
  patch: { name?: string; description?: string; defaults?: CampaignDefaults },
): Promise<CampaignResult<Campaign>> {
  if (!supabase) return { ok: false, error: 'Sign in to use campaigns.' };
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) upd.name = patch.name.trim() || 'Untitled campaign';
  if (patch.description !== undefined) upd.description = patch.description.trim();
  if (patch.defaults !== undefined) upd.defaults = patch.defaults;
  const { data, error } = await supabase.from('campaigns').update(upd).eq('id', id).select().single();
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, value: rowToCampaign(data as CampaignRow) };
}

/** GM: delete a campaign (owner-only via RLS). Players just remove their local membership. */
export async function deleteCampaign(id: string): Promise<CampaignResult<null>> {
  if (!supabase) return { ok: false, error: 'Sign in to use campaigns.' };
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, value: null };
}
