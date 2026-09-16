import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignMembership } from '../data/campaigns';
import { loadRoster, type SavedChar } from '../data/storage';
import { GmEditSheet, type GmEditHandle } from '../sheet/GmEditSheet';
import { DescriptionModal } from '../sheet/DescriptionModal';
import { ForceMobileContext } from '../sheet/useIsMobile';
import { useBackHandler } from '../sheet/useEscapeClose';
import { useTrackerVars, useGlobalVars } from './trackerAppearance';
import { TrackerCustomize } from './TrackerCustomize';
import { CampaignPartyLevelProvider } from '../../tracker/src/data/partyLevelContext';
import { CampaignPcPaneProvider, type PcPaneHandles } from '../../tracker/src/data/pcPaneContext';
import { CampaignMonsterPartsProvider } from '../../tracker/src/data/monsterPartsContext';
import { CampaignPcStatsProvider } from '../../tracker/src/data/pcStatsContext';
import type { PcStats } from '../../tracker/src/utils/pcDetail';
import { useCampaignDefaults } from './useCampaignDefaults';
import { computePcStats } from './computePcStats';
import { PcStatsCardExtra, PcSavesCells, hasRightColumn } from './PcStatsCardExtra';
import { MemberTurnButton } from './MemberTurnButton';
import { useCombatStore, isSamePc } from '../../tracker/src/store/combatStore';
import { useSettingsStore } from '../../tracker/src/store/settingsStore';
import { useWindowStore } from '../../tracker/src/store/windowStore';
import { useLayoutStore } from '../../tracker/src/store/layoutStore';
import { GameDataProvider } from '../../tracker/src/data/gameDataContext';
import { HostSearchProvider, type HostSearchRecord } from '../../tracker/src/data/hostSearchContext';
import { InitiativeTracker } from '../../tracker/src/components/InitiativeTracker';
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
import { PartyMembers, PartyCard, PARTY_MEMBER_DRAG, type PartyMemberDrag, type PartyCardSlots } from '../sheet/PartyMembers';
import { computeSummary } from '../sheet/partySummary';
import { fetchParty, type PartyMember } from '../data/party';
import { useAuth } from '../data/useAuth';
import { startTrackerSync, isTrackerSyncReady } from '../data/trackerSync';
import { livePlay, useMemberSheets, usePcSheetTruth } from './pcSheetTruth';
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
 * itself to <body> (carrying `.tracker-root` for its CSS variables) and is still there on this
 * press. This view's own root is inside HH's page, and excluded by name in case it ever isn't.
 */
