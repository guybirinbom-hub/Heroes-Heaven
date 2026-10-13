import { useCallback, useEffect, useRef, useState } from 'react';
import { initialPlay } from '../rules/play';
import { gmBaseOf, gmPendingEdit, gmPushBuiltOn } from '../sheet/gmSync';
import { deriveMaxHp } from '../rules/derive';
import { fetchPublishedSheet, pushGmEdit, type PartyMember } from '../data/party';
import { livePlay } from '../sheet/memberSheets';
import type { SavedChar } from '../data/storage';
import type { Character, ContentDatabase } from '../rules/types';
import { isSamePc, moveBeforeActive, releaseSteps, takeVitalsGesture, useCombatStore } from '../../tracker/src/store/combatStore';
import { CONDITION_META } from '../../tracker/src/utils/conditionEffects';
import type { Combatant } from '../../tracker/src/types/pf2e';

/*
 * `livePlay`, `memberCardSummary` (once `gmMemberSummary`) and `useMemberSheets` MOVED to
 * ../sheet/memberSheets.
 *
 * Nothing about them is tracker-specific, and this file imports the tracker's combat store — so
 * while they lived here the plain party surfaces (a character's Party button, the GM's campaign
 * detail) could not read a member's sheet without pulling the whole lazily-split tracker chunk into
 * the main bundle. They are re-exported so the seam's own callers, and this file's, are unchanged.
 */
export { memberCardSummary, livePlay, useMemberSheets } from '../sheet/memberSheets';

