import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
// Removable integration flag — see src/integration/README.md.
import { TEST_CAMPAIGNS_WITHOUT_LOGIN, TRACKER_IN_CAMPAIGN } from './integration/enabled';
import { wasOnCampaignsPage, setOnCampaignsPage } from './integration/lastCampaignView';
import { combatOwnsUndo } from './integration/combatUndoClaim';
import { undoIsClaimed } from './undoClaim';
import { CharacterSheet } from './sheet/CharacterSheet';
import { RosterScreen } from './sheet/RosterScreen';
import { HomebrewPage } from './sheet/HomebrewPage';
import { CampaignsPage } from './sheet/CampaignsPage';
import { Builder } from './builder/Builder';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { UpdateNotice } from './sheet/UpdateNotice';
import { WindowControls } from './sheet/WindowControls';
import { HeroesHeavenLogo } from './sheet/Logo';
import { loadContent, rebuildContent, onDescriptionsLoaded } from './data';
import { pickScreen } from './appScreen';
import { useAuth } from './data/useAuth';
import { startCloudSync, hasSyncedOnce, noteDerivedRefresh, pullForGmApply } from './data/cloudSync';
import { startCampaignHomebrew, refreshCampaignHomebrew, homebrewFingerprint } from './data/campaignHomebrew';
import { rebuildRoster, carryStoredOverrides } from './data/rebuild';
import { LoginScreen } from './sheet/LoginScreen';
import { getLoginSkipped, setLoginSkipped } from './data/device';
import { collectPortraitRefs, gcSharpPortraits, initPortraitStore } from './data/portraitStore';
import { computeSummary } from './sheet/partySummary';
import { publishCharacter, unpublishCharacter, fetchGmEdits, fetchPublishedSheet, deleteGmEdit, markGmEditRefused, currentUserId, subscribeGmEdits, type GmEdit } from './data/party';
import { loadRoster, saveRoster, newRosterId, duplicateChar, uniqueName, loadActiveId, saveActiveId, saveHomebrewItem, saveMode, deleteMode, loadCampaigns, saveCampaigns, loadSyncOwner, loadGmEditsApplied, saveGmEditsApplied, loadGmEditChains, saveGmEditChains, loadedAuthoredAs, ROSTER_KEY, localStorageBytes, type SavedChar } from './data/storage';
import { authoredKey, hash53 } from './data/authored';
import { isTauri } from './platform';
import { getPrefs, subscribePrefs } from './data/prefs';
import { useIsMobile, useShowUndoButtons } from './sheet/useIsMobile';
import { gmEditVerdict, boundGmBase, editsToApply, sameInstant, type GmChainRecord } from './sheet/gmSync';
import { useHeightVar } from './sheet/useHeightVar';
import { setupPersist, schedulePersist, persistNow, flushPersist, hasPendingPersist, recentPersists } from './data/persist';
import { chooseDialog } from './sheet/confirm';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from './rules/build';
import { useUndoableState } from './useUndoableState';
import { applyPlayState, initialPlay, playForRebuild, reconcileFormulaBook, rest, type PlayState } from './rules/play';
import { abilityMod } from './rules/derive';
import { companionConMod } from './rules/companions';
import { ContentContext } from './sheet/ContentContext';
import { PopupSizeController } from './sheet/PopupSizeController';
import { OverlayDismissGuard } from './sheet/OverlayDismissGuard';
import { PopupSizeLock } from './sheet/PopupSizeLock';
import { SettingsPage } from './sheet/SettingsPage';
import { CustomizationContext, useGlobalCustomization, effectiveCustomization } from './data/customization';
import { bumpZoom, resetZoom, ZOOM_STEP } from './theme/zoom';
import type { Character, ContentDatabase, Item, ModeDef } from './rules/types';

/** How often to look for a GM's edit when the Realtime stream is DOWN. Only ever runs in that case, so
 *  it can be brisk: at the table a GM's change to your hit points has to land in about a second. */

/**
 * How long to wait after a change before republishing to the party.
 *
 * This is the delay a GM sees before a player's damage shows on their screen, so it wants to be short.
 * It's still a debounce, not a throttle: a burst — dragging an HP stepper, typing a name — collapses
 * into ONE publish once the player stops, so the cost is a single write per action either way. It used
 * to be 1500ms, which at the table reads as the sync being slow.
 */
const PUBLISH_DEBOUNCE_MS = 400;

/**
 * F1 (2026-10-09): the longest the serialised GM-edit pass waits on one network answer (the rows, the
 * fresh reads of our own published rows, the cloud pull before an apply, a refusal receipt).
 * supabase-js has no fetch timeout, so one hung request kept the pass `running` for the whole session
 * and no later pass ever judged anything. On the bound the pass ends with nothing more judged, consumed
 * or written (a pull or a receipt counts as "not true": the apply WAITS, the refused row stays), and
 * `running` is released. It only ever delays an apply; it never writes the roster and never consumes a row.
 */
const GM_PASS_AWAIT_MS = 20_000;
const TIMED_OUT: unique symbol = Symbol('timed out');
function bounded<T>(p: Promise<T>): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), GM_PASS_AWAIT_MS);
  });
  const clear = () => clearTimeout(timer);
  p.then(clear, clear);
  return Promise.race([p, bound]);
}
function boundedTrue(p: Promise<boolean>): Promise<boolean> {
  return bounded(p).then((v) => v === true);
}

/**
 * F1 (2026-10-09, round 7): WHERE A ROSTER ENTRY CAME FROM, BY MARK. The after-commit effect must tell
 * "the commit holds the GM's apply, or a player change composed on it" from "something replaced the
 * entry". Guessing that from which sub-objects an updater keeps failed: a Customize click or a Ctrl+=
 * zoom right after the apply makes a NEW `character` object (race legs 47, 48), and his edit — on their
 * sheet — was answered "not applied". So the apply MARKS what it wrote, and the entry it was judged over:
 *  - `GM_APPLIED` on the written entry (the row's `campaign|char|stamp`);
 *  - `GM_JUDGED` on the judged entry, assigned on the committed object (invisible to React and readers).
 * Both are ENUMERABLE symbol-keyed own properties: every App updater composes on an entry by object
 * spread (`{ ...c, … }`), which copies them; JSON (persistence, the cloud bundle, the publish payload)
 * and `structuredClone` drop them, so an entry that was parsed, loaded, adopted, imported or built fresh
 * carries no mark (test/gm-apply-mark.test.ts). The key names ONE GM row: a later push has its own stamp,
 * and a row already handled is never judged again, so an old mark can never answer for a new record.
 */
const GM_APPLIED = Symbol('hh.gmApplied');
const GM_JUDGED = Symbol('hh.gmJudged');
type GmMarked = SavedChar & { [GM_APPLIED]?: string; [GM_JUDGED]?: string };

function initialRoster(): SavedChar[] {
  // A fresh install starts with an EMPTY roster — no demo character is injected. The RosterScreen
  // renders a friendly empty state that guides the user to create their first character.
  return loadRoster();
}

