/*
 * THE EIGHT SHARED EDITOR PARTS (decision 23; plan B section 4.5, WP7). Every Tweaks editor — the "Add a
 * tweak" editor and a row's own editor — is put together from these, in the order its registry entry lists
 * them (`editor.parts`, `editor.advancedParts`; src/rules/blocks/registry.ts). A new block kind needs no new
 * screen code: it names parts that already exist here.
 *
 * Each part's root is `div.tw-part[data-part="<name>"]` (test/tweaks-screen-registry.test.tsx reads them in
 * order). A part only shows and reports a value: the editor decides what a change writes (the Add editor
 * keeps a draft until "Add"; a row's editor writes each change at once through the write door, B22).
 * Text boxes keep their own text while the player types and commit once, when left (like DraftNumberInput):
 * a box never refills mid-edit, and a draft still being typed reaches the Add editor through `onDraft`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProficiencyRank } from '../../rules/types';
import { PROFICIENCY_RANKS } from '../../rules/types';
import { DraftNumberInput } from '../DraftNumberInput';
import { useUnsavedWork } from '../../data/unsavedWork';
import { PopupSelect, SearchSelect, cap, type OptionRecord } from '../shared';

/** One option of the target and record pickers. */
export interface PartOption {
  id: string;
  name: string;
  note?: string;
  group?: string;
  /** Why it cannot be chosen (Q27: an unpickable option says why). */
  disabled?: string;
  description?: string;
  record?: OptionRecord;
}

export function Part({ part, label, children, note, wide }: { part: string; label: string; children: ReactNode; note?: ReactNode; wide?: boolean }) {
  return (
    <div className={'tw-part tw-part-' + part + (wide ? ' wide' : '')} data-part={part}>
      <span className="tw-part-label">{label}</span>
      {children}
      {note}
    </div>
  );
}

/** A note under a part (a refusal, or what the part does not do yet). The write door's refusals are
 *  written mid-sentence ("maximum HP is already set by a tweak"); shown alone, they start with a capital. */
export function PartNote({ text, refusal }: { text: string; refusal?: boolean }) {
  const shown = refusal ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  return (
    <p className={'tw-part-note' + (refusal ? ' refusal' : '')} role={refusal ? 'alert' : undefined}>
      {refusal && <i className="ti ti-alert-circle" aria-hidden="true" />} {shown}
    </p>
  );
}

/** `target` — what the tweak changes: the built targets the menu's kinds accept, grouped as the sheet
 *  groups them (Attributes, Defence, Saves, Checks, Skills, Offence, Spellcasting, Movement). */
export function TargetPart({ value, options, onChange, label = 'What' }: { value: string | undefined; options: PartOption[]; onChange: (key: string) => void; label?: string }) {
  return (
    <Part part="target" label={label}>
      <SearchSelect label={label} value={value ?? null} placeholder="Choose what it changes…" options={options.map(({ description: _d, record: _r, ...o }) => o)} onChange={onChange} bare />
    </Part>
  );
}

/** `target` for "Add a Lore": the subject, typed (keyed through `loreKey` by the editor). */
export function LoreSubjectPart({ value, onChange, refusal }: { value: string; onChange: (subject: string) => void; refusal?: string }) {
  return (
    <Part part="target" label="Lore subject" note={refusal ? <PartNote text={refusal} refusal /> : undefined}>
      <input className="tw-text tw-lore-subject" aria-label="Lore subject" placeholder="Sailing" value={value} onChange={(e) => onChange(e.target.value)} />
    </Part>
  );
}

/** `number` — a DraftNumberInput: commits once when left (or Enter); empty = clear; a lone "-" changes
 *  nothing. `placeholder` is the book number ("book: 18"). */
export function NumberPart({
  label,
  ariaLabel,
  value,
  placeholder,
  min,
  max,
  onCommit,
  onClear,
  onDraft,
  note,
}: {
  label: string;
  ariaLabel: string;
  value: number | null;
  placeholder?: string;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  onClear: () => void;
  onDraft?: (n: number | null) => void;
  note?: ReactNode;
}) {
  return (
    <Part part="number" label={label} note={note}>
      <DraftNumberInput className="tw-num" aria-label={ariaLabel} value={value} placeholder={placeholder} min={min} max={max} onCommit={onCommit} onClear={onClear} onDraft={onDraft} />
    </Part>
  );
}

/** A part with nothing to fill in yet, or ever (a ritual has no spell rank; a text edit's fields wait for
 *  its record): the part is still there, in its place, saying why. */
export function StaticPart({ part, label, text }: { part: string; label: string; text: string }) {
  return (
    <Part part={part} label={label}>
      <span className="tw-part-static">{text}</span>
    </Part>
  );
}

export type BonusType = 'status' | 'circumstance' | 'item';
const BONUS_TYPES: { value: 'untyped' | BonusType; label: string }[] = [
  { value: 'untyped', label: 'Untyped (always adds)' },
  { value: 'status', label: 'Status' },
  { value: 'circumstance', label: 'Circumstance' },
  { value: 'item', label: 'Item' },
];

