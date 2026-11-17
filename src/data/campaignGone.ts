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
// UNKNOWN IS NOT GONE: only the proven answers make a mark. A failed read, a timeout, a signed-out
// read or any other error leaves the campaign unmarked, and App keeps retrying it as before.
//
// ONE CHARACTER (2026-11-17): the GM's Remove takes out one character, not the player (party.ts
// removeCharacterFromCampaign → publish answers 'char-removed'). That mark is keyed by the PAIR
// `campaignId|charId` (charMarkKey) with reason 'char-removed', so only that character stops sending;
// the player's other characters in the same campaign go on as before.
import { useSyncExternalStore } from 'react';

export type CampaignGoneReason = 'gone' | 'removed' | 'char-removed';

/** The key of one character's mark in one campaign — the same `campaignId|charId` App's publish keys use. */
export function charMarkKey(campaignId: string, charId: string): string {
  return `${campaignId}|${charId}`;
}

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
 *  joining again with the code must send again (and ask the server again), not stay silenced. `heldIds`
 *  holds each campaign id AND each `campaignId|charId` pair still held (charMarkKey), so a removed
 *  character's mark goes once that character leaves, even while another character stays in the campaign. */
export function keepCampaignGoneFor(heldIds: ReadonlySet<string>): void {
  if ([...marks.keys()].every((id) => heldIds.has(id))) return;
  set(new Map([...marks].filter(([id]) => heldIds.has(id))));
}

/** A removed character was let back in (party.ts allowCharacterBack: the code entered again, or Leave). App
 *  listens and sends that character again at once, even when nothing in it changed since the GM's Remove
 *  (a checker's finding, 2026-11-17: the code "brought it back" but the party saw it only after an edit). */
const letBackListeners = new Set<(campaignId: string, charId: string) => void>();
export function onCharacterLetBack(l: (campaignId: string, charId: string) => void): () => void {
  letBackListeners.add(l);
  return () => letBackListeners.delete(l);
}
export function characterLetBack(campaignId: string, charId: string): void {
  clearCampaignGone(charMarkKey(campaignId, charId));
  for (const l of letBackListeners) l(campaignId, charId);
}

/** Forget every mark — another account signed in ("removed" is about one account). */
export function clearAllCampaignGone(): void {
  if (marks.size) set(new Map());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The mark for one campaign — or, given the character, the campaign's mark else that character's own —
 *  re-rendering when it changes. */
export function useCampaignGone(campaignId: string, charId?: string): CampaignGoneReason | undefined {
  return useSyncExternalStore(
    subscribe,
    () => marks.get(campaignId) ?? (charId ? marks.get(charMarkKey(campaignId, charId)) : undefined),
    () => undefined,
  );
}
