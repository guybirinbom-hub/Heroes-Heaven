/*
 * THE TWEAKS EDITORS (decision 23; plan B section 4.5-4.6, WP7). One editor for every kind, put together
 * from the registry entry's `editor.parts` (and `advancedParts`, inside the editor's own "Advanced" fold)
 * out of the eight shared parts (./parts.tsx). Nothing here lists kinds by hand: a menu's kinds, the targets
 * they accept, the option chooser and the parts all come from src/rules/blocks/registry.ts through ./model.ts.
 *
 *   - `TweakAddEditor`: an "Add a tweak" menu, opened under the menus. THE SHARED-MENU RULE: a menu more than
 *     one kind lists opens with the target part (the union of what its kinds accept), then — when two or more
 *     of its kinds accept the chosen target — the option chooser (their `editor.option` labels; the default is
 *     the first in registry order); then exactly the resolved kind's parts in order, the target kept on top.
 *     It keeps a draft until "Add" (B22); "Cancel" throws it away. A draft holding anything counts as a change
 *     when the Builder is left (`onPending`, test/phone-builder-leave.test.tsx).
 *   - `TweakRowEditor`: a row's own editor. Each part writes at once when it is left (B22), through the write
 *     door (blocks/write.ts) via the page's `write`; Undo works as for every Builder control. A change of
 *     target or option that needs another kind changes the kind — in place when both kinds are stored under
 *     the same key, else as one remove + add (`writeTweaks`) carrying the reason, start level and on/off.
 *
 * Two numbers are computed here (plan B WP7): a set's `baseline` (`baselineFor`, the book number under it,
 * decision 9) stored when the set is made or edited; and the casting note of "Give a feat" (open point 8) —
 * the draft with the chosen feat given, built once per chosen feat and level, compared casting entry by
 * casting entry (`castingEntryChanges`).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildCharacter, type BuildState } from '../../rules/build';
import { baselineFor } from '../../rules/blocks/baseline';
import { startLevelOf } from '../../rules/blocks/active';
import { recordName, targetName } from '../../rules/blocks/names';
import { blockKind, isChoiceKind, type BlockInstance } from '../../rules/blocks/registry';
import { castingEntryChanges } from '../../rules/blocks/save';
import { writeTweak, type TweakDraft, type TweakWrite } from '../../rules/blocks/write';
import { loreKey } from '../../rules/loreKey';
import { bookTotal, numberTermsFor } from '../../rules/numberTerms';
import type { Character, ContentDatabase, FeatCategory, ProficiencyRank } from '../../rules/types';
import { cap } from '../shared';
import { ChoiceRowEditor, RECORD_LABEL as ANY_RECORD_LABEL, choiceRecords, extraCopiesHeld } from './ChoiceEditor';
import { AnswerPart, CountPart, FeatPlacePart, PickerPart, PlacePart, RulePart } from './choiceParts';
import { ANY_LIST_RULES, ANY_PICKERS } from '../../rules/blocks/registry';
import { heldClasses } from '../../rules/heldClasses';
import {
  carrierSkillOptions,
  choicePlaceOptions,
  editorParts,
  featPlaceCategories,
  kindAccepts,
  menuHasTarget,
  menuKindsFor,
  menuOfKind,
  menuTargets,
  resolveMenuKind,
  storedTextEdit,
  type TweakMenu,
  type TweakRowModel,
} from './model';
import {
  BonusTypePart,
  LevelPart,
  LoreSubjectPart,
  NumberPart,
  PartNote,
  ReasonPart,
  RankPart,
  RecordPart,
  StaticPart,
  TargetPart,
  TextPart,
  type BonusType,
  type PartOption,
} from './parts';

/** "Take anyway in another picker" (Tweaks phase 2, WP4): the one choice kind the Add flow builds so far. */
const ANY_KIND = 'choice.allowAnywayAnyPicker';
/** "Add a place" (Tweaks phase 2, WP7): an extra feat place (the skill increase and the boost come with WP11). */
const ADD_PLACE_KIND = 'choice.addPlace';

/** What one editor write did: refused (with why, nothing written), or written — `added` holds the row keys
 *  the write created (a new tweak, or a tweak whose key moved). */
export interface EditorWriteResult {
  refused?: string;
  added: string[];
}
export type EditorWrite = (ws: TweakWrite | TweakWrite[]) => EditorWriteResult;

interface EditorContext {
  build: BuildState;
  /** The character the draft builds (`featPrereqChar`). */
  character: Character;
  /** The Builder's FULL content view (`ovContent`): the pickers ignore Sources (gold-set R12). */
  content: ContentDatabase;
  /** The content without the player's text edits (the "book" a text edit is measured against). */
  bookContent: ContentDatabase;
  /** The page's rows (what is already a tweak: a Lore's rank, a feat already given). */
  rows: TweakRowModel[];
  write: EditorWrite;
}

