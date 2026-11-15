/*
 * THE SEVEN CHOICE PARTS AND THE SHARED CHOICE LOOK (Tweaks phase 2, WP2; plan section 2b, C48). Each part is
 * built once and named by the registry's `editor.parts` (picker, place, rule, count, question, answer, options),
 * on the same `div.tw-part[data-part]` root as the eight phase-1 parts in ./parts.tsx. Below them, the three
 * pieces WP4-WP14 put on the Builder's own screens: the breakable picker row, the kept-answer row and the
 * extra-place card (a normal slot card + the Tweak chip). WP2 built them. WP13: the values a deferred work package
 * owns (a skill-increase picker, the class-choice, tactic and rune places) come after the record rebuild, so no
 * part here offers or labels them.
 */
import { useState, type ReactNode } from 'react';
import { ADD_PLACES, ANY_PICKERS, ATTRIBUTE_IDS, BOOST_SETS, FEAT_PLACE_CATEGORIES, REMOVE_PLACES, REMOVE_SKILL_LANES, ruleWords } from '../../rules/blocks/registry';
import { ABILITY_NAME, loreName } from '../../rules/blocks/names';
import { COMMA_REFUSAL, answerHasComma } from '../../rules/blocks/stored';
import { loreKey } from '../../rules/loreKey';
import { SKILLS } from '../../rules/types';
import { DraftNumberInput } from '../DraftNumberInput';
import { PopupSelect, SearchSelect, cap } from '../shared';
import { DraftText, Part, PartNote, type PartOption } from './parts';

/* ─────────────── the seven choice parts ─────────────── */

/** The picker a "Take anyway" reaches, in words. */
export const PICKER_LABEL: Record<string, string> = {
  heritage: 'Heritage',
  background: 'Background',
  deity: 'Deity',
  subclass: 'Subclass',
  spell: 'Spell',
  sanctification: 'Sanctification',
};

/** `picker` — which picker "Take anyway" reaches (C19). */
export function PickerPart({ value, onChange, pickers = ANY_PICKERS }: { value: string | undefined; onChange: (picker: string) => void; pickers?: readonly string[] }) {
  return (
    <Part part="picker" label="Picker">
      <PopupSelect variant="pill" title="Picker" value={value ?? null} placeholder="Choose a picker" options={pickers.map((p) => ({ value: p, label: PICKER_LABEL[p] ?? p }))} onChange={onChange} />
    </Part>
  );
}

/** A place's stored fields as the place part edits them (plan section 4: `choice.addPlace`, `remove.choicePlace`). */
export interface PlaceValue {
  place?: string;
  level?: number;
  category?: string;
  ordinal?: number;
  lane?: string;
  set?: string;
  index?: number;
}
const PLACE_LABEL: Record<string, string> = {
  feat: 'Feat place',
  skillIncrease: 'Skill increase',
  boost: 'Attribute boost',
};
const LANE_LABEL: Record<string, string> = { main: 'Skill increase', bonus: 'Bonus increase', background: 'Background increase' };
const BOOST_SET_LABEL: Record<string, string> = { ancestry: 'Ancestry boosts', background: 'Background boosts', free: 'Free boosts (level 1)', level: 'Attribute boosts (a level)' };

/** One small labelled control inside the place part. */
function PlaceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="tw-place-field">
      <span className="tw-place-field-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * `place` — the place a place tweak adds or removes: its kind, then the fields that kind is named by (section 4):
 * a feat place's level and category (`categories`: the ones this character's slots draw, C13), a skill
 * increase's level (and, removed, its lane), a boost's level (removed: its set, level and which one). Which-one
 * numbers show 1-based and store 0-based. WP13: a class choice, a tactic and a rune (WP15-WP17) come after the
 * record rebuild.
 * `filled`: a feat place holding a pick — its level and category are greyed ("Remove the feat first", C12).
 * `locked`: the same greyed fields for another reason, in these words (WP7: answers an earlier feat left in the place).
 */