function trackerPopupOpen(): boolean {
  return !!document.querySelector('body > .tracker-root:not(.campaign-tracker)');
}

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
   */
  onOpenSettings: () => void;
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
   *  - trackerVars: paint the tracker with them; null → inherit the app's global appearance.
   *  - fullSheetRevert: the OUT-OF-COMBAT full-screen sheet (opened from a party card to review a
   *    character) is pinned to the app's global appearance — it's a focused "look at this character
   *    as they really are" view, not part of the combat workspace.
   * The IN-COMBAT PC panes deliberately get NO revert: tiled beside the initiative order and the
   * creature stat blocks, they should read as one themed surface, so they inherit the tracker theme.
   * None of this changes anything for players — it's the GM's local display only.
   */
  const trackerVars = useTrackerVars();
  const globalVars = useGlobalVars();
  const fullSheetRevert = trackerVars ? globalVars : undefined;
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
   * the embedded view. Computed once per roster change; keyed both by name (the initiative order
   * matches combatants to PCs by name) and by charId (the cards are keyed by charId).
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

  /*
   * The members again, but with the summary RE-DERIVED from the player's live sheet — keyed by name,
   * which is all a combatant row carries.
   *
   * This is what a PC's pane card reads. The dashboard's own cards are kept current by PartyMembers'
   * Realtime subscription, but PartyMembers is unmounted the moment the GM leaves the dashboard for
   * the workspace, so `mem.summary` there is frozen at whatever the last visit fetched. The sheets in
   * `sheetById` keep arriving either way (pcSheetTruth subscribes per member for the life of the
   * mount), so the card in the pane shows the HP and conditions the player has right now.
   */
  const liveMembers = useMemo(() => {
    const map = new Map<string, PartyMember>();
    for (const mem of members) {
      const sheet = sheetById.get(mem.charId);
      map.set(
        mem.name.trim().toLowerCase(),
        sheet ? { ...mem, summary: computeSummary(livePlay(sheet, content), content) } : mem,
      );
    }
    return map;
  }, [members, sheetById, content]);

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
        maxHP: mem.summary?.hpMax || pcStats.byName.get(mem.name.trim().toLowerCase())?.maxHP,
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
   * traits, conditions, actions, deities, …) — like the Archives search — opening HH's own
   * description popup on select. Built once from the content DB this view already holds; the few
   * purely-mechanical buckets with no description are skipped. It reaches the tracker's GlobalSearch
   * through HostSearchProvider, and the popup is portalled to <body> so it renders in HH's normal CSS
   * environment (outside the tracker's scoped stylesheet). Creatures stay searchable via the tracker
   * data (GlobalSearch adds them), since HH has no bestiary content.
   */
  const [descTarget, setDescTarget] = useState<{ bucket: string; id: string } | null>(null);
  // The tracker's floating stat-block windows join the root stacking context at z ≥ 501 (climbing on
  // each focus), so the host-search description popup — portalled to <body> at HH's .picker-overlay
  // z-index — would paint BEHIND any open window. Lift its wrapper above the current top.
  const floatingTopZ = useWindowStore((s) => s.topZ);
  const searchRecords = useMemo<HostSearchRecord[]>(() => {
    const skip = new Set(['modes', 'runes', 'stances']);
    const db = content as unknown as Record<string, Record<string, { name?: string }> | undefined>;
    const recs: HostSearchRecord[] = [];
    for (const bucket of Object.keys(db)) {
      if (skip.has(bucket)) continue;
      const rows = db[bucket];
      if (!rows || typeof rows !== 'object') continue;
      for (const id of Object.keys(rows)) {
        const name = rows[id]?.name;
        if (typeof name === 'string' && name) recs.push({ bucket, id, name });
      }
    }
    return recs;
  }, [content]);
  const hostSearch = useMemo(
    () => ({ records: searchRecords, open: (bucket: string, id: string) => setDescTarget({ bucket, id }) }),
    [searchRecords],
  );
  const descRec = descTarget
    ? (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }> | undefined>)[descTarget.bucket]?.[descTarget.id]
    : null;

  // "Stats shown" — the per-party override, else the global default. The party page's dropdown
  // (PcDetailControls) writes party.pcDetail; both live in the tracker's own stores.
  const globalDetail = useSettingsStore((s) => s.pcDetail);
  const partyDetail = parties.find((p) => p.id === partyId)?.pcDetail;
  const pcDetail = partyDetail ?? globalDetail;

  // Leaving the campaign resets the tracker UI (so re-entering doesn't pop the last panel open) — but
  // that's driven by CampaignsPage when the view returns to the campaigns LIST, NOT by this component
  // unmounting. Opening campaign settings unmounts this too, and back from there must restore the
  // exact view the GM left (a combat pane, the GM screen), so a reset on every unmount would be wrong.

  /**
   * The campaign's characters the GM can actually open, by charId — the sheet plus the owner id,
   * which travels with the MEMBER because a published SavedChar doesn't carry who to address a GM
   * edit to. Only the cards and the initiative rows need a name lookup, and `liveMembers` above is
   * that one (combatants carry no character id, so they are matched by lower-cased name, the same
   * convention partyStore.importCharacter already uses).
   */
  const roster = useMemo(() => {
    const byId = new Map<string, { entry: SavedChar; ownerId: string }>();
    for (const mem of members) {
      const entry = sheetById.get(mem.charId);
      if (entry) byId.set(mem.charId, { entry, ownerId: mem.ownerId });
    }
    return { byId };
  }, [members, sheetById]);

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
   */
  useBackHandler(fullSheetId != null, () => {
    void (async () => {
      if (await leaveFullSheet()) setFullSheetId(null);
    })();
  });

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
   */
  useBackHandler(synced && monsterSearchOpen, () => trackerUi.setMonsterSearch(false));
  useBackHandler(synced && searchOpen, () => trackerUi.setSearch(false));
  useBackHandler(synced && customOpen, () => trackerUi.setCustom(false));
  useBackHandler(synced && encountersOpen, () => trackerUi.setEncounters(false));
  useBackHandler(synced && appearanceOpen, () => trackerUi.setAppearance(false));

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
  useBackHandler(true, () => {
    if (trackerPopupOpen()) return;
    void (async () => {
      if (await leaveFullSheet()) onLeave();
    })();
  });

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
      if (await leaveFullSheet()) onOpenSettings();
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
    (mem: PartyMember) => {
      // Their published sheet is already here — show it. Only a member we have no sheet for falls
      // back to the page's own loader.
      if (roster.byId.has(mem.charId)) setFullSheetId(mem.charId);
      else onViewMember(mem);
    },
    [roster, onViewMember],
  );

  /** The card's host slots — the same ones on the dashboard, so the pane card matches it. The turn
   *  chip and the add-to-initiative button ride in the header; the stats split across the two
   *  columns (saves under AC on the left, everything else on the right).
   *
   *  `canAdd` is false for the pane card: a PC only HAS a pane because they are in the initiative
   *  order, so the "+" there could never be anything but permanently disabled. */
  const cardExtra = useCallback(
    (mem: PartyMember, canAdd = true): PartyCardSlots => {
      const st = pcStats.byId.get(mem.charId);
      return {
        header: (
          <>
            <MemberTurnButton campaignId={m.id} charId={mem.charId} name={mem.name} />
            {canAdd && <PartyAddToOrderButton member={mem} />}
          </>
        ),
        saves: st ? <PcSavesCells stats={st} detail={pcDetail} /> : null,
        // Emptiness is decided HERE, before the slot exists: the card splits into two columns off
        // the slot itself, so handing it an element that renders null (every right-column section
        // off — "Stats shown" → Minimal / Name only) bought a blank bordered gutter.
        right: st && hasRightColumn(st, pcDetail) ? <PcStatsCardExtra stats={st} detail={pcDetail} /> : null,
      };
    },
    [pcStats, pcDetail, m.id],
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
   * tracker's own CombatantDetail.
   */
  const renderPcPane = useCallback(
    (c: Combatant, handles: PcPaneHandles): ReactNode | null => {
      const mem = liveMembers.get(c.name.trim().toLowerCase());
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
            <PartyCard member={mem} isMine={false} onOpen={() => openMemberSheet(mem)} extra={cardExtra(mem, false)} />
          </div>
        </PcPaneShell>
      );
    },
    [liveMembers, openMemberSheet, cardExtra],
  );

  // The real levels of the real characters — what encounter difficulty must be rated against. The
  // tracker's own party level was a typed number that defaulted to 1, and rated a level-3 party's
  // fights against a level-1 budget.
  const partyLevels = useMemo(() => members.map((mem) => mem.summary?.level ?? 0), [members]);

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
    <div className="tracker-root campaign-tracker" style={trackerVars ?? undefined}>
      <GameDataProvider>
       <HostSearchProvider value={hostSearch}>
       <CampaignPartyLevelProvider levels={partyLevels}>
        <CampaignMonsterPartsProvider enabled={monsterParts} mode={monsterPartsMode}>
        <CampaignPcStatsProvider byName={pcStats.byName}>
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
                <div className="ct-order-scroll">
                  <InitiativeTracker
                    onCombatantClick={handleCombatantClick}
                    onMinWidthMeasured={setRailMinWidth}
                    onCollapse={showInitCollapse ? () => setRailCollapsedPersist(true) : undefined}
                  />
                </div>
                {dropMsg && <div className="ct-order-drop-msg" role="status">{dropMsg}</div>}
                <RailFooter />
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
                    // The card's "Stats shown" sections, built from the real character. Following
                    // the tracker's own PcDetailConfig — the same dropdown in the party header.
                    renderExtra={cardExtra}
                    onView={(mem) => {
                      // In combat the card joins the workspace beside the initiative order; out of
                      // combat there's nothing to keep an eye on, so the sheet gets the whole view.
                      if (inCombat) {
                        const cid = combatants.find(
                          (c) => c.isPC && c.name.trim().toLowerCase() === mem.name.trim().toLowerCase(),
                        )?.id;
                        if (cid) {
                          handleCombatantClick(cid);
                          return;
                        }
                      }
                      openMemberSheet(mem);
                    }}
                    // Hand every later list (Realtime refresh, a kick) back to the seam, so the
                    // tracker party and the cards can't drift apart.
                    onMembers={setServerMembers}
                    localMembers={members === localMembers ? localMembers : undefined}
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
        <FloatingWindowLayer />

        {/* Global-search result → HH's own description popup. Portalled to <body> so it renders in
            HH's normal CSS environment, not the tracker's scoped stylesheet. */}
        {descTarget && descRec && createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: floatingTopZ + 10 }}>
            <DescriptionModal
              root={{ title: descRec.name, description: descRec.description ?? '', descRefs: descRec.descRefs, key: descTarget.bucket, slug: descTarget.id }}
              onClose={() => setDescTarget(null)}
              onExit={() => setDescTarget(null)}
            />
          </div>,
          document.body,
        )}

        {/* Out of combat there's nothing to keep an eye on, so a party card's sheet gets the view.
            fullSheetRevert pins THIS review sheet to the app's global appearance when the tracker is
            re-themed — the in-combat panes follow the tracker theme, but this focused review shows the
            character as they really are. */}
        {fullSheetChar && (
          <div className="ct-sheet-full" style={fullSheetRevert}>
            <GmEditSheet
              key={fullSheetChar.entry.id}
              ref={fullSheetRef}
              initial={fullSheetChar.entry}
              live={fullSheetChar.entry}
              content={content}
              campaignId={m.id}
              playerOwnerId={fullSheetChar.ownerId}
              onExit={() => setFullSheetId(null)}
            />
          </div>
        )}
        </CampaignPcPaneProvider>
        </CampaignPcStatsProvider>
        </CampaignMonsterPartsProvider>
       </CampaignPartyLevelProvider>
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
function RailFooter() {
  const combatants = useCombatStore((s) => s.combatants);
  const clearAll = useCombatStore((s) => s.clearAllCombatants);

  const clear = async () => {
    const ok = await confirmDialog({
      title: 'Clear the initiative order?',
      message: 'Removes every combatant from the tracker. Your characters and the campaign are untouched.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (ok) clearAll();
  };

  return (
    <div className="ct-rail-foot">
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
        title={combatants.length === 0 ? 'Nothing to clear' : 'Remove every combatant'}
      >
        <i className="ti ti-trash" aria-hidden="true" /> Clear
      </button>
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
