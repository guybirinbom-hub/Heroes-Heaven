import { useMemo } from 'react';
import { loadRoster } from '../data/storage';
import { ownContent } from '../data/carried';
import { computeSummary } from '../sheet/partySummary';
import { applyPlayState } from '../rules/play';
import type { PartyMember } from '../data/party';
import type { ContentDatabase } from '../rules/types';

/*
 * The campaign's players, derived from THIS DEVICE's roster instead of the server.
 *
 * WHY: the real party is published to Supabase, so it needs an account. While testing without
 * login (TEST_CAMPAIGNS_WITHOUT_LOGIN) the party would always be empty — the campaign only exists
 * locally, so nobody ever published to it. This reads the same `campaignIds` link the real flow
 * uses, so the cards show your actual characters with their actual computed summaries.
 *
 * The output is a real PartyMember[], fed to HH's own <PartyMembers localMembers=…>, so the cards,
 * the summaries and the open-sheet behaviour are the genuine ones — not a mock.
 *
 * ⚠ TESTING SHIM. The real thing publishes to the server so every player sees every teammate; this
 * only ever sees characters on this device. Part of the removable seam (src/integration/).
 */
export function useLocalCampaignMembers(campaignId: string, content: ContentDatabase): PartyMember[] {
  return useMemo(() => {
    if (!campaignId) return [];
    return loadRoster()
      // `archived` lives on the SavedChar wrapper, not the Character itself.
      .filter((e) => !e.archived && (e.character.campaignIds ?? []).includes(campaignId))
      .map((e) => {
        // This device's OWN characters, so their own view (../data/carried.ts ownContent): what one
        // carries fills only what this device lacks, and a record deleted here stays deleted.
        const view = ownContent(content, e);
        /*
         * The PLAYED character, as the real publish summarises it (App.tsx: applyPlayState, then
         * computeSummary, both against this view): docs/overrides-redesign.md Building blocks item 7 named
         * this shim's summary-without-play a bypass — its card showed the built HP, not the damage taken.
         * Both lay the character's own content edits over the view themselves (../rules/blocks/content.ts).
         */
        let live = e.character;
        try {
          live = applyPlayState(e.character, e.play, view);
        } catch {
          /* a play state that won't apply: the built character, as before */
        }
        return {
          // No accounts offline: the roster id stands in for both. storage.ts calls it a "unique
          // roster id (distinct from character.id, which can collide on name)" — so it's exactly the
          // stable characterId join we want long term, rather than matching on name.
          ownerId: e.id,
          charId: e.id,
          name: e.character.name,
          summary: computeSummary(live, view),
        };
      });
  }, [campaignId, content]);
}
