import { useCampaignGone } from '../data/campaignGone';

/** Says plainly that a campaign of this character's is gone (its GM deleted it), that this player was
 *  removed from it, or (given `charId`) that the GM removed THIS character from it — learned from the server
 *  when a publish there failed (data/campaignGone.ts). Nothing while the campaign is fine or the answer is
 *  unknown. Leave stays the way out: beside the note on the Setup card and the Party page; `awayFromLeave`
 *  (the phone's campaign list) says where it is. `gm`: the account runs it (its own device that has not
 *  merged the delete yet) — not "your GM". */
export function CampaignGoneNote({ campaignId, charId, block, awayFromLeave, gm }: { campaignId: string; charId?: string; block?: boolean; awayFromLeave?: boolean; gm?: boolean }) {
  const reason = useCampaignGone(campaignId, charId);
  if (!reason) return null;
  if (reason === 'char-removed') {
    return (
      <span className={'cmp-gone-note' + (block ? ' block' : '')} role="status">
        <i className="ti ti-alert-triangle" aria-hidden="true" />{' '}
        Your GM removed this character from this campaign, so it is no longer sent to its party. Your other
        characters are not affected. Use Leave to remove the campaign from this character; you can join again
        later with the campaign code.
      </span>
    );
  }
  return (
    <span className={'cmp-gone-note' + (block ? ' block' : '')} role="status">
      <i className="ti ti-alert-triangle" aria-hidden="true" />{' '}
      {reason === 'removed' ? 'You were removed from this campaign.' : gm ? 'This campaign was deleted.' : 'Your GM deleted this campaign.'} Your character is no longer sent
      to its party.{' '}
      {awayFromLeave
        ? 'To remove the campaign, use Leave in the character’s Setup → Campaigns.'
        : 'Use Leave to remove the campaign from this character.'}
    </span>
  );
}