export function PlacePart({
  mode,
  value,
  onChange,
  categories = FEAT_PLACE_CATEGORIES,
  filled,
  locked,
  kindFixed,
  readOnly,
}: {
  mode: 'add' | 'remove';
  value: PlaceValue;
  onChange: (patch: PlaceValue) => void;
  categories?: readonly string[];
  filled?: string;
  locked?: string;
  /** The place's kind is what the tweak IS (a row editor): shown, never changed. */
  kindFixed?: boolean;
  /** Nothing to change (a removed place: section 2b allows its reason and on/off only): one line of words. */
  readOnly?: boolean;
}) {
  if (readOnly) return <StaticPlace value={value} />;
  const kinds = mode === 'add' ? ADD_PLACES : REMOVE_PLACES;
  const fixed = !!filled || !!locked;
  const lockedNote = filled ? `Holds ${filled} — remove the feat first to change its level or kind.` : locked;
  const which = (label: string, field: 'ordinal' | 'index') => (
    <PlaceField label={label}>
      <DraftNumberInput
        className="tw-num"
        aria-label={label}
        value={typeof value[field] === 'number' ? value[field]! + 1 : null}
        placeholder="1"
        min={1}
        max={20}
        onCommit={(n) => onChange({ [field]: Math.max(1, n) - 1 })}
        // Emptied: nothing is written (writing 0 would quietly re-aim the place at the first one).
        onClear={() => {}}
      />
    </PlaceField>
  );
  const level = (
    <PlaceField label="At level">
      {fixed ? (
        <span className="tw-part-static">{value.level ?? '—'}</span>
      ) : (
        <DraftNumberInput className="tw-num tw-level" aria-label="At level" value={value.level ?? null} placeholder="1" min={1} max={20} onCommit={(n) => onChange({ level: n })} onClear={() => onChange({ level: undefined })} />
      )}
    </PlaceField>
  );
  return (
    <Part part="place" label="Place" wide note={lockedNote ? <PartNote text={lockedNote} /> : undefined}>
      <div className="tw-place-fields">
        <PlaceField label="Kind">
          {fixed || kindFixed ? (
            <span className="tw-part-static">{PLACE_LABEL[value.place ?? ''] ?? value.place}</span>
          ) : (
            <PopupSelect variant="pill" title="Kind of place" value={value.place ?? null} placeholder="Choose a place" options={kinds.map((k) => ({ value: k, label: PLACE_LABEL[k] ?? k }))} onChange={(place) => onChange({ place })} />
          )}
        </PlaceField>
        {value.place === 'feat' && (
          <>
            {level}
            <PlaceField label="Feat kind">
              {fixed ? (
                <span className="tw-part-static">{cap(value.category ?? '—')}</span>
              ) : (
                <PopupSelect variant="pill" title="Feat kind" value={value.category ?? null} placeholder="Choose" options={categories.map((c) => ({ value: c, label: cap(c) }))} onChange={(category) => onChange({ category })} />
              )}
            </PlaceField>
            {mode === 'remove' && which('Which slot', 'ordinal')}
          </>
        )}
        {value.place === 'skillIncrease' && (
          <>
            {level}
            {mode === 'remove' && (
              <PlaceField label="Lane">
                <PopupSelect variant="pill" title="Lane" value={value.lane ?? null} placeholder="Choose" options={REMOVE_SKILL_LANES.map((l) => ({ value: l, label: LANE_LABEL[l] ?? l }))} onChange={(lane) => onChange({ lane })} />
              </PlaceField>
            )}
          </>
        )}
        {value.place === 'boost' &&
          (mode === 'add' ? (
            level
          ) : (
            <>
              <PlaceField label="Set">
                <PopupSelect variant="pill" title="Boost set" value={value.set ?? null} placeholder="Choose" options={BOOST_SETS.map((s) => ({ value: s, label: BOOST_SET_LABEL[s] ?? s }))} onChange={(set) => onChange({ set, ...(set === 'level' ? {} : { level: undefined }) })} />
              </PlaceField>
              {value.set === 'level' && level}
              {which('Which boost', 'index')}
            </>
          ))}
      </div>
    </Part>
  );
}

