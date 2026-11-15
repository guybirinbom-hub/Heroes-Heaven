/*
 * "TAKE ANYWAY" IN THE OTHER PICKERS (Tweaks phase 2, WP4; plan work/tweaks-phase2-notes/plan.md WP4, C19-C21, C45).
 * The heritage, background, deity, both subclass pickers, the spell pickers and a sanctification the deity refuses
 * all take a pick past a book rule through ONE stored kind, `choice.allowAnywayAnyPicker` (picker + record; a
 * subclass names its class, a sanctification its answer). This file is the one place that:
 *
 *   - finds the stored allow for a pick (`anyPickerBlock`) — live first, else a paused one;
 *   - turns "take this anyway" into drafts (`anyPickerDrafts`): none when a live allow exists, a PAUSED one switched
 *     back on (never listed twice, like the feat picker's `takeAnywayWrite`), else a new one;
 *   - asks first (`confirmTweak`) and commits the pick and the tweak as ONE write (`writeChoiceTweak`) — one undo step;
 *   - draws what sits under a stored pick (`StoredPickNote`): the Tweak mark while a tweak covers it, else the book's
 *     grey line (C45: on, paused, Tweaks off, no block at all — the name always shows, never the placeholder).
 *
 * The skill increase (per place and per rule) is WP12, after the record rebuild (WP13: no such picker here); never this file.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useIsMobile, useShowUndoButtons } from '../../sheet/useIsMobile';
import type { BlockInstance } from '../../rules/blocks/registry';
import { storedChoiceBlocks } from '../../rules/blocks/active';
import { writeChoiceTweak, type ChoiceDraft, type TweakHost } from '../../rules/blocks/write';
import type { BuildOverrides, CharacterOptions } from '../../rules/types';
import { chooseDialog } from '../../sheet/confirm';
import type { BreakAction } from './choiceParts';
import { confirmTweak } from './confirmTweak';
import { TweakMark, tweakMarkState } from './TweakMark';

/**
 * How a player takes back a pick they took anyway, in the words of the device they hold. Desktop keeps
 * its Ctrl+Z sentence; a phone has no keyboard, and its Undo arrows are hidden unless the player turned
 * them on in Settings (the owner's setting — 'auto' is desktop-only), so it names what is really there.
 * (Moved here from Builder.tsx, which re-exports it, so the Setup pickers in shared.tsx use the same words.)
 */
export function tweakUndoHint(isMobile: boolean, showUndoButtons: boolean, what: 'feat' | 'pick' = 'feat'): string {
  if (!isMobile) return 'You can undo with Ctrl+Z.';
  if (showUndoButtons) return 'You can undo it with the Undo arrow at the top.';
  return what === 'feat' ? 'Changed your mind? Clear the feat with the ✕ on its slot.' : 'Changed your mind? Pick another one, or remove the tweak on the Tweaks page.';
}

/** `tweakUndoHint` for a picker's pick (not a feat slot), on the device this component renders on. */
export function useTweakUndoHint(): string {
  return tweakUndoHint(useIsMobile(), useShowUndoButtons(), 'pick');
}

/** A picker's "Take anyway" door (WP4): the RULE reason an option is greyed for (null / undefined for a no-op grey
 *  or an allowed option — no button), and what pressing "Take anyway" does. Absent = the picker renders as before. */
export interface Breakable {
  reasonOf: (id: string) => string | null | undefined;
  onTakeAnyway: (id: string) => void;
  /** The button's words (WP5: a feat list's "Allow here"); default "Take anyway". */
  action?: BreakAction;
}

/** A picker's reveal switch ("Show heritages of other ancestries"), default off; shown only with Tweaks on. */
export interface PickerReveal {
  label: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}

/** The reveal switch, under a picker's search box. */
export function RevealToggle({ reveal }: { reveal: PickerReveal }) {
  return (
    <label className="tw-reveal" data-reveal={reveal.on ? 'on' : 'off'}>
      <input type="checkbox" checked={reveal.on} onChange={(e) => reveal.onToggle(e.target.checked)} />
      <span>{reveal.label}</span>
    </label>
  );
}

export type AnyPicker = 'heritage' | 'background' | 'deity' | 'subclass' | 'spell' | 'sanctification';

/** One pick a picker can take anyway: the picker, the record, and a subclass's class / a sanctification's answer. */
export interface AnyPickerKey {
  picker: AnyPicker;
  record: string;
  classId?: string;
  value?: string;
}

type Host = { overrides?: BuildOverrides; options?: CharacterOptions };

const KIND = 'choice.allowAnywayAnyPicker';

function matches(b: BlockInstance, k: AnyPickerKey): boolean {
  if (b.kind !== KIND || b.broken) return false;
  const p = b.params ?? {};
  if (p.picker !== k.picker || p.record !== k.record) return false;
  if (k.picker === 'subclass' && p.classId !== k.classId) return false;
  if (k.picker === 'sanctification' && p.value !== k.value) return false;
  return true;
}

/** The stored allow for this pick, a live one first, else a paused one (undefined when none). */
export function anyPickerBlock(host: Host, k: AnyPickerKey): BlockInstance | undefined {
  const mine = storedChoiceBlocks(host).filter((b) => matches(b, k));
  return mine.find((b) => tweakMarkState(host, b) === 'live') ?? mine[0];
}

