import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CharacterSheet } from './sheet/CharacterSheet';
import { RosterScreen } from './sheet/RosterScreen';
import { Builder } from './builder/Builder';
import { ErrorBoundary } from './sheet/ErrorBoundary';
import { kyra } from './rules/seed';
import { loadContent } from './data';
import { loadRoster, saveRoster, newRosterId, duplicateChar, loadActiveId, saveActiveId, saveHomebrewItem, saveMode, deleteMode, type SavedChar } from './data/storage';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from './rules/build';
import { applyPlayState, initialPlay, playForRebuild, rest, type PlayState } from './rules/play';
import { abilityMod } from './rules/derive';
import { ContentContext } from './sheet/ContentContext';
import { bumpZoom, resetZoom, ZOOM_STEP } from './theme/zoom';
import type { ContentDatabase, Item, ModeDef } from './rules/types';

function initialRoster(): SavedChar[] {
  const saved = loadRoster();
  return saved.length ? saved : [{ id: kyra.id, character: kyra }];
}

export default function App() {
  const [content, setContent] = useState<ContentDatabase | null>(null);
  const [roster, setRoster] = useState<SavedChar[]>(initialRoster);
  const [activeId, setActiveId] = useState<string>(() => {
    // Reopen the last-active character if it still exists, else the first.
    const r = initialRoster();
    const saved = loadActiveId();
    return r.some((c) => c.id === saved) ? (saved as string) : r[0].id;
  });
  const [mode, setMode] = useState<'sheet' | 'builder' | 'roster'>('sheet');
  // The build being edited: a BuildState (edit existing) or null (creating new).
  const [editing, setEditing] = useState<{ id: string; build: BuildState } | null>(null);
  // True when the last persist attempt was rejected (e.g. localStorage quota) — surfaced as a banner
  // so the user knows their changes aren't being saved rather than losing them silently.
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    loadContent().then(setContent);
  }, []);
  useEffect(() => setSaveFailed(!saveRoster(roster)), [roster]);
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
  }, []);

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

  // The game data is fetched at runtime; hold the UI until it's ready.
  if (!content || !active || !character) {
    return <div className="app-loading">Loading…</div>;
  }

  // Update the active character's in-play runtime state (seeding from its built
  // starting values the first time it's touched), then persist via the roster.
  const updatePlay = (fn: (play: PlayState) => PlayState) => {
    const id = active.id;
    setRoster((r) =>
      r.map((c) =>
        // Seed from initialPlay (derived from the character) then layer any persisted
        // state on top, so a play saved before newer fields existed gets them filled in.
        c.id === id ? { ...c, play: fn({ ...initialPlay(c.character, content), ...(c.play ?? {}) }) } : c,
      ),
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

  const deleteChar = (id: string) => {
    if (roster.length <= 1) return; // keep at least one character
    const remaining = roster.filter((c) => c.id !== id);
    setRoster(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  };

  let screen: ReactNode;
  if (mode === 'roster') {
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
        onImport={(saved) => {
          setRoster((r) => [...r, saved]);
          setActiveId(saved.id);
        }}
        onDuplicate={(id) => {
          const c = roster.find((x) => x.id === id);
          if (c) setRoster((r) => [...r, duplicateChar(c)]);
        }}
        onArchive={(id, archived) => setRoster((r) => r.map((c) => (c.id === id ? { ...c, archived } : c)))}
        onDelete={deleteChar}
      />
    );
  } else if (mode === 'builder') {
    screen = (
      <Builder
        content={content}
        initial={editing?.build}
        onCancel={() => {
          setEditing(null);
          setMode('sheet');
        }}
        onCreate={(build) => {
          const built = buildCharacter(build, content);
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
  } else {
    screen = (
      <CharacterSheet
        character={character}
        content={content}
        build={active.build}
        onPlay={updatePlay}
        onCreateItem={addCustomItem}
        onSaveMode={saveModeDef}
        onDeleteMode={removeModeDef}
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
      {saveFailed && (
        <div className="save-warning" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>Changes can’t be saved — browser storage is full or unavailable. Export your characters so you don’t lose work.</span>
          <button className="save-warning-x" onClick={() => setSaveFailed(false)} aria-label="Dismiss">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
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
