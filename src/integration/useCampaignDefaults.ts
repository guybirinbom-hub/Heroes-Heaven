import { useEffect, useState } from 'react';
import { fetchCampaignByCode, type CampaignDefaults, type CampaignMembership } from '../data/campaigns';
import { loadLocalDefaults } from './localCampaignDefaults';

/**
 * The campaign's default rules — what it says about variant rules and sources.
 *
 * `CampaignMembership` (what this view is handed) deliberately carries only id/code/role/name: its
 * own comment says the authoritative defaults are "refetched by code when opened", because a GM can
 * change them and every player must see the change. So the tracker has to go and ask.
 *
 * Starts from this device's copy so a device-only campaign (testing without login, where the fetch
 * can only ever fail) still has its rules, then upgrades to the server's answer if there is one.
 * A failed fetch leaves the local copy in place rather than blanking it — the rules a GM can see in
 * the settings page are the rules the tracker should use.
 *
 * Part of the removable seam; see ./README.md.
 */
export function useCampaignDefaults(m: CampaignMembership): CampaignDefaults | null {
  const [defaults, setDefaults] = useState<CampaignDefaults | null>(() => loadLocalDefaults(m.id));

  useEffect(() => {
    // OFFLINE (ruling 3's no-account table): there is no campaign and no session, so this is the one
    // server leg left in the seam for it. It was reaching Supabase and being turned back only by
    // LOCAL_TABLE's empty `code` hitting normalizeCode — i.e. by a field nobody would think of as
    // load-bearing. Say it here, where the reason is visible.
    if (m.local) return;
    let cancelled = false;
    void fetchCampaignByCode(m.code).then((res) => {
      if (cancelled || !res.ok) return; // offline / device-only → keep what we loaded locally
      setDefaults(res.value.defaults);
    });
    return () => {
      cancelled = true;
    };
  }, [m.code, m.id, m.local]);

  return defaults;
}
