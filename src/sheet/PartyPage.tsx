import { useState } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { CampaignMembership } from '../data/campaigns';
import { PartyMembers, useMemberViewer } from './PartyMembers';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';

interface PartyPageProps {
  content: ContentDatabase;
  /** The campaigns this character is attached to (subset of the user's memberships). */
  campaigns: CampaignMembership[];
  onClose: () => void;
}

/** Party view opened from a character's Party button — teammates' characters in summary for the
 *  selected campaign; tap one to read (only) their full sheet. A GM viewing here can still kick. */
export function PartyPage({ content, campaigns, onClose }: PartyPageProps) {
  const [selectedId, setSelectedId] = useState(campaigns[0]?.id ?? '');
  const selectedCampaign = campaigns.find((c) => c.id === selectedId);
  const { sheetEl, open } = useMemberViewer(content);

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
      </div>
    </div>
  );
}
