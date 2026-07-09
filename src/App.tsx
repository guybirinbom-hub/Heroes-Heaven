import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CharacterSheet } from './sheet/CharacterSheet';
import { RosterScreen } from './sheet/RosterScreen';
import { HomebrewPage } from './sheet/HomebrewPage';
import { CampaignsPage } from './sheet/CampaignsPage';
import { Builder } from './builder/Builder';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { UpdateNotice } from './sheet/UpdateNotice';
import { WindowControls } from './sheet/WindowControls';
import { HeroesHeavenLogo } from './sheet/Logo';
import { loadContent, rebuildContent } from './data';
import { pickScreen } from './appScreen';
import { useAuth } from './data/useAuth';
import { startCloudSync, hasSyncedOnce } from './data/cloudSync';
import { LoginScreen } from './sheet/LoginScreen';
import { getLoginSkipped, setLoginSkipped } from './data/device';
import { collectPortraitRefs, gcSharpPortraits, initPortraitStore } from './data/portraitStore';
import { computeSummary } from './sheet/partySummary';
import { publishCharacter, unpublishCharacter, fetchGmEdits, deleteGmEdit, currentUserId, subscribeGmEdits } from './data/party';
import { loadRoster, saveRoster, newRosterId, duplicateChar, uniqueName, loadActiveId, saveActiveId, saveHomebrewItem, saveMode, deleteMode, loadCampaigns, saveCampaigns, ROSTER_KEY, localStorageBytes, type SavedChar } from './data/storage';
import { isTauri } from './platform';
import { setupPersist, schedulePersist, persistNow, flushPersist, cancelPersist } from './data/persist';
import { chooseDialog } from './sheet/confirm';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from './rules/build';
import { useUndoableState } from './useUndoableState';
import { applyPlayState, initialPlay, playForRebuild, rest, type PlayState } from './rules/play';
import { abilityMod } from './rules/derive';
import { ContentContext } from './sheet/ContentContext';
import { PopupSizeController } from './sheet/PopupSizeController';
import { OverlayDismissGuard } from './sheet/OverlayDismissGuard';
import { PopupSizeLock } from './sheet/PopupSizeLock';
import { SettingsPage } from './sheet/SettingsPage';
import { CustomizationContext, useGlobalCustomization, effectiveCustomization } from './data/customization';
import { bumpZoom, resetZoom, ZOOM_STEP } from './theme/zoom';
import type { Character, ContentDatabase, Item, ModeDef } from './rules/types';

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
  const [devBypass, setDevBypass] = useState(() => import.meta.env.DEV && sessionStorage.getItem('hh-dev-skip') === '1');
  // Installed app: login is optional. If the user chose "continue without an account", remember it so
  // we don't show the login wall on every launch. The web build has no persistent skip (login there
  // is friends-only + mandatory); its only bypass is the DEV one above.
  const [localSkip, setLocalSkip] = useState(() => isTauri && getLoginSkipped());
  const bypassLogin = devBypass || localSkip;
  // Roster lives in an undo/redo timeline: every character-data change (all sheet mutations funnel
  // through setRoster) becomes an undoable step, driving Ctrl+Z / Ctrl+Shift+Z below.
  const { state: roster, set: setRoster, undo, redo } = useUndoableState<SavedChar[]>(initialRoster);
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
  // Which screen the Settings / Customize pages should return to when closed (the one they opened from).
  const [uiReturn, setUiReturn] = useState<'sheet' | 'roster' | 'homebrew' | 'campaigns'>('roster');
  const autoOpenSheet = useRef(true);
  // The build being edited: a BuildState (edit existing) or null (creating new).
  const [editing, setEditing] = useState<{ id: string; build: BuildState } | null>(null);
  // True when the last persist attempt was rejected (e.g. localStorage quota) — surfaced as a banner
  // so the user knows their changes aren't being saved rather than losing them silently.
  const [saveFailed, setSaveFailed] = useState(false);
  // Proactive "storage almost full" heads-up (before the hard quota failure that sets saveFailed).
  const [storageWarn, setStorageWarn] = useState(false);
  const storageDismissed = useRef(false);
  // Set by structural roster changes (create/delete/import/duplicate) so the NEXT persist writes
  // immediately instead of debouncing — a crash inside the debounce window must not drop a whole
  // character. Play mutations leave it false and take the debounced path. See the persist effect.
  const persistImmediately = useRef(false);
  const commitStructural = () => {
    persistImmediately.current = true;
  };

  useEffect(() => {
    // Any interaction while loading cancels the boot-time jump to the sheet.
    const cancel = () => {
      autoOpenSheet.current = false;
    };
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('keydown', cancel, true);
    loadContent().then((c) => {
      setContent(c);
      // Auto-jump to the last-active sheet — but only if there's actually a character to show.
      // An empty roster (fresh install) stays on the roster's empty state.
      if (autoOpenSheet.current && activeId) setMode((m) => (m === 'roster' ? 'sheet' : m));
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('keydown', cancel, true);
    });
    return () => {
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('keydown', cancel, true);
    };
  }, []);
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
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cleanup = () => {};
    let cancelled = false;
    void startCloudSync((merged) => {
      if (!cancelled) setRoster(merged);
    }).then((c) => {
      if (cancelled) c();
      else cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [auth.status, setRoster]);
  // Signing in supersedes any earlier "use offline" choice on the installed app.
  useEffect(() => {
    if (auth.status === 'signed-in' && localSkip) {
      setLoginSkipped(false);
      setLocalSkip(false);
    }
  }, [auth.status, localSkip]);
  // Publish characters attached to a campaign so teammates see them in the party. Debounced on roster
  // change; unpublishes any (campaign, character) pair that's no longer attached (detach / delete).
  const publishedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (auth.status !== 'signed-in' || !content) return;
    const readyContent = content;
    const timer = setTimeout(() => {
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
          for (const cid of ids) {
            desired.add(cid + '|' + sc.id);
            void publishCharacter(cid, sc.id, live.name, summary, published);
          }
        } catch {
          /* skip a character that won't compute */
        }
      }
      for (const key of publishedRef.current) {
        if (!desired.has(key)) {
          const [cid, charId] = key.split('|');
          void unpublishCharacter(cid, charId);
        }
      }
      publishedRef.current = desired;
    }, 1500);
    return () => clearTimeout(timer);
  }, [roster, auth.status, content]);
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
  // Apply pending GM edits to MY characters — silently. A GM can edit a player's sheet and push it; the
  // player's app swaps in the GM's version. It applies INSTANTLY via a Realtime subscription while the
  // app is open, and the focus/visibility/online/sign-in pull is the fallback for when it was closed or
  // the socket dropped. Each edit is cleared after applying so it lands exactly once.
  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    let cancelled = false;
    const apply = async () => {
      const edits = await fetchGmEdits();
      if (cancelled || !edits.length) return;
      // Only edits whose character actually lives in THIS device's roster are applied+cleared here.
      // Edits for characters this device doesn't have (another of the player's signed-in devices owns
      // them, or a mid-sync gap) are LEFT in place — deleting them here would rob the owning device of
      // the edit. Read the latest roster via the ref so this async pull isn't scoped to a stale snapshot.
      const present = new Set(rosterRef.current.map((c) => c.id));
      const applicable = edits.filter((e) => present.has(e.charId) && e.sheet && e.sheet.character);
      if (!applicable.length) return;
      // A character attached to two campaigns can have two pending edits (PK is campaign+char). Apply the
      // NEWEST per character (last-writer-wins); an older one is superseded, never dropped-before-applied.
      const newestByChar = new Map<string, (typeof applicable)[number]>();
      for (const e of applicable) {
        const prev = newestByChar.get(e.charId);
        if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) newestByChar.set(e.charId, e);
      }
      setRoster((r) =>
        r.map((c) => {
          const edit = newestByChar.get(c.id);
          return edit ? { ...edit.sheet, id: c.id, archived: c.archived ?? false } : c;
        }),
      );
      // Clear every edit we resolved on THIS device (the applied newest + superseded older). Edits for
      // characters not on this device are left for the device that owns them.
      for (const e of applicable) void deleteGmEdit(e.campaignId, e.charId);
    };
    void apply();
    const onFocus = () => void apply();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void apply();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    // Realtime: apply the moment the GM pushes, without waiting for a focus/open. Subscribes once we
    // know this user's id; the subscription triggers the same pull-and-apply above (including on each
    // (re)connect, so nothing pushed during a socket drop is missed).
    let unsubscribe = () => {};
    void currentUserId().then((id) => {
      if (!cancelled && id) unsubscribe = subscribeGmEdits(id, () => void apply());
    });
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [auth.status, setRoster]);
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
  // continuing to overwrite it. Comparing to our current serialization skips our own echo — the
  // reload triggers a re-persist of the identical value, which would otherwise ping-pong forever.
  // Desktop/web-relevant; the lone Tauri webview rarely hits it, so this stays lightweight.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ROSTER_KEY || e.newValue === null) return;
      if (e.newValue === JSON.stringify(roster)) return; // our own write echoed back — ignore
      // Another tab wrote the roster. Drop any of OUR pending debounced writes first so a stale
      // in-flight value can't clobber the version we're about to adopt, then reload theirs.
      cancelPersist();
      setRoster(loadRoster());
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
  const updateCharacter = (fn: (c: Character) => Character) => {
    if (!active) return;
    const id = active.id;
    setRoster((r) => r.map((c) => (c.id === id ? { ...c, character: fn(c.character) } : c)));
  };
  // Campaigns are a cloud feature — only offered when signed in. Local / not-signed-in users don't see
  // the menu item at all (a fully-local experience stays available by simply not signing in). The
  // DEV-only skip-login bypass can reach it too for local testing (`devBypass` is always false in the
  // production build, so this never loosens the real gate).
  const onOpenCampaigns = auth.status === 'signed-in' || devBypass ? () => setMode('campaigns') : undefined;

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
          c.id === id ? { ...c, play: fn({ ...initialPlay(c.character, content), ...(c.play ?? {}) }) } : c,
        ),
      coalesceTag ? { coalesce: true, tag: `play:${id}:${coalesceTag}` } : undefined,
    );
  };

  // Register a user-created custom item: add it to the live content DB (so it resolves
  // immediately) and persist it as homebrew (so it survives reloads).
  const addCustomItem = (item: Item) => {
    setContent((c) => (c ? { ...c, items: { ...c.items, [item.id]: item } } : c));
    saveHomebrewItem(item);
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
  const onHomebrewChanged = () => setContent(rebuildContent());

  // Player: fully leave a campaign — drop the membership (synced + tombstoned via saveCampaigns) AND
  // detach it from every character, so nothing keeps publishing to it. Stripping the id from each
  // character makes the publish effect unpublish those campaign_characters rows. (A GM ends a campaign
  // by deleting it in the Campaigns page instead.)
  const leaveCampaign = (campaignId: string) => {
    saveCampaigns(loadCampaigns().filter((m) => m.id !== campaignId));
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
            // Keep in-play progress across a rebuild, but reconcile build-derived overrides
            // (gear/currency/spells/resources) so the edited build actually takes effect.
            setRoster((r) =>
              r.map((c) => (c.id === id ? { ...c, id, character: built, build, play: c.play ? playForRebuild(c.play) : c.play } : c)),
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
        character={character!}
        content={sheetContent ?? readyContent}
        build={active.build}
        charKey={active.id}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
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
        partyEnabled={!!onOpenCampaigns}
        onRest={() =>
          updatePlay((p) =>
            rest(p, {
              level: active.character.level,
              conMod: abilityMod(active.character.abilities.con),
              initialResources: active.character.classResources,
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
      <div className="app-banners">
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
