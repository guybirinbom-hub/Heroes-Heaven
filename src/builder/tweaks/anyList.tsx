/*
 * "PICK FROM ANY LIST" IN THE PICKERS (Tweaks phase 2, WP5; plan C22, C20, C21, C45).
 *
 * A feat place or a pick-a-feat that refuses a feat for its list, its level or "only at 1st level" can take it
 * anyway through `choice.anyList` — ONE block per broken rule (decision 17: each break its own tweak), all written
 * with the pick in ONE `writeChoiceTweak` after ONE `confirmTweak` (one undo step). This file is the one place that:
 *
 *   - finds the stored allows for a feat (`anyListBlocksFor`), live or paused;
 *   - turns the rules to lift into drafts (`anyListDrafts`): none for a rule a live block lifts, a PAUSED one switched
 *     back on (never listed twice), else a new block;
 *   - asks first and hands back the one-write commit (`confirmAllowHere`) — with the feat's prerequisites too when the
 *     slot picker's row also needs "Take anyway" ("Allow here and take anyway"; that half is the phase-1
 *     `choice.allowAnyway`, written through the same patch);
 *   - draws what sits under a stored pick a book rule refuses (`AnyListNote`): the Tweak mark while an allow covers it
 *     (live, or paused with the book's words beside it), else the book's own grey line (C45).
 *
 * The rule tests themselves are the engine's (`slotRefusal`, `pickRefusal`): this file never decides a rule.
 */
import { useContext, type ReactNode } from 'react';
import type { BlockInstance } from '../../rules/blocks/registry';
import { storedChoiceBlocks } from '../../rules/blocks/active';
import { takeAnywayWrite, writeChoiceTweak, writeTweak, type ChoiceDraft, type TweakHost } from '../../rules/blocks/write';
import type { SlotRefusal, SlotRule } from '../../rules/choiceRefusal';
import type { BuildOverrides, CharacterOptions } from '../../rules/types';
import { confirmTweak } from './confirmTweak';
import { BookGreyLine, ShowTweakContext, notSaved } from './takeAnyway';
import { TweakMark, tweakMarkState } from './TweakMark';

type Host = { overrides?: BuildOverrides; options?: CharacterOptions };
const KIND = 'choice.anyList';

/** The stored `choice.anyList` blocks for a feat, any state (broken ones never). */
export function anyListBlocksFor(host: Host, featId: string): BlockInstance[] {
  return storedChoiceBlocks(host).filter((b) => b.kind === KIND && b.record === featId && !b.broken);
}

/** The drafts that lift `rules` for a feat: none for a rule a live block already lifts, a paused one switched back
 *  on, else a new block. */
export function anyListDrafts(host: Host, featId: string, rules: readonly SlotRule[]): ChoiceDraft[] {
  const mine = anyListBlocksFor(host, featId);
  const out: ChoiceDraft[] = [];
  for (const rule of new Set(rules)) {
    const same = mine.filter((b) => b.params?.rule === rule);
    if (same.some((b) => tweakMarkState(host, b) === 'live')) continue;
    out.push(same[0] ? { key: same[0].key, kind: KIND, on: true } : { kind: KIND, record: featId, fields: { rule } });
  }
  return out;
}

/** Can "Allow here" take this feat? Every refusal liftable (a mythic / impulse place's rule and the cap never are). */
export const allowable = (refusals: readonly SlotRefusal[]): boolean => refusals.length > 0 && refusals.every((r) => r.liftable);

/**
 * Ask ("Allow X here?", one line per broken rule — plus the unmet prerequisites when `takeAnyway` names them), then
 * hand back the ONE build that holds the allows, the pick (`pick`) and, for "Allow here and take anyway", the
 * prerequisites' "Take anyway". Resolves null when the player cancels or the write is refused (said: "Not saved").
 * `host` is the build the picker drew; the returned function writes again on the build the `set` hands it and keeps
 * that build whole if it refuses there.
 */
export async function confirmAllowHere<B extends TweakHost & Host>(opts: {
  name: string;
  featId: string;
  refusals: readonly SlotRefusal[];
  host: B;
  undoHint?: string;
  /** The prerequisites the feat also breaks (the slot picker's Take anyway half); absent = Allow here only. */
  takeAnyway?: string;
}): Promise<((build: B, pick: (b: B) => B) => B) | null> {
  const rules = opts.refusals.map((r) => r.rule);
  const words = opts.refusals.map((r) => r.words);
  const ok = await confirmTweak({ name: opts.name, rules: opts.takeAnyway ? [...words, opts.takeAnyway] : words, action: 'allow', undoHint: opts.undoHint });
  if (!ok) return null;
  const write = (build: B, pick: (b: B) => B) =>
    writeChoiceTweak(build, anyListDrafts(build, opts.featId, rules), (b) => {
      let next = b;
      if (opts.takeAnyway) {
        const w = takeAnywayWrite(next, opts.featId);
        const r = w ? writeTweak(next, w) : null;
        if (r && !r.refused) next = { ...next, overrides: r.overrides };
      }
      return pick(next);
    });
  const tried = write(opts.host, (b) => b);
  if (tried.refused) {
    void notSaved(tried.refused);
    return null;
  }
  return (build, pick) => {
    const r = write(build, pick);
    return r.refused ? build : r.build;
  };
}

/**
 * What sits under a stored feat a book rule refuses (`refusals` from the engine, without the tweak; empty = the book
 * allows it): the Tweak mark while an allow covers every rule (live: "Tweak"; paused: "Tweak paused" with the book's
 * words), else the book's grey line — with Tweaks switched off, or no allow at all (C45). `bookLine` is what the
 * caller already draws for the uncovered case (the slot card's "Not valid for this slot" note); absent, the grey line.
 */
export function AnyListNote({ host, featId, refusals, bookLine }: { host: Host; featId: string; refusals: readonly SlotRefusal[]; bookLine?: ReactNode }): ReactNode {
  const showAt = useContext(ShowTweakContext);
  if (!refusals.length) return null;
  const words = refusals.map((r) => r.words).join('; ');
  const mine = anyListBlocksFor(host, featId).filter((b) => refusals.some((r) => r.rule === b.params?.rule));
  const states = mine.map((b) => tweakMarkState(host, b));
  const covered = allowable(refusals) && refusals.every((r) => mine.some((b) => b.params?.rule === r.rule));
  const state = !covered || states.includes('off') ? 'off' : states.includes('paused') ? 'paused' : 'live';
  if (state === 'off') return bookLine ?? <BookGreyLine rule={words} />;
  const first = mine.find((b) => tweakMarkState(host, b) === state) ?? mine[0];
  return (
    <>
      <div className="tw-pick-note" data-anylist={state}>
        <TweakMark kind={KIND} state={state} rule={words} reason={first?.reason} bookWarning={state === 'paused' ? words : undefined} onShow={showAt && first ? () => showAt(first.key) : undefined} />
      </div>
      {state === 'paused' && bookLine}
    </>
  );
}
