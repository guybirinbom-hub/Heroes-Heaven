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
    let cancelled = false;
    void fetchCampaignByCode(m.code).then((res) => {
      if (cancelled || !res.ok) return; // offline / device-only → keep what we loaded locally
      setDefaults(res.value.defaults);
    });
    return () => {
      cancelled = true;
    };
  }, [m.code, m.id]);

  return defaults;
}
