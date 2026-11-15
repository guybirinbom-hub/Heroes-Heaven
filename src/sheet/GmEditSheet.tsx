import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useUnsavedWork } from '../data/unsavedWork';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { buildCharacter, type BuildState } from '../rules/build';
import { editableBuildOf, UNREADABLE_BUILD_NOTICE } from '../data/editBuild';
import { contentFor } from '../rules/blocks/content';
import { applyPlayState, initialPlay, playForRebuild, reconcileFormulaBook, toggleMode, type PlayState } from '../rules/play';
import { modeAlsoElsewhere, modeOwnedElsewhere } from '../rules/modes';
import { Builder } from '../builder/Builder';
import { CharacterSheet } from './CharacterSheet';
import { WindowControls } from './WindowControls';
import { exportNative } from '../data/transfer';
import { downloadText, fileSlug } from './download';
import { pushGmEdit, fetchPublishedSheet } from '../data/party';
import { confirmDialog, chooseDialog } from './confirm';
import { acknowledgeGmEditRefused, gmEditRefused, gmHeldEdit, gmPendingEdit, gmPendingVersion, gmUpdateBase, reconcileGmWork, subscribeGmPending } from './gmSync';
import { canonicalJson, sheetKey } from '../data/authored';
import { foreignCarriedIds, foreignContent, freshModeId, repointMode } from '../data/carried';
import { carryModePin } from '../data/prefs';
import { memberConditions, type PartySummary } from './partySummary';
import { carryStoredOverrides } from '../data/rebuild';
import { ContentContext } from './ContentContext';
import { CopyOnWriteItemsContext, CopyOnWriteModesContext, ModesRemoveFromCharacterContext, useModeUsage } from './CopyOnWriteItems';

/** The host's persisting homebrew writers, threaded App → CampaignsPage → (CampaignTracker |
 *  useMemberViewer) → GmEditSheet. See the props of the same names below. */
