// Campaigns the server has PROVEN this account can no longer publish to — its GM deleted it ('gone'),
// or the GM removed this player from it ('removed'). Learned from a failed publish (party.ts
// publishCharacter → 'gone' / 'refused'); App's publish effect stops sending there, and the campaign's
// card says why, with Leave as the way out.
//
// Memory only, for this session on this device. Nothing here is saved, synced or taken off a character:
// the character keeps its `campaignIds` until the player presses Leave. A fresh launch forgets every mark
// and the first publish asks the server again — so a campaign that comes back (a GM who lets a player in
// again) is never hidden for good. A later publish that LANDS clears the mark at once (App).
//
// UNKNOWN IS NOT GONE: only the two proven answers make a mark. A failed read, a timeout, a signed-out
// read or any other error leaves the campaign unmarked, and App keeps retrying it as before.
import { useSyncExternalStore } from 'react';

export type CampaignGoneReason = 'gone' | 'removed';

let marks: ReadonlyMap<string, CampaignGoneReason> = new Map();
const listeners = new Set<() => void>();

function set(next: ReadonlyMap<string, CampaignGoneReason>): void {
  marks = next;
  for (const l of listeners) l();
}

export function campaignGoneReason(campaignId: string): CampaignGoneReason | undefined {
  return marks.get(campaignId);
}

export function markCampaignGone(campaignId: string, reason: CampaignGoneReason): void {
  if (marks.get(campaignId) === reason) return;
  set(new Map(marks).set(campaignId, reason));
}

/** True when there was a mark to clear. */
export function clearCampaignGone(campaignId: string): boolean {
  if (!marks.has(campaignId)) return false;
  const next = new Map(marks);
  next.delete(campaignId);
  set(next);
  return true;
}

/** Drop every mark of a campaign no character on this device is in any more: once the player has left,
 *  joining again with the code must send again (and ask the server again), not stay silenced. */
export function keepCampaignGoneFor(heldIds: ReadonlySet<string>): void {
  if ([...marks.keys()].every((id) => heldIds.has(id))) return;
  set(new Map([...marks].filter(([id]) => heldIds.has(id))));
}

/** Forget every mark — another account signed in ("removed" is about one account). */
export function clearAllCampaignGone(): void {
  if (marks.size) set(new Map());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The mark for one campaign, re-rendering when it changes. */
export function useCampaignGone(campaignId: string): CampaignGoneReason | undefined {
  return useSyncExternalStore(subscribe, () => marks.get(campaignId), () => undefined);
}
