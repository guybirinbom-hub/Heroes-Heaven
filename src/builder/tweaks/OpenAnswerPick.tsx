/*
 * ONE ANSWER OF AN OPEN CHOICE (renderChoice's open branch: "any common language", "a cantrip from a tradition
 * other than your own"…), with the Tweaks phase 2 WP4 parts for an open SPELL choice (Adapted Cantrip, Adaptive
 * Adept; plan WP4 rev 3):
 *
 *   - "Show spells of other traditions" (Tweaks page on, default off) reveals the spells `openChoiceOptions` filters
 *     out by tradition (`excludeOwnTraditions`, the `sameTraditionAsAnswerOf` arm), greyed with their reason and
 *     "Take anyway"; "already your … cantrip" (a no-op grey) and a spell above the rank are never offered a button;
 *   - a live `spell` allow lifts the tradition rules (offered, never marked), and its answer carries the Tweak mark;
 *   - a kept answer the rule does not allow keeps its line under the control (Q27), with "Take anyway" while the
 *     Tweaks page is on.
 *
 * With the Tweaks page off, or for any other open choice, it renders exactly what the branch rendered before
 * (C45 adds only the greyed look of a barred kept answer's name).
 *
 * `openSpellTweak` + `OpenAnswerNote` are the same parts for the GRANTED-feat open choice (Builder's
 * `grantedChoicePicker`, a PopupSelect over `grantedFeatChoices`; WP4 finish B1): one answer path's rules, two
 * controls, never a second look.
 */
import { useState } from 'react';
import { allowedInPicker } from '../../rules/blocks/active';
import { tweaksPageOn } from '../../rules/blocks/stored';
import type { BuildState } from '../../rules/build';
import { openChoiceOptions, OPEN_SOURCE_LABEL, type OpenOption } from '../../rules/openChoice';
import type { Character, ContentDatabase, FeatChoiceDef } from '../../rules/types';
import { openOptionsWithRecords, SearchSelect, type BuilderActions } from '../shared';
import { anyPickerBlock, BookGreyLine, confirmTakeAnyway, StoredPickNote, type AnyPickerKey, type Breakable } from './takeAnyway';
import { tweakMarkState } from './TweakMark';

/** The tweak parts of one open SPELL answer (empty-handed for any other open choice). */
export interface OpenSpellTweak {
  /** The choice can be lifted at all: an open spell choice with a tradition rule. */
  liftable: boolean;
  /** Every option the picker lists (the reveal's greyed ones included), the kept answers kept. */
  all: OpenOption[];
  /** The answers the choice holds (kept, never greyed for the plain pick). */
  kept: ReadonlySet<string>;
  /** The picker's `breakable` (Tweaks page on, an open spell choice only). */
  breakable: Breakable | undefined;
  /** The kept answer the rule does not allow (Q27), when it is one. */
  barred: OpenOption | undefined;
  /** "Take anyway" for the STORED answer (writes the tweak only). */
  takeStored: () => void;
  /** The stored answer's allow and the book's words for its mark (while a tweak covers it), else undefined. */
  key: AnyPickerKey | null;
  markRule: string | undefined;
  tweaksOn: boolean;
}