/** A place in words, one line: "Feat place · level 4 · class · slot 1", "Attribute boost · free boosts (level 1) · boost 3". */
function StaticPlace({ value: v }: { value: PlaceValue }) {
  const bits = [
    PLACE_LABEL[v.place ?? ''] ?? v.place ?? '?',
    v.set ? (BOOST_SET_LABEL[v.set] ?? v.set) : undefined,
    typeof v.level === 'number' ? `level ${v.level}` : undefined,
    v.category ? cap(v.category) : undefined,
    v.lane ? (LANE_LABEL[v.lane] ?? v.lane) : undefined,
    typeof v.ordinal === 'number' ? `slot ${v.ordinal + 1}` : undefined,
    typeof v.index === 'number' ? `boost ${v.index + 1}` : undefined,
  ].filter(Boolean);
  return (
    <Part part="place" label="Place" wide>
      <span className="tw-part-static">{bits.join(' · ')}</span>
    </Part>
  );
}

/** `rule` — the book rule a choice tweak lifts (one tweak per rule, decision 17), in `ruleWords`' words. */
export function RulePart({ rules, value, onChange }: { rules: readonly string[]; value: string | undefined; onChange: (rule: string) => void }) {
  return (
    <Part part="rule" label="Rule">
      <PopupSelect variant="pill" title="Rule" value={value ?? null} placeholder="Choose a rule" options={rules.map((r) => ({ value: r, label: cap(ruleWords(r) ?? r) }))} onChange={onChange} />
    </Part>
  );
}

/** `place` for "Remove a place" (WP6): one printed feat slot the character's pages draw ("Level 4 · Class feat",
 *  "holds Fleet"); WP14: or a skill increase or boost place ("Level 5 · Skill increase", "holds Stealth"); a place a
 *  removal already names is greyed. `label` is "Place", or "Point to another" on a row. */
export function FeatPlacePart({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly { value: string; label: string; note: string; disabled?: string }[];
  onChange: (key: string) => void;
}) {
  return (
    <Part part="place" label={label} wide>
      <PopupSelect
        variant="pill"
        title={label}
        value={value ?? null}
        placeholder={options.length ? 'Choose a place' : 'No place yet'}
        search
        options={options.map((o) => ({ value: o.value, label: o.label, note: o.note, ...(o.disabled ? { disabled: true, disabledReason: o.disabled } : {}) }))}
        onChange={onChange}
      />
    </Part>
  );
}

/** `count` — how many more times (1-9). `floor`: never below the copies already used (section 2b). */
export function CountPart({ value, floor = 1, onCommit, onDraft }: { value: number | null; floor?: number; onCommit: (n: number) => void; onDraft?: (n: number | null) => void }) {
  const lo = Math.max(1, floor);
  return (
    <Part part="count" label="More times" note={lo > 1 ? <PartNote text={`At least ${lo}: that many copies are already taken.`} /> : undefined}>
      <DraftNumberInput className="tw-num" aria-label="More times" value={value} placeholder="1" min={lo} max={9} onCommit={(n) => onCommit(Math.min(9, Math.max(lo, n)))} onClear={() => onCommit(lo)} onDraft={onDraft} />
    </Part>
  );
}

/** `question` — a held record's question an answer tweak names (plan section 4b), from `options`. */
export function QuestionPart({ value, options, onChange }: { value: string | undefined; options: PartOption[]; onChange: (key: string) => void }) {
  return (
    <Part part="question" label="Question" wide>
      <SearchSelect label="Question" value={value ?? null} placeholder={options.length ? 'Choose a question…' : 'No question to change'} options={options.map(({ description: _d, record: _r, ...o }) => o)} onChange={onChange} bare />
    </Part>
  );
}

/** The answer part's kinds: a skill (or a typed Lore), an attribute, a sanctification, or the list's own words. */
export type AnswerMode = 'skill' | 'attribute' | 'sanctification' | 'value';
const SANCTIFICATIONS = [
  { value: 'holy', label: 'Holy' },
  { value: 'unholy', label: 'Unholy' },
  { value: 'none', label: 'None' },
];

/**
 * `answer` — the answer a choice tweak carries or allows: a skill (with "A Lore…" typed and keyed through
 * `loreKey`, C27), one of the six attributes, a sanctification, or a value typed in the list's own words. A
 * typed answer never holds a comma (C27: "A comma would split this answer in two.").
 */
