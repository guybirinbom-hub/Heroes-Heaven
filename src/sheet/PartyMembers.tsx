import { useEffect, useRef, useState } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyPlayState } from '../rules/play';
import { rememberPartyCapabilities } from '../data/partyCapabilities';
import { fetchParty, fetchMemberSheet, currentUserId, kickFromParty, subscribeParty, subscribeMemberSheet, type PartyMember } from '../data/party';
import type { PartySummary } from './partySummary';
import { CharacterSheet } from './CharacterSheet';
import { GmEditSheet } from './GmEditSheet';
import { confirmDialog } from './confirm';
import { RankPill } from './widgets';
import { useBackHandler } from './useEscapeClose';

const LOAD_ERROR = "Couldn't load the party. Check your connection, or that the campaign SQL has been run.";

interface ViewingState {
  campaignId: string;
  ownerId: string;
  charId: string;
  sheet: SavedChar;
}

/** Teammate-sheet viewer shared by the party page and the GM campaign detail. Returns the full-screen
 *  sheet element (or null) plus an `open(campaignId, charId, ownerId)` to load + show it. Render
 *  `sheetEl` with an early return from the host page so the sheet takes over the screen. With
 *  `{ gmEdit: true }` (GM campaign detail) the sheet is fully editable and can push changes back to the
 *  player; otherwise it's a read-only view. */