/*
 * THE SHEET IS THE TRUTH — for a campaign's player characters, and only for them.
 *
 * "The conditions and HP the players have are on their sheets, and what the GM sees is what they
 * have." So a PC row in the initiative order is not a copy of a character the GM types damage into;
 * it is a WINDOW onto the player's published sheet:
 *
 *   sheet → tracker  the player's live sheet (fetchMemberSheet + subscribeMemberSheet) writes the
 *                    PC combatant's HP and conditions. Whenever a sheet arrives, the sheet wins.
 *   tracker → sheet  a condition or damage the GM APPLIES to a PC in the tracker — a gesture the
 *                    combat store marks as his — is pushed to the player through the existing GM-edit
 *                    channel (pushGmEdit → gm_character_edits), so it lands on their sheet like any
 *                    other condition. Nothing else on the row is ever pushed.
 *
 * NPC / monster rows are untouched — they have no sheet and stay entirely tracker-local.
 *
 * ⚠ NEVER OVERWRITE A PLAYER'S OWN CHANGE — AND A LOAD IS NOT AN EDIT. Five rules keep that true:
 *   A. UNDO AND REDO NEVER PUSH. Ctrl+Z / Ctrl+Y act on the board only. For a PC row an Undo or a
 *      Redo is a LOAD of an older board — the snapshot can predate the player's own changes (Next
 *      Turn records one) — so it carries no gesture, and the same pass re-bases the row on the
 *      player's sheet. To take back a Mark defeated or a hit, the GM uses the opposite GESTURE
 *      (Restore, heal, remove the condition), which pushes like any other. Five rounds of letting an
 *      Undo push "only over his own last push" each opened a new timing hole; there is no licence
 *      left to get wrong. Nor does a load call back a change of his that is already OUT (rule C):
 *      nothing can stop what is on its way to the server, so the row goes on showing it. A change of
 *      his NOT SENT YET — owed after it reached nobody, or made while another was out and waiting
 *      behind it — lives on the row alone: a load takes it off the row, and it never goes out.
 *   B. A GESTURE IS THE ONLY THING THAT PUSHES. The combat store marks every explicit GM vitals
 *      action on a PC row (`takeVitalsGesture`): damage, healing, temp HP, max HP, Mark defeated /
 *      Restore, a condition added or removed, a condition's value or duration set — and, while the
 *      tracker's "Step players' conditions" setting is on (the default; settingsStore
 *      `pcConditionTicks`), the turn engine STEPPING their conditions as the GM advances the turn:
 *      Frightened down by 1 as their turn ends, Stunned used up as it starts (owner's list
 *      2026-10-01, item 3: "the tracker should do that for players but have a setting for it not to do
 *      that"). That step goes out like any condition he sets — through rule C, so a sheet the player
 *      changed while the turn moved still wins. `writeVitals` leaves those two conditions unpinned for
 *      it (`isPermanent` false); every other sheet condition stays pinned. Taking the gesture SPENDS the
 *      step (combatStore, SPENT STEPS): an Undo of that Next puts the board back but never the step
 *      (rule A — it went to their sheet), and Next pressed again does not step them a second time for
 *      the same turn. A step that never reaches their sheet is handed back (`releaseSteps`, the
 *      change's `steps`): dropped while owed — by a load, the Undo included — or lost to the sheet
 *      winning (rule C). EVERY OTHER way a row can
 *      come to differ from the sheet — Clear then re-add, Remove then re-add, Load encounter, Undo /
 *      Redo, a board from the GM's other device (reloadFromStorage), a campaign switch (setScope), the
 *      party bridge's max-HP sync, the rest of the turn engine (persistent damage, round durations,
 *      every step while the setting is off), and any row-replacing path added later — carries none, so
 *      it is safe BY CONSTRUCTION: the row is rewritten from the sheet (`writeVitals`) and nothing is
 *      pushed. A gesture that changes nothing a push carries (temp HP, max HP alone) pushes nothing
 *      either.
 *   C. A PUSH NEEDS A FRESH READ. Before anything is sent, the seam reads the published sheet
 *      (`fetchPublishedSheet`) and builds on what that read answers for the GM (`gmPushBuiltOn`), which
 *      also says WHICH of his pushes it built on, so the row can carry it (`gm_base.on`): his
 *      own pending edit while it stands against that read on a PROVED base — on his own character
 *      too, where that edit is never drawn but is still on the server — else the published sheet. The
 *      push is recorded on the stamp of that read, so one built on their newer publish stands. A read
 *      that FAILED (offline, a blip, no server), or one that finds no published sheet (they
 *      unpublished, or left), is NO ANSWER: nothing is sent, the gesture is OWED on its row, and a
 *      later pass — the next board change, or the next sheet handed in — sends it through a fresh
 *      read of its own.
 *      The push writes the gesture onto that sheet — only `play.damage` and `play.conditions`,
 *      nothing else of theirs — and only while it still carries the vitals the ROW SHOWED when the GM
 *      made the gesture. If it does not, the sheet moved since: THE SHEET WINS, the gesture (and any
 *      made on top of it) is DROPPED, and the row is re-based on what the read returned — the GM sees
 *      it snap and can hit again. That one test compares VALUES, and safely: a push carries the row's
 *      whole vitals, so it is exactly his change only on top of exactly the vitals he made it on —
 *      and on top of those it loses nothing, whoever wrote them.
 *      One change per character is OUT at a time, from its fresh read to the server's answer: two
 *      upserts racing let an earlier one land last, so the server ended on a hit the GM had already
 *      gone past. A gesture made meanwhile is a new change made ON the one that is out. It goes out
 *      next, with its own fresh read: on top of what that push wrote if it landed, together with it if
 *      it reached nobody, and not at all if the sheet won.
 *      Nothing of the PLAYER's is written over. A change of HIS can still be lost, in these ways:
 *      visibly, when the sheet wins and his row snaps to it — including one ordering no stamp can
 *      tell apart: their app applying an earlier push of his AFTER a later one was already built on
 *      it (fetched before the later one replaced it on the server), which IS after the later push's
 *      base, and only the sheets' content could tell from a change of their own (rule E rules that
 *      out); unseen, when an owed gesture never got its turn before the seam unmounted; and on the
 *      server, only for an edit an OLDER GM app wrote: such a row has no bound `gm_base`, so a seeded
 *      copy has no proved base, is never built on, and his next push replaces it. Every push this app
 *      makes carries the publish it was built on (`gm_base`, src/data/party.ts + the SQL), so an edit
 *      seeded from his other device or by a sign-in is proved and built on like any other. On the
 *      PLAYER's side their app applies a push only when their sheet is still exactly the one it was
 *      built on (src/sheet/gmSync.ts → `gmEditVerdict`); otherwise it refuses it and says so on their
 *      row (`gm_refused_at`), the overlay stands down, his row snaps to their sheet and the card says
 *      "not applied". A push built on an earlier push of his (`gm_base.on`) lands only on the device
 *      that applied that push, or while their row is still the very publish he built on. The one
 *      player-loss case left (a Ctrl+Z inside the publish debounce while their other device judges his
 *      next push) is named in ./README.md, Known gaps.
 *   D. AN UNMOUNTED SEAM WRITES NOTHING. Every pass first asks whether the seam is still mounted, and
 *      a read that answers after it unmounted (the GM left the campaign) sends nothing — the next
 *      board can hold a row of the same name.
 *   E. NO VALUE IDENTITY. Nothing here decides "did the player move this character" or "is this our
 *      echo" by comparing vitals: rule C's test never asks who wrote a sheet. Sheets of our own
 *      pushes are told apart by OBJECT (the overlay hands back the very object a push sent): one that
 *      is still the pending edit is his newest push coming back, and the row follows it — but it is
 *      no sheet ARRIVING, because a push that is out was made on top of it; one that is no longer
 *      the pending edit is a LATE ECHO, an older answer than one this screen already has, and is set
 *      aside. Following either as an arrival dragged the row back to an earlier hit of the GM's.
 *
 * WHICH ROW. The row a member's sheet drives is the PC row that is the same character by the
 * tracker's own rule (`isSamePc`: the charId both carry, the name only for a row that has none). A
 * row two members answer to — a hand-typed name they share — is a window onto neither sheet: nothing
 * is written to it or pushed from it. Two sheets fighting over one row never settled.
 *
 * WHAT THE ROW SHOWS. The GM's change while it is not sent or out. Otherwise the newest sheet that
 * arrived — or his own push once it landed, until the next sheet arrives (a push does not change the
 * published row: the player's app applies it and republishes, and until then a member read answers
 * with the pre-push sheet — always, on the GM's own character, where no overlay is drawn — which would
 * drag his change straight back off the row). A push whose answer comes back after a sheet arrived
 * leaves the row on that sheet: this screen cannot tell which of the two is newer, and the next read
 * — the one his landed push itself triggers — settles it. One write puts what it shows on the row (a
 * sheet's HP is already inside its own max, the row is written with that max, and a row's own vitals
 * are what it holds), so the pass that write sets off finds nothing left to write.
 *
 * Part of the removable seam; see ./README.md.
 */

