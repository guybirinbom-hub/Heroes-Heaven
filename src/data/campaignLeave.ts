// Campaigns belong to a CHARACTER (owner, 2026-10-21): "i want campigns to be character specific so i
// dont see all of the campins all my characters are in on every character", and leaving asks first,
// then removes the campaign from that character — "the point is so that the player dont exit the
// campign by mistake … if you are not in then you dont need to see that campaign anymore". Coming back
// is joining again with the code. One home for the three rules, so the Setup card, the Party page and
// App can't drift apart: which campaigns a character shows, what Leave asks, and what Leave changes.
import type { CampaignMembership } from './campaigns';
import type { SavedChar } from './storage';
import type { ConfirmOptions } from '../sheet/confirm';

/** The campaigns ONE character is in, in its own order. An id whose membership this device hasn't got
 *  (not synced here yet) still shows, under a placeholder name — unknown is not "not in it". */
export function campaignsOfCharacter(campaignIds: readonly string[] | undefined, memberships: readonly CampaignMembership[]): CampaignMembership[] {
  const byId = new Map(memberships.map((m) => [m.id, m]));
  return [...new Set(campaignIds ?? [])].map((id) => byId.get(id) ?? { id, code: '', role: 'player' as const, name: 'Campaign' });
}

/** The question Leave asks, the same words on the Setup card and the Party page. */
export function leaveCampaignQuestion(m: Pick<CampaignMembership, 'name' | 'role'>, characterName: string | undefined): ConfirmOptions {
  const who = characterName?.trim() || 'This character';
  return {
    title: `Leave “${m.name}”?`,
    message:
      m.role === 'gm'
        ? `${who} leaves your campaign’s party. The campaign itself stays. To bring ${who === 'This character' ? 'it' : who} back, enter the campaign’s code in this character’s Setup → Campaigns.`
        : `${who} leaves this campaign and its party, and the campaign is removed from this character. To come back, enter the code from your GM in this character’s Setup → Campaigns.`,
    confirmLabel: 'Leave campaign',
    danger: true,
  };
}

/**
 * What one character leaving a campaign changes: that character is detached (its sheet then comes off
 * the party — App's publish effect unpublishes a campaign it no longer lists), and nothing else is.
 * The account's membership goes only when it is a PLAYER's and no other character of theirs is still in
 * that campaign; a GM's never does (a GM ends a campaign by deleting it on the Campaigns page).
 *
 * `charId` is the roster id of the character leaving, or undefined for one the Builder hasn't created
 * yet (only its draft holds the id, so only the other characters are counted). An archived character
 * still counts as in the campaign: its link is kept, so its membership is too.
 * Returns the same arrays when nothing changes.
 */
export function leaveCampaignFor(
  roster: readonly SavedChar[],
  memberships: readonly CampaignMembership[],
  charId: string | undefined,
  campaignId: string,
): { roster: SavedChar[]; memberships: CampaignMembership[] } {
  const holds = (c: SavedChar) => (c.character.campaignIds ?? []).includes(campaignId) || (c.build?.campaignIds ?? []).includes(campaignId);
  const without = (ids: string[] | undefined) => (ids ?? []).filter((id) => id !== campaignId);
  let changed = false;
  const nextRoster = roster.map((c) => {
    if (c.id !== charId || !holds(c)) return c;
    changed = true;
    return {
      ...c,
      character: { ...c.character, campaignIds: without(c.character.campaignIds) },
      build: c.build ? { ...c.build, campaignIds: without(c.build.campaignIds) } : c.build,
    };
  });
  const stillIn = roster.some((c) => c.id !== charId && holds(c));
  const own = memberships.find((m) => m.id === campaignId);
  const drop = !!own && own.role === 'player' && !stillIn;
  return {
    roster: changed ? nextRoster : (roster as SavedChar[]),
    memberships: drop ? memberships.filter((m) => m.id !== campaignId) : (memberships as CampaignMembership[]),
  };
}

/** The roster with `campaignId` out of every character and build — for a campaign its GM deleted: the
 *  campaign no longer exists, so a character of his still in it showed a nameless "Campaign" with a Leave
 *  button and kept trying to publish there (a checker's finding, 2026-10-21). The same array when no
 *  character held it. */
export function withoutCampaign(roster: readonly SavedChar[], campaignId: string): SavedChar[] {
  let changed = false;
  const next = roster.map((c) => {
    const r = leaveCampaignFor([c], [], c.id, campaignId).roster[0];
    if (r !== c) changed = true;
    return r;
  });
  return changed ? next : (roster as SavedChar[]);
}

/** How long a PLAYER membership no character holds stays before it goes. A join in the Builder puts the
 *  campaign only in the draft until Save, so for minutes the account's other devices see it held by no
 *  character; removing it then undid the join everywhere (a checker's finding, 2026-10-21). */
