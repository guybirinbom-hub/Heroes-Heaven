import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../rules/build';
import { applyPlayState, initialPlay, playForRebuild, reconcileFormulaBook, type PlayState } from '../rules/play';
import { Builder } from '../builder/Builder';
import { CharacterSheet } from './CharacterSheet';
import { exportNative } from '../data/transfer';
import { downloadText } from './download';
import { pushGmEdit, fetchMemberSheet } from '../data/party';
import { confirmDialog, chooseDialog } from './confirm';
import { reconcileGmWork } from './gmSync';

function fileSlug(name: string): string {
  return (name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

export interface GmEditHandle {
  /**
   * Run the unsaved-changes prompt and report whether this sheet may be closed or replaced.
   *
   * Exposed because the sheet is no longer only dismissed by its own Back button: inside a campaign
   * the initiative order can swap it out when the turn moves on. That must ask the same question,
   * with the same push/discard/cancel semantics — and it has to be refusable, so it returns a
   * verdict instead of just closing. `reason` re-words the prompt for the caller's situation.
   */
  confirmLeave: (reason?: { title: string; message: string }) => Promise<boolean>;
}

/**
 * The GM's editable view of a player's character (opened from the campaign detail). It holds a WORKING
 * COPY of the published SavedChar so the GM can freely edit stats, gear, feats, and rebuild in the
 * builder — nothing reaches the player until the GM hits **Update**, which pushes the copy through
 * `gm_character_edits`; the player's app applies it silently on its next sync. Leaving with unsaved
 * changes prompts to update first. There's deliberately no read-only frame here — the GM has full
 * control of the sheet.
 */
export const GmEditSheet = forwardRef<GmEditHandle, {
  initial: SavedChar;
  /** The player's CURRENT published sheet, kept live by the viewer's Realtime subscription. Adopted
   *  automatically while the GM has no unsaved edits; flagged rather than applied when they do. */
  live?: SavedChar;
  content: ContentDatabase;
  campaignId: string;
  playerOwnerId: string;
  onExit: () => void;
}>(function GmEditSheet({
  initial,
  live,
  content: baseContent,
  campaignId,
  playerOwnerId,
  onExit,
}, ref) {
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
  /* The player published something newer while the GM has unsaved edits. Held, not applied: replacing
   * the working copy would throw away whatever the GM is in the middle of. Shown as a banner with the
   * choice to take their version. */
  const [playerAhead, setPlayerAhead] = useState<SavedChar | null>(null);

  /*
   * Follow the player, live — but never at the cost of the GM's work.
   *
   * With NO unsaved edits the working copy is just a mirror of what's published, so adopting the
   * player's new version is invisible and correct: HP they just lost, an item they just bought. That's
   * the "seamless" half.
   *
   * With unsaved edits, silently swapping the sheet would delete them mid-sentence. So the newer
   * version is parked and the GM told, which is also what makes the push safe: taking their version
   * re-bases the working copy so the stale-edit guard below has nothing left to warn about.
   */
  useEffect(() => {
    if (!live) return;
    const verdict = reconcileGmWork({ live: JSON.stringify(live), work: JSON.stringify(work), dirty });
    if (verdict === 'in-step') {
      setPlayerAhead(null); // usually our own push echoing back
      return;
    }
    if (verdict === 'hold') {
      setPlayerAhead(live);
      return;
    }
    setWork(live);
    baselineRef.current = live;
    setPlayerAhead(null);
    // `work`/`dirty` are read, not tracked: this must run when the PLAYER's version changes, not on
    // every local edit — reacting to `work` here would re-adopt and fight the GM's own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const takePlayerVersion = () => {
    if (!playerAhead) return;
    setWork(playerAhead);
    baselineRef.current = playerAhead;
    setPlayerAhead(null);
    setDirty(false);
  };

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
    setWork((w) => ({ ...w, play: fn(reconcileFormulaBook({ ...initialPlay(w.character, content), ...(w.play ?? {}) }, w.character, content)) }));
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

  /*
   * "May this sheet go away?" — the single gate for losing the working copy, whether the GM pressed
   * Back or the initiative order moved on to someone else. Returns false to mean "stay put": the
   * GM cancelled, or the push they asked for failed (in which case dropping the sheet anyway would
   * throw away the very changes they just chose to keep).
   */
  const confirmLeave = async (reason?: { title: string; message: string }): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await chooseDialog({
      title: reason?.title ?? 'Update before leaving?',
      message:
        reason?.message ??
        `You’ve changed ${work.character.name}. Push these changes to the player, or leave without updating?`,
      buttons: [
        { value: 'update', label: 'Update player', primary: true },
        { value: 'leave', label: 'Discard changes' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    if (!choice || choice === 'cancel') return false;
    if (choice === 'leave') return true;
    if (!(await confirmUpdate())) return false;
    return await pushToPlayer();
  };

  useImperativeHandle(ref, () => ({ confirmLeave }));

  const doExit = async () => {
    if (await confirmLeave()) onExit();
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
    <>
      {/* Only ever shown when the GM has unsaved edits — otherwise the player's change was already
          adopted silently and there is nothing to decide. */}
      {playerAhead && (
        <div className="gm-live-banner" role="status">
          <i className="ti ti-refresh-alert" aria-hidden="true" />
          <span>
            <strong>{work.character.name}</strong> changed on the player&apos;s device while you were editing. Your
            unsaved changes are still here — pushing them will overwrite the player&apos;s newer version.
          </span>
          <button className="btn" onClick={takePlayerVersion}>
            Take their version
          </button>
          <button className="save-warning-x" onClick={() => setPlayerAhead(null)} aria-label="Keep editing mine">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
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
    </>
  );
});