/** The only two things a tracker row and a character sheet both own. */
export interface PcVitals {
  currentHP: number;
  maxHP: number;
  /** Heroes Heaven condition ids — which are the tracker's lower-cased condition names. */
  conditions: { id: string; value?: number }[];
}

/**
 * Does a GM's DAMAGE in the tracker reach the player's sheet?
 *
 * Conditions are settled (the owner asked for them); HP is the assumption. This is the one switch:
 * false makes "GMs don't edit PC HP in the tracker" true — the sheet still drives the row's HP, the
 * GM's own damage just stops being published — without touching anything else.
 */
const GM_EDITS_PC_HP = true;

let _cid = 0;

/** A condition the tracker's turn engine steps on its own (CONDITION_META `autoDecrement`: Frightened at
 *  the end of a turn, Stunned at the start) — the two a sheet condition is left unpinned for (rule B). */
function stepsWithTheTurn(id: string): boolean {
  return !!CONDITION_META[id]?.autoDecrement;
}

/** The row still carries one of the sheet's stepping conditions PINNED — written before rule B let the
 *  turn engine step it — so `writeVitals` has to unpin it even where no value differs. */
function pinsAStep(c: Combatant, content: ContentDatabase): boolean {
  return c.conditions.some((x) => {
    const id = x.name.trim().toLowerCase();
    return !!x.isPermanent && stepsWithTheTurn(id) && !!content.conditions?.[id];
  });
}

/** Conditions Heroes Heaven actually has a rules entry for. A tracker-only condition (a custom one
 *  the GM typed) has no id on the sheet, so it is neither pushed nor reconciled — it simply stays. */
function known(list: { id: string; value?: number }[], content: ContentDatabase): { id: string; value?: number }[] {
  return list.filter((c) => !!content.conditions?.[c.id]);
}

function maxHpOf(live: Character, content: ContentDatabase): number {
  try {
    return deriveMaxHp(live, content);
  } catch {
    return live.hitPoints?.current ?? 0;
  }
}

