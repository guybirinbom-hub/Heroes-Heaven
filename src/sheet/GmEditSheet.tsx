import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../rules/build';
import { applyPlayState, initialPlay, playForRebuild, reconcileFormulaBook, type PlayState } from '../rules/play';
import { Builder } from '../builder/Builder';
import { CharacterSheet } from './CharacterSheet';
import { exportNative } from '../data/transfer';
import { downloadText } from './download';
import { pushGmEdit, fetchPublishedSheet } from '../data/party';
import { confirmDialog, chooseDialog } from './confirm';
import { gmPendingEdit, gmPendingVersion, reconcileGmWork, subscribeGmPending } from './gmSync';
import { memberConditions, type PartySummary } from './partySummary';
import { carryStoredOverrides } from '../data/rebuild';

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
  /** The card's published summary — what the OWNER's own app said about this character. Used only to
   *  carry over conditions their app DERIVED that this device cannot reproduce, so the sheet can
   *  never be silent about something the card is showing. See partySummary.memberConditions. */
  summary?: PartySummary;
  content: ContentDatabase;
  campaignId: string;
  playerOwnerId: string;
  onExit: () => void;
}>(function GmEditSheet({
  initial,
  live,
  summary,
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
   * Has the player's app picked up what we pushed?
   *
   * An Update writes `gm_character_edits`; the player's device is what applies it and re-publishes.
   * Until then the published character really is unchanged, and the GM used to be given no way of
   * telling "it didn't send" from "it hasn't landed yet" — pressing Update and coming back to an
   * unchanged sheet reads as the first. The edit IS shown (party.ts overlays it on every GM-side
   * read); this is the line that says it is still only on its way.
   */
  const pendingVersion = useSyncExternalStore(subscribeGmPending, gmPendingVersion, gmPendingVersion);
  const pending = useMemo(
    () => gmPendingEdit(campaignId, work.id),
    // The store is module state; `pendingVersion` is what says it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaignId, work.id, pendingVersion],
  );

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
    const verdict = reconcileGmWork({
      live: JSON.stringify(live),
      work: JSON.stringify(work),
      dirty,
      // Our own last push, which now comes BACK through the pending overlay — never "the player
      // changed this while you were editing".
      pushed: JSON.stringify(baselineRef.current),
    });
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

  /*
   * ⚠ bug 2026-09-18 (the owner's GM report): *"in the party page it says he is encumbered, when I
   * enter the character page it doesn't say that in any place."*
   *
   * The card draws the summary the PLAYER's app published; this sheet re-derives the character here,
   * on the GM's device, against the GM's content database. Encumbered comes out of item Bulk, so the
   * two answers part company whenever the two databases do — and then the GM is looking at a card
   * that says one thing and a sheet that says nothing. `memberConditions` is the single place that
   * question is answered now: this derivation, plus any DERIVED condition the owner's own app
   * reported that we could not reproduce, still carrying the cause they gave it (so it stays locked
   * and nobody at the table can "fix" it by hand).
   */
  const character = useMemo(() => {
    let live: ReturnType<typeof applyPlayState>;
    try {
      live = applyPlayState(work.character, work.play, content);
    } catch {
      live = work.character;
    }
    const conditions = memberConditions(live.conditions ?? [], summary?.conditions);
    return conditions === (live.conditions ?? []) ? live : { ...live, conditions };
  }, [work.character, work.play, content, summary]);

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
    setWork((w) => ({
      ...w,
      character: carryStoredOverrides(built, w.character),
      build,
      play: w.play ? playForRebuild(w.play, built.inventory, w.character.inventory) : w.play,
    }));
    setDirty(true);
    setEditing(null);
  };

  // Push the working copy to the player. Returns true on success.
  const pushToPlayer = async (): Promise<boolean> => {
    setBusy(true);
    /*
     * Don't silently clobber newer player work: if the player has re-published this character since we
     * opened it, our working copy is based on a stale snapshot. Detect it (re-fetch + compare to the
     * snapshot we opened) and let the GM reopen for the current version instead of overwriting theirs.
     *
     * ⚠ `fetchPublishedSheet`, NOT `fetchMemberSheet`. The latter hands back our own pending edit
     * whenever one is waiting, so this guard would be comparing the GM's work against itself: it
     * would find nothing changed and push straight over whatever the player published in between,
     * with no warning at all. A write re-bases on the player's row; only the display overlays it.
     */
    const row = await fetchPublishedSheet(campaignId, work.id);
    const current = row?.sheet ?? null;
    // Only warn about a PLAYER change. `current` must differ from every version we already know is
    // OURS: the snapshot we opened, our last push, and the edit still waiting on the server (which is
    // what `initial` is when the GM reopened a character whose edit hasn't landed yet).
    const cur = current ? JSON.stringify(current) : null;
    const mine = [JSON.stringify(initial), JSON.stringify(baselineRef.current)];
    if (pending) mine.push(JSON.stringify(pending.sheet));
    const changedByPlayer =
      cur !== null &&
      !mine.includes(cur) &&
      // With an edit of ours still waiting, the published row is SUPPOSED to be the pre-edit one, so
      // the fact that it differs proves nothing at all. The stamp is what answers it — and both sides
      // of that comparison come off the player's own clock, so a GM device running fast can't fool it.
      // Unknown either way (an edit seeded from the GM's other device) errs towards asking.
      (!pending || !pending.baseUpdatedAt || !row?.updatedAt || row.updatedAt > pending.baseUpdatedAt);
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
    // The stamp we just read travels with the push: it is the published version this edit is built
    // on, and the only skew-free way of asking later whether the player has moved past it.
    const res = await pushGmEdit(campaignId, work.id, playerOwnerId, work, row?.updatedAt);
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
          message: `Your changes to ${work.character.name} were sent — they apply on the player’s device right away if their app is open, otherwise next time they open it. Your own cards and sheet show them from now, marked “waiting” until the player’s app has them.`,
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
      {/* Pushed, on the server, not yet on the player's device. The sheet above already SHOWS the
          edit; this says why the player might not have it. It clears itself the moment their app
          publishes a version that carries the change (or anything newer). */}
      {pending && !dirty && (
        <div className="gm-pending-strip" role="status">
          <i className="ti ti-cloud-upload" aria-hidden="true" />
          <span>
            Your changes to <strong>{work.character.name}</strong> are saved and waiting — the player&apos;s app
            hasn&apos;t picked them up yet. They land the next time it&apos;s open.
          </span>
        </div>
      )}
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
