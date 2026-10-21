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
    const ids = (p.build ?? p.character).campaignIds; // a build-less present entry: its character's
    const build = c.build && !sameIds(c.build.campaignIds, ids) ? { ...c.build, campaignIds: ids } : c.build;
    const character = sameIds(c.character.campaignIds, p.character.campaignIds) ? c.character : { ...c.character, campaignIds: p.character.campaignIds };
    if (build === c.build && character === c.character) return c;
    changed = true;
    return { ...c, character, build };
  });
  return changed ? out : next;
}
