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