export function useMemberViewer(content: ContentDatabase, options?: { gmEdit?: boolean }) {
  const [viewing, setViewing] = useState<ViewingState | null>(null);
  useBackHandler(!!viewing, () => setViewing(null));
  const open = async (campaignId: string, charId: string, ownerId: string): Promise<boolean> => {
    const sheet = await fetchMemberSheet(campaignId, charId);
    if (sheet && sheet.character) {
      setViewing({ campaignId, ownerId, charId, sheet });
      return true;
    }
    return false;
  };

  /*
   * Keep the OPEN sheet live.
   *
   * `open()` takes a snapshot, and until now that snapshot was the whole story: a GM reading a player's
   * sheet saw whatever was published the instant they tapped the card, for as long as they left it
   * open. Subscribing to that one row means the player taking damage, spending a slot or picking up an
   * item shows on the GM's screen as it happens.
   *
   * The GM's EDITING view is deliberately not force-updated here — it owns a working copy, and
   * replacing that out from under a half-finished edit would destroy the GM's work. GmEditSheet takes
   * the live sheet as a prop and decides for itself (adopt it when clean, flag it when dirty).
   */
  const campaignId = viewing?.campaignId;
  const charId = viewing?.charId;
  useEffect(() => {
    if (!campaignId || !charId) return;
    let cancelled = false;
    const pull = () => {
      void fetchMemberSheet(campaignId, charId).then((sheet) => {
        if (cancelled || !sheet?.character) return;
        setViewing((v) =>
          // Guard against a late response for a sheet the viewer has since closed or swapped away from,
          // and skip identical payloads so an unchanged re-publish doesn't re-render the whole sheet.
          v && v.campaignId === campaignId && v.charId === charId && JSON.stringify(v.sheet) !== JSON.stringify(sheet)
            ? { ...v, sheet }
            : v,
        );
      });
    };
    const unsub = subscribeMemberSheet(campaignId, charId, pull);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [campaignId, charId]);
  let sheetEl = null;
  if (viewing) {
    if (options?.gmEdit) {
      sheetEl = (
        <div className="party-viewer">
          <GmEditSheet
            key={viewing.charId}
            initial={viewing.sheet}
            live={viewing.sheet}
            content={content}
            campaignId={viewing.campaignId}
            playerOwnerId={viewing.ownerId}
            onExit={() => setViewing(null)}
          />
        </div>
      );
    } else {
      // Read-only: derive the live character from the published SavedChar (play overlaid on the build).
      let live;
      try {
        live = applyPlayState(viewing.sheet.character, viewing.sheet.play, content);
      } catch {
        live = viewing.sheet.character;
      }
      sheetEl = (
        <div className="party-viewer">
          <CharacterSheet
            character={live}
            content={content}
            charKey="party-member"
            characters={[]}
            readOnly
            onBack={() => setViewing(null)}
          />
        </div>
      );
    }
  }
  return { sheetEl, open };
}

/** The party for one campaign — member cards (+ GM kick). Tapping a card calls `onView(member)`; the
 *  host loads the read-only sheet via useMemberViewer. */
export function PartyMembers({
  campaignId,
  isGm,
  onView,
  onMembers,
  localMembers,
  renderExtra,
}: {
  campaignId: string;
  isGm: boolean;
  onView: (m: PartyMember) => void;
  /**
   * Every list this component loads, handed to the host — the first fetch and every Realtime refresh.
   *
   * The tracker integration builds its combat party from the campaign's members, and it can't read
   * them out of here: this component only mounts INSIDE the tracker's party view, which needs that
   * party to exist first. So the host fetches once itself and keeps in step through this.
   */
  onMembers?: (list: PartyMember[]) => void;
  /**
   * Extra content for each card — the tracker integration passes the "Stats shown" sections here
   * (saves, abilities, skills, …) built from the real character, plus the header's turn chip and
   * add-to-initiative button. A render prop, not tracker types, so this component stays pure: the
   * real (non-tracker) party page passes nothing and is unchanged.
   */
  renderExtra?: (m: PartyMember) => PartyCardSlots;
  /**
   * Render THESE members instead of fetching from the server.
   *
   * The party is normally published to Supabase, so it needs an account. The tracker integration
   * passes locally-derived members while testing without login (src/integration/) — the cards, the
   * summaries and the open-sheet behaviour are then exactly the real ones, just fed from the local
   * roster. Omitted → the normal server-backed behaviour, unchanged.
   */
  localMembers?: PartyMember[];
}) {
  const [members, setMembers] = useState<PartyMember[] | null>(null);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // `myId` is null both BEFORE the auth check resolves and when genuinely signed out, so track the
  // resolution separately — otherwise the signed-out notice below flashes for a signed-in user.
  const [authChecked, setAuthChecked] = useState(false);
  // Read through a ref: a host passing an inline arrow must not restart the fetch + subscription.
  const onMembersRef = useRef(onMembers);
  onMembersRef.current = onMembers;

  useEffect(() => {
    void currentUserId()
      .then(setMyId)
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    // Local members are supplied by the host — never fetch or subscribe.
    if (localMembers) return;
    if (!campaignId) return;
    let cancelled = false;
    // `showLoading` only on the first load — a live Realtime refresh shouldn't flash the spinner.
    const refresh = (showLoading: boolean) => {
      if (showLoading) setMembers(null);
      setError('');
      fetchParty(campaignId)
        .then((list) => {
          if (cancelled) return;
          // A FAILED read is not an empty party. Keep the cards already on screen, say what happened,
          // and above all don't hand the host an empty list: the tracker mirrors this into its own
          // party store, where an empty list means "everyone left" and prunes them for real.
          if (!list) {
            setError(LOAD_ERROR);
            return;
          }
          setMembers(list);
          onMembersRef.current?.(list);
          // Cache the party's SHARED capabilities (Battleforger). The item editor renders
          // synchronously and cannot await the party, so it reads what the last fetch saw.
          rememberPartyCapabilities(campaignId, list.map((m) => m.summary));
        })
        .catch(() => {
          if (!cancelled) setError(LOAD_ERROR);
        });
    };
    refresh(true);
    // Live: refresh the cards the moment any member publishes/updates/leaves a character.
    const unsub = subscribeParty(campaignId, () => refresh(false));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [campaignId, reload, localMembers]);

  // What the cards actually render: host-supplied members win over the fetched list.
  const shown = localMembers ?? members;

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
      {shown === null && !error ? (
        <div className="party-loading"><span className="app-loading-spin" aria-hidden="true" /> Loading party…</div>
      ) : shown && shown.length === 0 && !localMembers && authChecked && myId === null ? (
        // The party lives on the server and its row-level security only answers signed-in users, so
        // a signed-out session ("use offline") gets an empty list rather than an error. Say that,
        // instead of implying nobody has shared a character.
        <div className="party-empty">Sign in to see this campaign’s party — the member list is stored on the server.</div>
      ) : shown && shown.length === 0 ? (
        <div className="party-empty">No one has shared a character with this campaign yet. Characters appear here once a member attaches one (Builder → Setup → Campaigns) and their app syncs.</div>
      ) : (
        <div className="party-grid">
          {(shown ?? []).map((m) => (
            <PartyCard
              key={m.charId}
              member={m}
              isMine={m.ownerId === myId}
              showKick={isGm && !!myId && m.ownerId !== myId}
              onOpen={() => onView(m)}
              onKick={() => void kick(m)}
              extra={renderExtra?.(m)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * What a party card carries when it is dragged.
 *
 * The GM drags a player's card onto the initiative rail to put that PC in the order; the seam
 * (src/integration/CampaignTracker.tsx) is what accepts the drop. Declared here, next to the drag
 * source, so the two can't disagree about the type or the payload.
 */
export const PARTY_MEMBER_DRAG = 'application/x-hh-party-member';
export interface PartyMemberDrag {
  charId: string;
  name: string;
  maxHP?: number;
}

/**
 * The three places a host can put its own content on a card.
 *
 * The card is two rows (the owner's pick, 2026-09-17), so one opaque node no longer fits: the saves
 * belong beside AC in row 1's band, the rest is row 2, and the turn chip + the add-to-initiative
 * button belong in the header beside the chevron. Named slots keep the layout here, where the CSS
 * is, instead of in whatever the host hands over.
 */
export interface PartyCardSlots {
  /** Header, between the name and the chevron — the tracker's turn-timer chip and "+" button. */
  header?: React.ReactNode;
  /** Row 1, inside the AC/Fort/Ref/Will block. */
  saves?: React.ReactNode;
  /** The whole of ROW 2: Speed & DCs, Skills, Abilities, Senses & Languages. Falsy → no row 2. */
  right?: React.ReactNode;
}

function hpColor(cur: number, max: number): string {
  if (max <= 0) return 'var(--app-accent)';
  const f = cur / max;
  if (f <= 0.35) return 'var(--app-danger, #ef4444)';
  if (f < 1) return 'var(--app-warn, #e0a63a)';
  return 'var(--app-good, #22c55e)';
}

export function PartyCard({
  member,
  isMine,
  showKick,
  onOpen,
  onKick,
  extra,
}: {
  member: PartyMember;
  isMine: boolean;
  /** GM only. Omitted (the card in a PC's tracker pane) → no kick button, and no chevron offset. */
  showKick?: boolean;
  onOpen: () => void;
  onKick?: () => void;
  extra?: PartyCardSlots;
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
      // Drag a card onto the initiative rail to add that PC to the order. Inert everywhere else —
      // the campaign detail panel has nothing that accepts this type.
      draggable
      onDragStart={(e) => {
        const payload: PartyMemberDrag = { charId: member.charId, name: member.name, maxHP: s.hpMax };
        e.dataTransfer.setData(PARTY_MEMBER_DRAG, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card's OWN key presses open the sheet. A keydown bubbling out of a control inside
        // it (the "+", the kick) is that control's activation: swallowing it here would preventDefault
        // the browser's click-from-Enter and open the sheet instead, so those buttons would be
        // mouse-only. stopPropagation on their click covers the mouse half; this covers the keyboard.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="party-card-h">
        <span className="party-av">{s.portrait ? <img src={s.portrait} alt="" /> : initials}</span>
        <span className="party-card-id">
          <span className="party-card-name">
            {s.name || member.name}
            {isMine && <span className="party-you"> · you</span>}
          </span>
          <span className="party-card-sub">{sub || '—'}</span>
        </span>
        {/* The host's header controls (turn chip, add-to-initiative). Their own clicks are theirs —
            they must not also open the sheet. */}
        {extra?.header && (
          <span className="party-card-tools" onClick={(e) => e.stopPropagation()}>
            {extra.header}
          </span>
        )}
        <i className="ti ti-chevron-right party-chev" aria-hidden="true" />
      </div>
      {/* Two ROWS (the owner's pick, 2026-09-17): row 1 is the band the GM reads while a turn is
          running — HP + chips on the left, then Perception and AC/saves across; row 2 is the
          full-width reference band they look up between turns. On a phone row 1's right-hand group
          wraps under the left one (see sheet.css, <=720px). */}
      <div className={'party-card-body' + (extra?.right ? ' has-right' : '')}>
        <div className="party-row-turn">
          <div className="party-turn-l">
            <div className="party-hp">
              <span className="party-lab">HP</span>
              <span className="party-stat-v">
                {s.hpCur ?? hpMax}
                {hpMax ? ` / ${hpMax}` : ''}
                {s.hpTemp ? <span className="party-temp"> +{s.hpTemp}</span> : null}
              </span>
              <span className="party-hpbar"><span style={{ width: pct + '%', background: hpColor(s.hpCur ?? hpMax, hpMax) }} /></span>
            </div>
            {((s.conditions?.length ?? 0) > 0 || (s.modes?.length ?? 0) > 0) && (
              <div className="party-chips">
                {(s.conditions ?? []).map((c, i) => (
                  // A condition the SHEET worked out (Bulk, an active mode) carries its cause and
                  // wears a lock here, the same way the owner's own rail marks it — nobody at the
                  // table can take it off, it goes when its cause goes.
                  <span className={'party-cond' + (c.derivedFrom ? ' is-auto' : '')} key={'c' + i} title={c.derivedFrom || undefined}>
                    {c.name}
                    {c.value ? ` ${c.value}` : ''}
                    {c.derivedFrom && <i className="ti ti-lock party-cond-lock" aria-hidden="true" />}
                  </span>
                ))}
                {(s.modes ?? []).map((m, i) => (
                  <span className="party-mode" key={'m' + i}>{m}</span>
                ))}
              </div>
            )}
          </div>
          {/* The numbers a GM calls for mid-turn, across the band past the divider: Perception with
              its circle, then AC and the saves as label-over-value tiles. Part of the card's own
              surface, so a click here still opens the sheet, exactly as it used to. */}
          <div className="party-turn-r">
            <div className="party-perc">
              <span className="party-lab">Perception</span>
              <span className="party-perc-v">
                {s.perception >= 0 ? '+' : ''}
                {s.perception ?? 0}
                {s.perceptionRank && <RankPill rank={s.perceptionRank} />}
              </span>
            </div>
            <div className="party-defs">
              <span className="party-def">
                <span className="party-lab">AC</span>
                <b>{s.ac ?? '—'}</b>
              </span>
              {extra?.saves}
            </div>
          </div>
        </div>
        {/* ROW 2 — the host's Speed & DCs, Skills, Abilities, Senses, full card width. Omitted
            entirely when the "Stats shown" preset leaves nothing to draw, so there is no empty band
            and no divider. A click on the numbers is not navigation, so it doesn't open the sheet. */}
        {extra?.right && (
          <div className="party-row-ref" onClick={(e) => e.stopPropagation()}>
            {extra.right}
          </div>
        )}
        {/* Bottom-left of the card, under row 2 (owner 2026-09-16: *"the remove player button
            doesn't need a row of its own, put it in the bottom left"*).
            DEVIATION from the approved mockup (card-two-rows.html), pending the owner's nod: the
            mockup puts this button INSIDE `.party-row-ref`. It sits in the body instead, after that
            row, because a "Stats shown" preset that hides every reference section drops row 2 — and
            with it the GM's only remove control. Pixel-identical on a normal card (row 2 has no
            padding-bottom); the difference shows only on a card with no row 2. */}
        {showKick && onKick && (
          <button
            className="party-kick"
            title="Remove from party"
            aria-label="Remove from party"
            onClick={(e) => {
              e.stopPropagation();
              onKick();
            }}
          >
            <i className="ti ti-trash" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
