/// <reference path="../../tracker/src/types/electron.d.ts" />
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CampaignMembership } from '../data/campaigns';
import { loadRoster, type SavedChar } from '../data/storage';
import { GmEditSheet, type GmEditHandle } from '../sheet/GmEditSheet';
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
import { PcStatsCardExtra } from './PcStatsCardExtra';
import { useCombatStore } from '../../tracker/src/store/combatStore';
import { useSettingsStore } from '../../tracker/src/store/settingsStore';
import { useLayoutStore, leafCids } from '../../tracker/src/store/layoutStore';
import { GameDataProvider } from '../../tracker/src/data/gameDataContext';
import { InitiativeTracker } from '../../tracker/src/components/InitiativeTracker';
import { TurnTimerWidget } from '../../tracker/src/components/TurnTimerWidget';
import { PaneLayout } from '../../tracker/src/components/PaneLayout';
import { PartyView } from '../../tracker/src/components/PartyView';
import { GMScreen } from '../../tracker/src/components/GMScreen';
import { GlobalSearch } from '../../tracker/src/components/GlobalSearch';
import { TextConverter } from '../../tracker/src/components/TextConverter';
import { EncounterManager } from '../../tracker/src/components/EncounterManager';
import { DiceOverlay } from '../../tracker/src/components/DiceOverlay';
import { FloatingWindowLayer } from '../../tracker/src/components/FloatingWindow';
import { usePartyStore } from '../../tracker/src/store/partyStore';
import type { Combatant } from '../../tracker/src/types/pf2e';
import { PartyMembers } from '../sheet/PartyMembers';
import type { PartyMember } from '../data/party';
import type { ContentDatabase } from '../rules/types';
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
  /** Open a member's sheet — the same GM view the old campaign detail panel offered. */
  onViewMember: (mem: PartyMember) => void;
}) {
  const { searchOpen, customOpen, encountersOpen, appearanceOpen, mainView, paneRequest, settingsRequest } = useTrackerUi();
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

  const inCombat = useCombatStore((s) => s.inCombat);
  const combatants = useCombatStore((s) => s.combatants);
  const activeIndex = useCombatStore((s) => s.activeIndex);
  const selectCombatant = useCombatStore((s) => s.selectCombatant);
  const active = inCombat ? (combatants[activeIndex] ?? null) : null;

  const activePartyId = usePartyStore((s) => s.activePartyId);
  const parties = usePartyStore((s) => s.parties);
  const partyId = activePartyId ?? parties[0]?.id ?? '';

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
    for (const e of loadRoster()) {
      if (e.archived || !(e.character.campaignIds ?? []).includes(m.id)) continue;
      const stats = computePcStats(e.character, content);
      byName.set(e.character.name.trim().toLowerCase(), stats);
      byId.set(e.id, stats);
    }
    return { byName, byId };
    // localMembers changes whenever the roster relevant to this campaign changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMembers, content, m.id]);

  // "Stats shown" — the per-party override, else the global default. The party page's dropdown
  // (PcDetailControls) writes party.pcDetail; both live in the tracker's own stores.
  const globalDetail = useSettingsStore((s) => s.pcDetail);
  const partyDetail = parties.find((p) => p.id === partyId)?.pcDetail;
  const pcDetail = partyDetail ?? globalDetail;

  // Leaving the campaign resets the tracker UI (so re-entering doesn't pop the last panel open) — but
  // that's driven by CampaignsPage when the view returns to the campaigns LIST, NOT by this component
  // unmounting. Opening campaign settings unmounts this too, and back from there must restore the
  // exact view the GM left (a combat pane, the GM screen), so a reset on every unmount would be wrong.

  /*
   * Combatants are matched to characters BY NAME. The initiative order stores its own combatants and
   * has no character id to join on, and this is already how the tracker links a PC to a party member
   * (partyStore.importCharacter matches on lower-cased name), so the convention is at least
   * consistent. Two characters with the same name in one campaign would be ambiguous — which is
   * also true of the tracker's existing matching.
   */
  const roster = useMemo(() => {
    const byName = new Map<string, SavedChar>();
    const byId = new Map<string, SavedChar>();
    const all = loadRoster();
    for (const mem of localMembers) {
      const e = all.find((x) => x.id === mem.charId);
      if (!e) continue;
      byName.set(mem.name.trim().toLowerCase(), e);
      byId.set(mem.charId, e);
    }
    return { byName, byId };
  }, [localMembers]);

  // ── The GM's unpushed working copies ─────────────────────────────────────────
  /*
   * Every open GmEditSheet registers its handle here so we can ask it before its pane is taken away.
   * Keyed by COMBATANT id, because that's what the pane tree stores and what a swap is expressed in.
   *
   * A registry rather than one ref because the tab system can have several sheets open at once —
   * a PC tiled beside a monster, or two PCs in one pane's tabs — each with its own dirty state.
   */
  const paneSheets = useRef(new Map<string, GmEditHandle>());
  /** The full-screen sheet (party card, out of combat) — only ever one. */
  const fullSheetRef = useRef<GmEditHandle>(null);

  const LOSE_TURN = (name: string) => ({
    title: 'Keep your changes?',
    message: `It’s ${name}’s turn. You’ve made changes to this character that haven’t been sent to the player yet — keep them by updating now, or discard them?`,
  });

  /*
   * `layoutStore.open(cid)` REPLACES the hovered pane's active stat block when that pane is already
   * showing a creature and the target isn't open — which silently destroys a PC sheet's working copy.
   * This mirrors open()'s own three-way decision to work out whether anything is actually about to be
   * lost, and only then asks. Focusing an existing tab, or adding one, loses nothing and must not
   * prompt.
   */
  const guardPaneSwap = useCallback(
    async (targetCid: string, reason?: { title: string; message: string }): Promise<boolean> => {
      const st = useLayoutStore.getState();
      if (!st.root) return true; // no panes yet → open() creates one
      if (leafCids(st.root).includes(targetCid)) return true; // → focuses the existing tab
      const doomed = st.hoveredCid; // non-null ⟺ the hovered pane's active tab IS a stat block
      if (!doomed || doomed === targetCid) return true; // → adds a tab
      const h = paneSheets.current.get(doomed);
      if (!h) return true; // a monster — nothing to lose
      return await h.confirmLeave(reason);
    },
    [],
  );

  /** Every way of leaving/closing the whole view has to clear the full-screen sheet too. */
  const [fullSheetId, setFullSheetId] = useState<string | null>(null);
  const leaveFullSheet = useCallback(
    async (reason?: { title: string; message: string }): Promise<boolean> => {
      if (!fullSheetId || !fullSheetRef.current) return true;
      return await fullSheetRef.current.confirmLeave(reason);
    },
    [fullSheetId],
  );

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

  // ── Click a combatant → open it in the workspace ─────────────────────────────
  /*
   * The tracker's own gesture, restored (App.tsx does exactly this): select it, open/focus its pane
   * tab, and show the workspace. Passing this as `onCombatantClick` is also what makes the rows
   * highlight — InitiativeTracker marks a row selected off layoutStore's hoveredCid, which stays
   * null while nothing ever opens a pane.
   */
  const handleCombatantClick = useCallback(
    (id: string) => {
      void (async () => {
        if (!(await guardPaneSwap(id))) return;
        selectCombatant(id);
        useLayoutStore.getState().open(id);
        trackerUi.showMain('combatant');
      })();
    },
    [guardPaneSwap, selectCombatant],
  );

  // ── The rail: collapse + resize ──────────────────────────────────────────────
  /*
   * Straight from the tracker's App.tsx — same localStorage key, same 480 ceiling, same
   * measured floor. InitiativeTracker only DRAWS the collapse chevron when handed `onCollapse`, and
   * only reports its own minimum width through `onMinWidthMeasured`, so a props-less
   * <InitiativeTracker /> is inert by design: nothing was broken, it simply was never wired up.
   */
  const showInitCollapse = useSettingsStore((s) => s.showInitCollapseButton);
  const turnTimerEnabled = useSettingsStore((s) => s.turnTimerEnabled);

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
    void (async () => {
      if (!(await guardPaneSwap(activeId, LOSE_TURN(active.name)))) return;
      selectCombatant(activeId);
      useLayoutStore.getState().open(activeId);
      trackerUi.showMain('combatant');
    })();
    // `active` is read fresh on the render where activeId changes; adding it would re-run this on
    // every unrelated combatant edit (HP, conditions) and re-prompt.
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
   * and every open sheet with it, taking unpushed working copies with no warning. So it goes through
   * the SAME gate as every other way of losing a sheet, and only navigates if the GM agrees.
   */
  const lastSettingsReqRef = useRef(settingsRequest);
  useEffect(() => {
    if (settingsRequest === lastSettingsReqRef.current) return;
    lastSettingsReqRef.current = settingsRequest;
    void (async () => {
      if (!(await leaveFullSheet())) return;
      for (const h of paneSheets.current.values()) {
        if (!(await h.confirmLeave())) return;
      }
      onOpenSettings();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsRequest]);

  // ── A PC's pane IS their Heroes Heaven sheet ─────────────────────────────────
  /*
   * The whole point of the two apps being connected: a PC's tab shows the real, editable character,
   * not the tracker's thin copy of them. Returning null (a combatant who isn't one of this
   * campaign's characters) falls back to the tracker's own CombatantDetail.
   */
  const renderPcPane = useCallback(
    (c: Combatant, handles: PcPaneHandles): ReactNode | null => {
      const entry = roster.byName.get(c.name.trim().toLowerCase());
      if (!entry) return null;

      /*
       * A PC pane needs its OWN close and move controls. The tracker gives a creature pane those via
       * CombatantDetail's header; a PC pane renders HH's sheet instead, whose only close (the Back
       * arrow) lives in the app chrome we hide. Without this header, two PC sheets tiled as two panes
       * couldn't be closed at all — exactly the bug being fixed.
       *
       * PaneLayout hands `onClose`/`dockHandle`/`onHeaderDrag` only to a SOLO pane; a pane sharing a
       * tab strip already has a × per tab, so no header is drawn there.
       */
      const closePane = async () => {
        const h = paneSheets.current.get(c.id);
        if (h && !(await h.confirmLeave())) return; // prompt before dropping unsaved GM edits
        handles.onClose?.();
      };

      return (
        <PcPaneShell name={entry.character.name} handles={handles} onClose={closePane}>
          <GmEditSheet
            // KEY IS LOAD-BEARING: GmEditSheet copies `initial` into state, and useState only reads
            // its argument on first render — so reusing this position for a different character would
            // keep showing (and editing) the previous one's working copy.
            key={entry.id}
            ref={(h) => {
              if (h) paneSheets.current.set(c.id, h);
              else paneSheets.current.delete(c.id);
            }}
            initial={entry}
            content={content}
            campaignId={m.id}
            playerOwnerId={entry.id}
            onExit={() => handles.onClose?.()}
          />
        </PcPaneShell>
      );
    },
    [roster, content, m.id],
  );

  // The real levels of the real characters — what encounter difficulty must be rated against. The
  // tracker's own party level was a typed number that defaulted to 1, and rated a level-3 party's
  // fights against a level-1 budget.
  const partyLevels = useMemo(() => localMembers.map((mem) => mem.summary.level), [localMembers]);

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

  return (
    <div className="tracker-root campaign-tracker" style={trackerVars ?? undefined}>
      <GameDataProvider>
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
              <aside
                className="ct-order"
                style={{ width: railWidth, minWidth: railWidth, maxWidth: railWidth }}
              >
                {/* The turn timer — a data-free feature the original tracker put in its toolbar. It
                    self-hides unless enabled in Settings → Initiative tracker → Timer, and reads only
                    the combat/settings stores, so mounting it is all that's needed. */}
                {turnTimerEnabled && (
                  <div className="ct-rail-timer">
                    <TurnTimerWidget />
                  </div>
                )}
                {/* InitiativeTracker is h-full, so it needs its own flex:1 box to leave room for the
                    footer below it. */}
                <div className="ct-order-scroll">
                  <InitiativeTracker
                    onCombatantClick={handleCombatantClick}
                    onMinWidthMeasured={setRailMinWidth}
                    onCollapse={showInitCollapse ? () => setRailCollapsedPersist(true) : undefined}
                  />
                </div>
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
                playersSlot={
                  <PartyMembers
                    campaignId={m.id}
                    isGm={m.role === 'gm'}
                    // The card's "Stats shown" sections, built from the real character. Following
                    // the tracker's own PcDetailConfig — the same dropdown in the party header.
                    renderExtra={(mem) => {
                      const st = pcStats.byId.get(mem.charId);
                      return st ? <PcStatsCardExtra stats={st} detail={pcDetail} /> : null;
                    }}
                    onView={(mem) => {
                      if (!TEST_CAMPAIGNS_WITHOUT_LOGIN) {
                        onViewMember(mem);
                        return;
                      }
                      // Local members ARE roster entries (charId === roster id).
                      // In combat the sheet joins the workspace beside the initiative order; out of
                      // combat there's nothing to keep an eye on, so it gets the whole view.
                      if (inCombat) {
                        const cid = combatants.find(
                          (c) => c.isPC && c.name.trim().toLowerCase() === mem.name.trim().toLowerCase(),
                        )?.id;
                        if (cid) {
                          handleCombatantClick(cid);
                          return;
                        }
                      }
                      setFullSheetId(mem.charId);
                    }}
                    localMembers={TEST_CAMPAIGNS_WITHOUT_LOGIN ? localMembers : undefined}
                  />
                }
              />
            )}
          </div>
        </div>

        {/* The tracker's own overlays, driven from the top-bar tools. */}
        {searchOpen && <GlobalSearch onClose={() => trackerUi.setSearch(false)} />}
        {customOpen && <TextConverter onClose={() => trackerUi.setCustom(false)} />}
        {encountersOpen && <EncounterManager onClose={() => trackerUi.setEncounters(false)} />}
        {appearanceOpen && <TrackerCustomize onClose={() => trackerUi.setAppearance(false)} />}
        <DiceOverlay />
        <FloatingWindowLayer />

        {/* Out of combat there's nothing to keep an eye on, so a party card's sheet gets the view.
            fullSheetRevert pins THIS review sheet to the app's global appearance when the tracker is
            re-themed — the in-combat panes follow the tracker theme, but this focused review shows the
            character as they really are. */}
        {fullSheetChar && (
          <div className="ct-sheet-full" style={fullSheetRevert}>
            <GmEditSheet
              key={fullSheetChar.id}
              ref={fullSheetRef}
              initial={fullSheetChar}
              content={content}
              campaignId={m.id}
              playerOwnerId={fullSheetChar.id}
              onExit={() => setFullSheetId(null)}
            />
          </div>
        )}
        </CampaignPcPaneProvider>
        </CampaignPcStatsProvider>
        </CampaignMonsterPartsProvider>
       </CampaignPartyLevelProvider>
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
 * The rail's footer — a data-free "quick add" combatant field and a "Clear" button.
 *
 * The original tracker's only add path is the (data-dependent, unwired) creature search, so in the
 * embed there was no way to drop a name-only combatant — a hazard, a nameless goblin — into the order
 * mid-fight, and no way to empty the board (End Combat ends the round but keeps everyone). Both are
 * pure combat-store operations that need no bestiary.
 */
function RailFooter() {
  const combatants = useCombatStore((s) => s.combatants);
  const addCombatant = useCombatStore((s) => s.addCombatant);
  const clearAll = useCombatStore((s) => s.clearAllCombatants);
  const [name, setName] = useState('');

  const add = () => {
    const t = name.trim();
    if (!t) return;
    addCombatant(null, { name: t });
    setName('');
  };
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
      <input
        className="ct-rail-add"
        placeholder="+ Add combatant"
        aria-label="Add a combatant to the initiative order"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
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
        Click anyone in the initiative order to open their stat block here.
        <br />
        Drag one onto a pane's edge to tile it, or onto its tabs to stack it.
      </div>
    );
  }
  return <PaneLayout combatants={combatants} />;
}