export interface GmHomebrewWriters {
  onCreateItem?: (item: Item) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
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
  /** Opened over the campaign's tracker, whose title bar steps aside meanwhile: the sheet leads with
   *  "← Tracker" (still through doExit → confirmLeave) and holds the window's controls. Removable seam. */
  inTracker?: boolean;
  /*
   * The host's PERSISTING homebrew writers (App's addCustomItem / saveModeDef / removeModeDef, passed
   * down through the campaigns page): an item or mode the GM creates, edits or deletes here is his own
   * homebrew, and those write it to storage, mark cloud + campaign-homebrew sync dirty and record the
   * tombstone. This sheet still updates its own content copy at once; absent (a host with no storage),
   * that local copy is all there is. A "delete" from the Add-items search is a RETIRE — a save of the
   * record with `retired: true` — so it comes through onCreateItem, never a removal.
   */
  onCreateItem?: (item: Item) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
  onExit: () => void;
}>(function GmEditSheet({
  initial,
  live,
  summary,
  content: baseContent,
  campaignId,
  playerOwnerId,
  inTracker,
  onCreateItem,
  onSaveMode,
  onDeleteMode,
  onExit,
}, ref) {
  const [work, setWork] = useState<SavedChar>(initial);
  const [dirty, setDirty] = useState(false);
  // The GM's edits live only here until Update player: closing the tab now loses them (data/unsavedWork.ts).
  useUnsavedWork(() => dirty);
  const [editing, setEditing] = useState<BuildState | null>(null);
  // The open build was rebuilt from the sheet (no stored build); the Tweaks page says so (plan B WP6).
  const [editingDerived, setEditingDerived] = useState(false);
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
  /* …or did the player's app REFUSE it (they changed the character before it picked it up)? Their
   * version is then what this sheet shows, and the GM is told rather than left to wonder where his
   * change went (F1, 2026-10). */
  const refused = useMemo(
    () => gmEditRefused(campaignId, work.id),
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
    // Canonical JSON: the published sheet is jsonb, whose key order is its own — compared as written,
    // a sheet that came back unchanged read as "changed on the player's device" while dirty.
    // `sheetKey`: and less the custom records it carries (../data/carried.ts, owner ruling 2026-10-20) —
    // which copy of a record rode along is the sender's view, not a change to the character, so the
    // player republishing with their own copy is never "changed on the player's device".
    const verdict = reconcileGmWork({
      live: sheetKey(live),
      work: sheetKey(work),
      dirty,
      // Our own last push, which now comes BACK through the pending overlay — never "the player
      // changed this while you were editing".
      pushed: sheetKey(baselineRef.current),
    });
    if (verdict === 'in-step') {
      setPlayerAhead(null); // usually our own push echoing back
      // The same character with newer copies of its records (the player edited one, or our push came
      // back carrying ours): with nothing unsaved, take them, so this sheet draws what the player sees.
      if (!dirty && canonicalJson(live.carried ?? null) !== canonicalJson(work.carried ?? null)) {
        setWork(live);
        baselineRef.current = live;
      }
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
  /*
   * The database every derivation here runs against: this GM's content with the custom records the
   * player's sheet CARRIES winning over his own copies (../data/carried.ts foreignContent, owner ruling
   * 2026-10-20: "the others should see the same item as the player"). Without it a player's homebrew
   * item drew "Unknown item" here, a homebrew feat dropped off and a homebrew cantrip read "Empty
   * cantrip". The same object as `content` when the sheet carries nothing.
   */
  const workCarried = work.carried;
  const viewContent = useMemo(() => foreignContent(content, { carried: workCarried }), [content, workCarried]);

  const character = useMemo(() => {
    let live: ReturnType<typeof applyPlayState>;
    try {
      live = applyPlayState(work.character, work.play, viewContent);
    } catch {
      live = work.character;
    }
    const conditions = memberConditions(live.conditions ?? [], summary?.conditions);
    return conditions === (live.conditions ?? []) ? live : { ...live, conditions };
  }, [work.character, work.play, viewContent, summary]);

  // The player's Overrides content edits laid over the carried view — carried records first, then the
  // edits (../rules/blocks/content.ts, the one content path; `character` above gets the same object from
  // applyPlayState). For deriving and drawing only: a push collects `carried` from `viewContent`, never
  // from here, so an edit is never baked into the record the player's sheet carries. Only the LIVE edits
  // (the Tweaks switch, each edit's own on/off — plan B WP2), so the memo keys on `options` too: contentFor
  // cannot un-apply an edit.
  const sheetContent = useMemo(
    () => contentFor(viewContent, work.character),
    [viewContent, work.character.overrides, work.character.options],
  );

  const updatePlay = (fn: (p: PlayState) => PlayState) => {
    setWork((w) => {
      const view = foreignContent(content, w);
      return { ...w, play: fn(reconcileFormulaBook({ ...initialPlay(w.character, view), ...(w.play ?? {}) }, w.character, view)) };
    });
    setDirty(true);
  };

  // Local copy first (resolves at once in this sheet), then the host's persisting writer, so what the
  // GM authors or deletes here outlives the session (test/bug-gm-edit-homebrew-persists.test.tsx).
  const addCustomItem = (item: Item) => {
    /*
     * A record this character CARRIES (../data/carried.ts) is never edited in place here: the item
     * editor COPIES it under a new id and repoints the instance (`copyOnWriteItems` below,
     * ./CopyOnWriteItems.tsx), so what arrives here is a new record of his, sent like any item he makes.
     * Writing an edit into the carried copy instead could reach nobody (2026-10-20, checker findings
     * saving-C1 / semantics-C1: the push was 'settled' unapplied and his screen reverted after "Sent").
     * Should a carried id still arrive (no control sends one now): one that is ONLY theirs (not in his own
     * content) is never saved into HIS homebrew — owner ruling 2026-10-20, "i dont want it in the
     * homebrew" — and the sheet is not marked changed for it.
     */
    if (work.carried?.items?.[item.id] && !content.items[item.id]) return;
    setContent((c) => ({ ...c, items: { ...c.items, [item.id]: item } }));
    onCreateItem?.(item);
  };
  /** The item records this sheet draws from what it carries: copy-on-write in its editor, no delete in
   *  its Add list. Less a fill-only record he holds himself (his own campaign-shared item, drawn from his
   *  record — ../data/carried.ts foreignCarriedIds): that one he edits in place, and the share sends it. */
  const copyOnWriteItems = useMemo(() => foreignCarriedIds(content, workCarried, 'items'), [content, workCarried]);
  /** …and the same for the modes it carries (./CopyOnWriteItems.tsx CopyOnWriteModesContext). */
  const copyOnWriteModes = useMemo(() => foreignCarriedIds(content, workCarried, 'modes'), [content, workCarried]);
  /*
   * Which of HIS roster characters use which modes (src/App.tsx ModeUsageContext). This player is never on
   * his roster, so any character it names for a mode is one of his own. A mode one of them owns, or one of
   * them uses (an old unowned mode he also switched on for this player), is never edited or deleted from
   * here (checker, round 4): in place, his own character's numbers changed, and Delete stripped it from him.
   */
  const usage = useModeUsage();
  const hisToo = (id: string): boolean => {
    const def = content.modes[id];
    return modeOwnedElsewhere(def, work.id) || (!!def && modeAlsoElsewhere(def, work.id, usage));
  };
  const saveModeDef = (mode: ModeDef) => {
    /*
     * A mode this sheet CARRIES is never edited in place (2026-10-20, checker findings saving-R2-chk-2 /
     * coverage-R2-gm-mode-edit-dead): saved under its own id it went into HIS saved modes while the sheet
     * kept drawing the carried copy (it wins in a foreign view) and the push sent the old one — the edit
     * never showed and never reached the player, and a mode the PLAYER wrote landed in his synced modes.
     * So, like a carried item (addCustomItem / ./CopyOnWriteItems.tsx): a COPY under a fresh id, his own
     * mode now, and the sheet's active modes (its own and its companions') repointed to it — a real change
     * to the sheet, which the push carries (owner ruling 2026-10-20: "the others should see the same item
     * as the player"). The carried id never reaches his storage.
     * The same for a mode ANOTHER character owns (src/rules/modes.ts modeOwnedElsewhere — one of his own
     * characters' modes, switched on for this player): edited in place, his own character's mode would change
     * with it (round 2, 2026-10-21). The player gets their own copy; his character keeps its mode as it was.
     */
    if (copyOnWriteModes.has(mode.id) || hisToo(mode.id)) {
      const old = mode.id;
      // Made on this character, so it is this character's (src/rules/modes.ts, Guy 2026-10-21): never one of
      // his own characters' modes, and the player's sheet lists it once the push lands.
      const copy: ModeDef = { ...mode, id: freshModeId(), charId: work.id };
      setContent((c) => ({ ...c, modes: { ...c.modes, [copy.id]: copy } }));
      onSaveMode?.(copy);
      carryModePin(old, copy.id); // a pinned mode's copy stays pinned (2026-10-20, r3-R3-pin-lost-on-copy)
      // The one repoint helper, shared with the player's own sheet (src/App.tsx, round 3, 2026-10-20).
      setWork((w) => (w.play ? { ...w, play: repointMode(w.play, old, copy.id) } : w));
      setDirty(true);
      return;
    }
    setContent((c) => ({ ...c, modes: { ...c.modes, [mode.id]: mode } }));
    onSaveMode?.(mode);
  };
  const removeModeDef = (id: string) => {
    // A carried mode offers no Delete here (ModesPanel reads CopyOnWriteModesContext); should its id still
    // arrive, nothing is deleted: his tombstone would not take it off the sheet, and it is not his to delete.
    if (copyOnWriteModes.has(id)) return;
    /*
     * A mode ANOTHER character owns — one of his own characters' modes switched on for this player — is never
     * deleted from here: that would take it from his own character too (round 2, 2026-10-21). The panel's
     * button reads "Remove from this character" for it, and that is what happens: switched off for this player
     * the way its toggle does it (a form's temporary Hit Points go with it), then out of every companion's
     * list (`repointMode`, as the player's own sheet does, src/App.tsx removeOwnModeDef). A change to the sheet,
     * which his Update sends; his saved modes are untouched.
     */
    if (hisToo(id)) {
      const defs = content.modes;
      setWork((w) => {
        if (!w.play) return w;
        const off = (w.play.activeModes ?? []).includes(id) ? toggleMode(w.play, id, defs) : w.play;
        const play = repointMode(off, id, null);
        return play === w.play ? w : { ...w, play };
      });
      setDirty(true);
      return;
    }
    setContent((c) => ({ ...c, modes: Object.fromEntries(Object.entries(c.modes).filter(([k]) => k !== id)) }));
    onDeleteMode?.(id);
  };

  const openBuilder = () => {
    // The stored build when there is one; the reverse build only for a build-less character. If that
    // throws there is NO build to edit (a blank one's Save would replace the player's whole character), so
    // the Builder stays closed and the working copy stays as it is (src/data/editBuild.ts).
    // The Builder stamps its draft at open (blocks/save.ts); only Save stores it, never this.
    const eb = editableBuildOf(work, viewContent);
    if (!eb) {
      void chooseDialog({ ...UNREADABLE_BUILD_NOTICE, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
      return;
    }
    setEditingDerived(eb.derived);
    setEditing(eb.build);
  };

  const onCreate = (build: BuildState) => {
    // Against the sheet's view: a carried feat the player picked stays a feat the rebuild knows. The
    // build's own content edits go over it inside buildCharacter (../rules/blocks/content.ts).
    const built = buildCharacter(build, viewContent);
    setWork((w) => ({
      ...w,
      character: carryStoredOverrides(built, w.character),
      build,
      // Same lossless round-trip as the player's own builder Save (App.tsx): the fresh character
      // says what the player's sheet picks are still allowed to be, the previous one lets gear
      // added in the builder reach the sheet.
      play: w.play ? playForRebuild(w.play, built, w.character) : w.play,
    }));
    setDirty(true);
    setEditing(null);
  };

  // Push the working copy to the player. Returns true on success.
  const pushToPlayer = async (): Promise<boolean> => {
    setBusy(true);
    const name = work.character.name;
    /*
     * PROVE THE WORKING COPY BEFORE IT GOES (F1, 2026-10). His edits were made on `baselineRef` — the
     * sheet he opened, last pushed or took. They may go out only on top of the newest thing the server
     * holds for this character: his held edit while it stands on this FRESH read, else the published
     * sheet (`gmUpdateBase`). Anything else means the character MOVED since his copy — the player
     * published, or his own tracker gesture replaced his held edit — and sending would undo that.
     *
     * ⚠ `fetchPublishedSheet`, NOT `fetchMemberSheet`. The latter hands back our own pending edit
     * whenever one is waiting, so this guard would be comparing the GM's work against itself. A write
     * re-bases on the player's row; only the display overlays it. The read's base travels with the
     * push (`gm_base`), and the player's app applies it only while their sheet is still that one.
     */
    const row = await fetchPublishedSheet(campaignId, work.id);
    const proof = gmUpdateBase(baselineRef.current, row, gmHeldEdit(campaignId, work.id));
    let base: { stamp: string; hash: string };
    let on: string | null;
    if (proof.ok) {
      base = proof.base;
      on = proof.on;
    } else {
      setBusy(false);
      if (proof.reason !== 'moved') {
        await confirmDialog(
          proof.reason === 'read-failed'
            ? {
                title: `Couldn’t check ${name}`,
                message: `Couldn’t reach the server to read ${name}’s current sheet, so nothing was sent. Your changes are still here — try Update again in a moment.`,
                confirmLabel: 'OK',
              }
            : {
                title: `${name} isn’t shared any more`,
                message: `${name} is no longer shared in this campaign, so there is nothing to update. Your changes are still here.`,
                confirmLabel: 'OK',
              },
        );
        return false;
      }
      // MOVED. The app never overwrites a player's change — but a GM who is shown that the character
      // changed and presses the red button has chosen to, knowingly (the one judgment call, F1).
      const choice = await chooseDialog({
        title: `${name} changed since your copy`,
        message: `${name} changed after this sheet was opened — on the player’s device, or by your own change in the tracker. Your edits were made on the older copy, so nothing was sent. Take the current version and make your edits again, or keep editing to note them first. Overwrite anyway sends your copy as it is: it undoes whatever changed since your copy (the player’s own changes included), and that cannot be taken back from here.`,
        buttons: [
          { value: 'take', label: 'Take current version', primary: true },
          { value: 'overwrite', label: 'Overwrite anyway', danger: true },
          { value: 'keep', label: 'Keep editing' },
        ],
      });
      if (choice === 'take') {
        setWork(proof.current);
        baselineRef.current = proof.current;
        setPlayerAhead(null);
        setDirty(false);
        return false;
      }
      if (choice !== 'overwrite') return false;
      setBusy(true);
      base = proof.base;
      on = proof.on;
    }
    // `content`: the push carries the custom records the sheet uses — his own (an item he made here) and
    // the player's (`work.carried`) — so the player's device resolves them (owner ruling 2026-10-20).
    const res = await pushGmEdit(campaignId, work.id, playerOwnerId, work, base, on, content);
    setBusy(false);
    if (!res.ok) {
      await confirmDialog({ title: 'Couldn’t update', message: res.error, confirmLabel: 'OK' });
      return false;
    }
    baselineRef.current = work; // our new known-published baseline
    setDirty(false);
    // He re-did his change on their version: whatever "not applied" said is answered (F1, 2026-10-09).
    acknowledgeGmEditRefused(campaignId, work.id);
    return true;
  };

  const confirmUpdate = () =>
    confirmDialog({
      title: `Update ${work.character.name}?`,
      message:
        'Push your changes to this player’s character. If their app is open it updates right away; otherwise the next time they open it. They won’t be notified. If they change the character before their app picks this up, their change wins and yours is not applied — their card then says “not applied”.',
      confirmLabel: 'Update',
    });

  const doUpdate = async () => {
    if (busy) return;
    if (await confirmUpdate()) {
      const ok = await pushToPlayer();
      if (ok)
        await confirmDialog({
          title: 'Sent',
          message: `Your changes to ${work.character.name} were sent — they apply on the player’s device right away if their app is open, otherwise next time they open it. Your own cards and sheet show them from now, marked “waiting” until the player’s app has them, or “not applied” if they changed the character first.`,
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
    /*
     * THE BUILDER IS OPEN. Its unsaved state lives inside <Builder> until Save, not in `work`, so
     * `dirty` cannot see it — and this used to answer "fine, go" here whenever the sheet itself was
     * clean: Escape, the tracker's Party / GM Screen, or a turn change then threw the builder's work
     * away without a word. Ask, but with Discard / Cancel ONLY: an "Update player" here would push
     * `work`, which is not what the GM is looking at — the wrong copy.
     */
    if (editing) {
      const choice = await chooseDialog({
        title: 'Leave the builder?',
        message: dirty
          ? `You’re rebuilding ${work.character.name}, and you have other changes you haven’t sent. Leaving now discards both.`
          : `You’re rebuilding ${work.character.name}. Leaving now discards what you’ve changed in the builder.`,
        buttons: [
          { value: 'leave', label: 'Discard changes', danger: true },
          { value: 'cancel', label: 'Cancel' },
        ],
      });
      return choice === 'leave';
    }
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

  const doExport = async () => {
    try {
      // Awaited: on the Android app the save or share finishes later, and its failure belongs here.
      await downloadText({ filename: `${fileSlug(work.character.name)}.codex.json`, text: exportNative(work, viewContent) });
    } catch (e) {
      void confirmDialog({ title: 'Export failed', message: (e as Error).message, confirmLabel: 'OK' });
    }
  };

  if (editing) {
    return (
      <ContentContext.Provider value={viewContent}>
        {/* skillOrderNotice={false} — skill order D13 (WP9): the one-time skill-order notice is the PLAYER's; the
            GM's edit neither shows it nor stamps `skillOrder`, so the player still sees it on their next open. */}
        <Builder content={viewContent} initial={editing} derivedBuild={editingDerived} onCancel={() => setEditing(null)} onCreate={onCreate} skillOrderNotice={false} />
      </ContentContext.Provider>
    );
  }

  return (
    // The sheet's popups and links resolve through the context: the same view, carried records included.
    <ContentContext.Provider value={viewContent}>
      {/* Over the tracker both title bars are hidden, so the desktop app's minimise / maximise / close
          live here: a direct child of .ct-sheet-full, pinned to its top-right corner above the GM strip
          and the strips below (campaign-tracker.css). Inside the sheet's identity row they sat under
          the strip and every banner, ~23 px or more below the window's corner. Null on the web. */}
      {inTracker && <WindowControls />}
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
      {/* The player's app refused his last push — they changed the character first — so this sheet is
          their version, and he is told rather than left to find his change gone (F1, 2026-10). */}
      {refused && !pending && !dirty && (
        <div className="gm-pending-strip" role="status">
          <i className="ti ti-cloud-x" aria-hidden="true" />
          <span>
            Your last changes to <strong>{work.character.name}</strong> were not applied — the player changed the
            character before their app picked them up. This is their version.
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
            unsaved changes are still here, but they were made on the older version — take theirs and make
            your changes again to send them.
          </span>
          <button className="btn" onClick={takePlayerVersion}>
            Take their version
          </button>
          <button className="save-warning-x" onClick={() => setPlayerAhead(null)} aria-label="Keep editing mine">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
      {/* The player's carried item records are copy-on-write in this sheet's item editor (see addCustomItem),
          and its carried modes in the Modes panel (see saveModeDef). ModesRemoveFromCharacterContext is set
          back to false here (2026-10-20, final check round 3): the player's own sheet sets it true around
          everything it draws, so a GM sheet ever opened from inside it would otherwise offer "Remove from
          this character", which removeModeDef ignores for a carried mode — a button that does nothing. */}
      <CopyOnWriteItemsContext.Provider value={copyOnWriteItems}>
      <CopyOnWriteModesContext.Provider value={copyOnWriteModes}>
      <ModesRemoveFromCharacterContext.Provider value={false}>
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
          gmEdit={{ onUpdate: () => void doUpdate(), onExport: () => void doExport(), busy, inTracker }}
          onBack={() => void doExit()}
        />
      </ModesRemoveFromCharacterContext.Provider>
      </CopyOnWriteModesContext.Provider>
      </CopyOnWriteItemsContext.Provider>
    </ContentContext.Provider>
  );
});
