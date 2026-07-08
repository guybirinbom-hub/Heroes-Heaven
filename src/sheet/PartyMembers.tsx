import { useEffect, useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import { fetchParty, fetchMemberSheet, currentUserId, kickFromParty, type PartyMember } from '../data/party';
import type { PartySummary } from './partySummary';
import { CharacterSheet } from './CharacterSheet';
import { confirmDialog } from './confirm';
import { useBackHandler } from './useEscapeClose';

/** Read-only teammate-sheet viewer shared by the party page and the GM campaign detail. Returns the
 *  full-screen sheet element (or null) plus an `open(campaignId, charId)` to load + show it. Render
 *  `sheetEl` with an early return from the host page so the sheet takes over the screen. */
export function useMemberViewer(content: ContentDatabase) {
  const [viewing, setViewing] = useState<Character | null>(null);
  useBackHandler(!!viewing, () => setViewing(null));
  const open = async (campaignId: string, charId: string): Promise<boolean> => {
    const sheet = await fetchMemberSheet(campaignId, charId);
    if (sheet) {
      setViewing(sheet);
      return true;
    }
    return false;
  };
  const sheetEl = viewing ? (
    <div className="party-viewer">
      <CharacterSheet
        character={viewing}
        content={content}
        charKey="party-member"
        characters={[]}
        readOnly
        onBack={() => setViewing(null)}
      />
    </div>
  ) : null;
  return { sheetEl, open };
}

/** The party for one campaign — member cards (+ GM kick). Tapping a card calls `onView(member)`; the
 *  host loads the read-only sheet via useMemberViewer. */
export function PartyMembers({
  campaignId,
  isGm,
  onView,
}: {
  campaignId: string;
  isGm: boolean;
  onView: (m: PartyMember) => void;
}) {
  const [members, setMembers] = useState<PartyMember[] | null>(null);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void currentUserId().then(setMyId);
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    setMembers(null);
    setError('');
    fetchParty(campaignId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the party. Check your connection, or that the campaign SQL has been run.");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload]);

  const kick = async (m: PartyMember) => {
    const ok = await confirmDialog({
      title: `Remove ${m.name}’s player?`,
      message: "Their characters leave this party and they can't rejoin unless you re-share the code. This removes every character that player shared with the campaign.",
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const res = await kickFromParty(campaignId, m.ownerId);
    if (res.ok) setReload((r) => r + 1);
    else setError(res.error);
  };

  return (
    <>
      {error && <p className="login-error" role="alert">{error}</p>}
      {members === null && !error ? (
        <div className="party-loading"><span className="app-loading-spin" aria-hidden="true" /> Loading party…</div>
      ) : members && members.length === 0 ? (
        <div className="party-empty">No one has shared a character with this campaign yet. Characters appear here once a member attaches one (Builder → Setup → Campaigns) and their app syncs.</div>
      ) : (
        <div className="party-grid">
          {(members ?? []).map((m) => (
            <PartyCard
              key={m.charId}
              member={m}
              isMine={m.ownerId === myId}
              showKick={isGm && !!myId && m.ownerId !== myId}
              onOpen={() => onView(m)}
              onKick={() => void kick(m)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function hpColor(cur: number, max: number): string {
  if (max <= 0) return 'var(--app-accent)';
  const f = cur / max;
  if (f <= 0.35) return 'var(--app-danger, #ef4444)';
  if (f < 1) return 'var(--app-warn, #e0a63a)';
  return 'var(--app-good, #22c55e)';
}

function PartyCard({
  member,
  isMine,
  showKick,
  onOpen,
  onKick,
}: {
  member: PartyMember;
  isMine: boolean;
  showKick: boolean;
  onOpen: () => void;
  onKick: () => void;
}) {
  const s: PartySummary = member.summary ?? ({} as PartySummary);
  const initials = (s.name || member.name || '—').slice(0, 2).toUpperCase();
  const sub = [s.ancestry, s.className && `${s.className} ${s.level ?? ''}`.trim()].filter(Boolean).join(' ');
  const hpMax = s.hpMax ?? 0;
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, Math.round(((s.hpCur ?? hpMax) / hpMax) * 100))) : 0;
  return (
    <div
      className="party-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {showKick && (
        <button
          className="party-kick"
          title="Remove from party"
          aria-label="Remove from party"
          onClick={(e) => {
            e.stopPropagation();
            onKick();
          }}
        >
          <i className="ti ti-user-minus" aria-hidden="true" />
        </button>
      )}
      <div className="party-card-h">
        <span className="party-av">{s.portrait ? <img src={s.portrait} alt="" /> : initials}</span>
        <span className="party-card-id">
          <span className="party-card-name">
            {s.name || member.name}
            {isMine && <span className="party-you"> · you</span>}
          </span>
          <span className="party-card-sub">{sub || '—'}</span>
        </span>
        <i className="ti ti-chevron-right party-chev" aria-hidden="true" />
      </div>
      <div className="party-stats">
        <span className="party-stat party-hp">
          <span className="party-stat-l">HP</span>
          <span className="party-stat-v">
            {s.hpCur ?? hpMax}
            {hpMax ? ` / ${hpMax}` : ''}
            {s.hpTemp ? <span className="party-temp"> +{s.hpTemp}</span> : null}
          </span>
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
    </div>
  );
}
