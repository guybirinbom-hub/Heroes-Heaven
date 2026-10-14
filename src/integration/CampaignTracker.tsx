import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CampaignMembership } from '../data/campaigns';
import { loadRoster, type SavedChar } from '../data/storage';
import { GmEditSheet, type GmEditHandle } from '../sheet/GmEditSheet';
import { RecordCard } from '../sheet/RecordCard';
import type { OpenAt } from '../sheet/cardModel';
import { PinStar } from '../sheet/PinStar';
import { astSlug } from '../sheet/useAst';
import { bucketOf } from '../sheet/astStore';
import { PinContext, type PinDescApi } from '../sheet/PinContext';
import type { DescNode } from '../sheet/descref';
import { ForceMobileContext } from '../sheet/useIsMobile';
import { DismissUnder, useBackHandler } from '../sheet/useEscapeClose';
import { useTrackerVars, useGlobalVars, hhSurfaceTheme } from './trackerAppearance';
import { syncThemeColorMeta } from '../theme/theme-manager';
import type { DialogStyle } from '../sheet/confirm';
import { TrackerCustomize } from './TrackerCustomize';
import { CampaignPartyLevelProvider } from '../../tracker/src/data/partyLevelContext';
import { CampaignPcPaneProvider, type PcPaneHandles } from '../../tracker/src/data/pcPaneContext';
import { CampaignMonsterPartsProvider } from '../../tracker/src/data/monsterPartsContext';
import { CampaignPcStatsProvider, type HostPcBadge } from '../../tracker/src/data/pcStatsContext';
import type { PcStats } from '../../tracker/src/utils/pcDetail';
import { useCampaignDefaults } from './useCampaignDefaults';
import { computePcStats } from './computePcStats';
import { PcStatsCardExtra, PcSavesCells, hasRightColumn, cardCore } from './PcStatsCardExtra';
import { MemberTurnButton } from './MemberTurnButton';
import { useCombatStore, isSamePc } from '../../tracker/src/store/combatStore';
import { useSettingsStore } from '../../tracker/src/store/settingsStore';
import { useWindowStore, HOST_WIN_W } from '../../tracker/src/store/windowStore';
import { fixedPopupPos } from '../../tracker/src/utils/zoomFix';
import { useLayoutStore, useGmLayoutStore, type PaneNode } from '../../tracker/src/store/layoutStore';
import { GameDataProvider } from '../../tracker/src/data/gameDataContext';
import { HostSearchProvider, type HostSearchRecord } from '../../tracker/src/data/hostSearchContext';
import { HostThemeProvider } from '../../tracker/src/data/hostThemeContext';
import { HostSaveProvider, type HostSave } from '../../tracker/src/data/hostSaveContext';
import { downloadText } from '../sheet/download';
import {
  closeTopTrackerModal,
  topTrackerModalUnderAWindow,
  underAnotherWindow,
  useTrackerModalCount,
} from '../../tracker/src/utils/spendEscape';
import { hostSearchRecords } from './hostSearchRecords';
import { InitiativeTracker, DELAY_RETURN_MIME, useDelayDropZone } from '../../tracker/src/components/InitiativeTracker';
import { useDelayDragActive } from '../../tracker/src/useDelayDragActive';
import { PaneLayout } from '../../tracker/src/components/PaneLayout';
import { PartyView } from '../../tracker/src/components/PartyView';
import { GMScreen } from '../../tracker/src/components/GMScreen';
import { GlobalSearch } from '../../tracker/src/components/GlobalSearch';
import { MonsterSearch } from '../../tracker/src/components/MonsterSearch';
import { TextConverter } from '../../tracker/src/components/TextConverter';
import { EncounterManager } from '../../tracker/src/components/EncounterManager';
import { DiceOverlay } from '../../tracker/src/components/DiceOverlay';
import { FloatingWindowLayer } from '../../tracker/src/components/FloatingWindow';
import { ErrorBoundary } from '../../tracker/src/components/ErrorBoundary';
import { usePartyStore } from '../../tracker/src/store/partyStore';
import type { Combatant } from '../../tracker/src/types/pf2e';
import { PartyMembers, PartyCard, useGmPendingVersion, useMyId, knownToBeOther, PARTY_MEMBER_DRAG, type PartyMemberDrag, type PartyCardSlots } from '../sheet/PartyMembers';
import { gmEditRefused, gmPendingEdit, memberPublishedRow, pendingEditStillStands } from '../sheet/gmSync';
import { type PartySummary } from '../sheet/partySummary';
import { currentUserId, fetchParty, type PartyMember } from '../data/party';
import { useAuth } from '../data/useAuth';
import { startTrackerSync, isTrackerSyncReady } from '../data/trackerSync';
import { memberCardSummary, livePlay, useMemberSheets, usePcSheetTruth } from './pcSheetTruth';
import type { ContentDatabase, DescRef } from '../rules/types';
import { useLocalCampaignMembers } from './useLocalCampaignMembers';
import { TEST_CAMPAIGNS_WITHOUT_LOGIN } from './enabled';
import { useTrackerUi, trackerUi } from './trackerUiStore';
import { confirmDialog } from '../sheet/confirm';
import { claimCombatUndo } from './combatUndoClaim';
// The pre-built, fully-scoped tracker stylesheet. `.tracker-root` below is LOAD-BEARING: it is what
// confines Tailwind's Preflight to this subtree. Without it the CSS still loads and silently
// collapses ~32 of HH's headings to body text. Regenerate with `npm run build:css` in tracker/.
import '../../tracker/dist-css/tracker.scoped.css';
import './campaign-tracker.css';

/** One stable empty list, so "the party isn't known yet" doesn't re-run every memo below it. */
const NO_MEMBERS: PartyMember[] = [];

/** How long the board waits for the GM mirror's opening pull (or for auth to answer) before it draws
 *  anyway. The GM plays off LOCAL data — a slow network must never hold the table hostage. */
const SYNC_READY_CAP_MS = 4000;

/*
 * A tracker popup that ISN'T one of the five overlays registered on the dismiss stack below.
 *
 * The initiative row's right-click menu does close itself on Escape — but from a listener on
 * `document`, which fires BEFORE the shared stack's listener on `window` and marks nothing on the
 * event. So the same press also reached the stack, whose base handler leaves the campaign: one
 * Escape out of a row menu and the GM was out of the campaign, unpushed pane edits and all. The
 * tracker can't import HH's hooks to register itself, so the seam asks the DOM: such a menu portals
 * itself to <body> (through the tracker's BodyPortal, carrying `.tracker-root` for its CSS variables)
 * and is still there on this press. This view's own root is inside HH's page, and excluded by name in
 * case it ever isn't.
 */
function trackerPopupOpen(): boolean {
  return !!document.querySelector('body > .tracker-root:not(.campaign-tracker)');
}

/*
 * A tracker modal open in this view: the `.modal-overlay` every tracker dialog draws inside this root —
 * the Encounter Building tables, Link Stat Block, the encounter-table editor, the advanced condition
 * editor, a party card's turn-time graph — drawn ABOVE the floating windows (z 2000 and up). Each closes
 * itself on Escape through the tracker's useEscapeCloses, which also gives Android's Back a handler on the
 * dismiss stack below (the graph too, since 2026-10-14). While one is up, Escape and Back are not the
 * windows' (a window hidden behind it would close) and not the campaign's. This DOM check is the guard for
 * a `.modal-overlay` that is NOT registered (the saved-encounters list, EncounterManager, is one — on
 * KNOWN_GAPS in tracker/src/components/modalEscapeCoverage.test.ts, which lets no new one in): a registered layer — `.modal-overlay` or not (the
 * condition picker, the GM screen's + menu and its "Add to GM Screen" picker) — is seen by its count
 * (useTrackerModalCount), which puts the Back handler for the layers above every handler here.
 */
function trackerModalOpen(): boolean {
  return !!document.querySelector('.campaign-tracker .modal-overlay');
}

/*
 * …and of those, one drawn over EVERY floating window: one outside them all (the campaign's own), or one
 * inside the window on top. A floating window is a stacking context of its own, so a modal opened inside
 * one — the Edit converter of a stat block in a window — is painted at that window's z-index, and a window
 * opened since (a link in the converter's preview) is painted over it, overlay and all (the G7s refuter,
 * 2026-10-13; tracker/src/utils/spendEscape underAnotherWindow). Asked only where the modal on top is such
 * a modal (the Back handler for the tracker's modals): the windows' and the base handlers keep
 * `trackerModalOpen`, so a modal with its own Escape inside a lower window, which closes itself on the
 * press, still keeps the press from closing a window too.
 */
function trackerModalOverWindows(): boolean {
  return [...document.querySelectorAll('.campaign-tracker .modal-overlay')].some((m) => !underAnotherWindow(m));
}

/** Input types that hold no text: an Escape on one is no "cancel what I was typing". */
const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/*
 * An Escape typed in a TEXT BOX of the tracker's (this view's root, or a tracker popup on <body>). In a
 * box Escape means "cancel what I was typing", never "leave the campaign" — and a box that does not
 * spend its own Escape (the stat block's, the GM screen's, the Monster Parts popup's; any added later)
 * used to fall through to the base handler and LEAVE (the G2b refuter, 2026-10-13). Asked of the key
 * press's own target, so it holds whichever file drew the box. A dropdown (<select>) holds no text:
 * focus stays on one after a pick, and an Escape there is a plain press (the G3 refuter, 2026-10-13).
 */
function editableInTracker(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const text =
    t.tagName === 'TEXTAREA' ||
    (t.tagName === 'INPUT' && !NOT_TEXT.has((t as HTMLInputElement).type)) ||
    t.isContentEditable ||
    !!t.closest('[contenteditable]:not([contenteditable="false"])');
  return text && !!t.closest('.campaign-tracker, body > .tracker-root');
}

/*
 * THE GM'S STAR. Every description popup keeps its favourite star; on a player's sheet it pins to the
 * character's Pinned section, and the GM has no character — the GM's pinned references are the GM
 * screen (the tracker's workspace of pages kept across combats). So the star here puts the page on the
 * GM screen as a `host` pane tab (ref "bucket:slug"), and takes it off again.
 */
function findHostTab(n: PaneNode | null, ref: string): { leaf: string; idx: number } | null {
  if (!n) return null;
  if (n.kind === 'leaf') {
    const idx = n.tabs.findIndex((t) => t.type === 'host' && t.ref === ref);
    return idx >= 0 ? { leaf: n.id, idx } : null;
  }
  return findHostTab(n.a, ref) ?? findHostTab(n.b, ref);
}
const hostRefOf = (n: DescNode): string | null => {
  const slug = n.slug ?? astSlug(n.title);
  const key = n.key ?? bucketOf(slug);
  return key && slug ? `${key}:${slug}` : null;
};

/** A Heroes Heaven page inside the tracker — a floating window (a Search result, a link in another page)
 *  or a page pinned to the GM screen; both draw THIS. The record's own page with its Range/Duration lines
 *  (the GM reads them off it mid-fight), its head under the window's header (action glyph, level badge,
 *  Archives link, the trust marker, trait chips), links opening another window where they were clicked;
 *  a record with no page shows its text. Card step 6 (docs/card-design.md section 6 "gm") made it the
 *  record card in mode 'gm'; item 7 of the owner's online list (2026-10-01) moved it from chrome 'embed'
 *  (the body alone, still pinned to the pre-card page by test/card-hostpage.test.tsx) to chrome 'window'.
 *  The window's header carries the star (HostPageControls). */
export function HostPage({ content, bucket, id, onOpen }: {
  content: ContentDatabase; bucket: string; id: string; onOpen: (bucket: string, id: string, at?: OpenAt) => void;
}) {
  return <RecordCard record={{ bucket, id }} mode="gm" chrome="window" content={content} onOpenRef={onOpen} />;
}

type HostRec = { name: string; description?: string; descRefs?: DescRef[] };
const hostRec = (content: ContentDatabase, bucket: string, id: string): HostRec | undefined =>
  (content as unknown as Record<string, Record<string, HostRec> | undefined>)[bucket]?.[id];

/**
 * Open a Heroes Heaven page as a tracker window — what a linked word, a trait chip or a "Remastered as"
 * name inside a windowed page does. With the point it was clicked at, the window opens THERE (the
 * tracker's own convention: a link promotes to a window where it was clicked — FloatingWindow's
 * RichText), converted into the zoomed page's coordinates (fixedPopupPos: HH scales the app with
 * html{zoom}, and a click arrives in real viewport pixels — test/gm-search-popup.test.tsx pins it at
 * zoom 2). A link opened from the keyboard hands over its own box instead (AstRenderer keyAt,
 * RemasteredLine clickPoint). With no point it opens centred, as a Search result does. A page already
 * open is focused instead.
 */
