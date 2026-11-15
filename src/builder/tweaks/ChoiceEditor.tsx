/*
 * A CHOICE TWEAK'S OWN EDITOR (Tweaks phase 2, WP2; plan section 2b). An open Choices row draws the parts its
 * registry entry names (`editor.parts`) from the seven choice parts in ./parts.tsx, and each change is written at
 * once through the write door as an `update` with `fields` (B22) — never a remove + add, so the row keeps its id,
 * its reason and its switch. A part with nothing this version can change shows as a static line saying what it
 * holds. The five kinds this version applies each have their "Add a tweak" menu (WP4-WP14). WP13 (re-scoped
 * 2026-10-25): "Change an answer" and "Edit a list" (WP9 steps 1-3, WP10), a skill increase taken anyway (WP12) and a
 * removed class-choice, tactic or rune place (WP15-WP17) come after the record rebuild; a stored one reads as made in
 * a newer version (a read-only row, never this editor), so nothing here edits one.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ANY_LIST_RULES, blockKind, ruleWords, type BlockInstance } from '../../rules/blocks/registry';
import { loreName } from '../../rules/blocks/names';
import { PLACE_HOLDS_ANSWERS, heldUnderPlace, type TweakDraft } from '../../rules/blocks/write';
import { featPlaceKey } from '../../rules/blocks/active';
import { SANCTIFICATION_FROM_DEITY } from '../../rules/build';
import type { Character, ContentDatabase } from '../../rules/types';
import { cap } from '../shared';
import type { BuildState } from '../../rules/build';
import { PICKER_BUCKETS, carrierSkillOptions, featPlaceCategories, heldInPlace, moreTakesTally, type TweakRowModel } from './model';
import { AnswerPart, CountPart, PICKER_LABEL, PlacePart, RulePart, type PlaceValue } from './choiceParts';
import { PartNote, ReasonPart, RecordPart, StaticPart, type PartOption } from './parts';
import type { EditorWrite } from './TweakEditor';

export const RECORD_LABEL: Record<string, string> = {
  heritage: 'Heritage',
  background: 'Background',
  deity: 'Deity',
  subclass: 'Subclass',
  spell: 'Spell',
  sanctification: 'Asked by',
};
const RULES: Record<string, readonly string[]> = {
  'choice.anyList': ANY_LIST_RULES,
};

/** The subclass options of these classes (a subclass "Take anyway" names its class), each with its class as group
 *  when there are several. */
function subclassRecords(content: ContentDatabase, classIds: readonly string[]): PartOption[] {
  return classIds.flatMap((cid) =>
    (content.classes?.[cid]?.subclass?.options ?? []).map((o) => ({ id: o.id, name: o.name, ...(classIds.length > 1 ? { group: content.classes[cid]?.name ?? cid } : {}) })),
  );
}

/** The options of a record picker for one choice tweak: the records of its picker's buckets (a feat for the
 *  feat kinds), plus the stored one if no list holds it. Exported for the "Add a tweak" flow of "Take anyway in
 *  another picker" (WP4). */
export function choiceRecords(kind: string, p: Record<string, unknown>, content: ContentDatabase, self: string | undefined): PartOption[] {
  let out: PartOption[];
  if (kind === 'choice.allowAnywayAnyPicker' && p.picker === 'subclass') {
    // WP4 (the WP2 check finding): a subclass allow names its class; only that class's own options are offered.
    out = subclassRecords(content, typeof p.classId === 'string' ? [p.classId] : []);
  } else if (kind === 'choice.allowAnywayAnyPicker' && p.picker === 'sanctification') {
    out = [...SANCTIFICATION_FROM_DEITY].map((id) => ({ id, name: nameOf(content, id) }));
  } else {
    const buckets = kind === 'choice.allowAnywayAnyPicker' ? (PICKER_BUCKETS[String(p.picker)] ?? []) : ['feats' as const];
    out = buckets.flatMap((bucket) =>
      Object.values((content[bucket as keyof ContentDatabase] ?? {}) as Record<string, { id: string; name: string; level?: number }>).map((r) => ({
        id: r.id,
        name: r.name,
        ...(typeof r.level === 'number' ? { note: `Level ${r.level}` } : {}),
        ...(buckets.length > 1 ? { group: bucket === 'feats' ? 'Feats' : 'Class features' } : {}),
      })),
    );
  }
  if (self && !out.some((o) => o.id === self)) out.push({ id: self, name: self.startsWith('lore:') ? loreName(self) : nameOf(content, self), note: 'Not in this list' });
  return out;
}