export const UNHELD_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The memberships less every PLAYER campaign none of the account's characters is in (owner, 2026-10-21:
 * "yes, remove them"). The phone's old Join row joined the ACCOUNT with no character, and now that
 * campaigns are per character such a membership is hidden, with no Leave to reach it, while its shared
 * homebrew kept arriving.
 *  - `rosters`: every copy of the roster the caller has (on disk and in memory); a character in any of
 *    them holds the campaign — archived, or linked only through its build, too.
 *  - `owned`: the campaigns this account owns (from the server). A GM's campaign never goes, and one
 *    stored as 'player' (the old join did that when a GM typed his own code) is a GM's again.
 *  - `seen` → `now`: when this device first saw each one held by no character. One goes only once it has
 *    been that way for UNHELD_GRACE_MS; the returned `seen` holds the ones still waiting.
 *  - `revived`: the synced join stamps (storage.ts loadRevived, `camp:<id>`). A join on ANY device restarts
 *    the wait — a rejoin by code of an old hidden campaign is held only by the Builder's draft until Save,
 *    while this device's own stamp may already be days old (a checker's finding, 2026-10-21).
 * Returns the same memberships array when nothing changes.
 */
export function dropUnheldPlayerCampaigns(
  memberships: CampaignMembership[],
  rosters: readonly (readonly SavedChar[])[],
  owned: ReadonlySet<string>,
  seen: Readonly<Record<string, number>>,
  revived: Readonly<Record<string, number>>,
  now: number,
): { memberships: CampaignMembership[]; seen: Record<string, number> } {
  const held = new Set<string>();
  for (const roster of rosters) for (const c of roster) for (const id of [...(c.character?.campaignIds ?? []), ...(c.build?.campaignIds ?? [])]) held.add(id);
  const nextSeen: Record<string, number> = {};
  let changed = false;
  const out: CampaignMembership[] = [];
  for (const m of memberships) {
    if (owned.has(m.id) && !m.local) {
      if (m.role !== 'gm') changed = true;
      out.push(m.role === 'gm' ? m : { ...m, role: 'gm' });
      continue;
    }
    if (m.role !== 'player' || m.local || held.has(m.id)) {
      out.push(m);
      continue;
    }
    const first = Math.max(seen[m.id] ?? now, revived[`camp:${m.id}`] ?? 0);
    if (now - first >= UNHELD_GRACE_MS) {
      changed = true;
      continue;
    }
    nextSeen[m.id] = first;
    out.push(m);
  }
  return { memberships: changed ? out : memberships, seen: nextSeen };
}

/*
 * UNDO AND REDO NEVER CHANGE WHICH CAMPAIGNS A CHARACTER IS IN (owner, 2026-10-21, answering "Leave in the
 * builder, then Ctrl+Z and Save: the campaign comes back"): leaving goes through the question and coming
 * back through the code, and an undo did either without a word. It put a campaign back whose membership
 * the leave had dropped (the card showed it as "Campaign" and the sheet published to it again), and an
 * undo of a Save that joined took the character out of the party silently. Both undo timelines (App's
 * roster, the Builder's build) hand every undo and redo through these (useUndoableState `keep`).
 */
const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === (b ?? [])[i]);

/** The Builder's build an undo or redo makes, with the present's campaigns. */
export function keepBuildCampaigns<T extends { campaignIds?: string[] }>(next: T, present: T): T {
  return sameIds(next.campaignIds, present.campaignIds) ? next : { ...next, campaignIds: present.campaignIds };
}

/** The roster an undo or redo makes, each character with the campaigns it has now — character and build.
 *  A character the undo brings back (a delete undone) is restored as it was, less any campaign the
 *  account is no longer in (`memberships`: a Leave on another character since may have dropped it — the
 *  "Campaign" placeholder again, and a publish to it; a checker's finding, 2026-10-21). `memberships`
 *  null: not known yet (before this device's first cloud pull) — its campaigns are kept. Returns the same
 *  array when nothing changes. */
export function keepRosterCampaigns(next: SavedChar[], present: SavedChar[], memberships: readonly CampaignMembership[] | null = null): SavedChar[] {
  const now = new Map(present.map((c) => [c.id, c]));
  const held = memberships && new Set(memberships.map((m) => m.id));
  let changed = false;
  const out = next.map((c) => {
    const p = now.get(c.id);
    if (!p) {
      if (!held) return c;
      const inHeld = (ids: string[] | undefined) => (ids ?? []).filter((id) => held.has(id));
      const keepsAll = (ids: string[] | undefined) => sameIds(ids, inHeld(ids));
      if (keepsAll(c.character.campaignIds) && keepsAll(c.build?.campaignIds)) return c;
      changed = true;
      return {
        ...c,
        character: { ...c.character, campaignIds: inHeld(c.character.campaignIds) },
        build: c.build ? { ...c.build, campaignIds: inHeld(c.build.campaignIds) } : c.build,
      };
    }
    const kept = withCampaignsOf(c, p);
    if (kept !== c) changed = true;
    return kept;
  });
  return changed ? out : next;
}

/** `next` in the campaigns `present` is in — character and build; `next` itself when they already match.
 *  Also the import's "Update existing" (owner, 2026-10-21): the file replaces the character but never
 *  takes it out of a party or puts it in one. */
export function withCampaignsOf(next: SavedChar, present: SavedChar): SavedChar {
  const ids = (present.build ?? present.character).campaignIds; // a build-less present entry: its character's
  const build = next.build && !sameIds(next.build.campaignIds, ids) ? { ...next.build, campaignIds: ids } : next.build;
  const character = sameIds(next.character.campaignIds, present.character.campaignIds)
    ? next.character
    : { ...next.character, campaignIds: present.character.campaignIds };
  return build === next.build && character === next.character ? next : { ...next, character, build };
}