export function openSpellTweak(o: {
  def: FeatChoiceDef;
  /** Every answer of the choice (a multi-pick asks one control per key), and THIS control's answer. */
  answers: (string | null | undefined)[];
  answer: string | null | undefined;
  build: BuildState;
  content: ContentDatabase;
  character: Character;
  revealing: boolean;
  undoHint: string;
  actions: BuilderActions;
  /** Where the answer is stored: the pure write of `id` as this control's answer. */
  write: (b: BuildState, id: string) => BuildState;
}): OpenSpellTweak {
  const { def, answers, answer, build, content, character, actions } = o;
  const from = def.from;
  const spell = from?.type === 'spell';
  const tweaksOn = tweaksPageOn(build);
  const liftable = spell && !!(from?.excludeOwnTraditions || from?.sameTraditionAsAnswerOf);
  const kept = new Set(answers.filter((a): a is string => !!a));
  // `keep`: a stored answer stays in its own picker (Adapted Cantrip's allegro from before its no-tradition rule,
  // 2026-10-15) instead of reading blank. A spell a live "Take anyway" names passes the tradition rules (WP4).
  const all = openChoiceOptions(from, content, {
    hideLegacy: build.hideLegacy,
    character,
    keep: answers,
    ...(spell ? { allowed: (id: string) => allowedInPicker(build, 'spell', id) } : {}),
    ...(tweaksOn && liftable && o.revealing ? { reveal: true } : {}),
  });
  // The BOOK's reason against a spell, whatever a tweak says (the mark's words and the confirm's): the picker's own
  // reason with the spell not kept and every filtered spell revealed.
  const bookWhy = (id: string): string | undefined =>
    openChoiceOptions(from, content, { hideLegacy: build.hideLegacy, character, keep: answers.filter((a) => a !== id), reveal: true }).find((x) => x.id === id && x.liftable)?.notAllowed;
  const take = async (id: string, pick: boolean) => {
    const rule = bookWhy(id);
    if (!rule) return;
    const write = await confirmTakeAnyway<BuildState>({ name: content.spells[id]?.name ?? id, rule, undoHint: o.undoHint, k: { picker: 'spell', record: id }, host: build });
    if (!write) return;
    actions.patch((b) => write(b, pick ? (x) => o.write(x, id) : (x) => x));
  };
  // A kept answer the rule does not allow says so UNDER the control, where the player looks — not only inside the
  // picker (Q27, checker 2026-10-15).
  const barred = all.find((x) => x.id === answer && x.notAllowed);
  const key: AnyPickerKey | null = spell && answer ? { picker: 'spell', record: answer } : null;
  const block = key ? anyPickerBlock(build, key) : undefined;
  const state = block ? tweakMarkState(build, block) : 'off';
  return {
    liftable,
    all,
    kept,
    tweaksOn,
    breakable:
      tweaksOn && spell
        ? {
            reasonOf: (id) => {
              const x = all.find((y) => y.id === id);
              return x?.liftable && !kept.has(id) ? x.notAllowed : null;
            },
            onTakeAnyway: (id) => void take(id, true),
          }
        : undefined,
    barred,
    takeStored: () => void (answer && take(answer, false)),
    key,
    markRule: block && state !== 'off' && answer ? bookWhy(answer) : undefined,
  };
}

/** Under the control: the Tweak mark while a tweak covers the answer, else the barred answer's line (Q27). */
export function OpenAnswerNote({ t, build }: { t: OpenSpellTweak; build: BuildState }) {
  if (t.markRule) return <StoredPickNote host={build} k={t.key} rule={t.markRule} onTakeAnyway={t.tweaksOn ? t.takeStored : undefined} />;
  if (!t.barred?.notAllowed) return null;
  return (
    <BookGreyLine
      barred
      rule={t.barred.notAllowed}
      act={
        t.tweaksOn && t.barred.liftable ? (
          <button type="button" className="pick-add tw-break-act" onClick={t.takeStored}>
            Take anyway
          </button>
        ) : undefined
      }
    />
  );
}

export function OpenAnswerPick({
  def,
  k,
  keys,
  label,
  build,
  content,
  character,
  actions,
  undoHint,
}: {
  def: FeatChoiceDef;
  /** This answer's key; `keys` every key of the choice (a multi-pick asks one control per key). */
  k: string;
  keys: string[];
  label: string;
  build: BuildState;
  content: ContentDatabase;
  character: Character;
  actions: BuilderActions;
  undoHint: string;
}) {
  const [reveal, setReveal] = useState(false);
  const from = def.from;
  const answers = keys.map((kk) => build.featChoices[kk]);
  const answer = build.featChoices[k];
  const t = openSpellTweak({
    def,
    answers,
    answer,
    build,
    content,
    character,
    revealing: reveal,
    undoHint,
    actions,
    write: (x, id) => ({ ...x, featChoices: { ...x.featChoices, [k]: id } }),
  });
  const i = keys.indexOf(k);
  const taken = new Set(def.distinct ? answers.filter((a, j) => j !== i && a) : []);
  const options = openOptionsWithRecords(
    t.all.filter((o) => !taken.has(o.id)),
    from,
  ).map((o) => (o.liftable && o.notAllowed && !t.kept.has(o.id) ? { ...o, disabled: o.notAllowed } : o));
  return (
    <>
      <SearchSelect
        bare
        label={label}
        // NOT the raw `from.type` — that printed the slug at the player ("Search own-deity-spell…") on sixteen records.
        placeholder={`Search ${OPEN_SOURCE_LABEL[from?.type ?? ''] ?? 'options'}…`}
        value={answer ?? null}
        onChange={(v) => actions.setFeatChoice(k, v)}
        options={options}
        breakable={t.breakable}
        reveal={t.tweaksOn && t.liftable ? { label: 'Show spells of other traditions', on: reveal, onToggle: setReveal } : undefined}
        grey={!!t.barred}
      />
      <OpenAnswerNote t={t} build={build} />
    </>
  );
}