/** "Take a feat more times": how many copies past the book's limit the character already holds, so the count never
 *  drops below the copies used (plan section 2b) — lowering it would silently stop a feat the player took. WP8: the
 *  ONE counter `slotRefusal`'s "Already taken" and the row's "taken N of M" read (`moreTakesTally` →
 *  featSlots.ts `featCopiesHeld`): every slot and extra place in the STORAGE view (WP7, C9: a copy in a paused extra
 *  place is still the player's, and lowering the count under it would refuse it when the place is resumed), a given
 *  feat no slot holds, a background's granted feat. A pick-a-feat answer or a dedication's bonus skill feat is not
 *  counted: those lanes keep the book's cap (C23), so no copy of theirs ever uses the tweak. */
export function extraCopiesHeld(build: BuildState, content: ContentDatabase, recordId: string | undefined): number {
  if (!recordId) return 1;
  const t = moreTakesTally(build, content, recordId);
  return Number.isFinite(t.book) ? Math.max(1, t.held - t.book) : 1;
}

/** A record's name from whichever list holds it (a feat, class feature, background, heritage, deity or class);
 *  its id when none does. */
function nameOf(content: ContentDatabase, id: string): string {
  for (const bucket of ['feats', 'classFeatures', 'backgrounds', 'heritages', 'deities', 'classes'] as const) {
    const r = (content[bucket] as Record<string, { name?: string }> | undefined)?.[id];
    if (r?.name) return r.name;
  }
  return id;
}

