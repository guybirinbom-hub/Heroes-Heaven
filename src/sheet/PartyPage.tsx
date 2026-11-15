import { useState } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { CampaignMembership } from '../data/campaigns';
import { PartyMembers, useMemberViewer } from './PartyMembers';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { confirmDialog } from './confirm';
import { leaveCampaignQuestion } from '../data/campaignLeave';
import { CampaignGoneNote } from './CampaignGoneNote';

interface PartyPageProps {
  content: ContentDatabase;
  /** The campaigns this character is attached to (subset of the user's memberships). */
  campaigns: CampaignMembership[];
  onClose: () => void;
  /** This device's characters (id + name) — how a card is recognised as one of your own. */
  characters?: { id: string; name: string }[];
  /** Open one of your own characters for real (a roster id), instead of reading its published copy. */
  onOpenOwn?: (charId: string) => void;
  /** THIS character leaves a campaign, after the question (data/campaignLeave.ts — only this character
   *  is detached; a player's membership goes once none of their characters is left in it). */
  onLeave?: (campaignId: string) => void;
  /** The character this page was opened from, named in the Leave question. */
  characterName?: string;
}

/** Party view opened from a character's Party button — teammates' characters in summary for the
 *  selected campaign; tap one to read (only) their full sheet. A GM viewing here can still kick. */
export function PartyPage({ content, campaigns, characters, onOpenOwn, onClose, onLeave, characterName }: PartyPageProps) {
  const [selectedId, setSelectedId] = useState(campaigns[0]?.id ?? '');
  const selectedCampaign = campaigns.find((c) => c.id === selectedId);
  const { sheetEl, open } = useMemberViewer(content, { roster: characters, onOpenOwn });

  const leave = async () => {
    if (!onLeave || !selectedCampaign) return;
    if (await confirmDialog(leaveCampaignQuestion(selectedCampaign, characterName))) onLeave(selectedCampaign.id);
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
        <PartyMembers campaignId={selectedId} isGm={selectedCampaign?.role === 'gm'} content={content} onView={(m) => void open(selectedId, m.charId, m.ownerId)} />
        {/* This character leaves the campaign — a GM's character too (the campaign stays; a GM ends it by
            deleting it on the Campaigns page). */}
        {selectedCampaign && <CampaignGoneNote campaignId={selectedCampaign.id} block gm={selectedCampaign.role === 'gm'} />}
        {onLeave && selectedCampaign && (
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
