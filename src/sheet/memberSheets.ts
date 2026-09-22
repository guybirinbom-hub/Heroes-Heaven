/*
 * A CAMPAIGN'S MEMBER SHEETS, KEPT LIVE — and the one summary every card draws from them.
 *
 * This used to live inside the tracker seam (../integration/pcSheetTruth.ts), which imports the
 * tracker's combat store. That put it behind the lazy tracker chunk, so the PLAIN party surfaces —
 * a character's Party button (./PartyPage.tsx, a page PLAYERS open) and the GM's campaign detail
 * (./CampaignsPage.tsx) — could not reach it without dragging the whole tracker into the main
 * bundle. They drew `campaign_characters.summary` raw instead: the PLAYER's own verdict, computed
 * on the player's device against the PLAYER's content database, while the sheet a card opens is
 * re-derived here. Encumbered comes out of item Bulk, so those two part company the moment the two
 * databases do — the owner's own report, from the surfaces the fix for it never reached.
 *
 * Nothing in this file knows the tracker exists. The seam re-exports it, so its own imports and the
 * chunk split are unchanged.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { applyPlayState } from '../rules/play';
import { fetchMemberSheet, subscribeMemberSheet, type PartyMember } from '../data/party';
import { gmPendingEdit, gmPendingVersion, subscribeGmPending } from './gmSync';
import { memberSummary, type PartySummary } from './partySummary';
import type { SavedChar } from '../data/storage';
import type { Character, ContentDatabase } from '../rules/types';

/** What the sheet SHOWS: the build with play overlaid (damage taken, conditions in effect). */
export function livePlay(sheet: SavedChar, content: ContentDatabase): Character {
  try {
    return applyPlayState(sheet.character, sheet.play, content);
  } catch {
    return sheet.character;
  }
}

/**
 * THE ONE SUMMARY every surface draws for a member whose SHEET this device holds — GM or player.
 *
 * Here, taking the whole member, rather than written out at each call site: the published summary
 * is not an optional extra the caller may decide to withhold. It was withheld while a GM edit of
 * ours was pending, and that re-created the owner's own report for the length of the pending window
 * — the "Encumbered" only the PLAYER's app can work out (their content database, their item Bulk)
 * vanished from the cards and the sheet the moment the GM pressed Update. Only DERIVED chips are
 * ever carried, every surface locks those, so there is not one a GM edit could have taken off; what
 * the player's app derives changes when the PLAYER publishes again, and until then it is still true.
 *
 * It was `gmMemberSummary` while the GM's surfaces were the only ones that had it. A teammate's
 * device holds the same two halves and owes the same answer, so the party page — a page PLAYERS
 * open — reads through here too. There is nothing GM-private in it: the pending overlay a GM's
 * sheet may carry is put there by the read
 * (../data/party.ts → resolvePendingGmEdit) and that store only ever answers the account that
 * pushed, so a player's device has no overlay to fold in.
 */
export function memberCardSummary(mem: PartyMember, sheet: SavedChar, content: ContentDatabase): PartySummary {
  return memberSummary(livePlay(sheet, content), content, mem.summary);
}

/**
 * Every member's published sheet, kept live.
 *
 * One subscription per member, exactly as the member viewer keeps ONE open sheet live — the GM is
 * looking at the whole party at once here, so all of them have to follow.
 *
 * Pass `''` for the campaign (or an empty list) to switch the whole hook off — a host that already
 * holds the sheets must not fetch and subscribe to them a second time.
 */
export function useMemberSheets(campaignId: string, members: PartyMember[]): Map<string, SavedChar> {
  const [sheets, setSheets] = useState<Map<string, SavedChar>>(() => new Map());
  const ids = members.map((m) => m.charId).join(',');
  const pendingVersion = useSyncExternalStore(subscribeGmPending, gmPendingVersion, gmPendingVersion);
  // The list as it stands right now, so a response for a member who has since left the party is
  // dropped instead of re-adding them. (It replaces the per-effect `cancelled` flag, which no longer
  // works now that the pull outlives any one effect.)
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const pull = useCallback(
    (charId: string) => {
      void fetchMemberSheet(campaignId, charId).then((s) => {
        if (!s?.character || !idsRef.current.split(',').includes(charId)) return;
        // Skip an identical re-publish so an echo doesn't re-render the whole party.
        setSheets((prev) => (JSON.stringify(prev.get(charId)) === JSON.stringify(s) ? prev : new Map(prev).set(charId, s)));
      });
    },
    [campaignId],
  );
  /*
   * THE SUBSCRIPTIONS — one channel per member, and nothing about a GM's own edit belongs in here.
   *
   * `pendingVersion` used to be a dep of this effect, which meant every Update AND every point of
   * damage the GM applied (pushVitals → pushGmEdit → rememberGmEdit) tore down and instantly re-joined
   * one channel per member, each on the same deterministic topic, with the leave still in flight.
   * Mid-combat that is N leave/join pairs per damage entry on identical topic names — and a Realtime
   * feed that quietly stops delivering is precisely the "the GM is looking at stale data" fault this
   * whole change exists to remove.
   */
  useEffect(() => {
    if (!campaignId || !ids) return;
    const unsubs = ids.split(',').map((charId) => {
      pull(charId);
      return subscribeMemberSheet(campaignId, charId, () => pull(charId));
    });
    return () => {
      for (const u of unsubs) u();
    };
  }, [campaignId, ids, pull]);
  /*
   * The re-PULL, and only the re-pull — for the ONE character whose pending edit actually moved.
   *
   * A GM's own Update doesn't touch `campaign_characters`, so no Realtime event ever arrives for it
   * and this map would keep answering with the pre-edit sheet until the player's device came online.
   * `fetchMemberSheet` overlays the pending edit (src/data/party.ts); this is what makes it re-ask.
   *
   * It also closes a clobber door on the way past: the tracker seam's `pushVitals`
   * (../integration/pcSheetTruth.ts) re-bases on the overlaid sheet, so a damage push that arrived
   * while a sheet edit was still pending used to be built on the published (pre-edit) sheet and
   * upserted over the GM's own waiting row, silently dropping it.
   *
   * ⚠ The counter is campaign-wide, so a bare re-run of this refetched EVERY member on every push —
   * and every single point of damage is a push. That is N HTTP reads per damage entry mid-combat,
   * and a drop inside one of them bumps the counter again and re-runs the whole fan-out. The stamp
   * of each member's own pending edit is what changed or didn't, so only that member is re-read.
   */
  const pendingSig = useRef(new Map<string, string>());
  useEffect(() => {
    if (!campaignId || !ids) return;
    for (const charId of ids.split(',')) {
      const sig = gmPendingEdit(campaignId, charId)?.pushedAt ?? '';
      const had = pendingSig.current.get(charId);
      pendingSig.current.set(charId, sig);
      // A member we have never tracked is not a member whose edit MOVED. The effect above runs on
      // the same pass for exactly these ids and pulls each of them, and `fetchMemberSheet` already
      // overlays whatever is pending — so pulling again here was a second read, per member, of a row
      // that was already on its way. (`undefined` and `''` are different answers: "we have never
      // looked" is not "there is no edit".)
      if (had === undefined || had === sig) continue;
      pull(charId);
    }
  }, [campaignId, ids, pendingVersion, pull]);
  return sheets;
}
