import { useState } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { CampaignMembership } from '../data/campaigns';
import { PartyMembers, useMemberViewer } from './PartyMembers';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { confirmDialog } from './confirm';

interface PartyPageProps {
  content: ContentDatabase;
  /** The campaigns this character is attached to (subset of the user's memberships). */
  campaigns: CampaignMembership[];
  onClose: () => void;
  /** Player leaves a campaign entirely (drops the membership + detaches all their characters). */
  onLeave?: (campaignId: string) => void;
}

/** Party view opened from a character's Party button — teammates' characters in summary for the
 *  selected campaign; tap one to read (only) their full sheet. A GM viewing here can still kick. */
export function PartyPage({ content, campaigns, onClose, onLeave }: PartyPageProps) {
  const [selectedId, setSelectedId] = useState(campaigns[0]?.id ?? '');
  const selectedCampaign = campaigns.find((c) => c.id === selectedId);
  const { sheetEl, open } = useMemberViewer(content);

  const leave = async () => {
    if (!onLeave || !selectedCampaign) return;
    const ok = await confirmDialog({
      title: `Leave “${selectedCampaign.name}”?`,
      message: 'You’ll leave this campaign and all of your characters will be removed from its party. You can rejoin later with the code (from a character’s Setup → Campaigns).',
      confirmLabel: 'Leave campaign',
      danger: true,
    });
    if (ok) onLeave(selectedCampaign.id);
  };

  if (sheetEl) return sheetEl;

  return (
    <div className="hb-page party-page">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <button className="icon-btn hb-back" onClick={onClose} title="Back" aria-label="Back to your sheet">
            <i className="ti ti-arrow-left" aria-hidden="true" />
          </button>
          <HeroesHeavenLogo className="chrome-logo" /> Party
        </div>
        <WindowControls />
      </header>

      <div className="party-body">
        {campaigns.length > 1 && (
          <div className="party-campaign-sel">
            <div className="seg" role="tablist" aria-label="Campaign">
              {campaigns.map((c) => (
                <span
                  key={c.id}
                  role="tab"
                  aria-selected={c.id === selectedId}
                  className={c.id === selectedId ? 'on' : ''}
                  onClick={() => setSelectedId(c.id)}
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <PartyMembers campaignId={selectedId} isGm={selectedCampaign?.role === 'gm'} onView={(m) => void open(selectedId, m.charId, m.ownerId)} />
        {/* Players can leave a campaign entirely; a GM ends theirs by deleting it in the Campaigns page. */}
        {onLeave && selectedCampaign && selectedCampaign.role === 'player' && (
          <div className="party-leave-row">
            <button className="chip danger" onClick={() => void leave()}>
              <i className="ti ti-logout" aria-hidden="true" /> Leave campaign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
