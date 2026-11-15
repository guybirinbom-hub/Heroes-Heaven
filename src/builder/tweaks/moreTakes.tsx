/*
 * "TAKE A FEAT MORE TIMES" IN THE BUILDER (Tweaks phase 2, WP8; plan work/tweaks-phase2-notes/plan.md WP8, C5, C21,
 * C23, C28, C44; the orchestrator's decisions D1-D4 in state.md "## WP8 + WP9 chat").
 *
 * ONE `choice.moreTakes` block per feat (D1: the write door's identity is the record; `times` is an amount). This
 * file is the one place that:
 *
 *   - finds the stored blocks for a feat (`moreTakesBlocksFor`), live or paused (broken ones never);
 *   - plans a "Take again" (`takeAgainPlan`): a new block `{record, times}` or the LIVE block's `times` raised —
 *     never a second block, never offered while the feat's block is paused (the player turns that one on instead);
 *   - asks first and hands back the one-write commit (`confirmTakeAgain`): the pick (through `withFeat`, C44) AND
 *     the block change in ONE `writeChoiceTweak` — one undo step; a refused write is said ("Not saved");
 *   - names which slot copies a moreTakes tweak is about (`moreTakesSlotMarks`), READ OFF THE BUILT CHARACTER, never
 *     guessed: live, the copies past the book's cap in the featPicks loop's own order (the character's rows); paused,
 *     the copies the loop dropped (a stored pick with no row);
 *   - draws the mark under such a copy's slot card (`MoreTakesNote`).
 *
 * The cap itself is the engine's (featGrants.ts `takesAllowed`, at the featPicks loop, `slotRefusal` and `slotKept`).
 */
import { useContext, type ReactNode } from 'react';
import { storedChoiceBlocks } from '../../rules/blocks/active';
import { featIdAtSlot, heldFeatSlots } from '../../rules/heldFeats';
import type { BlockInstance } from '../../rules/blocks/registry';
import { writeChoiceTweak, type ChoiceDraft, type TweakHost } from '../../rules/blocks/write';
import { buildCharacter, type BuildState } from '../../rules/build';
import { maxTakes } from '../../rules/featGrants';
import { featCopiesHeld, TAKEN_WORDS, type SlotRefusal } from '../../rules/featSlots';
import type { BuildOverrides, Character, CharacterOptions, ContentDatabase } from '../../rules/types';
import { confirmTweak } from './confirmTweak';
import { ShowTweakContext, notSaved } from './takeAnyway';
import { TweakMark, tweakMarkState, type TweakMarkState } from './TweakMark';

type Host = { overrides?: BuildOverrides; options?: CharacterOptions };
const KIND = 'choice.moreTakes';
/** The most `times` one block stores (stored.ts `isWhole(1, 9)`). */
export const MAX_MORE_TIMES = 9;

/** The rule a more-taken copy breaks, in the slot card's and the mark's words. */
export const MORE_TAKES_RULE = 'Taken more times than the feat allows';
/** A dropped copy's words while its tweak is paused (plan section 3, row "moreTakes"). */
export const MORE_TAKES_PAUSED = `${MORE_TAKES_RULE} — tweak paused`;

/** The stored `choice.moreTakes` blocks for a feat, in stored order, any state (broken ones never). */
export function moreTakesBlocksFor(host: Host, featId: string): BlockInstance[] {
  return storedChoiceBlocks(host).filter((b) => b.kind === KIND && b.record === featId && !b.broken);
}

const timesOf = (b: BlockInstance | undefined): number => (typeof b?.params?.times === 'number' ? b.params.times : 0);

/** What "Take again" would write for `featId` into slot `slotKey` (D1, D4): the draft and the count it ends at, or why
 *  it is not offered. The count is the one the STORAGE view needs (C9: a paused extra place's copy still takes a cap
 *  place, or resuming it would break this pick): every copy held outside this slot, plus this one, past the book. */
