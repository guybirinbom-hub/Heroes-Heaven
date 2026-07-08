import { useEffect, useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import type { CampaignMembership } from '../data/campaigns';
import { fetchParty, fetchMemberSheet, currentUserId, type PartyMember } from '../data/party';
import type { PartySummary } from './partySummary';
import { CharacterSheet } from './CharacterSheet';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { useBackHandler } from './useEscapeClose';

interface PartyPageProps {
  content: ContentDatabase;
  /** The campaigns this character is attached to (subset of the user's memberships). */
  campaigns: CampaignMembership[];
  onClose: () => void;
}

/** Party view — teammates' characters in summary for the selected campaign; tap one to read (only)
 *  their full sheet. Reached from the sheet's Party button. */
export function PartyPage({ content, campaigns, onClose }: PartyPageProps) {
  const [selectedId, setSelectedId] = useState(campaigns[0]?.id ?? '');
  const [members, setMembers] = useState<PartyMember[] | null>(null);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ charId: string; sheet: Character } | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);

  useBackHandler(!!viewing, () => setViewing(null));

  useEffect(() => {
    void currentUserId().then(setMyId);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setMembers(null);
    setError('');
    fetchParty(selectedId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the party. Check your connection, or that the campaign SQL has been run.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const openMember = async (m: PartyMember) => {
    setLoadingSheet(true);
    const sheet = await fetchMemberSheet(selectedId, m.charId);
    setLoadingSheet(false);
    if (sheet) setViewing({ charId: m.charId, sheet });
    else setError("Couldn't open that character sheet.");
  };

  if (viewing) {
    return (
      <div className="party-viewer">
        <CharacterSheet
          character={viewing.sheet}
          content={content}
          charKey={viewing.charId}
          readOnly
          onBack={() => setViewing(null)}
        />
      </div>
    );
  }

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

        {error && <p className="login-error" role="alert">{error}</p>}
        {loadingSheet && <div className="party-loading"><span className="app-loading-spin" aria-hidden="true" /> Opening sheet…</div>}

        {members === null && !error ? (
          <div className="party-loading"><span className="app-loading-spin" aria-hidden="true" /> Loading party…</div>
        ) : members && members.length === 0 ? (
          <div className="party-empty">No one has shared a character with this campaign yet. Characters appear here once a teammate attaches one (Builder → Setup → Campaigns) and their app syncs.</div>
        ) : (
          <div className="party-grid">
            {(members ?? []).map((m) => (
              <PartyCard key={m.charId} member={m} isMine={m.ownerId === myId} onOpen={() => void openMember(m)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function hpColor(cur: number, max: number): string {
  if (max <= 0) return 'var(--app-accent)';
  const f = cur / max;
  if (f <= 0.35) return 'var(--app-danger, #ef4444)';
  if (f < 1) return 'var(--app-warn, #e0a63a)';
  return 'var(--app-good, #22c55e)';
}

function PartyCard({ member, isMine, onOpen }: { member: PartyMember; isMine: boolean; onOpen: () => void }) {
  const s: PartySummary = member.summary ?? ({} as PartySummary);
  const initials = (s.name || member.name || '—').slice(0, 2).toUpperCase();
  const sub = [s.ancestry, s.className && `${s.className} ${s.level ?? ''}`.trim()].filter(Boolean).join(' ');
  const hpMax = s.hpMax ?? 0;
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, Math.round(((s.hpCur ?? hpMax) / hpMax) * 100))) : 0;
  return (
    <button className="party-card" onClick={onOpen} type="button">
      <div className="party-card-h">
        <span className="party-av">
          {s.portrait ? <img src={s.portrait} alt="" /> : initials}
        </span>
        <span className="party-card-id">
          <span className="party-card-name">{s.name || member.name}{isMine && <span className="party-you"> · you</span>}</span>
          <span className="party-card-sub">{sub || '—'}</span>
        </span>
        <i className="ti ti-chevron-right party-chev" aria-hidden="true" />
      </div>
      <div className="party-stats">
        <span className="party-stat party-hp">
          <span className="party-stat-l">HP</span>
          <span className="party-stat-v">{s.hpCur ?? hpMax}{hpMax ? ` / ${hpMax}` : ''}{s.hpTemp ? <span className="party-temp"> +{s.hpTemp}</span> : null}</span>
          <span className="party-hpbar"><span style={{ width: pct + '%', background: hpColor(s.hpCur ?? hpMax, hpMax) }} /></span>
        </span>
        <span className="party-stat"><span className="party-stat-l">AC</span><span className="party-stat-v">{s.ac ?? '—'}</span></span>
        <span className="party-stat"><span className="party-stat-l">Perc</span><span className="party-stat-v">{s.perception >= 0 ? '+' : ''}{s.perception ?? 0}</span></span>
      </div>
      {((s.conditions?.length ?? 0) > 0 || (s.modes?.length ?? 0) > 0) && (
        <div className="party-chips">
          {(s.conditions ?? []).map((c, i) => (
            <span className="party-cond" key={'c' + i}>{c.name}{c.value ? ` ${c.value}` : ''}</span>
          ))}
          {(s.modes ?? []).map((m, i) => (
            <span className="party-mode" key={'m' + i}>{m}</span>
          ))}
        </div>
      )}
    </button>
  );
}