/** The drafts that allow this pick: none while a live allow covers it, the paused one switched back on, else a new one. */
export function anyPickerDrafts(host: Host, k: AnyPickerKey): ChoiceDraft[] {
  const b = anyPickerBlock(host, k);
  if (b && tweakMarkState(host, b) === 'live') return [];
  const fields: Record<string, unknown> = { picker: k.picker, record: k.record };
  if (k.picker === 'subclass') fields.classId = k.classId;
  if (k.picker === 'sanctification') fields.value = k.value;
  return b ? [{ key: b.key, kind: KIND, on: true }] : [{ kind: KIND, fields }];
}

/**
 * Ask, then hand back the ONE build that holds the pick and its tweak (`pick` applies the pick to the build after
 * the tweak). Resolves null when the player cancels or the write is refused. The caller commits the result in one
 * `set` (one undo step).
 *
 * `host` is the build the picker drew: the write is tried on it first, and a refusal says so ("Not saved: …", as the
 * Tweaks page does — WP4 finish, C4) instead of closing the picker with nothing changed and nothing said. The
 * returned function writes again on the build the `set` hands it, and keeps that build whole if it refuses there.
 */
export async function confirmTakeAnyway<B extends TweakHost & Host>(opts: {
  name: string;
  rule: string;
  undoHint?: string;
  k: AnyPickerKey;
  host: B;
}): Promise<((build: B, pick: (b: B) => B) => B) | null> {
  const ok = await confirmTweak({ name: opts.name, rules: opts.rule, undoHint: opts.undoHint });
  if (!ok) return null;
  const tried = writeChoiceTweak(opts.host, anyPickerDrafts(opts.host, opts.k));
  if (tried.refused) {
    void notSaved(tried.refused);
    return null;
  }
  return (build, pick) => {
    const r = writeChoiceTweak(build, anyPickerDrafts(build, opts.k), pick);
    return r.refused ? build : r.build;
  };
}

/** A refused write, said where the player is (a picker has no notice line of its own): "Not saved: <why>". */
export function notSaved(why: string): Promise<string | null> {
  return chooseDialog({ title: 'Not saved', message: `Not saved: ${why}`, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
}

/** The Builder's "Show in Tweaks" (C28): opens the Tweaks page on one row by its key. Provided once by the Builder,
 *  so every mark under a picker (Setup, level pages, open answers) offers it without threading a prop. */
export const ShowTweakContext = createContext<((key: string) => void) | undefined>(undefined);

/**
 * What sits under a stored pick a book rule refuses (`rule`, null when the book allows it): the Tweak mark while a
 * tweak covers it (live, or paused with the book's warning beside it), else the book's own grey line — with Tweaks
 * switched off, or no tweak at all (C45). Draws nothing for a pick the book allows.
 */
export function StoredPickNote({
  host,
  k,
  rule,
  onShow,
  onTakeAnyway,
}: {
  host: Host;
  k: AnyPickerKey | null;
  rule: string | null | undefined;
  onShow?: () => void;
  /** With the Tweaks page on: "Take anyway" for the STORED pick (writes the tweak only). Not while one is live. */
  onTakeAnyway?: () => void;
}): ReactNode {
  const showAt = useContext(ShowTweakContext);
  if (!k || !rule) return null;
  const b = anyPickerBlock(host, k);
  const state = b ? tweakMarkState(host, b) : 'off';
  const act = onTakeAnyway && state !== 'live' && (
    <button type="button" className="pick-add tw-break-act" onClick={onTakeAnyway}>
      Take anyway
    </button>
  );
  if (b && state !== 'off')
    return (
      <div className="tw-pick-note">
        <TweakMark kind={KIND} state={state} rule={rule} reason={b.reason} bookWarning={state === 'paused' ? rule : undefined} onShow={onShow ?? (showAt ? () => showAt(b.key) : undefined)} />
        {act}
      </div>
    );
  return <BookGreyLine rule={rule} act={act || undefined} />;
}

/**
 * THE one look for "the book refuses this stored pick" (WP4 finish, C7): the line a kept open answer the rule does
 * not allow has always drawn under its control (`choice-inert`, the warning triangle), now also under every
 * Setup card, answer and spell row a stored pick breaks a rule on. `barred` keeps the open answer's own marker.
 */
export function BookGreyLine({ rule, act, barred = false }: { rule: string; act?: ReactNode; barred?: boolean }) {
  return (
    <div className="choice-inert tw-book-grey" data-book-grey {...(barred ? { 'data-choice-barred': '' } : {})}>
      <i className="ti ti-alert-triangle" aria-hidden="true" />
      <span className="tw-book-grey-why">{rule}</span>
      {act}
    </div>
  );
}

/** Is the stored pick shown greyed (C45)? A book rule refuses it and no LIVE tweak covers it. */
export function storedPickGrey(host: Host, k: AnyPickerKey | null, rule: string | null | undefined): boolean {
  if (!k || !rule) return false;
  const b = anyPickerBlock(host, k);
  return !b || tweakMarkState(host, b) !== 'live';
}