export type TakeAgainPlan = { draft: ChoiceDraft; times: number; raised: boolean } | { refused: string };
export function takeAgainPlan(host: BuildState, content: ContentDatabase, featId: string, slotKey: string): TakeAgainPlan {
  const mine = moreTakesBlocksFor(host, featId);
  const live = mine.find((b) => tweakMarkState(host, b) === 'live');
  if (!live && mine.some((b) => tweakMarkState(host, b) === 'paused'))
    return { refused: 'Already taken — its “Take a feat more times” tweak is paused: turn it on on the Tweaks page' };
  if (!live && mine.length) return { refused: 'Already taken' }; // Tweaks switched off: the caller offers nothing
  const book = maxTakes(content.feats[featId]);
  const elsewhere = featCopiesHeld(host, content, featId) - (featIdAtSlot(host, slotKey) === featId ? 1 : 0);
  const needed = elsewhere + 1 - book;
  const times = Math.max(timesOf(live) + 1, needed, 1);
  if (times > MAX_MORE_TIMES) return { refused: `Already taken — a feat can be taken at most ${MAX_MORE_TIMES} more times` };
  return live
    ? { draft: { key: live.key, kind: KIND, fields: { times } }, times, raised: true }
    : { draft: { kind: KIND, record: featId, fields: { times } }, times, raised: false };
}

/**
 * Ask ("Take Fleet again?") and hand back the ONE build that holds the block change and the pick (`pick`: the slot
 * write, through `withFeat`). Resolves null when the player cancels or the write is refused (said: "Not saved").
 * `host` is the build the picker drew; the returned function plans and writes again on the build `set` hands it, and
 * keeps that build whole when it refuses there — handing the refusal back (`refused`) for the caller to say.
 */
export async function confirmTakeAgain<B extends TweakHost & BuildState>(opts: {
  name: string;
  featId: string;
  slotKey: string;
  host: B;
  content: ContentDatabase;
  undoHint?: string;
}): Promise<TakeAgainCommit<B> | null> {
  const plan = takeAgainPlan(opts.host, opts.content, opts.featId, opts.slotKey);
  if ('refused' in plan) {
    void notSaved(plan.refused);
    return null;
  }
  const ok = await confirmTweak({ name: opts.name, ...takeAgainWords(opts.name, opts.content, opts.featId, plan), action: 'again', undoHint: opts.undoHint });
  if (!ok) return null;
  const write = (build: B, pick: (b: B) => B) => {
    const p = takeAgainPlan(build, opts.content, opts.featId, opts.slotKey);
    if ('refused' in p) return { build, refused: p.refused };
    return writeChoiceTweak(build, [p.draft], pick);
  };
  const tried = write(opts.host, (b) => b);
  if (tried.refused) {
    void notSaved(tried.refused);
    return null;
  }
  // WP8 round 4 (F2): the plan is worked out again on the build the commit is handed (it may have changed while the
  // confirm was open). A refusal there keeps that build whole AND is handed back, so the caller says it and keeps
  // the picker open.
  return (build, pick) => {
    const r = write(build, pick);
    return r.refused ? { build, refused: r.refused } : { build: r.build };
  };
}

/**
 * The "Take Fleet again?" box's rule lines and its note's first sentence (WP8 round 4, B1). Take again records ONE
 * tweak — a new "Take a feat more times" — or raises the count of the one there is; never "one per rule".
 */
export function takeAgainWords(name: string, content: ContentDatabase, featId: string, plan: Exclude<TakeAgainPlan, { refused: string }>): { rules: string[]; records: string } {
  const book = maxTakes(content.feats[featId]);
  const more = `${plan.times} more time${plan.times === 1 ? '' : 's'}`;
  const rule = `Already taken: the feat allows ${book === 1 ? 'one copy' : `${book} copies`}`;
  return plan.raised
    ? { rules: [rule, `Your “Take a feat more times” tweak for it goes to ${more}`], records: `This raises your “Take a feat more times” tweak for ${name} to ${more}` }
    : { rules: [rule, `This lets you take it ${more}`], records: 'This records 1 tweak' };
}

/** What a Take again commit hands back: the build to keep, and why the write was refused on it (nothing changed). */
export type TakeAgainCommit<B> = (build: B, pick: (b: B) => B) => { build: B; refused?: string };

/** `build` with every stored "Take a feat more times" switched off — a scratch copy to measure against (never stored,
 *  never written: the Builder keeps its own build). Every other stored entry is the same object. */
function withMoreTakesPaused(build: BuildState): BuildState {
  const list = build.overrides?.blocks;
  if (!Array.isArray(list)) return build;
  const blocks = list.map((e) => (e && typeof e === 'object' && (e as { kind?: unknown }).kind === KIND ? { ...e, on: false } : e));
  return { ...build, overrides: { ...build.overrides, blocks } as BuildOverrides };
}

/** One slot copy a moreTakes tweak is about: the block, and its mark state. */
export interface MoreTakesMark {
  block: BlockInstance;
  state: Exclude<TweakMarkState, 'off'>;
}