export default function App() {
  const [content, setContent] = useState<ContentDatabase | null>(null);
  // Web build: gates the whole app behind a magic-link login. 'disabled' on desktop → no login.
  const auth = useAuth();
  // DEV-ONLY escape hatch: open the app without an account on the local dev server (for testing).
  // `import.meta.env.DEV` is false in the production build, so this never appears on the deployed
  // site and the friends-only login stays enforced there. Bypass = local-only (no cloud sync).
  // TEST_CAMPAIGNS_WITHOUT_LOGIN (src/integration/ — removable) only saves setting the sessionStorage
  // flag by hand while testing the tracker. The `import.meta.env.DEV &&` guard is UNCHANGED, so this
  // still cannot appear in a production build and the friends-only login stays enforced there.
  const [devBypass, setDevBypass] = useState(
    () => import.meta.env.DEV && (TEST_CAMPAIGNS_WITHOUT_LOGIN || sessionStorage.getItem('hh-dev-skip') === '1'),
  );
  // Installed app: login is optional. If the user chose "continue without an account", remember it so
  // we don't show the login wall on every launch. The web build has no persistent skip (login there
  // is friends-only + mandatory); its only bypass is the DEV one above.
  const [localSkip, setLocalSkip] = useState(() => isTauri && getLoginSkipped());
  const bypassLogin = devBypass || localSkip;
  // Roster lives in an undo/redo timeline: every character-data change (all sheet mutations funnel
  // through setRoster) becomes an undoable step, driving Ctrl+Z / Ctrl+Shift+Z below.
  const { state: roster, set: setRoster, undo, redo, canUndo, canRedo } = useUndoableState<SavedChar[]>(initialRoster);
  // Settings → Interface can hide the undo/redo arrows (and 'auto' hides them on phones). The keyboard
  // shortcuts below are NOT gated on this — the setting is about header clutter, not about undo.
  const showUndoButtons = useShowUndoButtons();
  // ≤720px. Only the Campaigns menu gate below reads it — the phone keeps no GM side.
  const isPhone = useIsMobile();
  const [activeId, setActiveId] = useState<string>(() => {
    // Reopen the last-active character if it still exists, else the first (or '' on an empty roster).
    const r = initialRoster();
    const saved = loadActiveId();
    return r.some((c) => c.id === saved) ? (saved as string) : (r[0]?.id ?? '');
  });
  // Boot on the roster: it's driven entirely by localStorage so it paints immediately, while the
  // heavy content database (public/core.json) loads in the background. Once content arrives we
  // continue to the last-active sheet — the app's usual landing screen — unless the user already
  // started interacting with the roster (then yanking them away would be jarring).
  const [mode, setMode] = useState<'sheet' | 'builder' | 'roster' | 'homebrew' | 'campaigns' | 'settings'>('roster');
  // Was the app closed on the campaigns page? Captured ONCE, at mount, because the effect that keeps
  // the marker in sync clears it as soon as we boot on the roster — so we must read it before that
  // runs. Acted on only after content loads (campaigns needs it). See boot effect below.
  //
  // The marker alone decides it. It used to need a REMEMBERED CAMPAIGN as well, which quietly excluded
  // the one user this door was built for: signed out, the page IS the initiative tracker (the local
  // table) and there is no campaign to remember, so a GM who closed the app running a fight was
  // dropped on the roster every launch and had to go back through the hamburger. Since the marker is
  // cleared the moment you navigate anywhere else, "it was the current screen at close" is already the
  // whole question — a signed-in GM sitting on the campaigns list simply reopens on the list.
  const [bootToCampaign] = useState(() => TRACKER_IN_CAMPAIGN && wasOnCampaignsPage());
  // Campaign OPERATIONS are a cloud feature: create, join, the party, a player's published sheet all
  // need an account, and `campaignsOnline` is the gate on them. The DEV-only skip-login bypass counts
  // (`devBypass` is always false in the production build, so this never loosens the real gate).
  //
  // THE INITIATIVE TRACKER IS NOT ONE OF THEM. "The initiative tracker needs to be accessible without
  // an account. It will just not have any of the online features and only work as an empty campaign."
  // So on desktop the page is always offered — signed out it opens the local table instead of the
  // campaigns list (see CampaignsPage). On a PHONE it stays closed while signed out: the phone has no
  // GM side at all, and a signed-in phone still gets exactly the list + join-by-code it always had.
  const campaignsOnline = auth.status === 'signed-in' || devBypass;
  /**
   * CAN THIS DEVICE BE ON THE CAMPAIGNS PAGE AT ALL — the one predicate, for BOTH ways in.
   *
   * The menu item asks it, and so does the boot restore below. The boot path used to ask nothing
   * (just "was the app closed there?"), so the door the menu keeps shut on a signed-out phone stood
   * wide open at launch: the phone booted onto a campaigns page it has no GM side for.
   *
   * ⚠ On a PHONE this is false while the session is still 'loading' — not because the answer is no,
   * but because there is no answer yet. Harmless for the MENU (a hidden item costs nothing and comes
   * back on the very next render) and wrong for the BOOT restore, which decides once and for all: see
   * `bootPending` below.
   */
  const campaignsReachable = campaignsOnline || !isPhone;
  const onOpenCampaigns = campaignsReachable ? () => setMode('campaigns') : undefined;
  /** Set when the boot restore wants the campaigns page and the session hasn't answered yet. */
  const [bootPending, setBootPending] = useState(false);
  // Which screen the Settings / Customize pages should return to when closed (the one they opened from).
  const [uiReturn, setUiReturn] = useState<'sheet' | 'roster' | 'homebrew' | 'campaigns'>('roster');
  const autoOpenSheet = useRef(true);
  /** Takes the "the user is already using the app" listeners off — called where the boot restore's
   *  decision is actually MADE, which is either the content load or the `bootPending` effect below. */
  const stopBootCancel = useRef(() => {});
  // The build being edited: a BuildState (edit existing) or null (creating new).
  const [editing, setEditing] = useState<{ id: string; build: BuildState } | null>(null);
  // True when the last persist attempt was rejected (e.g. localStorage quota) — surfaced as a banner
  // so the user knows their changes aren't being saved rather than losing them silently.
  const [saveFailed, setSaveFailed] = useState(false);
  // Proactive "storage almost full" heads-up (before the hard quota failure that sets saveFailed).
  const [storageWarn, setStorageWarn] = useState(false);
  /* How much banner is currently showing, published as --app-banner-h. The pinned screens are sized to
   * the viewport MINUS this: banners are flow siblings above them, so without the subtraction a single
   * update notice makes the document taller than the window, and scrolling it drags the top bar off.
   * (The "your GM overwrote you" banner is gone, F1 2026-10: a GM edit is applied only when it loses
   * nothing of the player's, so there is no replaced work left to announce.) */
  const bannersRef = useHeightVar<HTMLDivElement>('--app-banner-h', [saveFailed, storageWarn]);
  const storageDismissed = useRef(false);
  // Set by structural roster changes (create/delete/import/duplicate) so the NEXT persist writes
  // immediately instead of debouncing — a crash inside the debounce window must not drop a whole
  // character. Play mutations leave it false and take the debounced path. See the persist effect.
  const persistImmediately = useRef(false);
  const commitStructural = () => {
    persistImmediately.current = true;
  };

  /*
   * REBUILD EVERY CHARACTER ONCE PER LAUNCH, from its build against the CURRENT engine and data.
   *
   * The stored `character` is a derived cache, and until now it was refreshed only when the player
   * next edited the build — so every data fix and engine fix shipped BLIND to existing rosters. The
   * owner updated to a build where his cleric's archetype finally worked, opened the sheet, and it
   * still showed the old spellcasting: the snapshot on disk was built by the previous version and
   * nothing ever re-derived it. Play state is deliberately untouched (the BUILD didn't change, so
   * there is nothing to reconcile — expended slots, HP and inventory stay put), and a character
   * whose rebuild throws keeps its stored snapshot rather than bricking the roster.
   *
   * ⚠ A rebuild is a DERIVED refresh, not an edit. The first version of this let the changed JSON
   * reach cloud sync's edit detector, which stamped every character "updated now" and pushed — so a
   * device that had merely been OPENED became the newest copy of everything and won merges against
   * real edits made seconds earlier on another device (the owner's "it deletes what I did a couple of
   * seconds later", 2026-09-02). `noteDerivedRefresh` moves the detector's baseline without stamping.
   * (Idempotent, so React re-running the updater in dev strict mode is harmless.)
   */
  const rebuiltThisLaunch = useRef(false);
  useEffect(() => {
    if (!content || rebuiltThisLaunch.current) return;
    rebuiltThisLaunch.current = true;
    setRoster((r) => {
      const next = rebuildRoster(r, content);
      noteDerivedRefresh(next);
      return next;
    });
  }, [content, setRoster]);

  /*
   * RE-MERGE THE CONTENT DATABASE AND RE-DERIVE EVERY CHARACTER, MID-SESSION — the one path for every
   * background change to what the database is merged from: the trust-gate switch below, a GM's campaign
   * homebrew arriving (startCampaignHomebrew's onChanged), and homebrew another device synced here.
   *
   * ⚠ Still a DERIVED refresh, never an edit — and, mid-session, never a way to swallow one either:
   * `noteDerivedRefresh(next, r)` leaves alone any character whose queued copy holds an edit that has
   * not been persisted yet, so the persist that follows still stamps and pushes it (see cloudSync.ts).
   *
   * `lastHbFp` is the homebrew fingerprint the database was last merged from — and null until core.json
   * is in. Before that, rebuildContent() would hand every screen a SEED-ONLY database and the launch
   * rebuild would re-derive the roster against it; skipping is safe because the load's own merge reads
   * storage itself. Called through a ref, so long-lived callbacks always reach the latest one.
   *
   * ⚠ `contentRef` moves WITH the merge, not on the next render. The cloud-sync adopt below rebuilds
   * against it, and an adopt can land between this call and that render (a trust-gate flip arrives
   * inside adopt() itself, before the roster does). Left a render behind, the adopt re-derived an
   * untouched character against the OLD database after this refresh had moved its baseline to the NEW
   * one — the next persist then stamped it "updated now" and pushed it (the 2026-09-02 class), and it
   * stayed derived from the old database.
   */
  const contentRef = useRef(content);
  contentRef.current = content;
  const lastHbFp = useRef<string | null>(null);
  /** Re-merge the database from storage. Null (and nothing done) before core.json is in. */
  const remerge = (): ContentDatabase | null => {
    if (lastHbFp.current === null) return null;
    lastHbFp.current = homebrewFingerprint();
    const db = rebuildContent();
    contentRef.current = db;
    setContent(db);
    return db;
  };
  const refreshDerived = () => {
    const db = remerge();
    if (!db) return;
    setRoster((r) => {
      const next = rebuildRoster(r, db);
      noteDerivedRefresh(next, r);
      return next;
    });
  };
  const refreshDerivedRef = useRef(refreshDerived);
  refreshDerivedRef.current = refreshDerived;

  /*
   * VERIFIED RULES ONLY — the trust gate's switch (docs/trust-gate.md §4).
   *
   * Flipping it must do TWO things, not one: re-merge the content database (the gate runs inside
   * mergeWithSeed, on the raw core, so a rebuild re-gates from scratch in either direction) AND
   * re-derive every character, because the stored `character` is a derived cache — without the roster
   * rebuild only the open sheet would change and every other character would keep its pre-flip numbers.
   *
   * Watched HERE rather than handled in the Settings card because prefs are cloud-synced: a flip made
   * on the phone arrives through `reloadPrefs` and has to land the same way, with no relaunch.
   *
   * ⚠ `noteDerivedRefresh` — a rebuild is a DERIVED refresh, never an edit. See the launch rebuild
   * above and src/data/rebuild.ts:14-15 for the two-device data loss that taught this.
   */
  const gatePref = useRef(getPrefs().trustGate);
  useEffect(
    () =>
      subscribePrefs((p) => {
        if (p.trustGate === gatePref.current) return;
        gatePref.current = p.trustGate;
        refreshDerivedRef.current();
      }),
    [],
  );

  useEffect(() => {
    // Any interaction while loading cancels the boot-time jump to the sheet.
    const cancel = () => {
      autoOpenSheet.current = false;
    };
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('keydown', cancel, true);
    const stopCancel = () => {
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('keydown', cancel, true);
    };
    stopBootCancel.current = stopCancel;
    // Descriptions arrive in a second file after the app is already interactive, and the loader
    // re-merges so they come back as a NEW database. Swapping it in is what makes them appear:
    // several layers downstream memoise on the database identity (applyOverrides, the sheet's
    // player-facing copy), so mutating records in place left every description blank — the failure
    // mode this split could have shipped with. Subscribed BEFORE the load so a database that is
    // already complete (main.tsx prefetches before React mounts) still reaches us.
    const stopDesc = onDescriptionsLoaded((db) => setContent(db));
    loadContent().then((c) => {
      // What `c` was merged from. Read here, not after the commit: a sync landing in between would be
      // counted as already merged and never reach the database.
      lastHbFp.current = homebrewFingerprint();
      setContent(c);
      // Restore the last screen once content is ready (campaigns needs it). If the app was closed while
      // looking at a campaign, reopen there; otherwise auto-jump to the last-active sheet. Both only
      // fire if the user hasn't already started interacting with the roster (which cancels the jump),
      // and only from the roster boot screen — never yanking them off somewhere they navigated to.
      // Settings → Appearance → "Opens on" can turn the whole restore off and stay on Characters.
      let waiting = false;
      if (autoOpenSheet.current && getPrefs().startupScreen !== 'characters') {
        // …and only where this device may be on that page at all — the menu gate and this one are the
        // same predicate. The screen itself is picked in the effect below, because on a phone that
        // predicate needs the session and the session often answers AFTER this load.
        if (bootToCampaign) {
          setBootPending(true);
          waiting = true;
        } else if (activeId) setMode((m) => (m === 'roster' ? 'sheet' : m));
      }
      // The listeners come off where the decision is MADE, and the bootPending branch has not made one
      // — it is still waiting for the session. Removing them here left that whole wait with nothing
      // listening: a GM who gave up and started using the roster was yanked onto the campaigns page
      // anyway the moment auth answered. That branch takes them off in the effect below instead.
      if (!waiting) stopCancel();
    });
    return () => {
      stopCancel();
      stopDesc();
    };
  }, []);

  /*
   * THE OTHER HALF OF THE BOOT RESTORE — which screen a launch that was closed on the campaigns page
   * lands on, decided once the session has answered.
   *
   * It used to be decided inside the content load above, from `campaignsReachable` read at that one
   * moment. On a phone that predicate NEEDS the session, and the session regularly answers later than
   * the content does: core.json comes straight out of the service worker's cache while an expired
   * token is still being refreshed over the network. 'loading' was then read as "no account", so a
   * SIGNED-IN GM's phone that was closed on a campaign reopened on a character sheet — and nothing
   * ever re-ran the branch. "Not yet known" is not "no": the ambiguous case waits here instead.
   *
   * Where auth has already answered this runs on the very next commit, so nothing else changes.
   * `autoOpenSheet` keeps the last word: a user who started using the roster while we waited is never
   * yanked off it.
   */
  useEffect(() => {
    if (!bootPending || auth.status === 'loading') return;
    setBootPending(false);
    // THE DECISION IS MADE HERE, so this is where the cancel listeners have done their job — anything
    // the user did during the wait above has already reached `autoOpenSheet`, and nothing after this
    // line is a boot restore to cancel.
    stopBootCancel.current();
    if (!autoOpenSheet.current) return;
    if (campaignsReachable) setMode((m) => (m === 'roster' ? 'campaigns' : m));
    else if (activeId) setMode((m) => (m === 'roster' ? 'sheet' : m));
  }, [bootPending, auth.status, campaignsReachable, activeId]);

  // Roster persistence is DEBOUNCED (see data/persist.ts): a burst of play mutations (HP ticks,
  // condition toggles, resource pips, a scrubbed stepper, per-keystroke XP) coalesces into one write
  // after a short idle gap, instead of JSON-stringifying the whole roster (portraits included) on
  // every event — the Android input-lag fix. Teardown handlers below flush any pending write so
  // nothing is lost when the app closes or is backgrounded.
  useEffect(() => {
    setupPersist(saveRoster, (ok) => {
      setSaveFailed(!ok);
      // Warn well before the browser's hard cap (~5MB web / more on the installed app).
      const limit = (isTauri ? 9 : 4.5) * 1024 * 1024;
      if (ok && !storageDismissed.current) setStorageWarn(localStorageBytes() > limit);
    });
  }, []);
  // Web build: once signed in, mirror the roster to/from the cloud — pull+merge on login, push on
  // change/background. `disabled` (desktop) never starts it. Applying the merged roster replaces
  // React state so the just-pulled cloud characters appear immediately.
  // The sync callback below (registered once per sign-in) rebuilds an adopted roster against
  // `contentRef` — whatever content is loaded by the time a pull lands (see refreshDerived above).
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cleanup = () => {};
    let stopCampaignHb = () => {};
    let cancelled = false;
    // Whose data the database was merged from. Another account signing in wipes it (startCloudSync),
    // and the database has to follow even when nothing that account pulls differs from the empty
    // storage — else its sheets resolve the previous account's campaign homebrew until a relaunch.
    const ownerBefore = loadSyncOwner();
    void startCloudSync((merged) => {
      if (cancelled) return;
      // A pulled copy was derived by whichever app version last saved it — re-derive it here, and
      // register the result as a DERIVED refresh (not an edit) so it can never stamp or push.
      const db = contentRef.current;
      const next = db ? rebuildRoster(merged, db) : merged;
      noteDerivedRefresh(next);
      setRoster(next);
    }).then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
      // Campaign homebrew starts only once cloud sync has started and made its first pull: memberships
      // are synced data, and a fresh device's pre-sync (empty) list would read as "left every campaign".
      stopCampaignHb = startCampaignHomebrew({ onChanged: () => refreshDerivedRef.current() });
      if (loadSyncOwner() !== ownerBefore) refreshDerivedRef.current();
    });
    return () => {
      cancelled = true;
      stopCampaignHb();
      cleanup();
    };
  }, [auth.status, setRoster]);
  // Homebrew that arrives BY SYNC — another device's edit, a converted or exported campaign source —
  // used to reach localStorage and nothing else: the content database kept its launch-time merge, so
  // the new records resolved nowhere until the app was relaunched. After every sync, re-merge when the
  // homebrew actually differs from what the database was merged from. The fingerprint is
  // order-insensitive, so the no-op sync that follows every push never rebuilds anything.
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    // refreshDerived records the new fingerprint, and waits out a database that hasn't loaded yet.
    const onSynced = () => {
      if (homebrewFingerprint() !== lastHbFp.current) refreshDerivedRef.current();
    };
    window.addEventListener('hh-synced', onSynced);
    return () => window.removeEventListener('hh-synced', onSynced);
  }, [auth.status]);
  // Signing in supersedes any earlier "use offline" choice on the installed app.
  useEffect(() => {
    if (auth.status === 'signed-in' && localSkip) {
      setLoginSkipped(false);
      setLocalSkip(false);
    }
  }, [auth.status, localSkip]);
  /* ── THE GM-EDIT CHANNEL, PLAYER SIDE (F1, 2026-10) ──────────────────────────────────────────────
   * A GM edit is a WHOLE sheet built on a published sheet of ours. It is applied only when that is
   * provably lossless (src/sheet/gmSync.ts → gmEditVerdict); otherwise it waits, or is refused with a
   * receipt the GM's app shows as "not applied". The refs below are what the applier and the publish
   * effect share. */
  /** campaign|char judged WAIT and not consumed yet — a publish of that key re-runs the pull. */
  const gmWaitingRef = useRef<Set<string>>(new Set());
  /** The serialised pull, for the publish effect to call once a waiting key has published. */
  const gmPullRef = useRef<() => void>(() => undefined);
  /** Applies decided INSIDE the setRoster updater, consumed by the after-commit effect. Keyed by
   *  campaign|char|stamp, so an updater React re-invokes writes the same entries. */
  const gmAppliedRef = useRef<
    Map<string, { e: GmEdit; key: string; mark: string; base: string; stamp: string; result: string; entry: SavedChar; judged: SavedChar }>
  >(new Map());
  /** The chain records written THIS session, beside the stored ones (storage can fail). */
  const gmChainSession = useRef<Record<string, GmChainRecord>>({});
  /** Successful publishes seen while a key waits — a sheet that never matches its own published copy
   *  is said out loud once (a jsonb round trip that changes it). */
  const gmWaitPublishes = useRef<Map<string, number>>(new Map());
  const warnedLongWait = useRef<Set<string>>(new Set());
  /** Warn ONCE per session when the gm_character_edits cleanup delete removes no rows (RLS gap). */
  const warnedGmEditDelete = useRef(false);
  const warnedGmFuture = useRef(false);
  /** The handled stamps THIS session, held in memory beside the stored ones. `saveGmEditsApplied`
   *  swallows a storage failure (quota, private mode), and a stamp that never reached disk means the
   *  same GM row is judged again on every focus / visibility / online / Realtime event — the revert
   *  loop, back again. Memory is enough to close it for the session; the stored map covers the next
   *  launch. */
  const gmAppliedSession = useRef<Record<string, string>>({});
  // Publish characters attached to a campaign so teammates see them in the party. Debounced on roster
  // change; unpublishes any (campaign, character) pair that's no longer attached (detach / delete).
  const publishedRef = useRef<Set<string>>(new Set());
  /** campaign|char → the JSON last SENT (in flight or landed). A failed send forgets it, so the next
   *  run sends again — a publish that never landed must never look in sync (a GM edit is judged
   *  against what the server really holds). */
  const sentJsonRef = useRef<Map<string, string>>(new Map());
  const publishFailedRef = useRef(false);
  const [publishNonce, setPublishNonce] = useState(0);
  useEffect(() => {
    // The retry: a failed publish goes again on online / focus / visible. No timer — no polling.
    const kick = () => {
      if (publishFailedRef.current) setPublishNonce((n) => n + 1);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  /** A publish for this key LANDED. If a GM edit for it waits, judge it again now: what the server
   *  holds has just moved (or caught up). */
  const onPublishedKey = (key: string) => {
    if (!gmWaitingRef.current.has(key)) return;
    const n = (gmWaitPublishes.current.get(key) ?? 0) + 1;
    gmWaitPublishes.current.set(key, n);
    if (n >= 3 && !warnedLongWait.current.has(key)) {
      warnedLongWait.current.add(key);
      console.warn(`[HeavesParty] a GM edit for ${key} has waited through ${n} publishes — this device's sheet never matches the published one.`);
    }
    gmPullRef.current();
  };
  useEffect(() => {
    if (auth.status !== 'signed-in' || !content) return;
    const readyContent = content;
    const timer = setTimeout(() => {
      publishFailedRef.current = false;
      const desired = new Set<string>();
      for (const sc of roster) {
        const ids = sc.character.campaignIds ?? [];
        if (!ids.length) continue;
        try {
          const live = applyPlayState(sc.character, sc.play, readyContent);
          const summary = computeSummary(live, readyContent);
          // Publish the full SavedChar (character + build + play) so a GM can fully edit it; the party's
          // read-only view derives the live character from it.
          const published = { id: sc.id, character: sc.character, build: sc.build, play: sc.play };
          const json = JSON.stringify(published);
          // Only what CHANGED goes up. This effect runs on every roster change, so before this every
          // attached character was re-uploaded (portrait and all) on every edit to ANY character —
          // one Customize click on one sheet meant N uploads. Per (campaign, character): a campaign
          // attached since the last publish still gets its first upload, and a send that FAILED is
          // forgotten below, so it goes again.
          for (const cid of ids) {
            const key = cid + '|' + sc.id;
            desired.add(key);
            if (sentJsonRef.current.get(key) === json) continue;
            sentJsonRef.current.set(key, json);
            void publishCharacter(cid, sc.id, live.name, summary, published).then((res) => {
              if (res === 'ok') onPublishedKey(key);
              else if (res === 'failed') {
                if (sentJsonRef.current.get(key) === json) sentJsonRef.current.delete(key);
                publishFailedRef.current = true;
              }
              // 'superseded' (or a test mock's undefined): the newer send answers for it.
            });
          }
        } catch {
          /* skip a character that won't compute */
        }
      }
      for (const key of publishedRef.current) {
        if (desired.has(key)) continue;
        const [cid, charId] = key.split('|');
        sentJsonRef.current.delete(key);
        void unpublishCharacter(cid, charId).then((res) => {
          if (res === 'ok') onPublishedKey(key);
        });
      }
      publishedRef.current = desired;
    }, PUBLISH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `onPublishedKey` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, auth.status, content, publishNonce]);
  // A live ref to the roster so the async GM-edit applier below reads the LATEST roster without having
  // to re-subscribe on every roster change. (Canonical "latest value" ref — safe to write in render.)
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  // Live target for the Ctrl+zoom shortcuts: when the open character has a per-sheet zoom OVERRIDE, the
  // shortcuts must adjust THAT (not the device zoom, which the overlay would otherwise snap back over).
  const zoomTargetRef = useRef<{ id: string; zoom?: number } | null>(null);
  // Startup GC: reclaim on-device sharp portraits not referenced by a live character (replaced/deleted
  // in a previous session). Deferred here — instead of eagerly deleting on replace/delete — so in-session
  // undo can still restore a sharp copy. CRUCIAL: only run against an AUTHORITATIVE roster. A signed-in
  // device must wait for its first cloud pull (else a pre-pull / empty / corrupt local roster would nuke
  // sharp copies the pull is about to restore); a signed-out/local device is authoritative immediately.
  // We also never GC an empty roster (nothing safe to key off). Poll up to ~30s for that state, else skip.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (tries: number) => {
      await initPortraitStore();
      if (cancelled) return;
      const roster = rosterRef.current;
      // 'disabled' (cloud sync not configured) and 'signed-out' are local-only → authoritative at once;
      // a signed-in device must wait for its first cloud pull. (Omitting 'disabled' would leave local-only
      // installed builds — where sharp copies actually live — never GC'ing, leaking orphans forever.)
      const authoritative =
        auth.status === 'disabled' || auth.status === 'signed-out' || (auth.status === 'signed-in' && hasSyncedOnce());
      if ((!authoritative || roster.length === 0) && tries < 20) {
        timer = setTimeout(() => void attempt(tries + 1), 1500);
        return;
      }
      if (!authoritative || roster.length === 0) return; // gave up waiting → don't risk deleting
      void gcSharpPortraits(new Set(roster.flatMap((c) => collectPortraitRefs(c))));
    };
    void attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [auth.status]);
  /** A delete that reports success but removes no rows is the silent RLS gap (or a newer push that
   *  replaced the row) — said out loud once per session so it is diagnosable. */
  const warnIfZero = (deleted: number | null) => {
    if (deleted === 0 && !warnedGmEditDelete.current) {
      warnedGmEditDelete.current = true;
      console.warn(
        '[HeavesParty] gm_character_edits cleanup deleted 0 rows — either the GM replaced that edit in the meantime (harmless), or the database is missing the gce_owner_delete policy (run the current supabase-campaign-characters.sql). Handled edits are stamped locally, so nothing re-applies.',
      );
    }
  };
  /** Mark one GM row HANDLED: its stamp recorded (memory first — storage can fail), the row deleted
   *  on its OWN stamp (a newer push that replaced it survives to be judged), and it stops waiting. */
  const consumeGmEdit = (e: GmEdit) => {
    const key = `${e.campaignId}|${e.charId}`;
    gmAppliedSession.current[key] = e.updatedAt;
    // Session values WIN: equality semantics, so the newest handled stamp is the one that counts.
    const stamps = { ...loadGmEditsApplied(), ...gmAppliedSession.current };
    // …and prune stamps for characters no longer on this device, so the map cannot grow forever.
    const present = new Set(rosterRef.current.map((c) => c.id));
    for (const k of Object.keys(stamps)) if (!present.has(k.slice(k.indexOf('|') + 1))) delete stamps[k];
    saveGmEditsApplied(stamps);
    gmWaitingRef.current.delete(key);
    gmWaitPublishes.current.delete(key);
    gmAppliedRef.current.delete(`${key}|${e.updatedAt}`); // a record still waiting for its commit is moot now
    void deleteGmEdit(e.campaignId, e.charId, e.updatedAt).then(warnIfZero);
  };
  /*
   * JUDGE PENDING GM EDITS FOR MY CHARACTERS (F1, 2026-10). A GM can edit a player's sheet and push
   * it; the row reaches this app INSTANTLY via a Realtime subscription while it is open, and the
   * focus/visibility/online/sign-in pull is the fallback for when it was closed or the socket dropped.
   *
   * ⚠ A PLAYER'S CHANGE IS NEVER OVERWRITTEN. The edit is a WHOLE sheet the GM built on a published
   * sheet of ours. It used to replace this device's entry whenever its stamp was new — so a potion the
   * player drank after the GM's read, published within 400 ms, came back the moment his push landed,
   * with no banner (local equalled last-published). Now each row is judged against a FRESH read of our
   * own published row (gmSync.gmEditVerdict): applied only when provably lossless; WAIT (nothing
   * consumed) while this device differs from the server; REFUSED otherwise — never applied, and a
   * one-column receipt tells the GM "not applied". Only an APPLY writes the roster, and only inside
   * the updater, re-checked over the QUEUED roster.
   *
   * Passes are serialised: one runs, at most one more is queued (two concurrent passes judging one row
   * could write a false receipt).
   */
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    let running = false;
    let again = false;
    const pass = async () => {
      // Bounded (GM_PASS_AWAIT_MS): a hung read ends the pass with nothing judged.
      const edits = await bounded(fetchGmEdits());
      if (cancelled || edits === TIMED_OUT || !edits.length) return;
      // Only edits whose character actually lives in THIS device's roster are judged here. Edits for
      // characters this device doesn't have (another of the player's signed-in devices owns them, or a
      // mid-sync gap) are LEFT in place — consuming them here would rob the owning device of the edit.
      const present = new Set(rosterRef.current.map((c) => c.id));
      const mine = edits.filter((e) => present.has(e.charId) && e.sheet && e.sheet.character);
      if (!mine.length) return;
      /* NEVER JUDGE THE SAME EDIT TWICE. The cleanup delete is best-effort, and on a database missing
       * the `gce_owner_delete` policy it silently removes NOTHING — the row survived every apply, and
       * the old loop re-applied it on each poll tick (2.5 s). The handled stamp (per campaign+char,
       * by instant equality) is the structural guard: a row can linger forever and is judged once. */
      const handled = { ...loadGmEditsApplied(), ...gmAppliedSession.current };
      const fresh = editsToApply(mine, handled);
      // Strays a failed delete left behind are cleared too — on their own stamp — so a later policy
      // fix drains them.
      for (const e of mine) if (!fresh.includes(e)) void deleteGmEdit(e.campaignId, e.charId, e.updatedAt).then(warnIfZero);
      if (!fresh.length) return;
      const owns = await bounded(Promise.all(fresh.map((e) => fetchPublishedSheet(e.campaignId, e.charId))));
      if (cancelled || owns === TIMED_OUT) return; // a hung read: nothing judged, consumed or written
      const chains = { ...loadGmEditChains(), ...gmChainSession.current };
      const byId = new Map(rosterRef.current.map((c) => [c.id, c]));
      // Two campaigns can hold an edit for one character: judged in campaign-id order — no clock.
      const order = fresh
        .map((e, i) => ({ e, own: owns[i] }))
        .sort((a, b) => (a.e.campaignId < b.e.campaignId ? -1 : a.e.campaignId > b.e.campaignId ? 1 : 0));
      const candidates: { e: GmEdit; key: string; judged: SavedChar; base: string; stamp: string }[] = [];
      for (const { e, own } of order) {
        const key = `${e.campaignId}|${e.charId}`;
        const local = byId.get(e.charId);
        if (!local) continue;
        // Handled while this pass was out (an apply committed during its reads): judged once only, and
        // never put back in the waiting set it was consumed out of.
        if (sameInstant(gmAppliedSession.current[key], e.updatedAt)) continue;
        if (e.gmBase === 'future' && !warnedGmFuture.current) {
          warnedGmFuture.current = true;
          console.warn('[HeavesParty] a GM edit was written by a newer version of the app — it waits until this app is updated.');
        }
        const v = gmEditVerdict({ row: e, own, local, chain: chains[key], loaded: loadedAuthoredAs });
        if (v === 'wait') {
          gmWaitingRef.current.add(key);
          continue;
        }
        if (v === 'apply') {
          gmWaitingRef.current.add(key); // until the commit consumes it
          const b = boundGmBase(e)!;
          candidates.push({ e, key, judged: local, base: b.hash, stamp: b.stamp });
          continue;
        }
        // refuse / settled / told: the roster is never touched. `told` (the server already carries our
        // receipt for this push — one that landed after the bound below gave up on it) is consumed like
        // `settled`: no second receipt, never applied (F1 2026-10-09, race leg 46).
        if (v === 'refuse' && own?.sheet) {
          /* THE RECEIPT FIRST, AND THE ROW IS CONSUMED ONLY ONCE IT LANDED. F1 (2026-10-09): the row
           * used to be consumed first and the receipt fired and forgotten — one failed UPDATE (a blip)
           * and no later pass ever judged the row again, so the GM's overlay stood down at their next
           * publish and no screen ever said "not applied" (test/bug-gm-edit-race.test.tsx leg 40).
           * Unreceipted, the row stays: the next focus / visibility / online / Realtime pass judges it,
           * and receipts it, again. Awaited here, inside the serialised pass — bounded (GM_PASS_AWAIT_MS):
           * a hung UPDATE counts as not landed, so the row stays and the pass still ends. A receipt slower
           * than the bound can therefore still land late, after a later pass's receipt for a newer push
           * of his (out of order); a late receipt for THIS push is seen by the next judgment as `told`
           * and the row is only consumed, never applied (race leg 46). */
          const told = await boundedTrue(markGmEditRefused(e.campaignId, e.charId, e.updatedAt));
          if (cancelled) return;
          if (!told) continue;
        }
        consumeGmEdit(e);
      }
      if (!candidates.length) return;
      /* NOT BEHIND ITS OWN CLOUD COPY. F1 (2026-10-09): the verdict proves this device holds the sheet
       * the GM built on — not that the player's OTHER device has nothing newer. A device that last
       * pulled before they changed something on their phone can be the one that published last (a
       * failed publish retried on `online`), the GM builds on that stale sheet, and the apply — a
       * roster edit, stamped newest — then won the cloud merge over the phone's work (leg 38). So the
       * cloud is pulled first: a newer copy from their other device is adopted (queued ahead of the
       * updater below, whose re-check then finds the entry moved: it waits, and is refused once that
       * copy publishes). Not level, or the pull failed: everything here waits. No cloud: nothing to
       * pull, and no await (null). A pull that never answers counts as not level (GM_PASS_AWAIT_MS):
       * everything waits, and the pass ends so a later event can judge again. */
      const level = pullForGmApply();
      if (level && !(await boundedTrue(level))) return;
      if (cancelled) return;
      /* THE ONLY WRITE. Re-checked over the QUEUED roster `r`: `rosterRef.current` is the last
       * COMMITTED one, and an update scheduled and not yet rendered (another tab's roster on the storage
       * event, the cloud pull's merge — both non-discrete Scheduler-lane updates) can itself be the
       * player's work. The entry must still be what was judged — the same object, or the same authored
       * sheet — or it WAITS (nothing consumed; its own publish re-runs the pull). One APPLY per
       * character per pass falls out of the same check: after the first, the entry is no longer what
       * was judged. React runs this updater when it RENDERS, so nothing is consumed in here: the apply
       * is recorded in a ref keyed by row, idempotent if React re-invokes it, and consumed by the
       * after-commit effect below. 2026-09-23 (d)/(e)/(f) and F1 legs in test/bug-gm-edit-race.test.tsx.
       *
       * QUEUED IN THE ORDINARY BATCH, ON PURPOSE. F1 (2026-10-09, round 6): committing it synchronously
       * (flushSync) rendered the SYNC lane alone — a cloud adopt or a storage event still pending on the
       * default lane was skipped, the apply committed over the pre-adopt roster, and the persist loop
       * that followed ended in "Maximum update depth exceeded" with the other device's change persisted
       * over (legs 43–45). In the ordinary batch the adopt renders FIRST (same lane, in order), so the
       * re-check below sees the entry moved and waits. A player tap made after the apply is rebased on
       * top of it instead; the after-commit `landed` test recognises that by MARK (GM_APPLIED above;
       * legs 41, 47, 48). The updater records the very entry it wrote (`entry`), keyed by row, so a
       * rebased re-run re-records the same key, and marks the entry it was judged over (GM_JUDGED) —
       * both `k.judged` and the queued entry it actually composed on, which may be another object
       * holding the same authored sheet. */
      setRoster((r) => {
        let changed = false;
        const next = r.map((c) => {
          let cur = c;
          for (const k of candidates) {
            if (k.e.charId !== c.id) continue;
            if (cur !== k.judged && authoredKey(cur) !== authoredKey(k.judged)) continue;
            const mark = `${k.key}|${k.e.updatedAt}`;
            (k.judged as GmMarked)[GM_JUDGED] = mark;
            (cur as GmMarked)[GM_JUDGED] = mark;
            const applied: GmMarked = { ...k.e.sheet, id: c.id, archived: c.archived ?? false, [GM_APPLIED]: mark };
            cur = applied;
            gmAppliedRef.current.set(mark, {
              e: k.e,
              key: k.key,
              mark,
              base: k.base,
              stamp: k.stamp,
              result: hash53(authoredKey(cur)),
              entry: cur,
              judged: k.judged,
            });
            changed = true;
          }
          return cur;
        });
        return changed ? next : r; // no change → no undo step, no commit
      });
    };
    const run = () => {
      if (cancelled) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      void pass()
        .catch(() => undefined)
        .finally(() => {
          running = false;
          if (again && !cancelled) {
            again = false;
            run();
          }
        });
    };
    gmPullRef.current = run;
    run();
    const onFocus = () => run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    // A cloud adopt can bring this device level with its own published sheet, which settles a WAIT.
    const onSynced = () => {
      if (gmWaitingRef.current.size) run();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hh-synced', onSynced);
    // Realtime: judge the moment the GM pushes, without waiting for a focus/open. Subscribes once we
    // know this user's id; the subscription triggers the same pull (including on each (re)connect, so
    // nothing pushed during a socket drop is missed).
    //
    // NO POLLING. There used to be a 2.5-second fallback poll for when the Realtime stream was not up
    // (the table missing from the supabase_realtime publication). On the owner's setup that stream was
    // never up, so the "fallback" was the steady state: a request every 2.5 s for the whole session,
    // and every stale row in that table re-applied on the next tick. The owner's model of this feature
    // is the right one — a GM's change is PUSHED to the player's sheet when the GM makes it; the app
    // does not go asking every second (2026-09-02). Without the stream, a GM edit arrives on the next
    // focus / visibility / online / sign-in pull. Enabling the stream is a one-time SQL run
    // (supabase-campaign-characters.sql).
    let unsubscribe = () => {};
    void currentUserId().then((id) => {
      if (cancelled || !id) return;
      unsubscribe = subscribeGmEdits(id, run, () => {});
    });
    return () => {
      cancelled = true;
      gmPullRef.current = () => undefined;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hh-synced', onSynced);
      unsubscribe();
    };
    // `consumeGmEdit` / `warnIfZero` read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, setRoster]);
  /* An APPLY is consumed AFTER a commit, never inside the updater — see the updater above. No
   * dependency list on purpose: the only moment an apply is certainly real is once React has rendered
   * the update that produced it, and "after every commit" is that moment without having to guess which
   * of App's states carried it there. Everything else is a size check.
   * A crash between the commit and this effect leaves the row unconsumed: the next launch judges it
   * again — APPLY again (same content, lossless) or, once the result published, REFUSE.
   *
   * ⚠ ONLY WHAT THE COMMIT HOLDS, AND ON DISK IN THE SAME COMMIT. F1 (2026-10-09), two windows that
   * consumed a GM edit into nothing (no sheet held it, no receipt — his overlay just stood down):
   *   • a whole-roster VALUE queued after the updater in the same render batch (cloud sync's adopt, read
   *     from storage that never held the apply) wins the commit while the updater still recorded the
   *     apply. So an apply is consumed only when the COMMITTED entry is exactly its result; otherwise the
   *     row stays, and is judged again at once (leg 39);
   *   • the same adopt landing between the commit and a PASSIVE effect: the roster's persist is scheduled
   *     in a passive effect, so storage still lacked the apply when adopt read it. So this is a LAYOUT
   *     effect — no gap after the commit — and it writes the roster to storage itself before consuming:
   *     any adopt from here on reads the apply (stamped newest by the persist hook) (leg 39b). */
  useLayoutEffect(() => {
    const done = gmAppliedRef.current;
    if (!done.size) return;
    const committed = new Map(roster.map((c) => [c.id, c]));
    /* LANDED = the committed entry IS the apply, or was COMPOSED UPON it — it carries the apply's
     * GM_APPLIED mark (see GM_APPLIED at the top of this file). F1 (2026-10-09, rounds 6–7): a player
     * change queued after the apply is rebased on top of it by React, through one of App's functional
     * updaters, each of which spreads the entry it changes — a potion tap (`updatePlay`), a Customize
     * click (`updateCharacter`), a Ctrl+= zoom (`zoomStep`) — so the commit holds apply + change and the
     * mark: landed (legs 41, 47, 48; by content alone it read as "not landed", the row was judged again
     * and REFUSED — the GM told "not applied" while his edit was on their sheet). A whole-entry
     * replacement (a cloud adopt, a storage event: parsed, no mark) is "not landed" → judged again.
     *
     * NOT RENDERED YET = the committed entry is still the one the apply was judged over, or a change
     * composed on THAT — it carries the apply's GM_JUDGED mark — so this commit simply did not include
     * the apply. F1 (2026-10-09, round 6): React computes a state update EAGERLY when nothing else is
     * queued — the updater ran (and recorded, and marked) at dispatch — and a tap's click, on the
     * higher-priority sync lane, then committed alone, ahead of the apply. Dropped there, the record was
     * gone when the apply committed (React reuses the eager result, so the updater never runs again):
     * nothing was consumed, the row was refused once apply + tap published (leg 41 under production
     * lanes). Such a record is KEPT for the commit that holds it; nothing is consumed or re-judged
     * meanwhile (the row is still in the waiting set — any pass judges it as usual, and a pass that
     * consumes the row drops the record with it). */
    const landed: NonNullable<ReturnType<typeof done.get>>[] = [];
    let dropped = 0;
    for (const [k, a] of [...done]) {
      const c = committed.get(a.e.charId) as GmMarked | undefined;
      if (c && (c === a.entry || c[GM_APPLIED] === a.mark || hash53(authoredKey(c)) === a.result)) {
        landed.push(a);
        done.delete(k);
      } else if (c && (c === a.judged || c[GM_JUDGED] === a.mark)) {
        continue; // not rendered yet — kept for the commit that holds it
      } else {
        dropped++;
        done.delete(k);
      }
    }
    if (dropped) gmPullRef.current(); // never landed, and never will: judge them again
    if (!landed.length) return;
    persistNow(roster);
    for (const a of landed) {
      // `at`: WHICH push this record is the result of — only a push whose `gm_base.on` names it may use
      // the record (F1, 2026-10-09: a base-keyed record from an old apply answered for pushes it never saw).
      // `stamp`: the PUBLISH it was applied over — a push built on a LATER held push of his over that same
      // publish (a third gesture) is caught by it too (F1, 2026-10-09: a round-2 refuter probe, now leg (10f) of test/gm-sync.test.ts).
      gmChainSession.current[a.key] = { at: a.e.updatedAt, stamp: a.stamp, base: a.base, result: a.result };
      consumeGmEdit(a.e);
    }
    const chains = { ...loadGmEditChains(), ...gmChainSession.current };
    const present = new Set(rosterRef.current.map((c) => c.id));
    for (const k of Object.keys(chains)) if (!present.has(k.slice(k.indexOf('|') + 1))) delete chains[k];
    saveGmEditChains(chains);
  });
  useEffect(() => {
    if (persistImmediately.current) {
      persistImmediately.current = false;
      persistNow(roster);
    } else {
      schedulePersist(roster);
    }
  }, [roster]);
  // Flush pending writes on app teardown: beforeunload (close/reload) and visibilitychange→hidden
  // (Android background / tab switch — the only reliable "app is going away" signal on mobile).
  useEffect(() => {
    const flush = () => flushPersist();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flushPersist(); // component teardown (e.g. HMR) shouldn't drop a pending write
    };
  }, []);
  useEffect(() => saveActiveId(activeId), [activeId]);
  // Remember whether the campaigns page is the current screen, so a fresh launch can reopen a
  // campaign the app was closed on. (Removable integration; see src/integration/lastCampaignView.ts.)
  useEffect(() => {
    if (TRACKER_IN_CAMPAIGN) setOnCampaignsPage(mode === 'campaigns');
  }, [mode]);

  // Suppress the browser's default right-click menu (Back/Reload/Inspect) so the app feels native,
  // NOT like a web page. Editable fields keep the native menu so cut/copy/paste still works, and any
  // component that already handled the event (e.defaultPrevented) is left alone.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t && t.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // App zoom: Ctrl+wheel and Ctrl +/-/0 scale the whole UI (also adjustable in Settings). When the open
  // character has a per-sheet zoom OVERRIDE, adjust that override instead of the device zoom (else the
  // shortcut fights the overlay: it would jump to the device zoom and then snap back).
  useEffect(() => {
    const zoomStep = (delta: number | 'reset') => {
      const t = zoomTargetRef.current;
      if (t && t.zoom != null) {
        const next = delta === 'reset' ? 1 : Math.min(2, Math.max(0.6, Math.round((t.zoom + delta) * 20) / 20));
        setRoster((r) =>
          r.map((c) => (c.id === t.id ? { ...c, character: { ...c.character, customization: { ...c.character.customization, zoom: next } } } : c)),
        );
      } else if (delta === 'reset') {
        resetZoom();
      } else {
        bumpZoom(delta);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      // Undo / redo for every character change. While a text field is focused, let the browser's
      // native text undo handle it (so editing a field char-by-char still works); elsewhere, Ctrl+Z
      // reverts the last sheet action (condition, item, HP, …) and Ctrl+Shift+Z / Ctrl+Y redoes it.
      if (k === 'z' || k === 'y') {
        // The campaign tracker owns Ctrl+Z while it's on screen: there, undo means "undo the combat
        // I just did", not "revert a character edit from an hour ago". It runs its own handler, so
        // this one stands down or they'd both fire. (Removable integration — see
        // src/integration/combatUndoClaim.ts.)
        if (TRACKER_IN_CAMPAIGN && combatOwnsUndo()) return;
        // …and so does any screen holding its own timeline (the builder). Without this both handlers
        // fire and undo two different things at once. See src/undoClaim.ts.
        if (undoIsClaimed()) return;
        const el = document.activeElement as HTMLElement | null;
        const editing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (editing) return;
        e.preventDefault();
        if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
        else undo();
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep(ZOOM_STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomStep(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        zoomStep('reset');
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [undo, redo, setRoster]);

  // Cross-tab guard: the whole roster is one localStorage key written on every change, so a SECOND
  // context (another browser tab, or a dev tab open alongside the Tauri webview) would silently
  // overwrite this tab's characters — whoever saves last wins, and the other tab never notices its
  // work vanished. The `storage` event fires only in OTHER tabs when a key changes, so when the
  // roster key is written elsewhere we adopt that value (reloading it into our timeline) instead of
  // continuing to overwrite it. Three things are NOT another tab's work and must never be adopted:
  // our current serialization, an echo of any RECENT write of ours, and anything at all while an edit
  // of ours is still queued — adopting any of them hands the player back a version they moved past.
  // Desktop/web-relevant; the lone Tauri webview rarely hits it, so this stays lightweight.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ROSTER_KEY || e.newValue === null) return;
      if (e.newValue === JSON.stringify(roster)) return; // our own write echoed back — ignore
      // An edit of ours is still inside the persist debounce, so THIS tab holds the newest state and
      // adopting would undo it: t=0 we edit, t=400 we write v2, the other tab adopts v2, t=500 we
      // edit again (v3, pending), t=800 the other tab re-persists v2. Keep v3 AND its pending write —
      // it lands a moment later and the other tab adopts it in turn.
      if (hasPendingPersist()) return;
      // An echo of an OLDER write of ours is not another tab's work either: the `roster` above is this
      // effect's closure, and the other tab's echo of what it adopted from us can arrive several of our
      // own writes later (a backgrounded tab's debounce timer is throttled to a second or more), so it
      // is checked against every recent write, newest first, not just the last one.
      if ([...recentPersists()].reverse().some((r) => e.newValue === JSON.stringify(r))) return;
      // Another tab wrote the roster. Taking their version is a DERIVED refresh, NOT an edit — tell
      // cloud sync so the echo isn't stamped "updated now" and pushed as the newest copy of every
      // character (the two-device loss described on noteDerivedRefresh).
      const adopted = loadRoster();
      noteDerivedRefresh(adopted);
      setRoster(adopted);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [roster, setRoster]);

  const active = roster.find((c) => c.id === activeId) ?? roster[0];
  zoomTargetRef.current = active ? { id: active.id, zoom: active.character.customization?.zoom } : null;
  // Derive the in-play character ONCE per (character, play, content) change. Inlining this in JSX
  // produced a fresh Character every App render, defeating all downstream memoization on the tabs.
  const character = useMemo(() => {
    if (!content || !active) return null;
    // Defense-in-depth: a malformed play overlay (despite normalizePlay) must not white-screen the
    // app from this pre-ErrorBoundary useMemo — fall back to the un-overlaid built character.
    try {
      return applyPlayState(active.character, active.play, content);
    } catch (err) {
      console.error('applyPlayState failed; showing the un-overlaid character', err);
      try {
        return applyPlayState(active.character, undefined, content);
      } catch {
        return active.character;
      }
    }
  }, [content, active?.character, active?.play]);

  // Content the SHEET sees, with this character's Overrides content-edits (feat/feature text) overlaid.
  // applyOverrides returns the same ref when there are no edits, so memoization downstream is preserved.
  const sheetContent = useMemo(
    () => (content ? applyOverrides(content, active?.character.overrides) : content),
    [content, active?.character.overrides],
  );

  // With an EMPTY roster (fresh install, or the user deleted their last character) there's no active
  // character. The SHEET can't render without one, so fall back to the roster's empty state — EXCEPT
  // for the builder (mid-create), Homebrew, and Campaigns, which are character-less and reachable from
  // the roster menu (a fresh phone opening one of them must not snap back to the roster).
  const effectiveMode =
    active ? mode : mode === 'builder' || mode === 'homebrew' || mode === 'campaigns' || mode === 'settings' ? mode : 'roster';
  // Settings navigation (a full page). Remember where we came from so closing returns there. (Per-character
  // Customize is NOT a page — it's a drawer inside the sheet, so live changes are visible.)
  const openSettings = () => {
    if (mode === 'sheet' || mode === 'roster' || mode === 'homebrew' || mode === 'campaigns') setUiReturn(mode);
    setMode('settings');
  };
  const closeSubpage = () => setMode(uiReturn);
  // Reactive device-global customization default + this character's effective customization (default +
  // its overrides), provided to the sheet subtree so every consumer resolves the same values.
  const globalCustom = useGlobalCustomization();
  const effectiveCustom = useMemo(
    () => effectiveCustomization(globalCustom, active?.character.customization),
    [globalCustom, active?.character.customization],
  );
  // Edit the ACTIVE character's stored data (not play-state) — used for per-character customization.
  // Undo works like updatePlay below: one step per call, unless the caller passes a coalesceTag, in
  // which case rapid calls sharing it merge into one step (a dragged colour input, a typed field).
  const updateCharacter = (fn: (c: Character) => Character, coalesceTag?: string) => {
    if (!active) return;
    const id = active.id;
    setRoster(
      (r) => r.map((c) => (c.id === id ? { ...c, character: fn(c.character) } : c)),
      coalesceTag ? { coalesce: true, tag: `char:${id}:${coalesceTag}` } : undefined,
    );
  };

  // Update the active character's in-play runtime state (seeding from its built
  // starting values the first time it's touched), then persist via the roster.
  // Each call is a distinct undo step unless the caller opts in with a coalesceTag:
  // rapid calls sharing a tag (a scrubbed +/- stepper, a per-keystroke field) merge into one step.
  const updatePlay = (fn: (play: PlayState) => PlayState, coalesceTag?: string) => {
    if (!content) return; // sheet mutations can't happen before the content database is loaded
    const id = active.id;
    setRoster(
      (r) =>
        r.map((c) =>
          // Seed from initialPlay (derived from the character) then layer any persisted
          // state on top, so a play saved before newer fields existed gets them filled in.
          // reconcileFormulaBook runs here rather than at rebuild time so a character who never
          // reopens the builder still receives the book and the picks their records grant; it is
          // idempotent and marks each grant spent, so repeating it writes nothing twice.
          c.id === id
            ? { ...c, play: fn(reconcileFormulaBook({ ...initialPlay(c.character, content), ...(c.play ?? {}) }, c.character, content)) }
            : c,
        ),
      coalesceTag ? { coalesce: true, tag: `play:${id}:${coalesceTag}` } : undefined,
    );
  };

  // Register a user-created custom item: add it to the live content DB (so it resolves
  // immediately) and persist it as homebrew (so it survives reloads).
  const addCustomItem = (item: Item) => {
    setContent((c) => (c ? { ...c, items: { ...c.items, [item.id]: item } } : c));
    saveHomebrewItem(item);
    // Already merged, so the Realtime echo of this device's own push is not "homebrew arrived by sync".
    if (lastHbFp.current !== null) lastHbFp.current = homebrewFingerprint();
  };

  // Create/update or delete a user mode: update the live content DB + persist to localStorage.
  const saveModeDef = (mode: ModeDef) => {
    setContent((c) => (c ? { ...c, modes: { ...c.modes, [mode.id]: mode } } : c));
    saveMode(mode);
  };
  const removeModeDef = (id: string) => {
    setContent((c) => (c ? { ...c, modes: Object.fromEntries(Object.entries(c.modes).filter(([k]) => k !== id)) } : c));
    deleteMode(id);
  };

  // The Homebrew manager persists to localStorage itself; re-merge it over core so changes show live.
  // Through remerge, which records the fingerprint: otherwise the Realtime echo of this device's own
  // push (~3 s later) read as "homebrew arrived by sync" and re-derived every character for nothing.
  const onHomebrewChanged = () => void remerge();

  // Player: fully leave a campaign — drop the membership (synced + tombstoned via saveCampaigns) AND
  // detach it from every character, so nothing keeps publishing to it. Stripping the id from each
  // character makes the publish effect unpublish those campaign_characters rows. (A GM ends a campaign
  // by deleting it in the Campaigns page instead.)
  const leaveCampaign = (campaignId: string) => {
    saveCampaigns(loadCampaigns().filter((m) => m.id !== campaignId));
    // The membership is gone, so that campaign's homebrew becomes this player's own on the next
    // successful pull — kept, never deleted.
    void refreshCampaignHomebrew();
    commitStructural();
    setRoster((r) =>
      r.map((c) => {
        const cids = c.character.campaignIds ?? [];
        if (!cids.includes(campaignId)) return c;
        const character = { ...c.character, campaignIds: cids.filter((id) => id !== campaignId) };
        const build = c.build ? { ...c.build, campaignIds: (c.build.campaignIds ?? []).filter((id) => id !== campaignId) } : c.build;
        return { ...c, character, build };
      }),
    );
  };

  const deleteChar = (id: string) => {
    // Deleting the last character is allowed — the roster can go to zero (empty state).
    const remaining = roster.filter((c) => c.id !== id);
    commitStructural(); // structural change — persist immediately, don't debounce
    setRoster(remaining);
    if (id === activeId) setActiveId(remaining[0]?.id ?? '');
    // NOTE: the deleted character's on-device sharp portraits are NOT reclaimed here — an eager delete
    // would make an undo of this deletion (Ctrl+Z) bring the character back with its sharp portraits
    // already gone. Orphaned sharp copies are reclaimed by the startup GC (see the mount effect).
  };

  let screen: ReactNode;
  const which = pickScreen({ effectiveMode, hasContent: !!content, hasCharacter: !!character });
  // Every branch below 'roster'/'loading' is only reached once pickScreen has confirmed content is
  // loaded, so `content` is non-null there — but TS can't infer that through `which`. Assert once.
  const readyContent = content!;
  if (auth.status === 'loading' && !bypassLogin) {
    // Checking for an existing session (and completing any magic-link redirect on the web).
    screen = (
      <div className="login-screen">
        <header className="chrome" data-tauri-drag-region>
          <div className="chrome-brand" data-tauri-drag-region>
            <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
          </div>
          <WindowControls />
        </header>
        <div className="app-loading content-loading">
          <span className="app-loading-spin" aria-hidden="true" />
          <span>Signing in…</span>
        </div>
      </div>
    );
  } else if (auth.status === 'signed-out' && !bypassLogin) {
    screen = (
      <LoginScreen
        // Installed app: a real, persistent "use offline" skip. Web: no skip (friends-only login),
        // except the DEV-server escape hatch for local testing.
        onSkip={isTauri ? () => { setLoginSkipped(true); setLocalSkip(true); } : undefined}
        onDevSkip={
          !isTauri && import.meta.env.DEV
            ? () => { sessionStorage.setItem('hh-dev-skip', '1'); setDevBypass(true); }
            : undefined
        }
      />
    );
  } else if (which === 'roster') {
    screen = (
      <RosterScreen
        roster={roster}
        activeId={activeId}
        content={content}
        onOpen={(id) => {
          setActiveId(id);
          setMode('sheet');
        }}
        onNew={() => {
          setEditing(null);
          setMode('builder');
        }}
        onImport={async (saved, customItems, customModes) => {
          const norm = (n: string) => n.trim().toLowerCase();
          const collide = roster.find((c) => norm(c.character.name) === norm(saved.character.name));
          let action: 'add' | 'update' | 'rename' = 'add';
          if (collide) {
            const choice = await chooseDialog({
              title: `“${saved.character.name}” already exists`,
              message: 'A character with this name is already in your roster. Update it with the imported version, or keep both as separate characters?',
              buttons: [
                { value: 'update', label: 'Update existing', primary: true },
                { value: 'both', label: 'Keep both' },
                { value: 'cancel', label: 'Cancel' },
              ],
            });
            if (choice === 'update') action = 'update';
            else if (choice === 'both') action = 'rename';
            else return false; // cancelled / dismissed — don't import
          }
          // Register any unrecognized imported items as custom homebrew items so the inventory resolves.
          (customItems ?? []).forEach(addCustomItem);
          let finalId: string;
          commitStructural(); // importing a character is structural — persist immediately
          if (action === 'update' && collide) {
            // Replace the existing entry in place (keep its roster id so the card/undo/active-id stay valid).
            setRoster((r) => r.map((c) => (c.id === collide.id ? { ...saved, id: collide.id, archived: c.archived ?? false } : c)));
            setActiveId(collide.id);
            finalId = collide.id;
          } else {
            const entry = action === 'rename' ? { ...saved, character: { ...saved.character, name: uniqueName(saved.character.name, roster) } } : saved;
            setRoster((r) => [...r, entry]);
            setActiveId(entry.id);
            finalId = entry.id;
          }
          // Persist any imported Wanderer's Guide custom modes, scoped to the imported character.
          (customModes ?? []).forEach((m) => saveModeDef({ ...m, charId: finalId }));
          return true;
        }}
        onDuplicate={(id) => {
          const c = roster.find((x) => x.id === id);
          if (c) {
            commitStructural(); // new character — persist immediately
            setRoster((r) => [...r, duplicateChar(c)]);
          }
        }}
        onArchive={(id, archived) => setRoster((r) => r.map((c) => (c.id === id ? { ...c, archived } : c)))}
        onDelete={deleteChar}
        onOpenHomebrew={() => setMode('homebrew')}
        onOpenCampaigns={onOpenCampaigns}
        onOpenSettings={openSettings}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
      />
    );
  } else if (which === 'loading') {
    // A content-dependent screen (sheet/builder/homebrew) was opened before core.json finished
    // loading — hold just that screen behind a lightweight shell; the roster stays a tap away.
    // (The builder is deliberately NOT gated on having a character — see pickScreen.)
    screen = (
      <div className="roster-screen">
        <header className="chrome" data-tauri-drag-region>
          <div className="chrome-brand" data-tauri-drag-region>
            <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
          </div>
          <WindowControls />
        </header>
        <div className="app-loading content-loading">
          <span className="app-loading-spin" aria-hidden="true" />
          <span>Loading game content…</span>
          <button className="btn" onClick={() => setMode('roster')}>
            View characters
          </button>
        </div>
      </div>
    );
  } else if (which === 'builder') {
    screen = (
      <Builder
        content={readyContent}
        initial={editing?.build}
        onLeaveCampaign={leaveCampaign}
        onCancel={() => {
          setEditing(null);
          setMode('sheet');
        }}
        onCreate={(build) => {
          const built = buildCharacter(build, applyOverrides(readyContent, build.overrides));
          commitStructural(); // create/rebuild a character — persist immediately
          if (editing) {
            const id = editing.id;
            // Keep in-play progress across a rebuild. playForRebuild DROPS NOTHING — not one key of
            // the play overlay, whatever the fresh build says (the 2026-09-22 vanished-spells
            // report); a pick the new build cannot hold is simply not DRAWN, by applyPlayState, and
            // comes back when the build does. The FRESH and PREVIOUS characters are passed for the
            // two additive things: gear added in the BUILDER reaching the sheet without disturbing
            // what the player has been carrying (bug 2026-09-12 #3c), and the same for a repertoire
            // spell added in the builder.
            setRoster((r) =>
              r.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      id,
                      character: carryStoredOverrides(built, c.character),
                      build,
                      play: c.play ? playForRebuild(c.play, built, c.character) : c.play,
                    }
                  : c,
              ),
            );
            setActiveId(id);
          } else {
            const id = newRosterId();
            setRoster((r) => [...r, { id, character: built, build }]);
            setActiveId(id);
          }
          setEditing(null);
          setMode('sheet');
        }}
      />
    );
  } else if (which === 'homebrew') {
    screen = (
      <HomebrewPage
        content={readyContent}
        onChanged={onHomebrewChanged}
        onClose={() => setMode('sheet')}
        onOpenRoster={() => setMode('roster')}
        onOpenCampaigns={onOpenCampaigns}
        onOpenSettings={openSettings}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
      />
    );
  } else if (which === 'campaigns') {
    screen = (
      <CampaignsPage
        content={readyContent}
        onClose={() => setMode('sheet')}
        onOpenRoster={() => setMode('roster')}
        onOpenHomebrew={() => setMode('homebrew')}
        onOpenSettings={openSettings}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
        onOpenOwn={(id) => { setActiveId(id); setMode('sheet'); }}
        modes={readyContent.modes}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
      />
    );
  } else if (which === 'settings') {
    screen = (
      <SettingsPage
        onClose={closeSubpage}
        onOpenRoster={() => setMode('roster')}
        onOpenHomebrew={() => setMode('homebrew')}
        onOpenCampaigns={onOpenCampaigns}
        modes={content?.modes}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
      />
    );
  } else {
    screen = (
      <CharacterSheet
        // This else is reached only when pickScreen returned 'sheet', which requires content AND a
        // character — so `character` is non-null here; TS just can't infer it through `which`.
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        character={character!}
        content={sheetContent ?? readyContent}
        build={active.build}
        charKey={active.id}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
        onOpenOwn={(id) => { setActiveId(id); setMode('sheet'); }}
        onPlay={updatePlay}
        onCreateItem={addCustomItem}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
        onOpenHomebrew={() => setMode('homebrew')}
        onOpenCampaigns={onOpenCampaigns}
        onOpenSettings={openSettings}
        onCustomize={updateCharacter}
        globalCustomization={globalCustom}
        onLeaveCampaign={leaveCampaign}
        partyEnabled={campaignsOnline}
        onRest={() =>
          updatePlay((p) =>
            rest(p, {
              level: active.character.level,
              conMod: abilityMod(active.character.abilities.con),
              initialResources: active.character.classResources,
              // Lets rest tell an ITEM mode (clears overnight) from one the player toggled themselves.
              modeDefs: content?.modes,
              // Fast Recovery / Bolstered Recovery — without this a night's sleep ignores them.
              restRecovery: active.character.restRecovery,
              // "Sleeping in armor results in poor rest that leaves you fatigued" — rest reads the
              // worn row's category + traits to tell armour from clothes.
              items: readyContent.items,
              // Svetocher reads Drained "as though the condition value were 1 lower", so a step-down
              // hands back that much less max HP.
              drainedReduction: active.character.drainedReduction,
              // A companion recovers on ITS OWN Constitution, which only its stat block knows.
              companionHeal: Object.fromEntries(
                (p.companions ?? active.character.companions ?? []).flatMap((c) => {
                  const con = companionConMod(c, active.character, readyContent);
                  return con == null ? [] : [[c.id, Math.max(1, con) * active.character.level]];
                }),
              ),
            }),
          )
        }
        onOpenRoster={() => setMode('roster')}
        onEdit={() => {
          // Any character is editable: use its stored build, or reverse-derive one from the
          // finished character (seeds/imports have no stored build). The reverse-derive can throw
          // on an unusual imported/legacy character, so fall back to a blank build instead of crashing.
          let editBuild: BuildState;
          try {
            editBuild = active.build ?? deriveBuildFromCharacter(active.character, readyContent);
          } catch (err) {
            console.error('Could not reconstruct build from character; starting from a blank build:', err);
            editBuild = emptyBuild();
          }
          setEditing({ id: active.id, build: editBuild });
          setMode('builder');
        }}
      />
    );
  }

  return (
    <ContentContext.Provider value={content}>
      <PopupSizeController />
      <PopupSizeLock />
      <OverlayDismissGuard />
      {/* App-wide banners. On desktop these sit in normal flow above the app; on mobile the app
          shell is position:fixed;inset:0 and would paint over them, so .app-banners floats fixed at
          the top (with safe-area padding) — see the mobile block in sheet.css. */}
      {/* Undo/redo OUTSIDE the character sheet. The sheet has had a visible pair in its header; every
          other screen — the roster (where you can delete a character), the builder, homebrew,
          campaigns, settings — was keyboard-only, even though the Ctrl+Z handler is registered
          app-wide with no mode gate. A mouse or tablet user had no way to undo on any of them. */}
      {/* Not on the builder: it keeps its own build timeline and draws its own pair in its header,
          so the floating one would be a second undo button that undoes something else. */}
      {/* Not on the campaigns screen either: while a campaign is open Ctrl+Z means UNDO THE COMBAT
          (the tracker claims it), so a character-undo pair floating over it is a button that does
          something other than what the keyboard beside it does. A static screen test, not a
          render-time read of combatOwnsUndo() — the claim isn't React state and wouldn't re-render. */}
      {showUndoButtons && which !== 'sheet' && which !== 'loading' && which !== 'builder' && which !== 'campaigns' && (canUndo || canRedo) && (
        <div className="app-undo" role="group" aria-label="Undo and redo">
          <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={() => canUndo && undo()}>
            <i className="ti ti-arrow-back-up" aria-hidden="true" />
          </button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => canRedo && redo()}>
            <i className="ti ti-arrow-forward-up" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="app-banners" ref={bannersRef}>
        {/* The manual "new version — download it" banner is for the INSTALLED apps only. The web build
            auto-updates through its service worker, so nudging web users to download a release is wrong. */}
        {isTauri && <UpdateNotice />}
        {saveFailed && (
          <div className="save-warning" role="alert">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span>Changes can’t be saved — browser storage is full or unavailable. Export your characters so you don’t lose work.</span>
            <button className="save-warning-x" onClick={() => setSaveFailed(false)} aria-label="Dismiss">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
        {storageWarn && !saveFailed && (
          <div className="save-warning storage-warning" role="alert">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span>
              This device’s storage is almost full. Export a backup and remove some characters or portraits so
              your changes keep saving{isTauri ? '.' : ' — your characters are also saved to the cloud.'}
            </span>
            <button
              className="save-warning-x"
              onClick={() => {
                storageDismissed.current = true;
                setStorageWarn(false);
              }}
              aria-label="Dismiss"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <CustomizationContext.Provider value={effectiveCustom}>
      <ErrorBoundary
        resetKeys={[activeId, mode, roster.length]}
        title="This screen ran into a problem"
        renderActions={(reset) => (
          <>
            <button className="btn" onClick={() => { setMode('roster'); reset(); }}>
              Back to roster
            </button>
            {roster.length > 1 && (
              <button className="btn" onClick={() => { deleteChar(active.id); reset(); }}>
                Remove this character
              </button>
            )}
          </>
        )}
      >
        {screen}
      </ErrorBoundary>
      </CustomizationContext.Provider>
    </ContentContext.Provider>
  );
}