export function vitalsFromSheet(sheet: SavedChar, content: ContentDatabase): PcVitals {
  const live = livePlay(sheet, content);
  const max = maxHpOf(live, content);
  /*
   * The AUTHORED conditions, not the overlay's. applyPlayState ADDS derived ones — encumbered from
   * bulk, a mode's granted conditions — that `play.conditions` deliberately never stores ("the
   * condition has to disappear the moment the mode goes"). Reading those back would push the sheet a
   * condition it computes for itself, and it would never be able to drop it again.
   */
  const authored = sheet.play?.conditions ?? sheet.character.conditions ?? [];
  return {
    currentHP: live.hitPoints?.current ?? max,
    maxHP: max,
    conditions: known(authored.map((c) => ({ id: c.id, value: c.value })), content),
  };
}

export function vitalsFromCombatant(c: Combatant, content: ContentDatabase): PcVitals {
  return {
    currentHP: c.currentHP,
    maxHP: c.maxHP,
    conditions: known(c.conditions.map((x) => ({ id: x.name.trim().toLowerCase(), value: x.value })), content),
  };
}

/**
 * The identity the two sides are compared on.
 *
 * Max HP is deliberately OUT: it is derived from the build, the tracker has no way to edit it for a
 * PC, and the party bridge seeds it from the published summary — so a one-point disagreement there
 * would otherwise read as "the GM changed something" on every single reconcile.
 */
export function vitalsKey(v: PcVitals): string {
  return `${v.currentHP}|${v.conditions.map((c) => `${c.id}:${c.value ?? ''}`).sort().join(',')}`;
}

/** The player's sheet with the GM's HP + conditions written into play state — and nothing else. */
export function sheetWithVitals(sheet: SavedChar, v: PcVitals, content: ContentDatabase): SavedChar {
  const play = { ...initialPlay(sheet.character, content), ...(sheet.play ?? {}) };
  const max = vitalsFromSheet(sheet, content).maxHP;
  // Conditions HH has no entry for are the player's (homebrew, a future book) — keep them as they are.
  const mine = (play.conditions ?? []).filter((c) => !content.conditions?.[c.id]);
  return {
    ...sheet,
    play: {
      ...play,
      conditions: [...mine, ...v.conditions.map((c) => (c.value == null ? { id: c.id } : { id: c.id, value: c.value }))],
      ...(GM_EDITS_PC_HP ? { damage: Math.max(0, Math.min(max, max - v.currentHP)) } : {}),
    },
  };
}

/**
 * Write the sheet's vitals onto one PC combatant. The tracker keeps no PC HP of its own.
 *
 * `dropped`: the player's OWN sheet took this character from above 0 HP to 0 and the row has not
 * followed it yet (SeenPc.drop; owner's list 2026-10-01, item 2: "if they drop to 0 it does need to be
 * updated in the tracker and move them to the correct initiative"). When this write takes the ROW from
 * above 0 to 0, mid-fight, the row moves to just before the creature whose turn it is, on that
 * creature's count — the tracker's one rule for a creature going down (combatStore `moveBeforeActive`,
 * which also refuses out of combat). A row already at 0 is already down — the GM's own knock-out moved
 * it when he made it — and is not moved a second time for the same fall. It happens HERE, inside this
 * plain write, and never through setDefeated / applyDamage: those are the GM's gestures, and a gesture
 * is pushed to the player (rule B). Their Dying and Unconscious are their sheet's, written like every
 * condition above; the tracker adds none.
 */
function writeVitals(cid: string, v: PcVitals, content: ContentDatabase, dropped = false): void {
  useCombatStore.setState((s: { combatants: Combatant[]; activeIndex: number; inCombat: boolean }) => {
    const c = s.combatants.find((x) => x.id === cid);
    if (!c) return;
    const standing = c.currentHP > 0;
    if (v.maxHP > 0) c.maxHP = v.maxHP;
    c.currentHP = Math.max(0, Math.min(v.currentHP, c.maxHP));
    c.isDefeated = c.currentHP === 0;
    // Keep a badge the GM already set (its duration is theirs) and every tracker-only condition;
    // replace only the ones the sheet is authoritative for. A sheet condition is pinned (`isPermanent`,
    // "until removed": the turn engine never touches it) — except one that steps with the turn
    // (Frightened, Stunned), which the engine steps as the GM's gesture while the tracker's "Step
    // players' conditions" setting is on (rule B; the engine itself checks the setting). A badge pinned
    // before that rule existed is unpinned here too, or it would never step.
    const keep = c.conditions.filter((x) => !content.conditions?.[x.name.trim().toLowerCase()]);
    const fromSheet = v.conditions.map((cond) => {
      const had = c.conditions.find((x) => x.name.trim().toLowerCase() === cond.id);
      const steps = stepsWithTheTurn(cond.id);
      if (had) return steps ? { ...had, value: cond.value, isPermanent: false } : { ...had, value: cond.value };
      return { id: `hh-${cond.id}-${++_cid}`, name: cond.id, value: cond.value, isPermanent: !steps };
    });
    c.conditions = [...keep, ...fromSheet];
    if (dropped && standing && c.currentHP === 0) moveBeforeActive(s, cid);
  });
}