export function AnswerPart({
  mode,
  value,
  onCommit,
  label = 'Answer',
  options,
  newLore = true,
}: {
  mode: AnswerMode;
  value: string | undefined;
  onCommit: (answer: string) => void;
  label?: string;
  /** `skill`: the skills offered (default: the sixteen); `value`: the list's own options to pick from. */
  options?: { value: string; label: string; disabled?: boolean; disabledReason?: string }[];
  /** `skill`: offer "A Lore…" for a Lore typed in (default). WP11: an extra skill increase raises only a skill or Lore
   *  the character knows (its `options`), so its parts pass false. */
  newLore?: boolean;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const note = refusal ? <PartNote text={refusal} refusal /> : undefined;
  if (mode === 'attribute' || mode === 'sanctification') {
    const opts = mode === 'attribute' ? ATTRIBUTE_IDS.map((a) => ({ value: a, label: ABILITY_NAME[a] })) : SANCTIFICATIONS;
    return (
      <Part part="answer" label={label}>
        <PopupSelect variant="pill" title={label} value={value ?? null} placeholder="Choose" options={opts} onChange={onCommit} />
      </Part>
    );
  }
  if (mode === 'skill') {
    const opts = options ?? SKILLS.map((s) => ({ value: s, label: cap(s) }));
    const shown = value && !opts.some((o) => o.value === value) ? [...opts, { value, label: loreLabel(value) }] : opts;
    return (
      <Part part="answer" label={label} note={note}>
        <PopupSelect
          variant="pill"
          title={label}
          value={value ?? null}
          placeholder="Choose a skill"
          search
          options={shown}
          onChange={onCommit}
          addCustom={
            newLore
              ? {
                  label: 'A Lore…',
                  placeholder: 'Sailing',
                  refuse: (t) => (answerHasComma(t) ? COMMA_REFUSAL : loreKey(t) ? null : "Name the subject, not just 'Lore'"),
                  onAdd: (t) => {
                    const k = loreKey(t);
                    if (k) onCommit(k);
                  },
                }
              : undefined
          }
        />
      </Part>
    );
  }
  return (
    <Part part="answer" label={label} note={note}>
      {options?.length ? (
        <PopupSelect variant="pill" title={label} value={value ?? null} placeholder="Choose" options={options} onChange={onCommit} />
      ) : (
        <DraftText
          className="tw-text tw-answer"
          ariaLabel={label}
          placeholder="fire"
          value={value ?? ''}
          onDraft={(t) => setRefusal(answerHasComma(t) ? COMMA_REFUSAL : null)}
          onCommit={(t) => {
            const v = t.trim();
            if (answerHasComma(v)) return setRefusal(COMMA_REFUSAL);
            setRefusal(null);
            if (v) onCommit(v);
          }}
        />
      )}
    </Part>
  );
}

/** A Lore key in words ("lore:sailing" → "Sailing Lore"); any other value as it is. */
const loreLabel = (v: string): string => (v.startsWith('lore:') ? loreName(v) : cap(v));

/**
 * `options` — "Edit this list" (feature 15, C26): the book options as a checklist (unticked = removed; a removed
 * value stays listed, greyed, never hidden), the values added below it, and a box to add one. `locked` options
 * cannot be removed, each with its reason (the unanswered default: "answer it first"). A typed value never holds
 * a comma (C27). Picker-only: the edit never reaches the engine's list.
 */
export function OptionsPart({
  options,
  add,
  remove,
  locked = {},
  onChange,
}: {
  options: { value: string; label: string }[];
  add: readonly string[];
  remove: readonly string[];
  /** value → why it cannot be removed now. */
  locked?: Record<string, string>;
  onChange: (edit: { add: string[]; remove: string[] }) => void;
}) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const refusal = answerHasComma(typed) ? COMMA_REFUSAL : options.some((o) => o.value === typed) || add.includes(typed) ? 'Already on the list.' : null;
  const toggle = (v: string) => onChange({ add: [...add], remove: remove.includes(v) ? remove.filter((x) => x !== v) : [...remove, v] });
  return (
    <Part part="options" label="Options" wide note={refusal && typed ? <PartNote text={refusal} refusal /> : undefined}>
      <ul className="tw-options">
        {options.map((o) => {
          const gone = remove.includes(o.value);
          const why = locked[o.value];
          return (
            <li key={o.value} className={'tw-option' + (gone ? ' removed' : '')}>
              <label>
                <input type="checkbox" checked={!gone} disabled={!!why && !gone} onChange={() => toggle(o.value)} />
                <span className="tw-option-name">{o.label}</span>
              </label>
              {gone && <span className="picker-why">Removed from this list by your tweak</span>}
              {why && !gone && <span className="picker-why">{why}</span>}
            </li>
          );
        })}
        {add.map((v) => (
          <li key={`+${v}`} className="tw-option added">
            <span className="tw-option-name">{v}</span>
            <span className="tw-option-tag">added</span>
            <button type="button" className="tw-option-drop" aria-label={`Take ${v} off the list`} onClick={() => onChange({ add: add.filter((x) => x !== v), remove: [...remove] })}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="tw-option-add">
        <input className="tw-text" aria-label="Add an option" placeholder="Add an option (fire)" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className="tw-option-add-go"
          disabled={!typed || !!refusal}
          onClick={() => {
            onChange({ add: [...add, typed], remove: [...remove] });
            setText('');
          }}
        >
          <i className="ti ti-plus" aria-hidden="true" /> Add
        </button>
      </div>
    </Part>
  );
}

/* ─────────────── Tweaks phase 2: the shared look WP4-WP17 reuse (plan WP2 "rev 3", C48) ─────────────── */

/** The picker-row button's words: Take anyway, Allow here, Take again, Allow here and take anyway. */
export type BreakAction = 'take' | 'allow' | 'again' | 'allowTake';
const BREAK_LABEL: Record<BreakAction, string> = { take: 'Take anyway', allow: 'Allow here', again: 'Take again', allowTake: 'Allow here and take anyway' };

/**
 * A greyed picker row a tweak can break (C20): the name, the book's reason under it, and a button at its end in
 * the picker's own "Choose" look (`pick-add`; Guy's taste answer 2026-10-24, "Real button"). The row itself
 * stays `disabled` in the DOM (so `data-ctl-live` counts and the experience harness do not move); the button is
 * a separate element. Drawn only while Tweaks is on and only on a RULE grey — the caller decides; a no-op grey
 * ("Already trained") never gets one. WP4's `breakable` prop renders exactly this.
 */
export function BreakableOptionRow({
  name,
  reason,
  note,
  action = 'take',
  onAct,
  onOpenDesc,
}: {
  name: string;
  reason: string;
  note?: string;
  action?: BreakAction;
  onAct: () => void;
  /** WP4: a picker whose rows are read-first keeps the description readable on a greyed row too. */
  onOpenDesc?: () => void;
}) {
  // The body stays `disabled` for the plain pick in EVERY picker (C20; WP4 finish C5: a read-first row once made it
  // the description's button). The description has its own small button; "Take anyway" is the one action.
  return (
    <div className="pick-row dim tw-break-row" data-breakable={action}>
      <button type="button" className="pick-body tw-break-body" disabled aria-disabled="true">
        <span className="picker-text">
          <span className="picker-name">{name}</span>
          {note && <span className="picker-traits">{note}</span>}
          <span className="picker-why">{reason}</span>
        </span>
      </button>
      {onOpenDesc && (
        <button type="button" className="tw-break-desc" title="View description" aria-label={`View description: ${name}`} onClick={onOpenDesc}>
          <i className="ti ti-info-circle" aria-hidden="true" />
        </button>
      )}
      <button type="button" className="pick-add tw-break-act" onClick={onAct}>
        {BREAK_LABEL[action]}
      </button>
    </div>
  );
}

/**
 * A kept answer that does not count right now (C26, C47): "Stealth — kept, doesn't count (place removed)" with
 * Restore (WP14, WP16, WP17), or the greyed "fire — not on this list" row an answer picker draws (WP9, WP10),
 * with "Tweak paused" while its tweak is paused. Never removes anything by itself.
 */
export function KeptAnswerRow({
  answer,
  status,
  reason,
  paused,
  action,
  mark,
}: {
  answer: string;
  /** "kept, doesn't count (place removed)", "not on this list" … */
  status: string;
  /** The book's reason, under the line. */
  reason?: string;
  paused?: boolean;
  action?: { label: string; onClick: () => void };
  /** A `TweakMark` beside the answer (WP9 / WP10). */
  mark?: ReactNode;
}) {
  return (
    <div className="tw-kept-row" data-kept-answer={answer}>
      <span className="tw-kept-text">
        <span className="tw-kept-line">
          <span className="tw-kept-answer">{answer}</span>
          <span className="tw-kept-status"> — {status}</span>
          {paused && <span className="tw-kept-paused">Tweak paused</span>}
          {mark}
        </span>
        {reason && <span className="picker-why">{reason}</span>}
      </span>
      {action && (
        <button type="button" className="tw-kept-act" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** "Go to"'s landing (C29): once the page that draws it is open, scroll the place (`data-place-key`) into view and
 *  flash it once. False when no card on the page draws that key (nothing flashes then). */
export function flashPlace(placeKey: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>(`[data-place-key="${CSS.escape(placeKey)}"]`);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList.remove('tw-flash');
  void el.offsetWidth; // restart the animation when the same place is flashed twice
  el.classList.add('tw-flash');
  window.setTimeout(() => el.classList.remove('tw-flash'), 1500);
  return true;
}

/** A place card's state: counting, paused by its own switch, or Tweaks switched off (C42). */
export type PlaceCardState = 'live' | 'paused' | 'off';

/**
 * An extra place a tweak added — WP7 fills it with the place's own slot. Guy's taste answer (2026-10-24,
 * "Normal card + chip"): it looks like any other feat place, with the "Tweak" chip beside it (the mark carries the
 * rule and the reason in its popover); no dashed card. Paused: the card greyed, its chip, and "Paused: Toughness
 * doesn't count while paused" with Turn on. Tweaks off: the card greyed with no controls at all (no chip either),
 * "Tweaks are off: Toughness doesn't count — turn Tweaks on in Setup → Options"; its key always counts as drawn,
 * so its pick is never listed as a feat with no slot (C42).
 */
export function PlaceCardShell({
  title,
  state,
  held,
  placeKey,
  onTurnOn,
  mark,
  below,
  children,
}: {
  /** The place's name, labelled like a book slot ("Extra class feat (level 2)"): the greyed card's label and the
   *  group's accessible name. The live slot card the caller draws uses the SAME label, so pausing never renames it;
   *  the caller always passes `mark` too, or nothing tells the place from the book's own slot. */
  title: string;
  state: PlaceCardState;
  /** The name of what the place holds (the greyed card's value, and the paused and off lines). */
  held?: string;
  /** The place's slot key (`data-place-key`: what "Go to" flashes). */
  placeKey?: string;
  onTurnOn?: () => void;
  /** The `TweakMark` beside the card (live and paused; never while Tweaks are off). */
  mark?: ReactNode;
  /** The live place's own slot card (picker, answers). Drawn only while live. */
  children?: ReactNode;
  /** WP7: the lines under the live card — its pick's notes ("Not valid for this slot", the prerequisites) and the
   *  feat's own questions, as a book slot draws them under its card. Drawn only while live (a paused or off place's
   *  feat does not count, so it asks nothing). */
  below?: ReactNode;
}) {
  const what = held ?? 'Its pick';
  const slot =
    state === 'live' && children ? (
      children
    ) : (
      <div className="lvl-card tw-place-plain">
        <span className="lvl-card-icon">
          <i className="ti ti-square-plus" aria-hidden="true" />
        </span>
        <span className="lvl-card-text">
          <span className="lvl-card-label">{title}</span>
          <span className="lvl-card-val">{held ?? 'Empty'}</span>
        </span>
      </div>
    );
  return (
    <div className={'tw-place-card' + (state !== 'live' ? ` ${state}` : '')} data-place-key={placeKey} data-place-state={state} role="group" aria-label={title}>
      <div className="lvl-slot tw-place-row">
        {slot}
        {state !== 'off' && mark}
      </div>
      {state === 'live' && children && below}
      {state === 'paused' && (
        <p className="tw-place-note">
          Paused: {what} doesn&rsquo;t count while paused
          {onTurnOn && (
            <>
              {' — '}
              <button type="button" className="tw-place-on" onClick={onTurnOn}>
                Turn on
              </button>
            </>
          )}
        </p>
      )}
      {state === 'off' && <p className="tw-place-note">Tweaks are off: {what} doesn&rsquo;t count — turn Tweaks on in Setup → Options</p>}
    </div>
  );
}