/** The menu whose target is a typed Lore subject (plan B section 4.5: the one text target). */
export const LORE_MENU = 'Add a Lore';
const SET_KINDS = new Set(['number.set', 'number.setMaxHp', 'attribute.set']);
/** grant.feat / grant.classFeature: the level part edits the STORED level (B10). */
const LEVELLED = new Set(['grant.feat', 'grant.classFeature']);
const RECORD_LABEL: Record<string, string> = {
  'grant.feat': 'Feat',
  'grant.classFeature': 'Class feature',
  'grant.language': 'Language',
  'grant.spell': 'Spell',
  'remove.feat': 'Feat',
  'choice.allowAnyway': 'Feat',
  'choice.anyList': 'Feat',
  'choice.moreTakes': 'Feat',
  'text.edit': 'Feat or class feature',
};
const CLASS_FEATURE_NOTE = 'Listed on the sheet; its bonuses and uses come in a later version.';
const CATEGORY_RANK_NOTE = "A category rank does not change one weapon group's or one weapon's own rank.";
const NO_RITUAL_RANK = 'A ritual has no spell rank.';

const storageOf = (kind: string): string => {
  const s = blockKind(kind)?.storage;
  return !s ? '' : s.in === 'blocks' ? 'blocks' : s.key;
};
const isNumberKind = (kind: string) => ['number', 'attribute'].includes(blockKind(kind)?.family ?? '');
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The number part's words for one kind and target: its label, and the box's aria-label (the target's
 *  name — "Max HP" for maximum HP, which the old card's box was called). */
function numberWords(kind: string, target: string | undefined, character: Character): { label: string; aria: string; min?: number } {
  if (kind === 'grant.spell') return { label: 'Spell rank', aria: 'Spell rank' };
  const def = blockKind(kind);
  const aria = target === 'max-hp' ? 'Max HP' : targetName(target, character.spellcasting, { page: true });
  const label = def?.slot === 'add' ? 'Amount (+ or −)' : (def?.editor?.option ?? 'Set to');
  // A maximum HP set below 1 is held at 1 (the old card's box did the same).
  return { label, aria, ...(target === 'max-hp' && def?.slot !== 'add' ? { min: 1 } : {}) };
}

/** The book number a number part shows as its placeholder ("book: 18"): the number under a set
 *  (`baselineFor`), else the permanent part of the target's term list. */
function bookNumber(character: Character, content: ContentDatabase, build: BuildState, target: string | undefined): number | undefined {
  if (!target) return undefined;
  const base = baselineFor(character, content, target, build);
  if (base !== undefined) return base;
  if (target.startsWith('score:')) return undefined;
  const terms = numberTermsFor(character, content, target);
  return terms ? bookTotal(terms) : undefined;
}

/** A set's baseline to store with a write (none when it cannot be known, decision 9). */
function baselineOf(kind: string, target: string | undefined, ctx: EditorContext): { baseline?: number } {
  if (!SET_KINDS.has(kind) || !target) return {};
  const b = baselineFor(ctx.character, ctx.content, target, ctx.build);
  return b === undefined ? {} : { baseline: b };
}

/** "Take anyway in another picker": the records of one picker (a subclass: the character's classes' own options;
 *  a sanctification: the records whose answer follows the deity). */
function anyPickerRecords(picker: string, build: BuildState, content: ContentDatabase): PartOption[] {
  if (picker !== 'subclass') return choiceRecords(ANY_KIND, { picker }, content, undefined);
  // Every class the character HOLDS (heldClasses: a leftover classId2 with Dual Class off is not one), each its own.
  return heldClassIds(build).flatMap((classId) => choiceRecords(ANY_KIND, { picker, classId }, content, undefined));
}
const heldClassIds = (build: BuildState): string[] => [...new Set(heldClasses(build).flatMap((s) => (s.classId ? [s.classId] : [])))];

/** The options of the record part for one kind (the FULL content; any level). `self` is the record the
 *  editing row already points at (never marked as taken). */
function recordOptions(kind: string, ctx: EditorContext, self?: string): PartOption[] {
  const { content, character, rows } = ctx;
  const taken = new Set(rows.filter((r) => r.kind === kind && typeof r.inst?.record === 'string').map((r) => r.inst!.record as string));
  if (self) taken.delete(self);
  const takenWhy = kind === 'text.edit' ? 'Already has a text edit' : 'Already a tweak';
  const mark = (o: PartOption): PartOption => (taken.has(o.id) ? { ...o, disabled: takenWhy } : o);
  switch (kind) {
    case 'grant.feat':
    case 'choice.allowAnyway':
      return Object.values(content.feats ?? {}).map((f) =>
        mark({ id: f.id, name: f.name, note: `${cap(f.category)} feat · level ${f.level}`, description: f.description, record: { bucket: 'feats', id: f.id } }),
      );
    // WP5: one feat may hold one "Pick from any list" per rule, so a feat with one is never greyed here (the write
    // door refuses the same feat and rule twice).
    case 'choice.anyList':
      return Object.values(content.feats ?? {}).map((f) => ({ id: f.id, name: f.name, note: `${cap(f.category)} feat · level ${f.level}`, description: f.description, record: { bucket: 'feats', id: f.id } }));
    // WP8 (D1): ONE "Take a feat more times" per feat — a feat that has one is greyed here, pointing at its row (the
    // write door refuses a second one too).
    case 'choice.moreTakes':
      return Object.values(content.feats ?? {}).map((f) => {
        const o: PartOption = { id: f.id, name: f.name, note: `${cap(f.category)} feat · level ${f.level}`, description: f.description, record: { bucket: 'feats', id: f.id } };
        return taken.has(f.id) ? { ...o, disabled: 'Already has this tweak — change its count on its row' } : o;
      });
    case 'grant.classFeature':
      return Object.values(content.classFeatures ?? {}).map((f) =>
        mark({ id: f.id, name: f.name, note: `Class feature · level ${f.level}`, description: f.description, record: { bucket: 'classFeatures', id: f.id } }),
      );
    case 'grant.language': {
      const known = new Set(character.languages ?? []);
      return Object.values(content.languages ?? {}).map((l) => mark(known.has(l.id) && l.id !== self ? { id: l.id, name: l.name, disabled: 'Already known' } : { id: l.id, name: l.name }));
    }
    case 'grant.spell':
      return Object.values(content.spells ?? {}).map((s) =>
        mark({
          id: s.id,
          name: s.name,
          note: `${s.ritual ? 'Ritual' : cap(s.traditions?.[0] ?? 'spell')} · ${s.rank === 0 ? 'cantrip' : `rank ${s.rank}`}`,
          description: s.description,
          record: { bucket: 'spells', id: s.id },
        }),
      );
    case 'remove.feat': {
      // The feats the build gave this character (a removed one is no longer among them: the row's own stays).
      const seen = new Set<string>();
      const out: PartOption[] = [];
      for (const f of character.feats ?? []) {
        if (seen.has(f.featId)) continue;
        seen.add(f.featId);
        const by = f.grantedBy ? ` · given by ${recordName(content, 'feats', f.grantedBy)}` : '';
        out.push(mark({ id: f.featId, name: recordName(content, 'feats', f.featId), note: `Level ${f.level}${by}`, description: content.feats?.[f.featId]?.description, record: { bucket: 'feats', id: f.featId } }));
      }
      if (self && !seen.has(self)) out.push({ id: self, name: recordName(content, 'feats', self), note: 'Removed by this tweak' });
      return out;
    }
    case 'text.edit':
      return [
        ...Object.values(content.feats ?? {}).map((f) => mark({ id: `feats/${f.id}`, name: f.name, note: `Level ${f.level}`, group: 'Feats' })),
        ...Object.values(content.classFeatures ?? {}).map((f) => mark({ id: `classFeatures/${f.id}`, name: f.name, note: `Level ${f.level}`, group: 'Class features' })),
      ];
    default:
      return [];
  }
}

/** The book name and description of a text edit's record (`feats/<id>` / `classFeatures/<id>`). */
function bookText(bookContent: ContentDatabase, record: string | undefined): { name: string; description: string } {
  const m = record ? /^(feats|classFeatures)\/(.+)$/.exec(record) : null;
  const rec = m ? (bookContent[m[1] as 'feats' | 'classFeatures'] as Record<string, { name?: string; description?: string }> | undefined)?.[m[2]] : undefined;
  return { name: rec?.name ?? '', description: rec?.description ?? '' };
}

/**
 * Open point 8: the note "Give a feat" shows when the chosen feat changes a casting entry ("This changes
 * Cleric: prepared → spontaneous. Spells you prepared stay saved."). The draft with the feat given is built
 * once and compared with the character the draft builds now, entry by entry. Writes nothing.
 */
function castingNoteFor(build: BuildState, character: Character, content: ContentDatabase, record: string, category: FeatCategory | undefined, level: number): string | null {
  const tried = writeTweak(build, { op: 'add', draft: { kind: 'grant.feat', record, level, ...(category ? { category } : {}) } });
  if (tried.refused) return null;
  const next = buildCharacter({ ...build, overrides: tried.overrides }, content);
  const changes = castingEntryChanges(character, next);
  if (!changes.length) return null;
  return `${changes.map((c) => `This changes ${c.name}: ${c.what.join(', ')}.`).join(' ')} Spells you prepared stay saved.`;
}

/** The option chooser (B19): one button per kind that can hold the target, labelled by `editor.option`. */
function OptionChooser({ kinds, value, onChange }: { kinds: string[]; value: string | undefined; onChange: (kind: string) => void }) {
  return (
    <div className="tw-chooser" role="group" aria-label="Kind of tweak">
      {kinds.map((k) => (
        <button key={k} type="button" className={'tw-opt' + (k === value ? ' on' : '')} aria-pressed={k === value} onClick={() => onChange(k)}>
          {blockKind(k)?.editor?.option ?? blockKind(k)?.title ?? k}
        </button>
      ))}
    </div>
  );
}

/** The editor's own "Advanced" fold (its `advancedParts`). */
function AdvancedFold({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="tw-editor-adv">
      <button type="button" className="tw-editor-adv-toggle" aria-expanded={open} onClick={onToggle}>
        <i className={'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" /> Advanced
      </button>
      {open && <div className="tw-parts">{children}</div>}
    </div>
  );
}

/* ─────────────────────────────── "Add a tweak" ─────────────────────────────── */

interface Draft {
  target?: string;
  subject?: string;
  kind?: string;
  value?: number | null;
  rank?: ProficiencyRank;
  bonusType?: BonusType;
  record?: string;
  text?: { name?: string; description?: string };
  level?: number | null;
  reason?: string;
  /** "Take anyway in another picker": the picker and a sanctification's answer. */
  picker?: string;
  answer?: string;
  /** "Pick from any list": the rule it lifts (WP5). */
  rule?: string;
  /** "Remove a place": the printed feat slot, by the key it is drawn as now (WP6; stored as level, category, ordinal). */
  placeKey?: string;
  /** "Add a place" (WP7): the extra feat place's level and category (its `n` is drawn by the write door, C4). */
  placeLevel?: number;
  placeCategory?: string;
  /** WP11: which place "Add a place" adds (absent = a feat place, the first kind) and a carrier's answer (a skill key or
   *  an attribute; absent = an empty place, owed). */
  placeKind?: 'feat' | 'skillIncrease' | 'boost';
  placeAnswer?: string;
  /** "Take a feat more times" (WP8): how many more times (1-9). */
  times?: number;
}

export function TweakAddEditor({
  menu,
  onAdded,
  onCancel,
  onPending,
  ...ctx
}: EditorContext & {
  menu: TweakMenu;
  /** The tweak was added: the keys of its new row(s). */
  onAdded: (added: string[]) => void;
  onCancel: () => void;
  /** The draft holds something (true) or is gone (false) — leaving the Builder asks first while it does. */
  onPending?: (dirty: boolean) => void;
}) {
  const { build, character, content, bookContent, rows } = ctx;
  const [d, setD] = useState<Draft>({});
  const [advOpen, setAdvOpen] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const pending = useRef(false);
  const closed = useRef(false);
  const pendingCb = useRef(onPending);
  pendingCb.current = onPending;
  const update = (patch: Partial<Draft>) => {
    if (closed.current) return; // a box committing as the editor goes away is no new draft
    setRefused(null);
    setD((x) => ({ ...x, ...patch }));
    if (!pending.current) {
      pending.current = true;
      pendingCb.current?.(true);
    }
  };
  const close = () => {
    closed.current = true;
    if (pending.current) {
      pending.current = false;
      pendingCb.current?.(false);
    }
  };
  // Mounted again (React's StrictMode runs effects twice in development): open again.
  useEffect(() => {
    closed.current = false;
    return () => close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The target: a chosen statistic, or for "Add a Lore" the typed subject keyed by loreKey.
  const isLore = menu.name === LORE_MENU;
  const subject = (d.subject ?? '').trim();
  const loreTarget = isLore && subject ? (loreKey(subject) ? `skill:${loreKey(subject)}` : null) : undefined;
  const loreRefusal = !isLore
    ? undefined
    : loreTarget === null
      ? "Name the subject, not just 'Lore'"
      : loreTarget && rows.some((r) => blockKind(r.kind)?.family === 'rank' && r.inst?.target === loreTarget)
        ? 'Already has a rank tweak — open it in the list'
        : undefined;
  const target = isLore ? (loreTarget && !loreRefusal ? loreTarget : undefined) : d.target;
  const hasTarget = menuHasTarget(menu);
  // Before a Lore subject is typed both rank kinds still apply (they accept the same targets).
  const kinds = menuKindsFor(menu, target);
  const kind = resolveMenuKind(menu, target, d.kind);
  const def = kind ? blockKind(kind) : undefined;
  // "Add a place" (WP11): the answer part is a skill increase's or a boost's, so a feat place (its pick is made in its
  // slot) has none. WP13: "Take anyway in another picker" has no place or rule part (a skill increase's, WP12, comes
  // after the record rebuild).
  const placeKind = d.placeKind ?? 'feat';
  const parts = kind
    ? editorParts(kind, menu).filter((p) => kind !== ADD_PLACE_KIND || p !== 'answer' || placeKind !== 'feat')
    : hasTarget
      ? ['target']
      : [];
  const advParts = def?.editor?.advancedParts ?? [];
  const targets = useMemo(() => (hasTarget && !isLore ? menuTargets(menu, character).map((t) => ({ id: t.key, name: t.label, group: t.group })) : []), [menu, character, hasTarget, isLore]);
  const records = useMemo(
    () => (kind === ANY_KIND ? (d.picker ? anyPickerRecords(d.picker, build, content) : []) : kind && parts.includes('record') ? recordOptions(kind, ctx) : []),
    [kind, content, character, rows, d.picker], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // "Remove a place" (WP6): the printed feat slots this character's pages draw; WP14: and its skill increases and
  // attribute boosts.
  const placeOpts = useMemo(() => (kind === 'remove.choicePlace' ? choicePlaceOptions(build, content) : []), [kind, build, content]);
  // "Add a place" (WP7, C13): the feat place categories this character may add — the level page's own list.
  const placeCats = useMemo(() => (kind === ADD_PLACE_KIND ? featPlaceCategories(build, content) : []), [kind, build, content]);
  const feat = kind === 'grant.feat' && d.record ? content.feats?.[d.record] : undefined;
  const spell = kind === 'grant.spell' && d.record ? content.spells?.[d.record] : undefined;
  const level = d.level ?? 1;
  // Built once per chosen feat and level (open point 8).
  const castNote = useMemo(
    () => (kind === 'grant.feat' && d.record ? castingNoteFor(build, character, content, d.record, feat?.category, level) : null),
    [kind, d.record, level, build, character, content], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const book = useMemo(() => (kind && isNumberKind(kind) ? bookNumber(character, content, build, target) : undefined), [kind, target, character, content, build]);
  const textBook = kind === 'text.edit' ? bookText(bookContent, d.record) : { name: '', description: '' };

  /** What the Add button still needs, or the write door's draft. */
  const made = ((): { draft: TweakDraft } | { missing: string } | null => {
    if (!kind || !def) return hasTarget ? { missing: isLore ? 'Type a subject' : 'Choose what it changes' } : null;
    if (hasTarget && !target) return { missing: isLore ? (loreRefusal ?? 'Type a subject') : 'Choose what it changes' };
    const from = level > 1 ? clamp(level, 1, 20) : undefined;
    const reason = d.reason?.trim() || undefined;
    const common = { ...(reason ? { reason } : {}) };
    if (isNumberKind(kind)) {
      if (d.value == null) return { missing: 'Type a number' };
      const w = numberWords(kind, target, character);
      const value = w.min != null ? Math.max(w.min, d.value) : d.value;
      return { draft: { kind, target, value, ...(kind === 'number.add' && d.bonusType ? { bonusType: d.bonusType } : {}), ...(from ? { from } : {}), ...common } };
    }
    if (def.family === 'rank') return { draft: { kind, target, rank: d.rank ?? 'trained', ...(from ? { from } : {}), ...common } };
    if (kind === ANY_KIND) {
      if (!d.picker) return { missing: 'Choose a picker' };
      if (!d.record) return { missing: `Choose a ${(ANY_RECORD_LABEL[d.picker] ?? 'record').toLowerCase()}` };
      if (d.picker === 'sanctification' && !d.answer) return { missing: 'Choose the answer' };
      // A subclass allow names its class: the character's class that offers this option (the first class first).
      const classId =
        d.picker === 'subclass'
          ? heldClassIds(build).find((c) => content.classes?.[c]?.subclass?.options.some((o) => o.id === d.record))
          : undefined;
      if (d.picker === 'subclass' && !classId) return { missing: 'Choose a subclass of your class' };
      const fields = { picker: d.picker, record: d.record, ...(classId ? { classId } : {}), ...(d.picker === 'sanctification' ? { value: d.answer } : {}) };
      return { draft: { kind, fields, ...common } };
    }
    if (kind === 'remove.choicePlace') {
      // WP6: a drawn printed feat slot, stored as (level, category, ordinal) — never its key (C32). WP14: a skill
      // increase (level, lane) or a boost place (set, level, index): its option's `place` carries its own `place`.
      const o = placeOpts.find((x) => x.value === d.placeKey);
      if (!o) return { missing: 'Choose the place' };
      if (o.disabled) return { missing: o.disabled };
      return { draft: { kind, fields: { place: 'feat', ...o.place }, ...common } };
    }
    if (kind === ADD_PLACE_KIND) {
      // WP7: an extra feat place at a level, of a category (C13); the door draws its `n` (C4). Above the character's
      // level it is stored and shows "Not reached yet" until the level is reached.
      if (d.placeLevel == null) return { missing: 'Choose the level' };
      // WP11 (C15 / C16): an extra skill increase or attribute boost at a level, with its answer when chosen (none:
      // an empty place, owed until the player answers it on its card or here).
      if (placeKind !== 'feat') {
        const field = placeKind === 'skillIncrease' ? 'skill' : 'attribute';
        return { draft: { kind, fields: { place: placeKind, level: clamp(d.placeLevel, 1, 20), ...(d.placeAnswer ? { [field]: d.placeAnswer } : {}) }, ...common } };
      }
      if (!d.placeCategory) return { missing: 'Choose the feat kind' };
      return { draft: { kind, fields: { place: 'feat', level: clamp(d.placeLevel, 1, 20), category: d.placeCategory }, ...common } };
    }
    if (!d.record) return { missing: `Choose ${/^[aeiou]/i.test(RECORD_LABEL[kind] ?? '') ? 'an' : 'a'} ${(RECORD_LABEL[kind] ?? 'record').toLowerCase()}` };
    switch (kind) {
      case 'choice.anyList':
        // WP5: the feat and the ONE rule it may break (another rule is another tweak, decision 17).
        if (!d.rule) return { missing: 'Choose the rule it may break' };
        return { draft: { kind, record: d.record, fields: { rule: d.rule }, ...common } };
      case 'choice.moreTakes':
        // WP8: the feat and how many more times, never below the copies it already holds past the book (C36).
        return { draft: { kind, record: d.record, fields: { times: clamp(Math.max(d.times ?? 1, extraCopiesHeld(build, content, d.record)), 1, 9) }, ...common } };
      case 'grant.feat':
        return { draft: { kind, record: d.record, level: clamp(level, 1, 20), ...(feat?.category ? { category: feat.category } : {}), ...common } };
      case 'grant.classFeature':
        return { draft: { kind, record: d.record, level: clamp(level, 1, 20), ...common } };
      case 'grant.spell': {
        const rank = d.value != null ? clamp(d.value, 0, 10) : (spell?.rank ?? 1);
        return { draft: { kind, record: d.record, spellRank: rank, ...(from ? { from } : {}), ...common } };
      }
      case 'text.edit': {
        const name = d.text?.name ?? textBook.name;
        const description = d.text?.description ?? textBook.description;
        const text = { ...(name !== textBook.name && name ? { name } : {}), ...(description !== textBook.description && description ? { description } : {}) };
        if (!Object.keys(text).length) return { missing: 'Change the name or the text' };
        return { draft: { kind, record: d.record, text, ...common } };
      }
      default:
        return { draft: { kind, record: d.record, ...(from && parts.includes('level') ? { from } : {}), ...common } };
    }
  })();

  const add = () => {
    if (!made || !('draft' in made) || !kind) return;
    const res = ctx.write({ op: 'add', draft: made.draft, ...baselineOf(kind, made.draft.target, ctx) });
    if (res.refused) {
      setRefused(res.refused);
      return;
    }
    close();
    onAdded(res.added);
  };

  const renderPart = (p: string): ReactNode => {
    switch (p) {
      case 'target':
        return isLore ? (
          <LoreSubjectPart key={p} value={d.subject ?? ''} onChange={(subject) => update({ subject })} refusal={loreRefusal} />
        ) : (
          <TargetPart key={p} value={d.target} options={targets} onChange={(t) => update({ target: t, value: d.value })} />
        );
      case 'number': {
        if (kind === 'grant.spell' && spell?.ritual) return <StaticPart key={p} part="number" label="Spell rank" text={NO_RITUAL_RANK} />;
        const w = numberWords(kind!, target, character);
        const ph = kind === 'grant.spell' ? (spell ? `its rank: ${spell.rank}` : undefined) : book !== undefined ? `book: ${book}` : undefined;
        return (
          <NumberPart
            key={p}
            label={w.label}
            ariaLabel={w.aria}
            value={d.value ?? null}
            placeholder={ph}
            min={kind === 'grant.spell' ? 0 : w.min}
            max={kind === 'grant.spell' ? 10 : undefined}
            onCommit={(value) => update({ value })}
            onClear={() => update({ value: null })}
            onDraft={(value) => update({ value })}
          />
        );
      }
      case 'bonusType':
        return <BonusTypePart key={p} value={d.bonusType} onChange={(bonusType) => update({ bonusType })} />;
      case 'rank':
        return (
          <RankPart
            key={p}
            value={d.rank ?? 'trained'}
            untrained={kind === 'rank.exactly'}
            onChange={(rank) => update({ rank })}
            note={target && /^(weapon|armor):/.test(target) ? <PartNote text={CATEGORY_RANK_NOTE} /> : undefined}
          />
        );
      case 'picker':
        // WP13: ANY_PICKERS holds only the built pickers (a skill increase taken anyway is WP12, after the rebuild).
        return <PickerPart key={p} value={d.picker} pickers={ANY_PICKERS} onChange={(picker) => update({ picker, record: undefined, answer: undefined })} />;
      case 'answer':
        if (kind === ADD_PLACE_KIND) {
          // WP11: the carrier's answer — a skill or Lore the character knows at that level (its greys), or an attribute.
          if (placeKind === 'skillIncrease')
            return <AnswerPart key={p} mode="skill" label="Skill" value={d.placeAnswer} options={carrierSkillOptions(character, d.placeLevel)} newLore={false} onCommit={(placeAnswer) => update({ placeAnswer })} />;
          if (placeKind === 'boost') return <AnswerPart key={p} mode="attribute" label="Attribute" value={d.placeAnswer} onCommit={(placeAnswer) => update({ placeAnswer })} />;
          return null;
        }
        return d.picker === 'sanctification' ? <AnswerPart key={p} mode="sanctification" label="Allowed answer" value={d.answer} onCommit={(answer) => update({ answer })} /> : null;
      case 'record':
        if (kind === ANY_KIND && !d.picker) return <StaticPart key={p} part="record" label="Record" text="Choose the picker first." />;
        return (
          <RecordPart
            key={p}
            label={kind === ANY_KIND ? (ANY_RECORD_LABEL[d.picker!] ?? 'Record') : (RECORD_LABEL[kind!] ?? 'Record')}
            value={d.record}
            options={records}
            onChange={(record) => update({ record, text: undefined, value: kind === 'grant.spell' ? undefined : d.value })}
            note={
              kind === 'grant.classFeature' ? <PartNote text={CLASS_FEATURE_NOTE} /> : castNote ? <PartNote text={castNote} /> : undefined
            }
          />
        );
      case 'text':
        return d.record ? (
          <TextPart
            key={`${p}:${d.record}`}
            name={d.text?.name ?? textBook.name}
            description={d.text?.description ?? textBook.description}
            onCommit={(t) => update({ text: { ...d.text, ...t } })}
            onDraft={(t) => update({ text: { ...d.text, ...t } })}
          />
        ) : (
          <StaticPart key={p} part="text" label="Your text" text="Choose the feat or class feature first." />
        );
      case 'level':
        return <LevelPart key={p} value={d.level ?? null} onCommit={(level) => update({ level })} onDraft={(level) => update({ level })} />;
      case 'rule':
        return kind === 'choice.anyList' ? <RulePart key={p} rules={ANY_LIST_RULES} value={d.rule} onChange={(rule) => update({ rule })} /> : null;
      case 'count': {
        // WP8: "More times" — never below the copies the chosen feat already holds past the book (the row's floor).
        const floor = extraCopiesHeld(build, content, d.record);
        return <CountPart key={p} value={d.times ?? floor} floor={floor} onCommit={(times) => update({ times })} onDraft={(times) => times != null && update({ times })} />;
      }
      case 'place':
        if (kind === ADD_PLACE_KIND)
          return (
            <PlacePart
              key={p}
              mode="add"
              // WP11: a feat place (the first kind), an extra skill increase or an extra attribute boost. Another kind
              // drops the other kind's own answer (a skill is no attribute).
              value={{ place: placeKind, level: d.placeLevel, category: d.placeCategory }}
              categories={placeCats}
              onChange={(patch) =>
                update({
                  ...('level' in patch ? { placeLevel: patch.level } : {}),
                  ...('category' in patch ? { placeCategory: patch.category } : {}),
                  ...(patch.place && patch.place !== placeKind ? { placeKind: patch.place as Draft['placeKind'], placeAnswer: undefined } : {}),
                })
              }
            />
          );
        return kind === 'remove.choicePlace' ? <FeatPlacePart key={p} label="Place" value={d.placeKey} options={placeOpts} onChange={(placeKey) => update({ placeKey })} /> : null;
      case 'reason':
        return <ReasonPart key={p} value={d.reason ?? ''} onCommit={(reason) => update({ reason })} onDraft={(reason) => update({ reason })} />;
      default:
        return null;
    }
  };

  const showChooser = kinds.length > 1;
  return (
    <div className="tw-editor tw-add-editor" data-menu={menu.name}>
      <div className="tw-parts">
        {parts.slice(0, parts[0] === 'target' ? 1 : 0).map(renderPart)}
        {showChooser && <OptionChooser kinds={kinds} value={kind} onChange={(k) => update({ kind: k })} />}
        {parts.slice(parts[0] === 'target' ? 1 : 0).map(renderPart)}
      </div>
      {advParts.length > 0 && kind && (
        <AdvancedFold open={advOpen} onToggle={() => setAdvOpen((o) => !o)}>
          {advParts.map(renderPart)}
        </AdvancedFold>
      )}
      {refused && <PartNote text={refused} refusal />}
      <div className="tw-editor-actions">
        {made && 'missing' in made && <span className="tw-missing">{made.missing}</span>}
        <button type="button" className="tw-add-cancel" onClick={() => {
          close();
          onCancel();
        }}>
          Cancel
        </button>
        <button type="button" className="tw-add-go" disabled={!made || !('draft' in made)} onClick={add}>
          <i className="ti ti-plus" aria-hidden="true" /> Add
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── a row's own editor ─────────────────────────────── */

/** The fields a tweak keeps when its kind changes to one stored under another key (remove + add). */
function carriedDraft(b: BlockInstance, kind: string, target: string | undefined): TweakDraft {
  const start = startLevelOf(b);
  return {
    kind,
    ...(target ? { target } : {}),
    ...(typeof b.value === 'number' ? { value: b.value } : {}),
    ...(b.rank ? { rank: b.rank } : {}),
    ...(kind === 'number.add' && b.bonusType ? { bonusType: b.bonusType } : {}),
    ...(start > 1 ? { from: start } : {}),
    ...(b.reason ? { reason: b.reason } : {}),
    ...(b.on ? {} : { on: false }),
  };
}

export function TweakRowEditor({ row, ...ctx }: EditorContext & { row: TweakRowModel }) {
  const { build, character, content, bookContent } = ctx;
  const b = row.inst;
  const def = blockKind(row.kind);
  const menu = menuOfKind(row.kind);
  const [advOpen, setAdvOpen] = useState(!!b?.bonusType);
  const [refused, setRefused] = useState<string | null>(null);
  const targets = useMemo(() => {
    if (!menu || !menuHasTarget(menu)) return [];
    const list = menuTargets(menu, character).map((t) => ({ id: t.key, name: t.label, group: t.group }));
    const cur = b?.target;
    return cur && !list.some((o) => o.id === cur) ? [...list, { id: cur, name: targetName(cur, character.spellcasting, { page: true }) }] : list;
  }, [menu, character, b?.target]);
  const records = useMemo(() => (def?.editor?.parts.includes('record') ? recordOptions(row.kind, ctx, typeof b?.record === 'string' ? b.record : undefined) : []), [row.kind, content, character, ctx.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b || !def?.editor) return null;
  // Tweaks phase 2 (WP2): a choice tweak draws its own parts (./ChoiceEditor.tsx), written as `fields`.
  if (isChoiceKind(def)) return <ChoiceRowEditor row={row} build={build} content={content} write={ctx.write} character={character} />;

  const target = b.target;
  const kinds = menu && target ? menuKindsFor(menu, target) : [];
  const parts = editorParts(row.kind, menu);
  const advParts = def.editor.advancedParts ?? [];

  const done = (res: EditorWriteResult) => setRefused(res.refused ?? null);
  const update = (draft: Partial<TweakDraft>, baseline: { baseline?: number } = {}) => done(ctx.write({ op: 'update', key: row.key, draft, ...baseline }));
  /** Change the kind (a chosen option, or a target this kind cannot hold): in place when both are stored
   *  under the same key, else one remove + add carrying the reason, start level and on/off. */
  const changeKind = (kind: string, to: string | undefined) => {
    const baseline = baselineOf(kind, to, ctx);
    if (storageOf(kind) === storageOf(row.kind)) {
      update({ ...(kind !== row.kind ? { kind } : {}), ...(to !== undefined ? { target: to } : {}), ...(kind === 'attribute.add' ? { bonusType: undefined } : {}) }, baseline);
      return;
    }
    done(ctx.write([{ op: 'remove', key: row.key }, { op: 'add', draft: carriedDraft(b, kind, to), ...baseline }]));
  };
  const onTarget = (to: string) => {
    if (to === target || !menu) return;
    const kind = kindAccepts(row.kind, to) ? row.kind : resolveMenuKind(menu, to);
    if (kind) changeKind(kind, to);
  };
  const book = isNumberKind(row.kind) ? bookNumber(character, content, build, target) : undefined;
  const start = startLevelOf(b);
  const storedLevel = LEVELLED.has(row.kind) ? Math.max(Number(b.params?.level) || 1, start) : start;
  const recordId = typeof b.record === 'string' ? b.record : undefined;
  const spell = row.kind === 'grant.spell' && recordId ? content.spells?.[recordId] : undefined;
  const stored = row.kind === 'text.edit' && recordId ? storedTextEdit(build, recordId) : {};
  const textBook = row.kind === 'text.edit' ? bookText(bookContent, recordId) : { name: '', description: '' };

  const renderPart = (p: string): ReactNode => {
    switch (p) {
      case 'target':
        return <TargetPart key={p} value={target} options={targets} onChange={onTarget} />;
      case 'number': {
        if (row.kind === 'grant.spell') {
          if (spell?.ritual) return <StaticPart key={p} part="number" label="Spell rank" text={NO_RITUAL_RANK} />;
          const r = typeof b.params?.rank === 'number' ? b.params.rank : null;
          return (
            <NumberPart
              key={p}
              label="Spell rank"
              ariaLabel="Spell rank"
              value={r}
              placeholder={spell ? `its rank: ${spell.rank}` : undefined}
              min={0}
              max={10}
              onCommit={(n) => update({ spellRank: n })}
              onClear={() => update({ spellRank: spell?.rank ?? 1 })}
            />
          );
        }
        const w = numberWords(row.kind, target, character);
        return (
          <NumberPart
            key={p}
            label={w.label}
            ariaLabel={w.aria}
            value={typeof b.value === 'number' ? b.value : null}
            placeholder={book !== undefined ? `book: ${book}` : undefined}
            min={w.min}
            onCommit={(n) => update({ value: n }, baselineOf(row.kind, target, ctx))}
            // Emptied and left: the tweak goes (the old card's "back to the computed number").
            onClear={() => done(ctx.write({ op: 'remove', key: row.key }))}
          />
        );
      }
      case 'bonusType':
        return <BonusTypePart key={p} value={b.bonusType} onChange={(bonusType) => update({ bonusType })} />;
      case 'rank':
        return (
          <RankPart
            key={p}
            value={b.rank}
            untrained={row.kind === 'rank.exactly'}
            onChange={(rank) => update({ rank })}
            note={target && /^(weapon|armor):/.test(target) ? <PartNote text={CATEGORY_RANK_NOTE} /> : undefined}
          />
        );
      case 'record':
        return (
          <RecordPart
            key={p}
            label={RECORD_LABEL[row.kind] ?? 'Record'}
            value={recordId}
            options={records}
            onChange={(id) => {
              if (id === recordId) return;
              const category = row.kind === 'grant.feat' ? content.feats?.[id]?.category : undefined;
              // Another spell is added at ITS own rank, as the Add editor does: the old spell's rank belongs to it.
              const spellRank = row.kind === 'grant.spell' ? (content.spells?.[id]?.rank ?? 1) : undefined;
              update({ record: id, ...(category ? { category } : {}), ...(spellRank !== undefined ? { spellRank } : {}) });
            }}
            note={row.kind === 'grant.classFeature' ? <PartNote text={CLASS_FEATURE_NOTE} /> : undefined}
          />
        );
      case 'text':
        return (
          <TextPart
            key={`${p}:${recordId}`}
            name={stored.name ?? textBook.name}
            description={stored.description ?? textBook.description}
            // A field typed back to the book's own text is no edit: it is cleared.
            onCommit={(t) =>
              update({
                text: {
                  ...('name' in t ? { name: t.name === textBook.name ? undefined : t.name } : {}),
                  ...('description' in t ? { description: t.description === textBook.description ? undefined : t.description } : {}),
                },
              })
            }
          />
        );
      case 'level':
        return (
          <LevelPart
            key={p}
            value={storedLevel > 1 ? storedLevel : null}
            onCommit={(n) => update(LEVELLED.has(row.kind) ? { level: clamp(n, 1, 20) } : { from: clamp(n, 1, 20) })}
          />
        );
      case 'reason':
        return <ReasonPart key={p} value={b.reason ?? ''} onCommit={(t) => update({ reason: t.trim() || undefined })} />;
      default:
        return null;
    }
  };

  return (
    <>
      <div className="tw-parts">
        {parts.slice(0, parts[0] === 'target' ? 1 : 0).map(renderPart)}
        {kinds.length > 1 && <OptionChooser kinds={kinds} value={row.kind} onChange={(k) => k !== row.kind && changeKind(k, target)} />}
        {parts.slice(parts[0] === 'target' ? 1 : 0).map(renderPart)}
      </div>
      {advParts.length > 0 && (
        <AdvancedFold open={advOpen} onToggle={() => setAdvOpen((o) => !o)}>
          {advParts.map(renderPart)}
        </AdvancedFold>
      )}
      {refused && <PartNote text={refused} refusal />}
    </>
  );
}
