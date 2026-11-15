import { useCampaignGone } from '../data/campaignGone';

/** Says plainly that a campaign of this character's is gone (its GM deleted it) or that this player was
 *  removed from it — learned from the server when a publish there failed (data/campaignGone.ts). Nothing
 *  while the campaign is fine or the answer is unknown. Leave stays the way out: beside the note on the
 *  Setup card and the Party page; `awayFromLeave` (the phone's campaign list) says where it is. `gm`: the
 *  account runs it (its own device that has not merged the delete yet) — not "your GM". */
export function CampaignGoneNote({ campaignId, block, awayFromLeave, gm }: { campaignId: string; block?: boolean; awayFromLeave?: boolean; gm?: boolean }) {
  const reason = useCampaignGone(campaignId);
  if (!reason) return null;
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