/**
 * The slot copies to mark, by slot key (C28), READ OFF THE ENGINE (`character` = buildCharacter of `build`), never
 * guessed from the slot order (the character's rows are sorted after the loop, so their order is not the loop's):
 *   - a LIVE block: the slot copies that have a row now and NONE in the same build with the moreTakes tweaks paused
 *     (built once, only while a live one exists) — exactly the copies a pause would drop;
 *   - a PAUSED block (and no live one): the stored slot picks the loop DROPPED — at or below the character's level, a
 *     live place, the feat known, and no row under that key (the cap is the only other reason a row is missing);
 *   - Tweaks switched off: nothing (the book's own display, C28).
 */
export function moreTakesSlotMarks(build: BuildState, content: ContentDatabase, character: Pick<Character, 'feats'> | null | undefined): Map<string, MoreTakesMark> {
  const out = new Map<string, MoreTakesMark>();
  const blocks = storedChoiceBlocks(build).filter((b) => b.kind === KIND && !b.broken && typeof b.record === 'string');
  if (!blocks.length || !character) return out;
  const rows = character.feats ?? [];
  let bookRows: Character['feats'] | undefined;
  const bookKeys = (featId: string) => {
    bookRows ??= buildCharacter(withMoreTakesPaused(build), content).feats ?? [];
    return new Set(bookRows.filter((r) => r.featId === featId && r.slotKey).map((r) => r.slotKey!));
  };
  for (const featId of new Set(blocks.map((b) => b.record as string))) {
    const mine = blocks.filter((b) => b.record === featId);
    const live = mine.find((b) => tweakMarkState(build, b) === 'live');
    if (live) {
      const kept = bookKeys(featId);
      for (const r of rows) if (r.featId === featId && r.slotKey && !kept.has(r.slotKey)) out.set(r.slotKey, { block: live, state: 'live' });
      continue;
    }
    const paused = mine.find((b) => tweakMarkState(build, b) === 'paused');
    if (!paused || !content.feats[featId]) continue;
    const rowKeys = new Set(rows.filter((r) => r.featId === featId && r.slotKey).map((r) => r.slotKey!));
    // The slot takings of the live view (heldFeats.ts: a held-back extra place's taking is not listed — that copy
    // keeps its own words, it is not this tweak's).
    for (const s of heldFeatSlots(build, undefined, { via: ['slot'] })) {
      if (s.featId !== featId || rowKeys.has(s.slotKey)) continue;
      if (!Number.isFinite(s.level) || s.level > (build.level ?? 1)) continue;
      out.set(s.slotKey, { block: paused, state: 'paused' });
    }
  }
  return out;
}

/**
 * WP8 round 4 (B2; the orchestrator's decision): with Tweaks on and the feat's "Take a feat more times" PAUSED (none
 * live), the copy that still COUNTS — it has a row under its own slot key — shows no "Not valid for this slot" note
 * when the cap ("Already taken") is the ONLY rule its slot refuses it for. Only the copy the engine drops keeps the
 * note, with its paused words (`moreTakesSlotMarks`). Tweaks off (no block reads paused): false, the book's display.
 * A copy held back only by a paused extra place keeps its own words (they are not `TAKEN_WORDS`).
 */
export function pausedMoreTakesCountingCopy(
  build: BuildState,
  character: Pick<Character, 'feats'> | null | undefined,
  slotKey: string,
  featId: string,
  refusals: readonly SlotRefusal[],
): boolean {
  if (!refusals.length || !refusals.every((r) => r.rule === 'taken' && r.words === TAKEN_WORDS)) return false;
  const states = moreTakesBlocksFor(build, featId).map((b) => tweakMarkState(build, b));
  if (!states.includes('paused') || states.includes('live')) return false;
  return !!character?.feats?.some((r) => r.featId === featId && r.slotKey === slotKey);
}

/** The mark under a more-taken copy's slot card: live "Tweak" (the rule, the reason, Show in Tweaks); paused "Tweak
 *  paused" with "Taken more times than the feat allows — tweak paused". Nothing for a copy no tweak is about. */
export function MoreTakesNote({ mark }: { mark: MoreTakesMark | undefined }): ReactNode {
  const showAt = useContext(ShowTweakContext);
  if (!mark) return null;
  return (
    <div className="tw-pick-note" data-more-takes={mark.state}>
      <TweakMark
        kind={KIND}
        state={mark.state}
        rule={MORE_TAKES_RULE}
        reason={mark.block.reason}
        bookWarning={mark.state === 'paused' ? MORE_TAKES_PAUSED : undefined}
        onShow={showAt ? () => showAt(mark.block.key) : undefined}
      />
    </div>
  );
}
