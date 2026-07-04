import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CharacterSheet } from './sheet/CharacterSheet';
import { RosterScreen } from './sheet/RosterScreen';
import { HomebrewPage } from './sheet/HomebrewPage';
import { Builder } from './builder/Builder';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { UpdateNotice } from './sheet/UpdateNotice';
import { WindowControls } from './sheet/WindowControls';
import { HeroesHeavenLogo } from './sheet/Logo';
import { loadContent, rebuildContent } from './data';
import { loadRoster, saveRoster, newRosterId, duplicateChar, uniqueName, loadActiveId, saveActiveId, saveHomebrewItem, saveMode, deleteMode, ROSTER_KEY, type SavedChar } from './data/storage';
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
import { bumpZoom, resetZoom, ZOOM_STEP } from './theme/zoom';
import type { ContentDatabase, Item, ModeDef } from './rules/types';

function initialRoster(): SavedChar[] {
  // A fresh install starts with an EMPTY roster — no demo character is injected. The RosterScreen
  // renders a friendly empty state that guides the user to create their first character.
  return loadRoster();
}

export default function App() {
  const [content, setContent] = useState<ContentDatabase | null>(null);
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
  const [mode, setMode] = useState<'sheet' | 'builder' | 'roster' | 'homebrew'>('roster');
  const autoOpenSheet = useRef(true);
  // The build being edited: a BuildState (edit existing) or null (creating new).
  const [editing, setEditing] = useState<{ id: string; build: BuildState } | null>(null);
  // True when the last persist attempt was rejected (e.g. localStorage quota) — surfaced as a banner
  // so the user knows their changes aren't being saved rather than losing them silently.
  const [saveFailed, setSaveFailed] = useState(false);
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
    setupPersist(saveRoster, (ok) => setSaveFailed(!ok));
  }, []);
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

  // App zoom: Ctrl+wheel and Ctrl +/-/0 scale the whole UI (also adjustable in Settings).
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      bumpZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
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
        bumpZoom(ZOOM_STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        bumpZoom(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [undo, redo]);

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
  // character. The sheet/homebrew screens can't render without one, so force a character-less mode:
  // the roster (its empty state) unless the user is mid-create in the builder.
  const effectiveMode = active ? mode : mode === 'builder' ? 'builder' : 'roster';

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

  const deleteChar = (id: string) => {
    // Deleting the last character is allowed — the roster can go to zero (empty state).
    const remaining = roster.filter((c) => c.id !== id);
    commitStructural(); // structural change — persist immediately, don't debounce
    setRoster(remaining);
    if (id === activeId) setActiveId(remaining[0]?.id ?? '');
  };

  let screen: ReactNode;
  if (effectiveMode === 'roster') {
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
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
      />
    );
  } else if (!content || !character) {
    // A content-dependent screen (sheet/builder/homebrew) was opened before core.json finished
    // loading — hold just that screen behind a lightweight shell; the roster stays a tap away.
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
  } else if (effectiveMode === 'builder') {
    screen = (
      <Builder
        content={content}
        initial={editing?.build}
        onCancel={() => {
          setEditing(null);
          setMode('sheet');
        }}
        onCreate={(build) => {
          const built = buildCharacter(build, applyOverrides(content, build.overrides));
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
  } else if (effectiveMode === 'homebrew') {
    screen = (
      <HomebrewPage
        content={content}
        onChanged={onHomebrewChanged}
        onClose={() => setMode('sheet')}
        onOpenRoster={() => setMode('roster')}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
      />
    );
  } else {
    screen = (
      <CharacterSheet
        character={character}
        content={sheetContent ?? content}
        build={active.build}
        charKey={active.id}
        characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
        onPlay={updatePlay}
        onCreateItem={addCustomItem}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
        onOpenHomebrew={() => setMode('homebrew')}
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
            editBuild = active.build ?? deriveBuildFromCharacter(active.character, content);
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
        <UpdateNotice />
        {saveFailed && (
          <div className="save-warning" role="alert">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span>Changes can’t be saved — browser storage is full or unavailable. Export your characters so you don’t lose work.</span>
            <button className="save-warning-x" onClick={() => setSaveFailed(false)} aria-label="Dismiss">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
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
    </ContentContext.Provider>
  );
}
