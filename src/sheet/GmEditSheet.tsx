import { useMemo, useRef, useState } from 'react';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../rules/build';
import { applyPlayState, initialPlay, playForRebuild, type PlayState } from '../rules/play';
import { Builder } from '../builder/Builder';
import { CharacterSheet } from './CharacterSheet';
import { exportNative } from '../data/transfer';
import { downloadText } from './download';
import { pushGmEdit, fetchMemberSheet } from '../data/party';
import { confirmDialog, chooseDialog } from './confirm';

function fileSlug(name: string): string {
  return (name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

/**
 * The GM's editable view of a player's character (opened from the campaign detail). It holds a WORKING
 * COPY of the published SavedChar so the GM can freely edit stats, gear, feats, and rebuild in the
 * builder — nothing reaches the player until the GM hits **Update**, which pushes the copy through
 * `gm_character_edits`; the player's app applies it silently on its next sync. Leaving with unsaved
 * changes prompts to update first. There's deliberately no read-only frame here — the GM has full
 * control of the sheet.
 */
export function GmEditSheet({
  initial,
  content: baseContent,
  campaignId,
  playerOwnerId,
  onExit,
}: {
  initial: SavedChar;
  content: ContentDatabase;
  campaignId: string;
  playerOwnerId: string;
  onExit: () => void;
}) {
  const [work, setWork] = useState<SavedChar>(initial);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<BuildState | null>(null);
  const [busy, setBusy] = useState(false);
  // The published states we already know about — the snapshot we opened, plus whatever we last pushed.
  // The stale-edit guard warns only when the current published sheet matches NEITHER (i.e. the PLAYER,
  // not our own earlier push, changed it), so a GM's repeated pushes in one session don't false-alarm.
  const baselineRef = useRef<SavedChar>(initial);
  // Local content copy so any items/modes the GM authors while editing resolve for this session.
  const [content, setContent] = useState<ContentDatabase>(baseContent);

  const character = useMemo(() => {
    try {
      return applyPlayState(work.character, work.play, content);
    } catch {
      return work.character;
    }
  }, [work.character, work.play, content]);

  const sheetContent = useMemo(
    () => applyOverrides(content, work.character.overrides),
    [content, work.character.overrides],
  );

  const updatePlay = (fn: (p: PlayState) => PlayState) => {
    setWork((w) => ({ ...w, play: fn({ ...initialPlay(w.character, content), ...(w.play ?? {}) }) }));
    setDirty(true);
  };

  const addCustomItem = (item: Item) => {
    setContent((c) => ({ ...c, items: { ...c.items, [item.id]: item } }));
  };
  const saveModeDef = (mode: ModeDef) => {
    setContent((c) => ({ ...c, modes: { ...c.modes, [mode.id]: mode } }));
  };
  const removeModeDef = (id: string) => {
    setContent((c) => ({ ...c, modes: Object.fromEntries(Object.entries(c.modes).filter(([k]) => k !== id)) }));
  };

  const openBuilder = () => {
    let b: BuildState;
    try {
      b = work.build ?? deriveBuildFromCharacter(work.character, content);
    } catch {
      b = emptyBuild();
    }
    setEditing(b);
  };

  const onCreate = (build: BuildState) => {
    const built = buildCharacter(build, applyOverrides(content, build.overrides));
    setWork((w) => ({ ...w, character: built, build, play: w.play ? playForRebuild(w.play) : w.play }));
    setDirty(true);
    setEditing(null);
  };

  // Push the working copy to the player. Returns true on success.
  const pushToPlayer = async (): Promise<boolean> => {
    setBusy(true);
    // Don't silently clobber newer player work: if the player has re-published this character since we
    // opened it, our working copy is based on a stale snapshot. Detect it (re-fetch + compare to the
    // snapshot we opened) and let the GM reopen for the current version instead of overwriting theirs.
    const current = await fetchMemberSheet(campaignId, work.id);
    // Only warn about a PLAYER change: `current` must differ from BOTH the snapshot we opened and our own
    // last push (our first push re-publishes via the player, so on a later push `current` is our own edit).
    const cur = current ? JSON.stringify(current) : null;
    const changedByPlayer = cur !== null && cur !== JSON.stringify(initial) && cur !== JSON.stringify(baselineRef.current);
    if (changedByPlayer) {
      setBusy(false);
      const overwrite = await confirmDialog({
        title: 'Player changed this character',
        message: `${work.character.name} was updated by the player since you opened it, so your edits are based on an older version and would overwrite their newer changes. Overwrite anyway, or cancel and reopen to edit their current version?`,
        confirmLabel: 'Overwrite anyway',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!overwrite) return false;
      setBusy(true);
    }
    const res = await pushGmEdit(campaignId, work.id, playerOwnerId, work);
    setBusy(false);
    if (!res.ok) {
      await confirmDialog({ title: 'Couldn’t update', message: res.error, confirmLabel: 'OK' });
      return false;
    }
    baselineRef.current = work; // our new known-published baseline
    setDirty(false);
    return true;
  };

  const confirmUpdate = () =>
    confirmDialog({
      title: `Update ${work.character.name}?`,
      message:
        'Push your changes to this player’s character. If their app is open it updates right away; otherwise the next time they open it. They won’t be notified.',
      confirmLabel: 'Update',
    });

  const doUpdate = async () => {
    if (busy) return;
    if (await confirmUpdate()) {
      const ok = await pushToPlayer();
      if (ok)
        await confirmDialog({
          title: 'Sent',
          message: `Your changes to ${work.character.name} were sent — they apply on the player’s device right away if their app is open, otherwise next time they open it.`,
          confirmLabel: 'OK',
        });
    }
  };

  const doExit = async () => {
    if (!dirty) {
      onExit();
      return;
    }
    const choice = await chooseDialog({
      title: 'Update before leaving?',
      message: `You’ve changed ${work.character.name}. Push these changes to the player, or leave without updating?`,
      buttons: [
        { value: 'update', label: 'Update player', primary: true },
        { value: 'leave', label: 'Leave without updating' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    if (!choice || choice === 'cancel') return;
    if (choice === 'leave') {
      onExit();
      return;
    }
    if (await confirmUpdate()) {
      const ok = await pushToPlayer();
      if (ok) onExit();
    }
  };

  const doExport = () => {
    try {
      downloadText(`${fileSlug(work.character.name)}.codex.json`, exportNative(work));
    } catch (e) {
      void confirmDialog({ title: 'Export failed', message: (e as Error).message, confirmLabel: 'OK' });
    }
  };

  if (editing) {
    return <Builder content={content} initial={editing} onCancel={() => setEditing(null)} onCreate={onCreate} />;
  }

  return (
    <CharacterSheet
      character={character}
      content={sheetContent}
      build={work.build}
      charKey={work.id}
      characters={[]}
      onPlay={updatePlay}
      onCreateItem={addCustomItem}
      onSaveMode={saveModeDef}
      onDeleteMode={removeModeDef}
      onEdit={openBuilder}
      gmEdit={{ onUpdate: () => void doUpdate(), onExport: doExport, busy }}
      onBack={() => void doExit()}
    />
  );
}