/** One change of the GM's to one PC (rule C). */
interface Change {
  /** The row it was made on, by id. A row that is not this one never carries it (rule B). */
  rowId: string;
  /** The row's vitals — what the push writes. */
  v: PcVitals;
  /** The vitals key of what the row showed when he made it: the only sheet it may land on. */
  on: string;
  /** The turn-engine steps inside it (combatStore SPENT STEPS, `takeVitalsGesture`'s `steps`): handed
   *  back (`releaseSteps`) when the change is dropped without reaching their sheet (rule B). */
  steps?: string[];
}

/** What the seam remembers per character, keyed `campaign|character` — rules A–E at the top of this file. */
interface SeenPc {
  /** The sheet object `sheetById` last handed in. A different object is a read that answered since. */
  sheet: SavedChar;
  /** What the row shows while the GM has nothing not sent or out (WHAT THE ROW SHOWS). */
  shown: PcVitals;
  /** Counts the sheets from the player's side that `shown` has followed, so a push's answer can tell
   *  whether one arrived while it was out (WHAT THE ROW SHOWS). His own pushes coming back are not
   *  counted (rule E). */
  arrived: number;
  /** His change that has not gone out: made while another was out, or OWED. A load drops it (rule A). */
  want?: Change;
  /** His change that is OUT, from its fresh read to the server's answer. No load drops it (rule A). */
  out?: Change;
  /**
   * The player's side went from above 0 HP to 0 — a sheet arriving, or a push's fresh read the sheet
   * won — and the row has not shown it yet: a change of the GM's not sent or out stood over it. Kept
   * until the first pass in which the row shows `shown` (writeVitals' `dropped`), then spent — or until
   * a pass finds no row for the character: a row added after that is a re-add, never the fall. Taken
   * only on the pass the sheet arrived, the drop was lost whenever a change of his was standing then:
   * the row reached 0 later, through the sheet winning his push, and never moved.
   */
  drop?: boolean;
  /**
   * The HP the PLAYER's side last had: the last sheet that arrived from them, or a push's fresh read of
   * their published sheet. A fall is theirs only from above 0 here — never from what the row showed of
   * his own landed push (`shown = held`, or his push coming back). His heal that landed and that their
   * app then REFUSED stood the row up, but never them: their next sheet at 0 is no new fall.
   */
  theirs: number;
}

/** `shown` follows the player's side (an arrival, or a fresh read the sheet won): a fall from above 0
 *  HP to 0 ON THEIR SIDE is owed to the row until the row shows it (SeenPc.drop). One still at 0 on
 *  their side is no new fall, whatever the row showed of his in between. */
function follow(st: SeenPc, v: PcVitals): void {
  if (st.theirs > 0 && v.currentHP === 0) st.drop = true;
  st.theirs = v.currentHP;
  st.shown = v;
}

/**
 * Hold the PC rows and the players' sheets in step, in both directions.
 *
 * Runs on every combat-store change and whenever a sheet arrives, so neither side can drift — but
 * only a GM GESTURE is ever published (rule B); every other difference is the sheet winning. See
 * the rules at the top of this file.
 */