export function ChoiceRowEditor({ row, build, content, write, character }: { row: TweakRowModel; build: BuildState; content: ContentDatabase; write: EditorWrite; character?: Character | null }) {
  const b = row.inst as BlockInstance;
  const p = (b.params ?? {}) as Record<string, unknown>;
  const kind = row.kind;
  const def = blockKind(kind);
  const [refused, setRefused] = useState<string | null>(null);
  const recordId = typeof b.record === 'string' ? b.record : typeof p.record === 'string' ? p.record : undefined;
  const records = useMemo(() => (def?.editor?.parts.includes('record') ? choiceRecords(kind, p, content, recordId) : []), [kind, content, recordId, p.picker]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!def?.editor) return null;

  const update = (draft: Partial<TweakDraft>) => setRefused(write({ op: 'update', key: row.key, draft }).refused ?? null);
  const setFields = (fields: Record<string, unknown>) => update({ fields });
  const picker = String(p.picker ?? '');

  const renderPart = (part: string): ReactNode => {
    switch (part) {
      case 'picker':
        // Another picker is another tweak (its record lives in another list): the picker shows, never changes here.
        return <StaticPart key={part} part="picker" label="Picker" text={PICKER_LABEL[picker] ?? cap(picker)} />;
      case 'record':
        if (kind === 'choice.allowAnywayAnyPicker' && picker === 'sanctification')
          return <StaticPart key={part} part="record" label="Asked by" text={recordId ? nameOf(content, recordId) : '—'} />;
        // Section 2b: a feat allowed past a list, or taken more times, keeps its feat (another feat is another
        // tweak, and the door's duplicate check runs on add only); its rule or count is what changes.
        if (kind === 'choice.anyList' || kind === 'choice.moreTakes')
          return <StaticPart key={part} part="record" label="Feat" text={recordId ? nameOf(content, recordId) : '—'} />;
        return (
          <RecordPart
            key={part}
            label={kind === 'choice.allowAnywayAnyPicker' ? (RECORD_LABEL[picker] ?? 'Record') : 'Feat'}
            value={recordId}
            options={records}
            onChange={(id) => id !== recordId && update({ record: id })}
          />
        );
      case 'answer': {
        if (kind === 'choice.allowAnywayAnyPicker') {
          if (picker !== 'sanctification') return null;
          return <AnswerPart key={part} mode="sanctification" label="Allowed answer" value={typeof p.value === 'string' ? p.value : undefined} onCommit={(value) => setFields({ value })} />;
        }
        if (kind === 'choice.addPlace') {
          // WP11: a skill or Lore the character knows at the place's level, with the level's own greys (no new Lore).
          if (p.place === 'skillIncrease')
            return (
              <AnswerPart
                key={part}
                mode="skill"
                label="Skill"
                value={typeof p.skill === 'string' ? p.skill : undefined}
                options={carrierSkillOptions(character, typeof p.level === 'number' ? p.level : undefined)}
                newLore={false}
                onCommit={(skill) => setFields({ skill })}
              />
            );
          if (p.place === 'boost') return <AnswerPart key={part} mode="attribute" label="Attribute" value={typeof p.attribute === 'string' ? p.attribute : undefined} onCommit={(attribute) => setFields({ attribute })} />;
          return null; // a feat place's pick is made in its slot (WP7), never here
        }
        // WP13: a changed answer (WP10) comes after the record rebuild; its stored block is a read-only row.
        return null;
      }
      case 'place': {
        const v: PlaceValue = {
          place: typeof p.place === 'string' ? p.place : undefined,
          level: typeof p.level === 'number' ? p.level : undefined,
          category: typeof p.category === 'string' ? p.category : undefined,
          ordinal: typeof p.ordinal === 'number' ? p.ordinal : undefined,
          lane: typeof p.lane === 'string' ? p.lane : undefined,
          set: typeof p.set === 'string' ? p.set : undefined,
          index: typeof p.index === 'number' ? p.index : undefined,
        };
        // A place's kind is what the tweak IS: changing it is a new tweak, so it shows, never changes here. A removed
        // place changes nothing but its reason and switch (section 2b); an extra feat place keeps its level and kind
        // while it holds a feat (C12: moving it would leave the feat with no slot). WP7: or while answers an earlier
        // feat left stay under its key (the write door refuses that move too: nothing is ever left behind), and its
        // categories are the character's own (C13, the one list the level page's "Add a place" offers).
        const featPlace = kind === 'choice.addPlace' && p.place === 'feat';
        const held = featPlace ? heldInPlace(build, p) : undefined;
        const leftovers = featPlace && !held && heldUnderPlace(build, featPlaceKey(p.level, p.category, p.n)) === 'answers';
        return (
          <PlacePart
            key={part}
            mode={kind === 'choice.addPlace' ? 'add' : 'remove'}
            value={v}
            readOnly={kind === 'remove.choicePlace'}
            kindFixed
            categories={featPlace ? featPlaceCategories(build, content, v.category) : undefined}
            filled={held ? nameOf(content, held) : undefined}
            locked={leftovers ? `${PLACE_HOLDS_ANSWERS}.` : undefined}
            onChange={(patch) => {
              const { place: _place, ...rest } = patch;
              if (Object.keys(rest).length) setFields(rest);
            }}
          />
        );
      }
      case 'rule':
        return <RulePart key={part} rules={RULES[kind] ?? []} value={typeof p.rule === 'string' ? p.rule : undefined} onChange={(rule) => setFields({ rule })} />;
      case 'count':
        return <CountPart key={part} value={typeof p.times === 'number' ? p.times : null} floor={extraCopiesHeld(build, content, recordId)} onCommit={(times) => setFields({ times })} />;
      // WP13: the 'question' and 'options' parts are "Change an answer" and "Edit a list" (WP9 steps 1-3, WP10), after
      // the record rebuild: a stored one is a read-only row, never this editor.
      case 'reason':
        return <ReasonPart key={part} value={b.reason ?? ''} onCommit={(t) => update({ reason: t.trim() || undefined })} />;
      default:
        return null;
    }
  };

  return (
    <>
      <div className="tw-parts">{def.editor.parts.map(renderPart)}</div>
      {refused && <PartNote text={refused} refusal />}
      {/* ruleWords is the row line's own wording; the rule part offers the same words */}
      {kind === 'choice.anyList' && typeof p.rule === 'string' && !ruleWords(p.rule) && <PartNote text="This rule comes from a newer version of the app." />}
    </>
  );
}