export function openHostWindow(content: ContentDatabase, bucket: string, id: string, at?: OpenAt): void {
  const rec = hostRec(content, bucket, id);
  if (!rec) return;
  const ws = useWindowStore.getState();
  const ref = `${bucket}:${id}`;
  if (!at) {
    ws.open('host', ref, rec.name);
    return;
  }
  const p = fixedPopupPos(at.x, at.y, HOST_WIN_W, 320);
  ws.open('host', ref, rec.name, p.left, p.top, { noCascade: true });
}

/** The window header's half of the popup's chrome for a host page (HostSearch.controls): the favourite
 *  star. It reads the GM screen's pin target (`gmPin`, PinContext) — the windows and panes render inside
 *  its provider — so it pins the page to the GM screen; on a page that IS a GM-screen pane it unpins it,
 *  which closes that pane. The trust marker is NOT here: a line of words that names what is not applied
 *  ("…partly applied. Not applied: …") would crowd the tab strip and the close button out of a header
 *  that holds them in one row, and it would vanish with the header of a pane holding two tabs. It sits
 *  in the page's own head instead (RecordCard chrome 'window'), where the popup puts it. */
function HostPageControls({ content, bucket, id }: { content: ContentDatabase; bucket: string; id: string }) {
  const rec = hostRec(content, bucket, id);
  if (!rec) return null;
  return <PinStar node={{ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug: id }} />;
}

/*
 * Windows close when the GM goes back to the campaigns LIST — the same moment the tracker's transient UI
 * resets (CampaignsPage calls trackerUi.reset() there), so a page opened at one table never reappears at
 * the next. NOT on unmount: opening this campaign's settings unmounts the tracker too, and the GM comes
 * back to the windows he left. Registered here, by the lazily-loaded tracker side, so trackerUiStore (which
 * CampaignsPage imports statically) never pulls the tracker's stores into the main bundle.
 */
trackerUi.onReset(() => useWindowStore.getState().closeAll());

/** True when this PC already has a row in the initiative order. Matched through the store's OWN
 *  `isSamePc` (charId first, name as the fallback), because that is what `addCombatant`'s PC dedupe
 *  uses — the two must agree or the button lies. */
function pcInOrder(pc: { name: string; charId?: string }): boolean {
  return useCombatStore.getState().combatants.some((c) => c.isPC && isSamePc(c, pc));
}

/**
 * THE ONE WAY a party member reaches the initiative order.
 *
 * Both gestures end here: dragging the card onto the rail, and the "+" beside the card's turn chip.
 * They add the same thing — a PC row with no initiative value, the real maxHP, and the character id
 * the tracker now stores — so the two can never drift into adding subtly different combatants.
 *
 * Returns false when that PC is already in the order; the caller decides how to say so.
 */
export function addPartyMemberToInitiative(pc: PartyMemberDrag): boolean {
  const name = (pc.name ?? '').trim();
  if (!name || pcInOrder({ name, charId: pc.charId })) return false;
  useCombatStore.getState().addCombatant(null, { name, isPC: true, maxHP: pc.maxHP, charId: pc.charId });
  return true;
}

/** The "+" beside a card's turn chip: this player, into the initiative order. Disabled (with the
 *  reason) once they're in it — the tracker refuses a second PC of the same name anyway. */
