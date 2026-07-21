import type { CampaignDefaults } from '../data/campaigns';
import { TEST_CAMPAIGNS_WITHOUT_LOGIN } from './enabled';

/*
 * A campaign's default rules, on THIS DEVICE.
 *
 * WHY: every function in data/campaigns.ts starts `if (!supabase) return { ok: false, error: 'Sign
 * in to use campaigns.' }` — the defaults live in a Supabase row and are, by design, re-fetched by
 * code when a campaign opens. A campaign created while testing without login exists nowhere but this
 * browser, so that fetch answers "No campaign with that code", `loadedDefaults` never flips true,
 * and the settings page silently renders only Name and Description: no Sources, no variant rules.
 * That's the whole bug.
 *
 * This is the local stand-in. It is deliberately NOT in data/campaigns.ts: that module is Heroes
 * Heaven's, the server is its source of truth, and a local cache there would start answering for
 * REAL campaigns too — masking a failed fetch with stale rules is far worse than showing an error.
 * Here it stays part of the removable seam and gated on the testing flag.
 *
 * ⚠ TESTING SHIM. Whatever a GM saves here reaches no player: the real flow writes the campaign row
 * that everyone else reads. Signed in, the server always wins and none of this runs.
 */

const KEY = 'pf2e-codex.local-campaign-defaults';

type Store = Record<string, CampaignDefaults>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Store) : {};
  } catch {
    return {};
  }
}

/** This device's copy of a campaign's defaults, or null if it has none. */
export function loadLocalDefaults(campaignId: string): CampaignDefaults | null {
  if (!TEST_CAMPAIGNS_WITHOUT_LOGIN) return null;
  return read()[campaignId] ?? null;
}

export function saveLocalDefaults(campaignId: string, defaults: CampaignDefaults): void {
  if (!TEST_CAMPAIGNS_WITHOUT_LOGIN) return;
  try {
    const all = read();
    all[campaignId] = defaults;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota — a testing shim isn't worth throwing over */
  }
}

export function deleteLocalDefaults(campaignId: string): void {
  try {
    const all = read();
    if (!(campaignId in all)) return;
    delete all[campaignId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