export function usePcSheetTruth(args: {
  campaignId: string;
  members: PartyMember[];
  sheetById: Map<string, SavedChar>;
  content: ContentDatabase;
}): void {
  const { campaignId, members, sheetById, content } = args;
  /*
   * `campaign|character` → `SeenPc`. It outlives every ROW: Clear, Remove, Load encounter, Undo and
   * a board from the GM's other device each put a different (or an older) row under the same
   * character — and while "the row differs from what the seam last agreed" was enough to publish,
   * each of them published that row, full HP and no conditions or a stale snapshot, over the
   * player's own damage and conditions. Only a gesture pushes now (rule B), so this map is what to
   * SHOW, never a licence to push. Keyed by campaign too, so nothing of one campaign's can reach
   * another's.
   */
  const [seen] = useState(() => new Map<string, SeenPc>());
  /** Every sheet a push of ours sent, by object — how a sheet coming back is told from the player's
   *  side moving (rule E). Weak, so a sheet goes the moment nothing else holds it. */
  const [ours] = useState(() => new WeakSet<SavedChar>());
  /** False once the seam unmounts (rule D). Set back on every effect run, which a deps change makes
   *  synchronously after its own cleanup, so a push that is out across a re-render keeps going. */
  const alive = useRef(true);
  /** The newest `reconcile`, so a push's answer re-runs the pass this seam has NOW. */
  const again = useRef<() => void>(() => undefined);

  const reconcile = useCallback(() => {
    // Rule D. A push's answer re-runs this pass, and it can come back after the GM left.
    if (!alive.current) return;
    const combatants = useCombatStore.getState().combatants;
    /**
     * Send one change for one character (rules C and D). Answers whether the pass should run again
     * at once: the push landed, or the sheet won. A change that reached nobody — the read failed or
     * found no published sheet, the server refused it, the push threw — is OWED again, back on its
     * row with any gesture made on it while it was out, and goes out on a later pass. Never retried
     * from here, which would spin against a server that is still refusing.
     */
    const send = async (mem: PartyMember, st: SeenPc, w: Change): Promise<boolean> => {
      try {
        const row = await fetchPublishedSheet(campaignId, mem.charId);
        if (!alive.current) return false;
        const built = row?.sheet ? gmPushBuiltOn(campaignId, mem.charId, row) : null;
        const fresh = built?.sheet;
        if (row && built && fresh) {
          const now = vitalsFromSheet(fresh, content);
          if (vitalsKey(now) !== w.on) {
            // The sheet moved since he made it: it wins, over anything made on top of it too — and a
            // fall to 0 in it is the player's, owed to the row like one that arrived (SeenPc.drop).
            // A turn-engine step in either never reached them: handed back (rule B, SPENT STEPS).
            releaseSteps(w.steps);
            releaseSteps(st.want?.steps);
            st.want = undefined;
            follow(st, now);
            return true;
          }
          // Built on their PUBLISHED sheet (no push of his under it): this read is the player's side,
          // and it carries what the row showed, so the row already went through anything in it — no
          // fall to owe. Kept as theirs, so a fall from here is one (their app applied his heal and
          // republished, and the next sheet this screen is handed is them down again). Built on his
          // own push, the read is HIS, never theirs (SeenPc.theirs).
          if (built.on === null) st.theirs = now.currentHP;
          const arrived = st.arrived;
          const sent = sheetWithVitals(fresh, w.v, content);
          // The base is THIS read (`gmBaseOf`: its stamp and the hash of the sheet it holds), and
          // `built.on` says which push of his it was built on — the player's app applies it only while
          // their published sheet is still that one. A read with no stamp proves nothing: nothing is
          // sent (pushGmEdit refuses) and the gesture is owed.
          const res = await pushGmEdit(campaignId, mem.charId, mem.ownerId, sent, gmBaseOf(row), built.on);
          if (res.ok) {
            ours.add(sent);
            // What the server holds now — the sheet may not hold the row whole (a heal past its max).
            const held = vitalsFromSheet(sent, content);
            if (st.arrived === arrived) st.shown = held;
            if (st.want) st.want.on = vitalsKey(held); // a gesture made on this push lands on it
            return true;
          }
        }
      } catch {
        /* a push that THREW reached nobody */
      }
      // Owed again, with the steps of both (a load that later drops it hands them back).
      st.want = st.want ? { ...st.want, on: w.on, steps: [...(w.steps ?? []), ...(st.want.steps ?? [])] } : w;
      return false;
    };
    // WHICH ROW: the tracker's own "same character" rule, the one its add dedupe and the "+" button use.
    const rowOf = (mem: PartyMember) => combatants.find((x) => x.isPC && isSamePc(x, mem));
    for (const mem of members) {
      const sheet = sheetById.get(mem.charId);
      if (!sheet) continue;
      const c = rowOf(mem);
      const sv = vitalsFromSheet(sheet, content);
      const key = `${campaignId}|${mem.charId}`;
      const st = seen.get(key) ?? { sheet, shown: sv, arrived: 0, theirs: sv.currentHP };
      if (!seen.has(key)) {
        seen.set(key, st);
      } else if (sheet !== st.sheet) {
        st.sheet = sheet;
        // A read answered (rule E): the player's side moved, and the row follows it; or his newest
        // push came back, which the row follows too — but it is no arrival, since a push of his still
        // out was made on top of it; or a LATE ECHO, which is set aside.
        if (!ours.has(sheet)) {
          // Only the PLAYER's side is a fall (SeenPc.drop): a first sight, a Load, a re-add, an Undo or
          // his own push coming back writes the row too, and none of those is the character going down.
          follow(st, sv);
          st.arrived++;
        } else if (sheet === gmPendingEdit(campaignId, mem.charId)?.sheet) {
          st.shown = sv;
        }
      }
      // NO ROW that is this character's window: none on the board (removed, a Clear, an encounter
      // without them), or one another member answers to as well, which is nobody's (WHICH ROW). The
      // sheet is still followed above — a row added later starts from it — but a fall in it is no fall
      // OF A ROW: whatever row comes next is a re-add, and a re-add is not the character going down
      // (SeenPc.drop). Before 2026-10-13 an arrival here waited for the re-add, which then took it for
      // the fall and moved the new row before whoever was acting.
      if (!c || members.some((o) => o !== mem && rowOf(o) === c)) {
        st.drop = false;
        continue;
      }
      // Taken on every pass that has this character's row, whatever it then decides: a gesture is acted
      // on by the pass that sees it or by nobody (the store forgets it the moment its own dispatch
      // returns, either way).
      const taken: string[] = [];
      const gesture = takeVitalsGesture(c.id, taken);
      const cv = vitalsFromCombatant(c, content);
      const ck = vitalsKey(cv);
      const was = st.want?.v ?? st.out?.v ?? st.shown;
      if (gesture && ck !== vitalsKey(was)) {
        // Rule B: the GM's own change, made on what the row showed. One of his not sent yet on this
        // row carries it along — and the turn-engine steps in it (SPENT STEPS).
        if (st.want?.rowId === c.id) {
          st.want.v = cv;
          st.want.steps = [...(st.want.steps ?? []), ...taken];
        } else st.want = { rowId: c.id, v: cv, on: vitalsKey(was), steps: taken };
      } else if (!gesture && st.want && (st.want.rowId !== c.id || ck !== vitalsKey(st.want.v))) {
        // A load took his unsent change off the row (rules A and B): not his doing, so the sheet wins.
        // A step in it never reached them, and an Undo may bring its turn back: handed back.
        releaseSteps(st.want.steps);
        st.want = undefined;
      }
      const show = st.want?.v ?? st.out?.v ?? st.shown;
      // A fall of theirs is spent on the first pass the row shows their sheet — moving the row if this
      // write takes it down, else (the row already there) moving nothing — and kept while a change of
      // the GM's not sent or out stands over it (SeenPc.drop).
      let dropped = false;
      if (show === st.shown) {
        dropped = !!st.drop;
        st.drop = false;
      }
      // …or when the row still pins a condition that steps with the turn (a board saved before rule B
      // let the engine step a player's Frightened): the same values, written unpinned. The pass that
      // write sets off finds nothing left to write.
      if (ck !== vitalsKey(show) || pinsAStep(c, content)) writeVitals(c.id, show, content, dropped);
      if (st.want && !st.out) {
        const w = (st.out = st.want);
        st.want = undefined;
        void send(mem, st, w).then((rerun) => {
          st.out = undefined;
          if (rerun) again.current();
        });
      }
    }
  }, [seen, ours, campaignId, members, sheetById, content]);

  useEffect(() => {
    alive.current = true;
    again.current = reconcile;
    reconcile();
    const off = useCombatStore.subscribe(reconcile);
    return () => {
      off();
      alive.current = false;
    };
  }, [reconcile]);
}