export function PartyAddToOrderButton({ member }: { member: PartyMember }) {
  const inOrder = useCombatStore((s) =>
    s.combatants.some((c) => c.isPC && isSamePc(c, { name: member.name, charId: member.charId })),
  );
  const label = inOrder
    ? `${member.name} is already in the initiative order`
    : `Add ${member.name} to the initiative order`;
  // A disabled button gets no hover tooltip of its own, so the wrapper carries the title too.
  return (
    <span className="party-add-init-wrap" title={label}>
      <button
        type="button"
        className="party-add-init"
        disabled={inOrder}
        title={label}
        aria-label={label}
        onClick={() => addPartyMemberToInitiative({ charId: member.charId, name: member.name, maxHP: member.summary?.hpMax })}
      >
        <i className="ti ti-plus" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Opening a campaign IS the initiative tracker (layout option B).
 *
 *   row 1  Heroes Heaven's chrome + the tracker's tools   → rendered by CampaignsPage (<TrackerTools/>)
 *   row 2  the tracker, full width: initiative order + the main workspace         ← here
 *
 * The campaign's own controls (share code, defaults, delete) live in the campaign settings page,
 * reached from the tools in row 1 — they're once-in-a-while controls and don't earn a permanent row.
 *
 * THE MAIN WORKSPACE IS THE TRACKER'S OWN. `mainView === 'combatant'` renders <PaneLayout> over the
 * combat `useLayoutStore`: a tree of panes, each a tabbed stack of stat blocks and reference popups,
 * splittable and draggable. This is what the tracker means by its layout, and it's what makes
 * clicking a row in the initiative order — or having several combatants open at once — work at all.
 * An earlier version of this file replaced it with a single-valued `focus` state, which is why the
 * order wasn't clickable and only one thing could ever be on screen.
 *
 * Part of the removable seam; see ./README.md.
 */
export function CampaignTracker({
  m,
  content,
  onOpenSettings,
  onLeave,
  onViewMember,
}: {
  m: CampaignMembership;
  /** Needed to compute each local character's party summary (AC/HP/saves on the card). */
  content: ContentDatabase;
  /**
   * Leave for the campaign's settings page. Called only once it's SAFE to unmount this view — the
   * tools button that asks for it lives in HH's chrome and can't know whether the GM has unsaved
   * changes, so the decision belongs here.
   *
   * `dialogStyle` is what a box the page raises in answer should wear — the local table has no
   * settings and says so in a confirm, which opens OVER this view: the tracker's own look and a
   * z-index above its floating windows (see `dialogStyle` below). A page that navigates ignores it.
   */
  onOpenSettings: (dialogStyle?: DialogStyle) => void;
  /**
   * Leave the campaign (back to the campaigns list). Called only once it's SAFE to unmount, exactly
   * like onOpenSettings — Escape and the Back arrow both arrive here through the shared dismiss
   * stack, so neither can throw away an unpushed working copy without asking.
   */
  onLeave: () => void;
  /** Open a member's sheet — the same GM view the old campaign detail panel offered. */
  onViewMember: (mem: PartyMember) => void;
}) {
  const { searchOpen, monsterSearchOpen, customOpen, encountersOpen, appearanceOpen, mainView, paneRequest, settingsRequest } = useTrackerUi();
  /*
   * ── OFFLINE: THE TRACKER WITHOUT AN ACCOUNT ──────────────────────────────────
   *
   * "The initiative tracker needs to be accessible without an account. It will just not have any of
   * the online features and only work as an empty campaign … but I still need to access the
   * initiative tracker to use it."
   *
   * `m.local` is CampaignsPage's marker on the synthetic "Local table" membership (id `local`): there
   * is no row behind it on the server and no account to ask, so every online leg below is skipped —
   * the party read, the players' published sheets, the GM-edit push, HH's party cards. What is left is
   * the standalone tracker: the initiative order, the bestiary picker, the name quick-add, encounters,
   * the GM screen — all of which are local already.
   *
   * It is NOT a permissions check. A signed-in GM's campaign takes every branch it always did.
   */
  const offline = !!m.local;
  /*
   * The GM's own theme for this tracker view (theme/style only, local, never synced).
   *  - trackerVars: paint the tracker with them; null → inherit the app's global appearance. One object
   *    per appearance state (useTrackerVars memoises), because it also feeds every popup below.
   *  - fullSheetRevert: the OUT-OF-COMBAT full-screen sheet (opened from a party card to review a
   *    character) is pinned to the app's global appearance — it's a focused "look at this character
   *    as they really are" view, not part of the combat workspace. Its own popups render inside it and
   *    keep that look; so do GmEditSheet's dialogs (detached, on the app's look).
   * The IN-COMBAT PC panes deliberately get NO revert: tiled beside the initiative order and the
   * creature stat blocks, they hold the PC's party card and read as one themed surface with them.
   * EVERY POPUP OPENED IN THE TRACKER wears the tracker's look too — the owner, 2026-10-01: "if i open
   * a pop up in the initiative tracker it needs to have the same colors as the initiative tracker".
   * Those drawn on <body>, outside this root, get it handed to them: the tracker's own (row menu,
   * hover previews) through HostThemeProvider → BodyPortal, and the confirms raised here through
   * `dialogStyle`. A Search-everything page is a tracker window INSIDE this root (item 7), so it
   * simply wears the root's look.
   * None of this changes anything for players — it's the GM's local display only.
   */
  const trackerVars = useTrackerVars();
  const globalVars = useGlobalVars();
  // A phone or tablet browser paints its status bar from <meta name="theme-color">, which follows the
  // app's theme (theme-manager). While the tracker wears its own look, follow that instead, and hand the
  // bar back to the app's theme when the tracker closes or drops its look (native-feel check 2026-10-14).
  useEffect(() => {
    const bg = (trackerVars as Record<string, string> | null)?.['--app-bg'];
    if (!bg) return;
    syncThemeColorMeta(bg);
    return () => syncThemeColorMeta(document.documentElement.style.getPropertyValue('--app-bg').trim() || undefined);
  }, [trackerVars]);
  // The app's variables AND the four text properties: the sheet sits inside `.tracker-root`, whose
  // rules re-declare colour and font from the TRACKER's variables, and an element inherits those as
  // finished values — with the variables alone the review sheet kept the tracker's font, and its
  // tracker text colour wherever the sheet sets none (found in the 2026-10-10 browser proof).
  const fullSheetRevert = trackerVars ? hhSurfaceTheme(globalVars) : undefined;
  // While testing without login the server party is always empty (nobody published to a campaign
  // that only exists on this device), so feed HH's real cards from the local roster instead.
  const localMembers = useLocalCampaignMembers(m.id, content);

  /*
   * THE PARTY, FROM THE SERVER.
   *
   * PartyMembers (inside PartyView's playersSlot) does its own fetch and Realtime refresh — but that
   * slot never mounts until a party EXISTS in the tracker's store, and the party is built from this
   * very list. So the seam fetches the members itself once at mount to break the circle, and
   * PartyMembers hands every later list back through `onMembers` so the two can't drift.
   *
   * The bridge below used to be gated on TEST_CAMPAIGNS_WITHOUT_LOGIN — i.e. OFF in every release: a
   * signed-in GM opened their campaign on "Party not found.", players could only be quick-added as
   * name-only monsters, and the encounter badge rated every fight against a level-1 party of one. The
   * local roster is now only the FALLBACK, for the dev-without-login path where nobody ever published.
   */
  /*
   * `null` = NOT YET KNOWN — no read of the party has succeeded on this mount. It is deliberately a
   * different value from `[]` ("the campaign really has no members"), because the party bridge below
   * MIRRORS this list and an empty one prunes for real. A failed fetch used to arrive as `[]` and
   * wiped the GM's per-player notes, turn history and stat overrides; it now arrives as null and the
   * bridge simply doesn't run. Adversarially confirmed.
   */
  const [serverMembers, setServerMembers] = useState<PartyMember[] | null>(null);
  useEffect(() => {
    // OFFLINE: no server, no account — this is the one call that would go out for a local table.
    if (offline) return;
    let cancelled = false;
    void fetchParty(m.id).then((list) => {
      if (!cancelled && list) setServerMembers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [m.id, offline]);
  /*
   * OFFLINE the party is EMPTY AND KNOWN — deliberately `NO_MEMBERS`, not `null`. A local table really
   * has no members (rather than "we haven't read them yet"), so the bridge below is free to run: it
   * creates the campaign's empty party, which is what keeps the party view off "Party not found." and
   * gives the GM the tracker's own NPC tools. There is nothing to prune, because nothing was mirrored.
   */
  const known = offline ? NO_MEMBERS : !TEST_CAMPAIGNS_WITHOUT_LOGIN || serverMembers?.length ? serverMembers : localMembers;
  const members = known ?? NO_MEMBERS;

  /*
   * The players' own sheets — the truth for a PC's HP and conditions, in both directions. See
   * ./pcSheetTruth.ts for the conflict rules that keep a player's own edit from ever being lost.
   */
  /* A GM edit the player's app hasn't picked up yet: the sheets below are already overlaid with it
   * (src/data/party.ts), and this is what re-renders the cards and panes that draw them. */
  const pendingVersion = useGmPendingVersion();
  // Which of these cards is the GM's own character — the one card that must not open the GM editor.
  const { myId } = useMyId();
  const memberSheets = useMemberSheets(m.id, members);
  const sheetById = useMemo(() => {
    const map = new Map<string, SavedChar>();
    // OFFLINE: no sheets at all. Nobody's character is attached to the local table, so this would be
    // empty anyway — returning early makes "no PC pane, no GM edit, ever" structural rather than
    // incidental, since `roster` (and therefore renderPcPane) is built from this map.
    if (offline) return map;
    // This device's own characters first, so the dev-without-login path still has sheets to show;
    // a published sheet always wins over the local copy.
    for (const e of loadRoster()) if (!e.archived && (e.character.campaignIds ?? []).includes(m.id)) map.set(e.id, e);
    for (const [charId, s] of memberSheets) map.set(charId, s);
    return map;
    // localMembers changes whenever the roster relevant to this campaign changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberSheets, localMembers, m.id, offline]);
  // With no members and no sheets this reconciles nothing and pushes nothing — the hook still runs
  // (hooks can't be conditional) but every loop inside it is over an empty list.
  usePcSheetTruth({ campaignId: m.id, members, sheetById, content });

  const inCombat = useCombatStore((s) => s.inCombat);
  const combatants = useCombatStore((s) => s.combatants);
  const activeIndex = useCombatStore((s) => s.activeIndex);
  const selectCombatant = useCombatStore((s) => s.selectCombatant);
  const active = inCombat ? (combatants[activeIndex] ?? null) : null;

  const parties = usePartyStore((s) => s.parties);
  /*
   * THIS campaign's mirrored party, and nothing else.
   *
   * It used to fall back to `activePartyId`, then to the first party on the device — both of which
   * are some OTHER campaign's. `syncCampaignParty` is the only thing that sets activePartyId, so the
   * moment it doesn't run (a party we haven't read yet) those fallbacks handed the GM campaign A's
   * party while standing in campaign B: A's PCs added to B's initiative order, A's per-player notes
   * and turn history edited from B. An unmirrored campaign resolves to '' and says "Party not
   * found." — the honest answer, and the sync below makes sure that's only ever momentary.
   */
  const partyId = parties.find((p) => p.campaignId === m.id)?.id ?? '';

  /*
   * The real characters' stats, in the tracker's own PcStats shape.
   *
   * This is what makes "Show player AC & saves in initiative order" and the party cards' "Stats
   * shown" sections work: the tracker knows how to display these, it just never had the numbers in
   * the embedded view. Computed once per roster change; keyed by charId (a card's key, and a PC row's
   * first one — pcStatsContext joins a row by its character id, so a rename on either side keeps the
   * link) and by name (a row with no character id: typed in by hand, or saved before ids were kept).
   */
  const pcStats = useMemo(() => {
    const byName = new Map<string, PcStats>();
    const byId = new Map<string, PcStats>();
    for (const mem of members) {
      const sheet = sheetById.get(mem.charId);
      if (!sheet) continue;
      // The PLAYED character, not the build: the numbers the GM reads have to be the ones on the
      // player's sheet right now — damage taken, conditions in effect.
      const stats = computePcStats(livePlay(sheet, content), content);
      byName.set(mem.name.trim().toLowerCase(), stats);
      byId.set(mem.charId, stats);
    }
    return { byName, byId };
  }, [members, sheetById, content]);

  /** Is an Update of ours still waiting for THIS character? The same staleness test the party cards
   *  use: a chip must never outlive the player's own publish, and `mem.updatedAt` is that publish.
   *  `gmPendingEdit` also refuses to answer for a character the signed-in account owns, so a GM who
   *  plays in their own campaign gets no overlay and no chip here either — the same rule the cards
   *  and the sheet follow, kept in the one place all three read through (../sheet/gmSync.ts). */
  const pendingFor = (mem: PartyMember): boolean => {
    const edit = gmPendingEdit(m.id, mem.charId);
    return !!edit && pendingEditStillStands(edit, memberPublishedRow(mem));
  };

  /** THE ONE SUMMARY every GM-side surface in this view draws from — and it takes the whole member
   *  precisely so that no surface here can decide to withhold the player's own half of it. See
   *  `memberCardSummary` (../sheet/memberSheets.ts) for what withholding it cost. */
  const summaryFor = (mem: PartyMember, sheet: SavedChar): PartySummary => memberCardSummary(mem, sheet, content);

  /*
   * The members again, but with the summary RE-DERIVED from the player's live sheet — keyed by charId,
   * and found for a PC row through `memberOfRow` (the tracker's own `isSamePc`: the row's character id,
   * its name only when it has none), so a row the GM renamed, or a character the player renamed, still
   * gets its card in the pane.
   *
   * This is what a PC's pane card reads. (The dashboard's cards go through the same answer, by way of
   * `roster.byId` and PartyMembers' `summarize` prop.) PartyMembers is unmounted the moment the GM
   * leaves the dashboard for the workspace, so `mem.summary` there is frozen at whatever the last
   * visit fetched, and the pane needs an answer that doesn't depend on it. The sheets in
   * `sheetById` keep arriving either way (pcSheetTruth subscribes per member for the life of the
   * mount), so the card in the pane shows the HP and conditions the player has right now.
   *
   * ⚠ `memberSummary`, NOT a bare `computeSummary`. Re-deriving on its own was the second half of the
   * owner's report from inside the tracker itself: this pane card showed no Encumbered while the
   * dashboard card two clicks away (drawn from the player's published summary) showed it, because a
   * condition derived from item Bulk depends on which device's data you ask. `memberSummary` is the
   * one reconciliation — this device's derivation, plus anything only the player's app could reach.
   */
  const liveMembers = useMemo(() => {
    const map = new Map<string, PartyMember>();
    for (const mem of members) {
      const sheet = sheetById.get(mem.charId);
      map.set(mem.charId, sheet ? { ...mem, summary: summaryFor(mem, sheet) } : mem);
    }
    return map;
    // `summaryFor` is defined just above and closes over the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, sheetById, content, pendingVersion]);
  /** The member a PC row is — the tracker's own rule (`isSamePc`), the one its add dedupe, the "+"
   *  button and the sheet seam use, so the pane can't disagree with them about who a row is. A row two
   *  members answer to (a hand-typed name they share) is neither's, as it is to the seam (pcSheetTruth
   *  WHICH ROW). */
  const memberOfRow = useCallback(
    (c: { name: string; charId?: string }): PartyMember | undefined => {
      const hits = members.filter((x) => isSamePc(c, { name: x.name, charId: x.charId }));
      return hits.length === 1 ? liveMembers.get(hits[0].charId) : undefined;
    },
    [members, liveMembers],
  );

  /*
   * Mirror the campaign's PCs into the tracker's OWN party store (the party tagged with this
   * campaign). This is the bridge that lets the tracker's native features act on the real characters
   * instead of an empty local party:
   *   • PartyView's "Add to Initiative" now adds these PCs (with real HP) to the order, and
   *   • the turn timer's "Save to Averages" matches them by name and records per-player turn history
   *     (which the per-player turn-time graph on the cards then reads).
   * It also makes this the active party, so `partyId` resolves to it. useLayoutEffect so the party
   * exists before the first paint (no "Party not found" flash) — and it runs even for an empty list a
   * read actually RETURNED, because PartyMembers only mounts once a party exists and it is what fills
   * the list in. An empty list nobody read is a different thing entirely; see the guard below.
   */
  const syncCampaignParty = usePartyStore((s) => s.syncCampaignParty);
  const hostPcs = useMemo(
    () =>
      members.map((mem) => ({
        charId: mem.charId,
        name: mem.name,
        // The published summary is what the player's own app derived; the computed sheet stats are
        // the fallback for a member whose sheet hasn't arrived yet.
        maxHP: mem.summary?.hpMax || pcStats.byId.get(mem.charId)?.maxHP,
      })),
    [members, pcStats],
  );
  useLayoutEffect(() => {
    // …but NOT before a read has actually succeeded: `known === null` means we don't know the party
    // yet, and mirroring a list we never read would prune every PC in it.
    //
    // The one exception is a campaign this device has NEVER mirrored: there is nothing to prune, and
    // without an (empty) party the GM whose read just failed — offline, or a missing
    // `campaign_characters` table — sits on "Party not found." for the life of the mount, with no
    // cards, no message and no way back short of leaving the campaign. With the empty party there,
    // PartyMembers mounts in the players slot, says what went wrong and keeps its own live
    // subscription, so the real list lands the moment the connection does.
    // Read through getState so `parties` isn't a dep: every sync writes a new parties array, which
    // as a dep would re-run this effect forever.
    if (!known && usePartyStore.getState().parties.some((p) => p.campaignId === m.id)) return;
    syncCampaignParty(m.id, m.name, hostPcs);
  }, [known, hostPcs, m.id, m.name, syncCampaignParty]);

  /*
   * ── THE GM'S OTHER DEVICE ────────────────────────────────────────────────────
   *
   * "I would like all of the data to be local and that is what the GM actually uses, to cut on lag;
   * but when I open another device I want to be able to see the current encounter if there is one,
   * and all of the saved encounters also need to be visible. So if there are 2 GM devices and one
   * updates something it needs to update on the second one."
   *
   * ../data/trackerSync.ts mirrors this ACCOUNT's tracker keys to `gm_tracker_state` (owner-only RLS
   * — a player can never read a GM's board) and back down to the same GM's other devices. It is
   * started here, at the campaign mount, rather than on the campaigns page:
   *   • its opening pull has to land BEFORE the `setScope` below, because that pull is what writes the
   *     other device's newer board into localStorage and setScope is what READS localStorage;
   *   • this is the component that knows whether the campaign is the offline local table;
   *   • it mirrors EVERY campaign's keys in one round, so starting it per opened campaign costs
   *     nothing — one uid, one channel, one pull.
   *
   * NEVER for the local table (ruling 3: no account at all) and never for a player's membership — a
   * player's device has no GM board to mirror. `startTrackerSync` is itself a no-op with no uid or no
   * Supabase client, so this is belt and braces, and the ONE place the policy is written down.
   */
  const auth = useAuth();
  const syncUid = !offline && m.role === 'gm' && auth.status === 'signed-in' ? (auth.session?.user.id ?? null) : null;
  /*
   * `false` until that opening pull has settled. The scope effect below waits for it — and so does
   * the whole view (the early return further down), because a board nobody can touch yet is the only
   * honest version of "not scoped yet".
   *
   * Drawing the board first looks harmless (the pull would correct it a moment later), but a GM who
   * TOUCHES a stale board in that window marks its key dirty, and a dirty key beats the cloud — it
   * has to, an unsent local change is a real change. This device's old copy would then be pushed over
   * the other device's newer one. Waiting is what keeps a GM's change on the other device from being
   * overwritten by this app.
   */
  /*
   * …but NOT on a remount of a mirror that never went down. Campaign settings unmounts this view and
   * mounts it again on the way back, and the campaigns page holds the mirror across that round trip
   * (see CampaignsPage's mirror hold), so the rows are already in localStorage: there is no pull to
   * wait for and nothing stale to hide. Re-entering cost the whole blackout — a full network round
   * trip of "Opening the table…" — every single time. A mirror that really did come down is a new
   * session and waits like any first open, which is the guarantee above, unchanged.
   */
  const [synced, setSynced] = useState(() => isTrackerSyncReady(syncUid));
  useEffect(() => {
    // BACK TO THE GATE on every restart of the mirror. `synced` only ever went true, so a session that
    // left and re-entered 'signed-in' (a token refresh) tore the mirror down and started a new one —
    // with a new opening pull in flight — over a board that was already drawn and editable. That is the
    // exact window this state exists to close, so it closes again. Where nothing is mirrored the `go()`
    // below runs in this same effect, so the local table never sees a flicker.
    setSynced(isTrackerSyncReady(syncUid));
    let live = true;
    const go = () => {
      if (live) setSynced(true);
    };
    // THE CAP. Neither a slow network nor a session that hasn't answered yet may hold the board
    // hostage: the GM plays off local data, and a late pull simply lands on top of it.
    const cap = setTimeout(go, SYNC_READY_CAP_MS);
    if (!syncUid) {
      // The local table, a player's membership, signed out: nothing to wait for. `loading` is the one
      // exception — auth may be about to say "signed in", and scoping now is exactly the stale-board
      // window above, so it waits for the cap instead.
      if (auth.status !== 'loading') go();
      return () => {
        live = false;
        clearTimeout(cap);
      };
    }
    const { stop, ready } = startTrackerSync({ uid: syncUid });
    void ready.then(go); // `ready` never rejects — a failed pull resolves and the sync stays local
    return () => {
      live = false;
      clearTimeout(cap);
      // Unmount, or a sign-out (syncUid drops to null and re-runs this): stop() unsubscribes and
      // flushes whatever push was still pending.
      stop();
    };
  }, [syncUid, auth.status]);

  /*
   * THE TOOLS ROW IS PART OF THE BOARD, and it is rendered by CampaignsPage — in Heroes Heaven's own
   * chrome, outside this component, where `synced` cannot reach it. It is not decoration: the turn
   * timer chip inside it calls pause/resume/discard/removeTurn/saveTurnsToAverages straight on the
   * combat store, and until `setScope` has run that store persists to the UNSCOPED key — the
   * standalone tracker's board, the one thing this view must never touch ("NOTHING TO EDIT UNTIL THE
   * BOARD IS THE RIGHT ONE" below). "Save to Averages" additionally writes pf2e-parties and
   * pf2e-dm-turn-average, both of which the GM mirror uploads. So the row waits with the table.
   */
  useEffect(() => {
    trackerUi.setBoardReady(synced);
    return () => trackerUi.setBoardReady(false);
  }, [synced]);

  /*
   * Scope the tracker's combat + GM-screen layout to THIS campaign, so two campaigns don't share one
   * initiative order. `setScope` lands with the tracker's own store work; guarded so this seam keeps
   * working (and its tests keep passing) against a build that doesn't have it yet.
   *
   * THE LOCAL TABLE IS A REAL SCOPE, NOT THE BARE KEY. `m.id` is `local` there, so its board persists
   * under `pf2e-current-combat:local`. It deliberately does NOT fall back to the unscoped
   * `pf2e-current-combat`: that key holds whatever the STANDALONE tracker saved before scoping
   * existed, and adopting it would drop a signed-out user into someone's half-finished old encounter
   * (and, worse, write over it). The GM mirror leaves both alone — it carries campaigns that are real
   * memberships, and `local` is not one.
   *
   * `synced` is the gate described above: this reads localStorage, so it must not run until the pull
   * that fills localStorage has finished (or given up). It is true immediately when nothing is being
   * mirrored, so the local table scopes on the very next commit.
   */
  useEffect(() => {
    if (!synced) return;
    const setScope = (useCombatStore.getState() as { setScope?: (id: string | null) => void }).setScope;
    if (typeof setScope !== 'function') return;
    setScope(m.id);
    return () => setScope(null);
  }, [m.id, synced]);

  /*
   * Global Search over ALL of Heroes Heaven's content (feats, spells, items, ancestries, rules,
   * traits, conditions, actions, deities, …) — like the Archives search. Built once from the content DB
   * this view already holds; the few purely-mechanical buckets with no description are skipped. It
   * reaches the tracker's GlobalSearch through HostSearchProvider. Creatures stay searchable via the
   * tracker data (GlobalSearch adds them), since HH has no bestiary content.
   *
   * A RESULT OPENS AS ONE OF THE TRACKER'S OWN WINDOWS — the owner, 2026-10-01 (item 7): "Search
   * everything results open in the tracker's movable, windowed stat-block popup, not a static popup."
   * It used to open HH's description popup portalled to <body> (to keep HH's markup out of the tracker's
   * scoped stylesheet): centred over a dimmed page, one at a time, impossible to move. Now `render` draws
   * the page (HostPage) inside a movable, tabbed, dockable window — and the same page in a GM-screen pane
   * — and `controls` puts the popup's star in that window's header. The CSS this costs
   * is paid in campaign-tracker.css (list bullets the tracker's preflight strips) and ast.css (the
   * window chrome's insets). `open` is the HostSearch contract's other door, for a host that draws no
   * pages; this host draws them, so its `open` opens the same window.
   */
  // A confirm raised here must stay above every floating window (`dialogStyle` below), and the windows'
  // z climbs from 501 on each focus (windowStore keeps `topZ` at or above every one of them).
  const floatingTopZ = useWindowStore((s) => s.topZ);
  /*
   * The tracker's look, for the one HH surface this view still raises on <body> itself: a confirm
   * (undefined when the tracker inherits the app's look — then <body>'s own values ARE the tracker's).
   * The vars alone would not do: an HH element inherits <body>'s finished text colour and font, so
   * `hhSurfaceTheme` re-declares them as well. (A Search page used to be the other one, an HH popup on
   * <body> in a wrapper carrying this; item 7 made it a tracker window, which wears the tracker's look
   * by sitting inside this root.)
   */
  const hhPopupTheme = useMemo(() => hhSurfaceTheme(trackerVars), [trackerVars]);
  /*
   * …so a confirm raised from this view (Clear the order, a card's kick, the local table's "No
   * campaign settings") wears the same look, above every floating window. A confirm is a detached root
   * (src/sheet/confirm.tsx), so it gets this as an option, not a context; it is applied as the
   * overlay's inline style, never through `.tracker-root` — the tracker's scoped preflight must never
   * reach HH's markup. The z-index applies with or without a tracker look — HH's own 80 sits under a
   * window at 501. (The player's sheet raises its own confirms without this style, and the windows stay
   * up over that sheet: campaign-tracker.css lifts those above every window instead.)
   */
  const dialogStyle = useMemo<DialogStyle>(() => ({ ...hhPopupTheme, zIndex: floatingTopZ + 20 }), [hhPopupTheme, floatingTopZ]);
  /*
   * THE TRACKER'S OWN EXPORTS (the Encounter Manager's saved encounters) save through the app's one
   * export helper, src/sheet/download.ts (item 8). On the Android app that helper first asks — Save to
   * folder or Share — in a dialog it raises on <body>, OUTSIDE this root, at the confirm lift
   * campaign-tracker.css gives it (1600). The Encounter Manager asking is a tracker modal at 2000
   * (tracker.scoped.css `.modal-overlay`), and nothing between them forms a stacking context: the chooser
   * opened UNDER the manager, so the GM tapped Export and saw nothing happen (G8t refuter, 2026-10-13,
   * measured in Edge: a tap on "Save to folder" landed on the manager).
   * So while the host's export is in flight this root ISOLATES its own layers — one stacking context,
   * painted at the page's own level — and whatever the tracker draws (its modals, its windows, the dice)
   * stays under any dialog on <body>, whatever z-index either side uses. Only while in flight: the rest
   * of the time the windows keep floating over the sheet's own popups as designed
   * (test/tracker-windows-over-sheet.test.tsx). On the web and the PC app the save is done before the
   * browser paints, so nothing changes on screen there. test/download-platform-route.test.tsx.
   * That chooser is a pop-up opened in the tracker, so it wears the tracker's look (the owner,
   * 2026-10-01): the same `dialogStyle` every confirm raised here gets, read when the export starts (a
   * ref, so this callback — and every export button under the provider — is not rebuilt each time a
   * window comes to the front and `topZ` climbs).
   */
  const dialogStyleNow = useRef(dialogStyle);
  dialogStyleNow.current = dialogStyle;
  const [hostSaving, setHostSaving] = useState(0);
  const hostSave = useCallback<HostSave>(async (file) => {
    setHostSaving((n) => n + 1);
    try {
      // Called before the first await, so the web's anchor still clicks inside the GM's own click. A
      // name the helper refuses (thrown) and a failed save (rejected) both reach the manager's notice.
      return await downloadText({ ...file, style: dialogStyleNow.current });
    } finally {
      setHostSaving((n) => n - 1);
    }
  }, []);
  const rootStyle = useMemo<CSSProperties | undefined>(
    () => (hostSaving > 0 ? { ...trackerVars, isolation: 'isolate' } : trackerVars ?? undefined),
    [hostSaving, trackerVars],
  );
  // The index itself — names, older names, a detail line, no duplicate scrapes: hostSearchRecords.ts.
  const searchRecords = useMemo<HostSearchRecord[]>(() => hostSearchRecords(content), [content]);
  const hostSearch = useMemo(() => {
    const open = (bucket: string, id: string, at?: OpenAt) => openHostWindow(content, bucket, id, at);
    return {
      records: searchRecords,
      open,
      // The page in a window or a GM-screen pane: its links open another window where they were clicked.
      render: (bucket: string, id: string) => <HostPage content={content} bucket={bucket} id={id} onOpen={open} />,
      // …and the popup's star, in that window's (or pane's) header.
      controls: (bucket: string, id: string) => <HostPageControls content={content} bucket={bucket} id={id} />,
    };
  }, [searchRecords, content]);
  // The star in every description popup here (findHostTab above).
  const gmRoot = useGmLayoutStore((s) => s.root);
  const gmPin = useMemo<PinDescApi>(() => ({
    where: 'GM screen',
    has: (n) => { const ref = hostRefOf(n); return !!ref && !!findHostTab(gmRoot, ref); },
    toggle: (n) => {
      const ref = hostRefOf(n);
      if (!ref) return;
      const gm = useGmLayoutStore.getState();
      const hit = findHostTab(gm.root, ref);
      if (hit) gm.closeTab(hit.leaf, hit.idx);
      else gm.addPopup({ type: 'host', ref, title: n.title });
    },
  }), [gmRoot]);

  // "Stats shown" — the per-party override, else the global default. The party page's dropdown
  // (PcDetailControls) writes party.pcDetail; both live in the tracker's own stores.
  const globalDetail = useSettingsStore((s) => s.pcDetail);
  const partyDetail = parties.find((p) => p.id === partyId)?.pcDetail;
  const pcDetail = partyDetail ?? globalDetail;

  // Leaving the campaign resets the tracker UI (so re-entering doesn't pop the last panel open) — but
  // that's driven by CampaignsPage when the view returns to the campaigns LIST, NOT by this component
  // unmounting. Opening campaign settings unmounts this too, and back from there must restore the
  // exact view the GM left (a combat pane, the GM screen, the open windows), so a reset on every
  // unmount would be wrong. The windows ride that same reset (trackerUi.onReset, top of this file).

  /**
   * The campaign's characters the GM can actually open, by charId — the sheet plus the owner id,
   * which travels with the MEMBER because a published SavedChar doesn't carry who to address a GM
   * edit to. An initiative row finds its member through `memberOfRow` above (its character id first,
   * its name only when it has none).
   */
  const roster = useMemo(() => {
    const byId = new Map<string, { entry: SavedChar; ownerId: string; summary?: PartySummary }>();
    for (const mem of members) {
      const entry = sheetById.get(mem.charId);
      // `summary` travels with the sheet, through the SAME reconciliation the cards use, so the sheet
      // a card opens cannot contradict the card — and cannot resurrect a condition a pending GM edit
      // has already removed (which the raw published summary did).
      if (entry) byId.set(mem.charId, { entry, ownerId: mem.ownerId, summary: summaryFor(mem, entry) });
    }
    return { byId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, sheetById, content, pendingVersion]);

  // ── The GM's unpushed working copy ───────────────────────────────────────────
  /*
   * There is exactly ONE editable sheet in this view now: the full-screen one a card opens. A PC's
   * pane holds their card, not a GmEditSheet, so there are no longer several working copies tiled
   * across the pane tree to ask about one at a time — and no pane swap that can silently destroy one
   * (the registry + pane-swap guard that existed for that went with the sheets).
   */
  const fullSheetRef = useRef<GmEditHandle>(null);

  /** Every way of leaving/closing the whole view has to clear the full-screen sheet too. */
  const [fullSheetId, setFullSheetId] = useState<string | null>(null);
  const leaveFullSheet = useCallback(
    async (reason?: { title: string; message: string }): Promise<boolean> => {
      if (!fullSheetId || !fullSheetRef.current) return true;
      return await fullSheetRef.current.confirmLeave(reason);
    },
    [fullSheetId],
  );

  // Both routes out of the view — campaign settings and leaving the campaign — unmount that same
  // sheet, so both ask `leaveFullSheet` the same question before they go.

  /*
   * Back / Escape closes the OPEN review sheet before it leaves the campaign — it's a layer on top of
   * the tracker, so one back press should peel it, not exit the whole campaign. Registered on the
   * shared dismiss stack ABOVE CampaignsPage's "leave campaign", and its Back arrow now fires that
   * stack too, so both the arrow and Escape close the sheet first.
   *
   * `under`: the sheet is drawn UNDER the tracker's floating windows (z 30 against their 501+), so while
   * one is open the windows' handler below takes the press first, whichever opened first (useEscapeClose
   * DismissUnder; everything the sheet registers itself is under them too — the boundary round it below).
   */
  useBackHandler(
    fullSheetId != null,
    () => {
      void (async () => {
        if (await leaveFullSheet()) setFullSheetId(null);
      })();
    },
    { under: true },
  );

  /*
   * Escape inside a tracker overlay used to LEAVE THE CAMPAIGN.
   *
   * The overlays are the tracker's own components and close themselves on their own terms; the shared
   * dismiss stack knew nothing about them, so its topmost handler was still "leave the campaign" —
   * one press out of a search box and the GM was out of it, unpushed pane edits and all. Registering
   * each open overlay puts it ABOVE the base handler below (the stack is LIFO and these push when
   * they open), so Escape peels the overlay first and only the next press leaves.
   *
   * Each one is gated on `synced` as well, because the overlays themselves render BELOW the early
   * return further down: while the board is still opening there is nothing on screen for these to
   * close, and a flag left over from before (opening campaign settings and coming back deliberately
   * doesn't reset the tracker UI) would put a handler on the stack that swallows an Escape and closes
   * nothing — the same LIFO trap, one level down.
   *
   * The first four are drawn ABOVE the floating windows (`.modal-overlay` at 2000 and up, the Search box
   * at 9500), so while one is open the windows' handler stands down (below). The Customize panel is drawn
   * UNDER them (`.tc-overlay`, z 60), so a window open over it takes the press first (`under`).
   */
  useBackHandler(synced && monsterSearchOpen, () => trackerUi.setMonsterSearch(false));
  useBackHandler(synced && searchOpen, () => trackerUi.setSearch(false));
  useBackHandler(synced && customOpen, () => trackerUi.setCustom(false));
  useBackHandler(synced && encountersOpen, () => trackerUi.setEncounters(false));
  useBackHandler(synced && appearanceOpen, () => trackerUi.setAppearance(false), { under: true });

  /*
   * LEAVING THE CAMPAIGN IS THIS VIEW'S DECISION.
   *
   * It used to be the campaigns page's: its own "back to the list" sat at the bottom of the dismiss
   * stack, so Escape and the Back arrow unmounted the tracker — and every open sheet's unpushed
   * working copy with it — without a word, while the settings route (which unmounts exactly the
   * same sheets) asked first. Registering the base handler HERE puts the same gate on both routes
   * and, because only the topmost handler runs, also stops a press this view has already spent
   * (a tracker popup closing itself) from falling through and leaving.
   */
  /*
   * …AS OF THE KEY PRESS, not as of the moment this handler runs. A browser runs a microtask checkpoint
   * after every event listener, and React 18 commits a keydown's state update in one: so by the time
   * the stack's `window` listener calls this, the row menu's own `document` listener has already closed
   * the menu AND React has taken it off the DOM — `trackerPopupOpen()` said "nothing open" and the same
   * press left the campaign (the local table: the whole page). jsdom dispatches with no checkpoint
   * between listeners, so only the browser ever showed it (found in the 2026-10-10 browser proof;
   * test/bug-tracker-seam.test.tsx flushes React where the browser does). A capture listener on
   * `window` runs before every other listener for the press, so it reads the DOM as the GM saw it.
   * Spent with this press: a Back arrow later (no key) asks the DOM afresh.
   */
  const popupAtPress = useRef(false);
  /* …and, the same way, as of the key press: a tracker modal on screen (`trackerModalOpen` — it closes
   * itself from a `document` listener, so by the time a `window` handler runs the browser has already
   * taken it off the DOM), and whether the press was typed in a tracker text box (`editableInTracker`)
   * — and if so, which floating window holds that box (`[data-float-win]`, FloatingWindow's root, whose
   * value is the window's id), or none. All spent with this press, like `popupAtPress`. */
  const modalAtPress = useRef(false);
  const modalOverWindowsAtPress = useRef(false);
  const editableAtPress = useRef(false);
  const boxWinAtPress = useRef<string | null>(null);
  /* …and whether the press is a REPEAT — the key held down. A held Escape repeats, and each repeat
   * reached this stack as a press of its own: whatever the first press closed — a popup of the tracker's
   * that took it from its own `document` listener and spent it (the stat block's ☰ menu; the condition
   * picker, where the GM adds Dying, until it became a registered layer on 2026-10-14), the row's
   * right-click menu, a window — the repeats went on to close every window and then LEFT THE CAMPAIGN (the
   * G7s refuter, 2026-10-13: a held Escape from the condition picker left the campaign twice over). A
   * repeat now closes no window and never leaves: one press, one layer, as the tracker's own modals
   * already hold it (tracker/src/utils/spendEscape). test/bug-tracker-escape-boxes.test.tsx (i). */
  const repeatAtPress = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      popupAtPress.current = trackerPopupOpen();
      modalAtPress.current = trackerModalOpen();
      modalOverWindowsAtPress.current = trackerModalOverWindows();
      editableAtPress.current = editableInTracker(e.target);
      boxWinAtPress.current =
        editableAtPress.current && e.target instanceof Element
          ? (e.target.closest('[data-float-win]')?.getAttribute('data-float-win') ?? null)
          : null;
      repeatAtPress.current = e.repeat;
      setTimeout(() => {
        popupAtPress.current = false;
        modalAtPress.current = false;
        modalOverWindowsAtPress.current = false;
        editableAtPress.current = false;
        boxWinAtPress.current = null;
        repeatAtPress.current = false;
      }, 0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useBackHandler(true, () => {
    // A held key's repeat never leaves: the first press did what it did (`repeatAtPress` above).
    if (repeatAtPress.current) return;
    if (trackerPopupOpen() || popupAtPress.current) return;
    // A text box's Escape is "cancel what I was typing" (editableInTracker), and a tracker modal's is
    // that modal's — never "leave the campaign". Android's Back is no key press (a `popstate`, so nothing
    // was recorded "at the press"): a tracker modal still on screen that no Back handler below closes (an
    // unregistered `.modal-overlay`; the turn-time graph was one until 2026-10-14) keeps the campaign up too.
    if (editableAtPress.current || modalAtPress.current || trackerModalOpen()) return;
    void (async () => {
      if (await leaveFullSheet()) onLeave();
    })();
  });

  /*
   * ESCAPE PEELS THE TOP WINDOW FIRST (item 7). A Search page is a floating window now, and windows had
   * no Escape at all: they render INSIDE this root, so `trackerPopupOpen()` never sees one, and with only
   * a window open the press fell to the base handler above and LEFT THE CAMPAIGN. So while any window is
   * open, this sits above the base handler and closes the highest one; the next press closes the next,
   * and with none left Escape leaves as before. (Counting windows in `trackerPopupOpen()` instead would
   * make the base handler do nothing at all — and leaving by Escape impossible while any window exists.)
   *
   * It stands down for a press that a body popup took (the row's right-click menu over a window closes
   * itself from its own `document` listener): asked as of the key press, exactly like the base handler,
   * or one Escape out of that menu would close the window under it too.
   *
   * Declared AFTER the base handler and gated on `synced` (the windows render below the early return):
   * while the board is still opening there is no window on screen for it to close, and a press then
   * must not close one the GM has not seen yet. Back from campaign settings with windows still open, it
   * lands above the base handler again.
   *
   * WHAT IS DRAWN UNDER THE WINDOWS, AND WHAT OVER THEM. The stack runs in push order; the screen does
   * not. A cover entry (useEscapeClose DismissUnder): everything drawn UNDER the windows is registered
   * `under` — the player's sheet (z 30; its own handler above and, through the boundary round it,
   * every popup, overlay and tab the sheet registers while a window stays open over it) and the
   * Customize panel (z 60) — so a window takes the press before any of them, whichever opened first.
   * The tracker's four overlays are drawn OVER the windows (2000 and up), so while one is open this
   * stands down: a window opened from inside one (the Custom creature's stat block links) used to push
   * this above the overlay's handler, and Escape closed that window, hidden behind the overlay, while
   * the overlay stayed. A confirm (a detached root over the windows, campaign-tracker.css) is plain
   * LIFO and opens last. test/tracker-windows-over-sheet.test.tsx, test/gm-search-popup.test.tsx.
   * So does every OTHER tracker modal drawn over the windows (`trackerModalOpen`: the Encounter Building
   * tables, Link Stat Block, the encounter-table editor, the advanced condition editor, a party card's
   * turn-time graph) — asked as of the press, since a modal that closes itself from its own `document`
   * listener and lets the press go on is off the DOM before this runs (the graph did, until 2026-10-14; a
   * stand-in keeps the record guarded). Without it Escape closed the window hidden BEHIND the modal (the
   * item-7 refuter, 2026-10-13). test/bug-tracker-escape-boxes.test.tsx (c).
   * And for an Escape typed in a tracker TEXT BOX outside every window (the stat-block pane's, the GM
   * screen's, the initiative rail's): that press is "cancel what I was typing", exactly as the base
   * handler reads it, and it closed whichever unrelated window was on top (the G3 refuter, 2026-10-13).
   * A box INSIDE a window is that window's own, and Escape there closes THAT window — not the top one:
   * focus reached by the keyboard (Tab) raises no window, so the box's can sit under another, and
   * `closeTop` closed the unrelated one above it (the G3 refuter, round 2).
   * A REPEAT (the key held down) closes no window: the first press closed one layer, and the held key
   * peeled every window after it (the G7s refuter, 2026-10-13; `repeatAtPress` above).
   */
  const openWindows = useWindowStore((s) => s.wins.length);
  const overlayAboveWindows = monsterSearchOpen || searchOpen || customOpen || encountersOpen;
  // How many of the tracker's own modals are open (tracker/src/utils/spendEscape useEscapeCloses) — the
  // Back handler below. While one is, this handler is off the stack: a window opened from inside one drawn
  // over the windows (a converter's preview links) would otherwise land ABOVE that Back handler and take
  // the press for a window hidden behind the modal. (A modal inside a window is painted UNDER a window
  // opened since: the Back handler below closes that window itself.)
  const modalCount = useTrackerModalCount();
  /* The windows' close for a press (or a Back) that is theirs. `modalOver` says whether a tracker modal is
   * drawn over the window this would close — as of the key press, or (Back is no key press) on screen now. */
  const closeWindowForPress = (modalOver: () => boolean): void => {
    if (repeatAtPress.current) return;
    if (trackerPopupOpen() || popupAtPress.current) return;
    if (modalOver()) return;
    if (editableAtPress.current) {
      if (boxWinAtPress.current) useWindowStore.getState().close(boxWinAtPress.current);
      return;
    }
    useWindowStore.getState().closeTop();
  };
  useBackHandler(
    synced && openWindows > 0 && !overlayAboveWindows && modalCount === 0,
    () => closeWindowForPress(() => modalAtPress.current || trackerModalOpen()),
    { cover: true },
  );

  /*
   * ANDROID'S BACK CLOSES THE TRACKER MODAL ON TOP (G7s, 2026-10-13). On the phone Back reaches the
   * dismiss stack as a `popstate`, never as a key: the tracker's modals close themselves on Escape from a
   * `document` keydown listener (useEscapeCloses) that Back never reaches, and `modalAtPress` above is set
   * only from a keydown — so Back with the Encounter Building tables up closed the window hidden behind
   * them, or LEFT THE CAMPAIGN. While any tracker modal is open this sits above the windows' handler and
   * the base handler (a cover, like the windows': the sheet and Customize drawn under the modals wait
   * their turn) and closes the top one — covered all over by another layer it closes nothing, and
   * that layer, registered later, is above this anyway. test/bug-tracker-escape-boxes.test.tsx (BACK).
   * The count is the tracker's registrations, not the DOM: a registered layer with no `.modal-overlay` —
   * the condition picker, the GM screen's + menu and its "Add to GM Screen" picker (owner's list
   * 2026-10-14, items 1 and 3: Back with one up left the campaign) — is closed here like any other.
   * The keyboard's Escape reaches it past an open modal only when the modal's own listener left the
   * press unspent for a layer drawn over all of the modal — a body popup, a layer with a text box — and
   * such a layer that closes itself on that press without spending it is gone by the time this runs: it
   * closed the modal under the layer too (the G7s refuter, 2026-10-13). closeTopTrackerModal closes
   * nothing while a press the modal left to a layer is still on its way, so that press closes the layer
   * alone. test/bug-tracker-escape-boxes.test.tsx (g).
   * It does NOT stand down for a tracker popup on <body> still up when Back comes, as the windows' and
   * the base handlers do: the body popup that shows over a modal is a link's preview tooltip (a stat
   * block's links, as in the Edit converter's preview: BodyPortal, `pointer-events: none`), which a tap
   * can leave up — Back would do nothing while it showed. Closed with its modal, it goes with it. (The
   * combatant menu opens from the initiative rail and from a stat block's right-click or ☰, which every
   * modal is drawn over; a right-click inside the stat block's Edit converter is the converter's own and
   * opens no menu over it — TextConverter keeps it, CombatantMenu.test.tsx.)
   * A MODAL UNDER A WINDOW. A stat block's Edit converter opened in a floating window is painted at that
   * window's z-index, and a window opened since (a link in its preview) or raised since is painted over
   * it (spendEscape underAnotherWindow). That window is the layer on top: this closes it — as the windows'
   * handler would, which is off the stack while a modal is open — and the converter, its unsaved edits
   * with it, stays (the G7s refuter, 2026-10-13: Back and Escape alike closed the converter hidden under
   * the window). A modal drawn over every window (`trackerModalOverWindows`) still keeps the press.
   * test/bug-tracker-escape-boxes.test.tsx (h), BACK. The same for a layer drawn in the page UNDER the
   * windows that one covers all over — the GM screen's + menu (2026-10-14): that window is on top, and
   * this closes it first (test/bug-tracker-escape-boxes.test.tsx (k), BACK).
   */
  useBackHandler(
    synced && modalCount > 0,
    () => {
      if (topTrackerModalUnderAWindow()) {
        closeWindowForPress(() => modalOverWindowsAtPress.current || trackerModalOverWindows());
        return;
      }
      closeTopTrackerModal();
    },
    { cover: true },
  );

  // ── Click a combatant → open it in the workspace ─────────────────────────────
  /*
   * The tracker's own gesture, restored (App.tsx does exactly this): select it, open/focus its pane
   * tab, and show the workspace. Passing this as `onCombatantClick` is also what makes the rows
   * highlight — InitiativeTracker marks a row selected off layoutStore's hoveredCid, which stays
   * null while nothing ever opens a pane.
   */
  const handleCombatantClick = useCallback(
    (id: string) => {
      selectCombatant(id);
      useLayoutStore.getState().open(id);
      trackerUi.showMain('combatant');
    },
    [selectCombatant],
  );

  // ── Drag a party card into the initiative order ──────────────────────────────
  /*
   * The GM drags a player's card off the party dashboard and drops it on the rail: that PC joins the
   * order with NO initiative, exactly as PartyView's "Add to Initiative" adds them (isPC, the real
   * maxHP and the character id, deduped through isSamePc). Where in the list it was dropped is
   * ignored — an un-rolled combatant lands where un-rolled combatants land, and a made-up
   * initiative would be a number the GM never rolled.
   *
   * The rail is the seam's own element, so nothing in tracker/src has to know this gesture exists.
   * The initiative rows are themselves draggable (onto a pane, to open a stat block) and carry a
   * different type, which is why every leg below checks for ours before it claims the event.
   */
  const [dropOver, setDropOver] = useState(false);
  const [dropMsg, setDropMsg] = useState('');
  useEffect(() => {
    if (!dropMsg) return;
    const t = setTimeout(() => setDropMsg(''), 3000);
    return () => clearTimeout(t);
  }, [dropMsg]);
  const onRailDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PARTY_MEMBER_DRAG)) return;
    // Without BOTH preventDefaults the browser refuses the drop and runs its own navigation instead.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropOver(true);
  }, []);
  const onRailDragLeave = useCallback((e: React.DragEvent) => {
    // dragleave also fires crossing between children — only a pointer that really left the rail counts.
    const to = e.relatedTarget as Node | null;
    if (to && e.currentTarget.contains(to)) return;
    setDropOver(false);
  }, []);
  const onRailDrop = useCallback((e: React.DragEvent) => {
    setDropOver(false);
    const raw = e.dataTransfer.getData(PARTY_MEMBER_DRAG);
    if (!raw) return; // something else's drag (an initiative row onto a pane) — leave it alone
    e.preventDefault();
    let pc: PartyMemberDrag;
    try {
      pc = JSON.parse(raw) as PartyMemberDrag;
    } catch {
      return;
    }
    // addCombatant refuses a second PC of the same name on its own; saying so is what keeps a drop
    // that quietly does nothing from reading as a broken drop target.
    if (!addPartyMemberToInitiative(pc)) setDropMsg(`${(pc.name ?? '').trim()} is already in the initiative order.`);
  }, []);

  // ── Drag a delayed creature back out of the Delay area ───────────────────────
  /*
   * Dropped ANYWHERE on the initiative list, it does exactly what the area's Return button does —
   * WHERE it lands is ignored on purpose, because the position is not the GM's to choose: the print
   * (and the owner) put the returning creature immediately ahead of the turn it interrupted. The
   * handler sits on the seam's own wrapper, so the tracker's list component knows nothing about it.
   */
  const onReturnDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DELAY_RETURN_MIME)) return;
    e.preventDefault();
    // Matches the effectAllowed the delayed row's drag sets — a mismatched pair resolves the drag
    // operation to none and the browser delivers no drop, which is how the Delay zone shipped dead.
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const onReturnDrop = useCallback((e: React.DragEvent) => {
    const id = e.dataTransfer.getData(DELAY_RETURN_MIME);
    if (!id) return; // an initiative row heading for a pane — not ours
    e.preventDefault();
    useCombatStore.getState().returnFromDelay(id);
  }, []);

  // ── The rail: collapse + resize ──────────────────────────────────────────────
  /*
   * Straight from the tracker's App.tsx — same localStorage key, same 480 ceiling, same
   * measured floor. InitiativeTracker only DRAWS the collapse chevron when handed `onCollapse`, and
   * only reports its own minimum width through `onMinWidthMeasured`, so a props-less
   * <InitiativeTracker /> is inert by design: nothing was broken, it simply was never wired up.
   */
  const showInitCollapse = useSettingsStore((s) => s.showInitCollapseButton);

  /*
   * While the tracker is on screen, Ctrl+Z means UNDO THE COMBAT — the damage, condition, defeat or
   * turn you just applied here. HH's global shortcut is the character-undo timeline and would
   * otherwise silently revert an unrelated character edit instead; the claim makes it stand down, so
   * one press does exactly one thing. See ./combatUndoClaim.ts.
   */
  useEffect(() => claimCombatUndo(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      // Ctrl+K opens Search. The tools button has advertised the shortcut since it was written, but
      // the binding lived in the tracker's own App — which HH doesn't mount — so it did nothing here.
      if (k === 'k') {
        e.preventDefault();
        trackerUi.setSearch(true);
        return;
      }
      if (k !== 'z' && k !== 'y') return;
      // A focused text field keeps the browser's own text undo — same rule HH's handler uses.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (k === 'y' || (k === 'z' && e.shiftKey)) useCombatStore.getState().redo();
      else useCombatStore.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem('pf2e-sidebar-collapsed') === '1',
  );
  const setRailCollapsedPersist = (v: boolean) => {
    setRailCollapsed(v);
    try {
      localStorage.setItem('pf2e-sidebar-collapsed', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const [railWidth, setRailWidth] = useState(280);
  const [railMinWidth, setRailMinWidth] = useState(220);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, width: 0 });

  /*
   * Tablet-width guard. railWidth (280–480px, GM-dragged this session only — it does not persist)
   * is fine on a desktop but eats the middle workspace on a tablet-ish window. effectiveRailWidth
   * caps only the RENDERED width to ~30% of the viewport (never below railMinWidth) — railWidth
   * itself is never written here, so resizing the window and back never loses the GM's dragged
   * width, and the drag ceiling below stays the flat 480 it always was. railCap stores the DERIVED
   * cap (Infinity once the guard is off), not the raw viewport width, so React's same-value bailout
   * swallows resize frames that don't change the cap — every frame on a desktop-width window. A
   * plain 0.3*viewportWidth cap wouldn't clear 480 until 1600px (0.3*1400=420), quietly shrinking
   * common ~1400px laptop windows that are desktop, not tablet — so DESKTOP_MIN_WIDTH (at or above
   * it, the cap is off) switches the cap off outright there.
   */
  const DESKTOP_MIN_WIDTH = 1400;
  const railCapFor = (w: number, minW: number) => (w >= DESKTOP_MIN_WIDTH ? Infinity : Math.max(minW, Math.floor(w * 0.3)));
  const [railCap, setRailCap] = useState(() => railCapFor(window.innerWidth, railMinWidth));
  useEffect(() => {
    setRailCap(railCapFor(window.innerWidth, railMinWidth));
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRailCap(railCapFor(window.innerWidth, railMinWidth)));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [railMinWidth]);
  const effectiveRailWidth = Math.min(railWidth, railCap);

  const onRailDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      dragStart.current = { x: e.clientX, width: railWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [railWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // Flat 480 ceiling, same as before the tablet cap existed — the viewport only narrows the
      // RENDERED width (effectiveRailWidth above), never the stored railWidth the GM dragged to.
      // Tying this to viewportWidth would silently shrink a desktop drag ceiling on 1400–1599px
      // windows and would let a narrow-window nudge permanently overwrite a wider dragged width.
      setRailWidth(Math.min(480, Math.max(railMinWidth, dragStart.current.width + e.clientX - dragStart.current.x)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [railMinWidth]);

  // ── Follow the turn ──────────────────────────────────────────────────────────
  /*
   * Whoever is up gets shown, via the same open() the user's own click uses — so the turn simply
   * drives the workspace rather than fighting a separate mechanism.
   *
   * Keyed on the active combatant's id, not the index: re-sorting initiative or removing someone
   * shifts every index without the turn actually moving on, and that shouldn't drag the GM's view
   * around (or prompt them about unsaved changes).
   */
  const activeId = active?.id ?? null;
  // `undefined` = "haven't adopted a turn yet" (a fresh mount); `null` = out of combat.
  const lastTurnRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!inCombat) {
      lastTurnRef.current = null;
      return;
    }
    // First render while in combat — a fresh entry OR a remount (e.g. back from campaign settings).
    // Adopt the current turn WITHOUT moving the view, so the GM lands back on whatever they were
    // looking at (the GM screen, the party dashboard). Only a real turn CHANGE after this jumps.
    if (lastTurnRef.current === undefined) {
      lastTurnRef.current = activeId;
      return;
    }
    if (activeId === lastTurnRef.current) return;
    lastTurnRef.current = activeId;
    if (!active || !activeId) return;
    // A name-only NPC has nothing to show — CombatantDetail would render an empty shell.
    if (!active.isPC && !active.creature) return;
    selectCombatant(activeId);
    useLayoutStore.getState().open(activeId);
    trackerUi.showMain('combatant');
    // `active` is read fresh on the render where activeId changes; adding it would re-run this on
    // every unrelated combatant edit (HP, conditions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, inCombat]);

  // ── Requests from the top bar (which lives outside this component) ───────────
  const lastPaneReqRef = useRef(paneRequest);
  useEffect(() => {
    if (paneRequest === lastPaneReqRef.current) return;
    lastPaneReqRef.current = paneRequest;
    void (async () => {
      if (await leaveFullSheet()) setFullSheetId(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneRequest]);

  /*
   * The tools asked for the campaign's settings page. Navigating there unmounts this whole view —
   * and the open sheet with it, taking an unpushed working copy with no warning. So it goes through
   * the SAME gate as every other way of losing that sheet, and only navigates if the GM agrees.
   */
  const lastSettingsReqRef = useRef(settingsRequest);
  useEffect(() => {
    if (settingsRequest === lastSettingsReqRef.current) return;
    lastSettingsReqRef.current = settingsRequest;
    void (async () => {
      if (await leaveFullSheet()) onOpenSettings(dialogStyle);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsRequest]);

  // ── The card is the way in to a player's sheet ───────────────────────────────
  /*
   * ONE route to the GM-edit sheet, from both the party dashboard and the initiative order.
   *
   * The sheet takes the whole tracker view (`.ct-sheet-full`, absolute over `.ct-body`), so leaving
   * it simply uncovers whatever asked for it: the dashboard, or the PC's pane card. That is what
   * makes the back arrow land where the GM came from without anything here tracking a history.
   */
  const openMemberSheet = useCallback(
    async (mem: PartyMember) => {
      // Their published sheet is already here — show it. Only a member we have no sheet for falls
      // back to the page's own loader.
      //
      // …except YOUR OWN character. A GM plays too, and the sheet here is the GM editor: opening it
      // on your own card put you in front of your own character wearing "GM editing X — changes
      // reach the player only when you Update", with the player being you. The page above owns that
      // decision for every surface (useMemberViewer → ownRosterId), so hand it over rather than
      // asking the same question a second way here.
      //
      // ⚠ THE ACCOUNT IS READ HERE, not taken from the rendered `useMyId()` a few lines up. That
      // hook answers null until auth comes back, and these cards paint the moment `fetchParty`
      // resolves — a separate request, started at the same mount, so the window is reachable and is
      // exactly the first seconds a GM spends on this page. An inequality against that rendered null
      // is TRUE inside it for your own card, which dropped the GM into the editor on their own
      // character. `knownToBeOther` is the one function the page asks (../sheet/PartyMembers); a
      // second phrasing of the question here is how these two came apart before.
      //
      // The dev seam's party (localMembers) is derived from this device's roster with no accounts in
      // play at all — its `ownerId` IS the roster id — so there is nobody it could belong to, and the
      // GM sheet opens there exactly as it always did.
      const other = members === localMembers || knownToBeOther(mem.ownerId, await currentUserId());
      if (other && roster.byId.has(mem.charId)) setFullSheetId(mem.charId);
      else onViewMember(mem);
    },
    [roster, onViewMember, members, localMembers],
  );

  /** The card's host slots — the same ones on the dashboard, so the pane card matches it. The turn
   *  chip and the add-to-initiative button ride in the header; the stats split across the two
   *  columns (saves under AC on the left, everything else on the right).
   *
   *  `canAdd` is false for the pane card: a PC only HAS a pane because they are in the initiative
   *  order, so the "+" there could never be anything but permanently disabled.
   *
   *  The turn chip is there only while "Enable turn timer" is on (no timer icon on a player card
   *  when the timer is off). With it off AND no "+", the header slot is null rather than an empty
   *  fragment: PartyMembers draws `.party-card-tools` for any truthy header, and `.party-card-h` is a
   *  flex row with a 10px gap, so an empty span would push the chevron 10px off the card's edge. */
  const turnTimerEnabled = useSettingsStore((s) => s.turnTimerEnabled);
  const cardExtra = useCallback(
    (mem: PartyMember, canAdd = true): PartyCardSlots => {
      const st = pcStats.byId.get(mem.charId);
      return {
        header:
          !turnTimerEnabled && !canAdd ? null : (
            <>
              {turnTimerEnabled && <MemberTurnButton campaignId={m.id} charId={mem.charId} name={mem.name} />}
              {canAdd && <PartyAddToOrderButton member={mem} />}
            </>
          ),
        // "Stats shown" switches the card's OWN core too — Ancestry & class, Defenses (AC; the HP bar
        // stays), Perception (owner's list 2026-10-01, item 3: "some switches change nothing, the
        // switches need to do what they say"). The dashboard card and the PC's pane card alike.
        core: cardCore(pcDetail),
        // Null, not an element that renders nothing, when the saves are off: the card decides whether
        // its AC/saves block exists at all from this slot.
        saves: st && pcDetail.saves ? <PcSavesCells stats={st} detail={pcDetail} /> : null,
        // Emptiness is decided HERE, before the slot exists: the card splits into two columns off
        // the slot itself, so handing it an element that renders null (every right-column section
        // off — "Stats shown" → Minimal / Name only) bought a blank bordered gutter.
        right: st && hasRightColumn(st, pcDetail) ? <PcStatsCardExtra stats={st} detail={pcDetail} /> : null,
      };
    },
    [pcStats, pcDetail, m.id, turnTimerEnabled],
  );

  // ── A PC's pane IS their party card ──────────────────────────────────────────
  /*
   * Clicking a PC in the initiative order used to drop the GM straight into the editable sheet, with
   * the "GM editing X" strip hidden (a pane is too short for it) and no way out but the pane's ×.
   * The pane holds the CARD instead — the dashboard's own card, with the live HP and conditions —
   * and a click on it opens the full sheet, strip, Update and Back arrow included. Back uncovers the
   * card again, because the sheet is a layer over this whole view rather than the pane's content.
   *
   * Returning null (a combatant who isn't one of this campaign's members) falls back to the
   * tracker's own CombatantDetail. The member is found by the row's character id first
   * (`memberOfRow`), so a row the GM renamed — or a character the player renamed — keeps its card here
   * instead of falling back to CombatantDetail's HP and condition editors.
   */
  const renderPcPane = useCallback(
    (c: Combatant, handles: PcPaneHandles): ReactNode | null => {
      const mem = memberOfRow(c);
      if (!mem) return null;
      /*
       * A PC pane needs its OWN close and move controls: the tracker gives a creature pane those via
       * CombatantDetail's header, and nothing HH renders in here carries any. PaneLayout hands
       * `onClose`/`dockHandle`/`onHeaderDrag` only to a SOLO pane; a pane sharing a tab strip already
       * has a × per tab, so no header is drawn there.
       */
      return (
        <PcPaneShell name={mem.name} handles={handles} onClose={() => handles.onClose?.()}>
          <div className="ct-pane-card">
            <PartyCard
              member={mem}
              isMine={mem.ownerId === myId}
              // Same chip as the dashboard card: this pane may be showing the GM's own last Update
              // rather than what the player published. `sheetById` is already overlaid (party.ts),
              // so the numbers here are the edited ones — this says why.
              pending={pendingFor(mem)}
              // …or the player's app refused his last push: the same "not applied" chip as the card
              // (`gmEditRefused` itself never answers for the signed-in account's own character).
              refused={!pendingFor(mem) && gmEditRefused(m.id, mem.charId)}
              onOpen={() => void openMemberSheet(mem)}
              extra={cardExtra(mem, false)}
            />
          </div>
        </PcPaneShell>
      );
    },
    // `pendingVersion` is the pending store's snapshot — module state, so it is what says it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberOfRow, openMemberSheet, cardExtra, m.id, pendingVersion, myId],
  );

  // The real levels of the real characters — what encounter difficulty must be rated against. The
  // tracker's own party level was a typed number that defaulted to 1, and rated a level-3 party's
  // fights against a level-1 budget. The sheet's own level first (the live sheet, a GM's pending
  // level edit included — the same number the row's per-PC rating reads), the published summary's
  // for a member whose sheet hasn't arrived.
  const partyLevels = useMemo(
    () => members.map((mem) => pcStats.byId.get(mem.charId)?.level || mem.summary?.level || 0),
    [members, pcStats],
  );

  /*
   * What the host hands the initiative rows besides the numbers (tracker/src/data/pcStatsContext):
   *  - FOLDED: a condition HH has an entry for is already inside the PC's AC and saves above (they are
   *    the live sheet's), so the row must not take the tracker's own penalty for it again — a frightened
   *    player's row read two under their card (owner's list 2026-10-01, item 3). The tracker's
   *    `persistent damage` is HH's `persistent-damage`.
   *  - BADGES: what the sheet works out and stores nowhere — Encumbered from Bulk, a mode's conditions
   *    (`derivedFrom` on the card's own summary, the one `roster` holds) — and the active modes. Drawn
   *    locked on the row; never written into its conditions (pcSheetTruth reads only AUTHORED ones).
   *  - MEMBERS: so Quick add of a member's name adds that PC linked.
   */
  const conditionFolded = useCallback(
    (name: string) => {
      const k = name.trim().toLowerCase();
      return !!content.conditions?.[k] || !!content.conditions?.[k.replace(/\s+/g, '-')];
    },
    [content],
  );
  const hostBadges = useMemo(() => {
    const map = new Map<string, HostPcBadge[]>();
    for (const [charId, r] of roster.byId) {
      const s = r.summary;
      if (!s) continue;
      const badges: HostPcBadge[] = [
        ...s.conditions
          .filter((c) => !!c.derivedFrom)
          .map((c) => ({ kind: 'condition' as const, name: c.name, value: c.value, title: c.derivedFrom })),
        ...(s.modes ?? []).map((name) => ({ kind: 'mode' as const, name, title: 'an active mode on their sheet' })),
      ];
      if (badges.length) map.set(charId, badges);
    }
    return map;
  }, [roster]);

  /*
   * Battlezoo Monster Parts comes from THE CAMPAIGN, not from a switch in the tracker: the campaign
   * is what actually decides whether the table is in play, and the GM already set it there.
   *
   * `monsterPartsMode` defaults to 'hybrid' to match Heroes Heaven's own default for an enabled
   * variant (builder/shared.tsx) — the tracker's historical 'light' would quietly under-price every
   * monster by up to 4x for a party that never chose Light.
   */
  const campaignDefaults = useCampaignDefaults(m);
  const monsterParts = campaignDefaults?.variantRules?.monsterParts ?? false;
  const monsterPartsMode = campaignDefaults?.variantRules?.monsterPartsMode ?? 'hybrid';

  const fullSheetChar = fullSheetId ? (roster.byId.get(fullSheetId) ?? null) : null;

  /*
   * TELL THE CHROME A SHEET IS COVERING THE TRACKER — so the campaign's title bar can step aside (the
   * owner, 2026-10: "when editing a player sheet from the tracker I don't want to see the top row").
   *
   * Keyed on what is actually RENDERED below (`synced && fullSheetChar`), not on `fullSheetId`: the
   * builder the sheet opens renders inside the same `.ct-sheet-full`, so it keeps the bar hidden too.
   * A report only (see `sheetOpen` in trackerUiStore) — closing still goes through leaveFullSheet.
   *
   * The unmount cleanup is load-bearing, the same as boardReady's above: campaign settings, leaving the
   * campaign, the page-replacing sheet route and the GM's own card all UNMOUNT this view with a sheet
   * possibly open, and a flag left true would hide the bar — its back arrow and hamburger with it — on
   * whatever comes next. test/bug-tracker-sheet-top-row.test.tsx pins it.
   */
  const sheetShown = synced && fullSheetChar != null;
  useEffect(() => {
    trackerUi.setSheetOpen(sheetShown);
    return () => trackerUi.setSheetOpen(false);
  }, [sheetShown]);

  /*
   * NOTHING TO EDIT UNTIL THE BOARD IS THE RIGHT ONE.
   *
   * `synced` gated only the setScope effect below, so until it flipped the rail rendered whatever the
   * store held — with no scope set, that is the BARE `pf2e-current-combat`: the standalone tracker's
   * board, the one key this view deliberately never touches. Damage, a condition, an added creature in
   * that window went into that key and then vanished off screen when the scope swapped. It was one
   * commit before this round; the wait for the mirror's opening pull made it up to four seconds.
   *
   * So the table simply isn't there yet. The GM plays off local data and SYNC_READY_CAP_MS is the
   * ceiling on this — it ends when the pull lands or four seconds pass, whichever is first, and it is
   * skipped outright (same commit) where nothing is being mirrored.
   */
  if (!synced) {
    return (
      <div className="tracker-root campaign-tracker" style={trackerVars ?? undefined}>
        <div className="ct-body">
          <div className="ct-empty">Opening the table…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tracker-root campaign-tracker" style={rootStyle}>
      <GameDataProvider>
       <HostSearchProvider value={hostSearch}>
       {/* The tracker's own exports (the Encounter Manager's saved encounters) save through the app's one
           export helper: the anchor on the web and the PC app, Save to folder / Share on the Android app,
           whose WebView ignores the tracker's own anchor (item 8). `hostSave` (above) keeps that
           chooser over the tracker's own modals while it is open. */}
       <HostSaveProvider value={hostSave}>
       {/* The tracker's look for what the tracker itself draws on <body> (its BodyPortal): the row's
           right-click menu and every hover preview. null → they inherit the app's look, as this root does. */}
       <HostThemeProvider value={trackerVars}>
       <PinContext.Provider value={gmPin}>
       <CampaignPartyLevelProvider levels={partyLevels}>
        <CampaignMonsterPartsProvider enabled={monsterParts} mode={monsterPartsMode}>
        <CampaignPcStatsProvider
          byName={pcStats.byName}
          byId={pcStats.byId}
          badgesById={hostBadges}
          folded={conditionFolded}
          members={hostPcs}
        >
        <CampaignPcPaneProvider render={renderPcPane}>
        <div className="ct-body">
          {/* Collapsed: a drawer handle at the top-left, exactly as the tracker does it. */}
          {showInitCollapse && railCollapsed && (
            <button
              className="ct-rail-open"
              onClick={() => setRailCollapsedPersist(false)}
              title="Show initiative order"
              aria-label="Show initiative order"
            >
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          )}

          {!(showInitCollapse && railCollapsed) && (
            <>
              {/* The whole rail is the drop target for a party card — the tracker's own components
                  inside it know nothing about the gesture. */}
              <aside
                className={'ct-order' + (dropOver ? ' is-drop' : '')}
                style={{ width: effectiveRailWidth, minWidth: effectiveRailWidth, maxWidth: effectiveRailWidth }}
                onDragOver={onRailDragOver}
                onDragLeave={onRailDragLeave}
                onDrop={onRailDrop}
              >
                {/* The turn timer now lives in the TOP BAR (TrackerTools), not the rail. */}
                {/* InitiativeTracker is h-full, so it needs its own flex:1 box to leave room for the
                    footer below it. */}
                <div className="ct-order-scroll" onDragOver={onReturnDragOver} onDrop={onReturnDrop}>
                  <InitiativeTracker
                    onCombatantClick={handleCombatantClick}
                    onMinWidthMeasured={setRailMinWidth}
                    onCollapse={showInitCollapse ? () => setRailCollapsedPersist(true) : undefined}
                  />
                </div>
                {dropMsg && <div className="ct-order-drop-msg" role="status">{dropMsg}</div>}
                <RailFooter dialogStyle={dialogStyle} />
              </aside>
              {/* The drag handle. Its own element rather than a border so there's something to grab. */}
              <div
                className="ct-rail-resize"
                onMouseDown={onRailDragStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize initiative order"
              />
            </>
          )}

          <div className="ct-main">
            {/* One malformed stat block used to white-screen the whole campaign: the tracker's own
                boundary exists (its App.tsx wraps the same ternary) but was never mounted in here.
                resetKeys so switching view / party recovers without a manual "Try again". */}
            <ErrorBoundary label="this campaign’s tracker" resetKeys={[mainView, partyId]}>
            {mainView === 'gm' ? (
              <GMScreen />
            ) : mainView === 'combatant' ? (
              /* The tracker's workspace: tabbed, splittable panes of stat blocks and popups. */
              <CombatantWorkspace combatants={combatants} />
            ) : (
              /* The PLAYERS section shows Heroes Heaven's OWN campaign party cards — the same ones
                 the old campaign panel used, with view-sheet + kick intact. The tracker's NPC
                 section (and its Add NPC) is kept as-is beneath them. */
              <PartyView
                partyId={partyId}
                /* OFFLINE: no players slot. PartyMembers is a Supabase view of the campaign's party
                   (fetch, Realtime, kick), and there is no campaign — so the local table gets the
                   tracker's OWN party section, exactly as the standalone app shows it. */
                playersSlot={
                  offline ? undefined : (
                  <PartyMembers
                    campaignId={m.id}
                    isGm={m.role === 'gm'}
                    // So a card whose GM edit the player hasn't applied yet is re-summarised from
                    // that edit instead of from the pre-edit `summary` column the server holds.
                    content={content}
                    /* THE DASHBOARD CARD GOES THROUGH THE SAME ANSWER AS EVERYTHING ELSE HERE.
                       Without this it drew `m.summary` raw — the player's own verdict, computed on
                       their device against their content database — while the PC's pane card two
                       clicks away and the sheet a card opens both went through `memberSummary`. Same
                       character, same screen, two answers about Encumbered, which is the owner's
                       report with the sides swapped. `roster.byId` already holds that one answer
                       (this device's derivation ∪ the chips only the player's app could reach, with
                       a pending edit of ours folded in), so the card just reads it. */
                    summarize={(mem) => roster.byId.get(mem.charId)?.summary}
                    // The card's "Stats shown" sections, built from the real character. Following
                    // the tracker's own PcDetailConfig — the same dropdown in the party header.
                    renderExtra={cardExtra}
                    onView={(mem) => {
                      // In combat the card joins the workspace beside the initiative order; out of
                      // combat there's nothing to keep an eye on, so the sheet gets the whole view.
                      if (inCombat) {
                        // Their row by the tracker's own rule (character id first), so a renamed row
                        // or character still opens its pane rather than the sheet.
                        const cid = combatants.find(
                          (c) => c.isPC && isSamePc(c, { name: mem.name, charId: mem.charId }),
                        )?.id;
                        if (cid) {
                          handleCombatantClick(cid);
                          return;
                        }
                      }
                      void openMemberSheet(mem);
                    }}
                    // Hand every later list (Realtime refresh, a kick) back to the seam, so the
                    // tracker party and the cards can't drift apart.
                    onMembers={setServerMembers}
                    localMembers={members === localMembers ? localMembers : undefined}
                    // A card's kick asks in a confirm drawn over this view: the tracker's look, above
                    // its windows.
                    dialogStyle={dialogStyle}
                  />
                  )
                }
              />
            )}
            </ErrorBoundary>
          </div>
        </div>

        {/* The tracker's own overlays, driven from the top-bar tools. */}
        {monsterSearchOpen && <MonsterSearch onClose={() => trackerUi.setMonsterSearch(false)} />}
        {searchOpen && <GlobalSearch onClose={() => trackerUi.setSearch(false)} />}
        {customOpen && <TextConverter onClose={() => trackerUi.setCustom(false)} />}
        {encountersOpen && <EncounterManager onClose={() => trackerUi.setEncounters(false)} />}
        {appearanceOpen && <TrackerCustomize onClose={() => trackerUi.setAppearance(false)} />}
        <DiceOverlay />
        {/* The floating windows — creature stat blocks, reference popups and (item 7) every Search
            everything page — inline in this root: they wear its look and sit inside the GM-screen pin
            provider above. Escape closes the top one (the handler after the base handler). */}
        <FloatingWindowLayer />

        {/* Out of combat there's nothing to keep an eye on, so a party card's sheet gets the view.
            fullSheetRevert pins THIS review sheet to the app's global appearance when the tracker is
            re-themed — the in-combat panes follow the tracker theme, but this focused review shows the
            character as they really are. */}
        {fullSheetChar && (
          <div className="ct-sheet-full" style={fullSheetRevert}>
            {/* Everything the sheet registers on the dismiss stack is drawn under the floating windows
                (this layer is z 30), so a window open over it takes Escape first (the windows' handler). */}
            <DismissUnder.Provider value>
            <GmEditSheet
              key={fullSheetChar.entry.id}
              ref={fullSheetRef}
              initial={fullSheetChar.entry}
              live={fullSheetChar.entry}
              // The card's own summary, so the sheet can't go quiet about a condition the card shows
              // (a condition the owner's app derived and this device's content can't reproduce).
              summary={fullSheetChar.summary}
              content={content}
              campaignId={m.id}
              playerOwnerId={fullSheetChar.ownerId}
              // The campaign's title bar is hidden while this is open (sheetOpen above), so the sheet
              // carries the one way back ("← Tracker", through its own doExit → confirmLeave) and, in
              // the desktop app, the window's drag region and controls.
              inTracker
              onExit={() => setFullSheetId(null)}
            />
            </DismissUnder.Provider>
          </div>
        )}
        </CampaignPcPaneProvider>
        </CampaignPcStatsProvider>
        </CampaignMonsterPartsProvider>
       </CampaignPartyLevelProvider>
       </PinContext.Provider>
       </HostThemeProvider>
       </HostSaveProvider>
       </HostSearchProvider>
      </GameDataProvider>
    </div>
  );
}

/**
 * The workspace, plus the empty state.
 *
 * PaneLayout renders nothing at all when the tree is empty (`if (!root) return null`), which would
 * leave a blank pane with no hint. The tracker's own App has the same empty state — and, crucially,
 * marks it `data-dock-empty` so a combatant dragged out of the initiative order has somewhere to land
 * when no pane exists yet.
 */
/**
 * A PC pane: HH's editable sheet, plus the pane's own header (name · move · close) and a
 * width-driven switch to the phone layout.
 *
 * WHY THE MOBILE SWITCH: the sheet's desktop layout (a side rail + multi-column grids) is built for a
 * full window. Tiled two-up, each pane is roughly half that and the desktop layout doesn't fit. The
 * phone layout — single column, bottom tab nav — does. `useIsMobile` normally reads the VIEWPORT, so
 * a narrow pane in a wide window wouldn't trigger it; measuring the pane and pushing the result
 * through `ForceMobileContext` makes the sheet inside respond to ITS width, not the window's. Scoped
 * entirely here — nothing outside a PC pane sees the override, so the real phone/desktop layouts are
 * untouched.
 */
function PcPaneShell({
  name,
  handles,
  onClose,
  children,
}: {
  name: string;
  handles: PcPaneHandles;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  // Hysteresis so a width parked right on the line doesn't flip layouts every frame.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    setNarrow((prev) => (prev ? w <= 760 : w <= 720));
  }, []);
  // Re-measure after every render: a split/unsplit re-renders this pane with a new width, and
  // ResizeObserver is unreliable in some embedded webviews. The setState guard makes it converge in
  // one extra render (an unchanged value is a no-op).
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      ro = new ResizeObserver(measure);
      ro.observe(ref.current);
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [measure]);

  // A wide pane defers to the viewport (null) rather than forcing desktop — so on a phone, where the
  // pane fills a narrow screen, the sheet is still mobile.
  const showHeader = !!(handles.onClose || handles.dockHandle || handles.onHeaderDrag);
  return (
    <ForceMobileContext.Provider value={narrow ? true : null}>
      <div ref={ref} className={'ct-pc-pane' + (narrow ? ' is-narrow' : '')}>
        {showHeader && (
          // Dragging the bar merges this pane into another as tabs (onHeaderDrag) — the same gesture a
          // creature pane's header offers.
          <div className="ct-pc-pane-head" onMouseDown={handles.onHeaderDrag}>
            {handles.dockHandle}
            <span className="ct-pc-pane-name">{name}</span>
            {handles.onClose && (
              <button
                className="ct-pc-pane-close"
                title="Close"
                aria-label="Close this sheet"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="ct-pc-pane-body">{children}</div>
      </div>
    </ForceMobileContext.Provider>
  );
}

/**
 * The rail's footer.
 *
 * PRIMARY add = the bestiary picker (MonsterSearch), exactly like the original app's dashed
 * "+ Add Combatants" button — search Archives creatures/hazards and drop them in with a full stat
 * block. Quick-add-by-name used to sit here as a second control; it now lives INSIDE that popup,
 * where the GM is already looking when they want a nameless goblin. What's left beside the button is
 * "Clear" (empty the board — End Combat ends the round but keeps everyone).
 */
/**
 * THE DELAY AREA — the owner's gesture, in his words: "I want a delay mechanic where I drag someone
 * from the initiative order and above the Add combatants button there will be a delay area that I
 * can drop into, and there will be a button to add back to initiative".
 *
 * Only the creature whose turn it is can be dropped in (the acting row is the only one that carries
 * DELAY_MIME, and delayCombatant refuses the rest anyway — Player Core p. 416). Coming back, by the
 * button or by dragging the row onto the list, puts it in one place: immediately ahead of the turn
 * it interrupted, acting now. That is the whole point of it — "players decide to enter after they
 * hear me say 'now it's this guy's turn'".
 *
 * On screen only when it has something to say — someone is delayed, or a delay drag is in the air
 * right now (the owner's afternoon list, 2026-09-17: "make the delay section not visible if it's
 * empty; if the GM drags then make it visible"). An empty strip sitting there for a whole fight is
 * rail height spent on nothing, and the drop target still arrives the instant the drag begins.
 */
function DelayArea() {
  const inCombat = useCombatStore((s) => s.inCombat);
  const anyDelayed = useCombatStore((s) => s.combatants.some((c) => c.isDelayed));
  // The drag that makes it appear starts on a row inside InitiativeTracker, which knows nothing
  // about whoever is drawing a Delay area — so the signal is taken off the document, where every
  // dragstart passes, rather than by threading a callback through the tracker.
  const dragging = useDelayDragActive();
  if (!inCombat || (!anyDelayed && !dragging)) return null;
  // The zone is a child, not this function's own JSX, so its drop-highlight state is born and dies
  // with it. Returning null from THIS component would leave that state alive between appearances,
  // and a drag abandoned over the zone (Escape) would bring the next one back already lit.
  return <DelayZone />;
}

function DelayZone() {
  const combatants = useCombatStore((s) => s.combatants);
  // The drag half lives with the drag SOURCE (the acting row writes DELAY_MIME and the effect the
  // zone has to answer with) — this host only says what the highlight looks like.
  const { over, props } = useDelayDropZone();
  const delayed = combatants.filter((c) => c.isDelayed);
  return (
    <div className={'ct-delay' + (over ? ' is-over' : '')} {...props}>
      <div className="ct-delay-head">
        <span className="ct-delay-title">Delay</span>
        {delayed.length === 0 && <span className="ct-delay-hint">drag the acting creature here</span>}
      </div>
      {delayed.map((c) => (
        <div
          key={c.id}
          className="ct-delay-row"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DELAY_RETURN_MIME, c.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          title="Drag onto the initiative order, or press Return"
        >
          <span className="ct-delay-init">{c.initiative ?? '—'}</span>
          <span className="ct-delay-name">{c.name}</span>
          <button
            className="ct-delay-back"
            onClick={() => useCombatStore.getState().returnFromDelay(c.id)}
            title="Back in, just ahead of the current turn — and it acts now"
          >
            Return
          </button>
        </div>
      ))}
    </div>
  );
}

function RailFooter({ dialogStyle }: { dialogStyle: DialogStyle }) {
  const combatants = useCombatStore((s) => s.combatants);
  const clearAll = useCombatStore((s) => s.clearAllCombatants);

  const clear = async () => {
    const ok = await confirmDialog({
      title: 'Clear the initiative order?',
      message: 'Removes every combatant from the tracker. Your characters and the campaign are untouched.',
      confirmLabel: 'Clear',
      danger: true,
      // The tracker's look, above its floating windows (a stat block left open used to cover it).
      style: dialogStyle,
    });
    if (ok) clearAll();
  };

  return (
    <div className="ct-rail-foot">
      <DelayArea />
      {/* One line, not two — "the Clear can be a smaller button on the same line" (2026-09-17). Both
          are still plain buttons, so Tab reaches them in this order and Enter/Space fires them. */}
      <div className="ct-rail-foot-row">
        <button
          className="ct-rail-add-btn"
          onClick={() => trackerUi.setMonsterSearch(true)}
          title="Search the bestiary and add creatures with full stat blocks"
        >
          <i className="ti ti-plus" aria-hidden="true" /> Add combatants
        </button>
        <button
          className="ct-rail-clear"
          onClick={() => void clear()}
          disabled={combatants.length === 0}
          title={combatants.length === 0 ? 'Nothing to clear' : 'Clear the order'}
        >
          <i className="ti ti-trash" aria-hidden="true" /> Clear
        </button>
      </div>
    </div>
  );
}

function CombatantWorkspace({ combatants }: { combatants: Combatant[] }) {
  const root = useLayoutStore((s) => s.root);
  if (!root) {
    return (
      <div className="ct-empty" data-dock-empty="">
        <div>
          Click anyone in the initiative order to open their stat block here.
          <br />
          Drag one onto a pane's edge to tile it, or onto its tabs to stack it.
        </div>
        {/* An add affordance right where the eye lands when the board is empty — the original app
            put a "+ Add Combatants" button in this same empty state. */}
        <button className="ct-empty-add" onClick={() => trackerUi.setMonsterSearch(true)}>
          <i className="ti ti-plus" aria-hidden="true" /> Add combatants
        </button>
      </div>
    );
  }
  return <PaneLayout combatants={combatants} />;
}