/** `bonusType` — untyped (the default: a tweak +/- always adds, decision 15) or a PF2e bonus type. */
export function BonusTypePart({ value, onChange }: { value: BonusType | undefined; onChange: (t: BonusType | undefined) => void }) {
  return (
    <Part part="bonusType" label="Bonus type">
      <PopupSelect
        variant="pill"
        title="Bonus type"
        value={value ?? 'untyped'}
        options={BONUS_TYPES}
        onChange={(v) => onChange(v === 'untyped' ? undefined : (v as BonusType))}
      />
    </Part>
  );
}

/** `rank` — trained … legendary (untrained too where it means something: an "exactly" hold). */
export function RankPart({ value, onChange, untrained, note }: { value: ProficiencyRank | undefined; onChange: (r: ProficiencyRank) => void; untrained?: boolean; note?: ReactNode }) {
  const ranks = PROFICIENCY_RANKS.filter((r) => untrained || r !== 'untrained' || r === value);
  return (
    <Part part="rank" label="Rank" note={note}>
      <PopupSelect variant="pill" title="Rank" value={value ?? null} placeholder="Choose a rank" options={ranks.map((r) => ({ value: r, label: cap(r) }))} onChange={(v) => onChange(v as ProficiencyRank)} />
    </Part>
  );
}

/** `record` — a feat, class feature, language or spell, from the Builder's FULL content (never the Sources-
 *  filtered view: gold-set R12, out of scope on purpose); feats of ANY level (problem 6). An option with a
 *  description opens it first (PinStar kept), its Select button chooses it. */
export function RecordPart({ label, value, options, onChange, note }: { label: string; value: string | undefined; options: PartOption[]; onChange: (id: string) => void; note?: ReactNode }) {
  return (
    <Part part="record" label={label} note={note} wide>
      <SearchSelect
        label={label}
        value={value ?? null}
        placeholder={`Choose ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}…`}
        options={options.map((o) => (o.record ? { ...o, record: o.record } : { id: o.id, name: o.name, note: o.note, group: o.group, disabled: o.disabled }))}
        onChange={onChange}
        sortByName
        bare
      />
    </Part>
  );
}

/**
 * A text box that keeps its own text while typed and commits once, when left (blur, Enter on one line, or
 * an unmount), and only when the text changed. `onDraft` hears every keystroke (the Add editor's draft).
 */
export function DraftText({
  value,
  onCommit,
  onDraft,
  multiline,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (text: string) => void;
  onDraft?: (text: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const live = useRef({ draft, value, onCommit });
  live.current = { draft, value, onCommit };
  // Text still being typed is not saved until the box is left: closing or reloading asks first (unsavedWork.ts).
  useUnsavedWork(() => live.current.draft != null && live.current.draft !== live.current.value);
  const finish = () => {
    const { draft: d, value: v, onCommit: commit } = live.current;
    if (d == null) return;
    live.current.draft = null;
    setDraft(null);
    if (d !== v) commit(d);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => finish(), []);
  const common = {
    className,
    'aria-label': ariaLabel,
    placeholder,
    value: draft ?? value,
    onBlur: finish,
  };
  const change = (t: string) => {
    setDraft(t);
    onDraft?.(t);
  };
  return multiline ? (
    <textarea {...common} rows={5} onChange={(e) => change(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => change(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}

/** `text` — the record's name and description as the player wants them (16px on a phone). */
export function TextPart({
  name,
  description,
  onCommit,
  onDraft,
}: {
  name: string;
  description: string;
  onCommit: (text: { name?: string; description?: string }) => void;
  onDraft?: (text: { name?: string; description?: string }) => void;
}) {
  return (
    <Part part="text" label="Your text" wide note={<PartNote text="Your text shows on records with no Archives page; everywhere else comes in a later version." />}>
      <DraftText className="tw-text tw-text-name" ariaLabel="Name" value={name} onCommit={(t) => onCommit({ name: t })} onDraft={onDraft ? (t) => onDraft({ name: t }) : undefined} />
      <DraftText
        className="tw-text tw-text-desc"
        ariaLabel="Description"
        multiline
        value={description}
        onCommit={(t) => onCommit({ description: t })}
        onDraft={onDraft ? (t) => onDraft({ description: t }) : undefined}
      />
    </Part>
  );
}

/** `level` — "From level" 1-20; an empty box is level 1. */
export function LevelPart({ value, onCommit, onDraft }: { value: number | null; onCommit: (n: number) => void; onDraft?: (n: number | null) => void }) {
  return (
    <Part part="level" label="From level">
      <DraftNumberInput className="tw-num tw-level" aria-label="From level" value={value} placeholder="1" min={1} max={20} onCommit={onCommit} onClear={() => onCommit(1)} onDraft={onDraft} />
    </Part>
  );
}

/** `reason` — shown in the breakdown and on the row. */
export function ReasonPart({ value, onCommit, onDraft }: { value: string; onCommit: (text: string) => void; onDraft?: (text: string) => void }) {
  return (
    <Part part="reason" label="Reason" wide>
      <DraftText className="tw-text tw-reason" ariaLabel="Reason" placeholder="Reason (shown in the breakdown)" value={value} onCommit={onCommit} onDraft={onDraft} />
    </Part>
  );
}
