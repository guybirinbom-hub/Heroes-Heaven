/*
 * "REMOVE A PLACE" ON THE LEVEL PAGE (Tweaks phase 2, WP6; plan C17, C29, C42, section 2 row 13).
 *
 * A printed feat slot a live `remove.choicePlace` removes is not drawn: the level page shows the thin line
 * "Class feat place removed — Restore" in its place, and a pick it held moves to the "Feat with no slot" row (still on
 * the character, still counted) with "Fleet stays as a feat with no slot". The card menu's "Remove this place" asks
 * nothing (Restore and Ctrl+Z undo it). This file is the one place that:
 *
 *   - turns a place into its drafts (`removePlaceDrafts`): a PAUSED removal of the same place switched back on, else a
 *     new block (the write door refuses a second copy of one);
 *   - draws the thin line (`RemovedPlaceLine`) with its Tweak mark.
 *
 * Which slots are removed is the engine's (`removedPlaceKeys` / `removedSlotKeys`): this file never decides it.
 *
 * WP14 (C47): a skill-increase card and a boost set use the same door — `removeChoicePlace` (one write, no confirm, a
 * refusal said) from the card menu, `restoreChoicePlace` from Restore — and draw a removed place as
 * `RemovedChoicePlace`: the kept row "Stealth — kept, doesn't count (place removed)" with Restore when it holds an
 * answer (the answer stays in its store), else the thin line "Skill increase at level 5 removed". `boostSetParts` is
 * one boost set's menu entries and removed rows, for the level page and the three Setup sets alike. Which places are
 * removed is the engine's (`removedSkillIncreasePlaces` / `removedBoostIndexes`).
 */
import type { ReactNode } from 'react';
import { removedBoostIndexes, storedChoiceBlocks } from '../../rules/blocks/active';
import { ABILITY_NAME } from '../../rules/blocks/names';
import { tweaksPageOn } from '../../rules/blocks/stored';
import { dropChoiceTweak, writeChoiceTweak, type ChoiceDraft } from '../../rules/blocks/write';
import type { BuildState } from '../../rules/build';
import type { AbilityId, BuildOverrides, CharacterOptions } from '../../rules/types';
import type { SlotCardMenuItem } from '../FeatSlotCard';
import { KeptAnswerRow } from './choiceParts';
import { notSaved } from './takeAnyway';
import { TweakMark, tweakMarkState } from './TweakMark';

type Host = { overrides?: BuildOverrides; options?: CharacterOptions };
const KIND = 'remove.choicePlace';
/** The fields that name a removed place (every place kind's identity, section 4). */
const PLACE_FIELDS = ['place', 'set', 'classId', 'group', 'level', 'category', 'lane', 'index', 'ordinal'] as const;

/** A printed feat slot as a removal names it: (level, category, ordinal) — never the slot key (C32). */
export interface FeatPlaceRef {
  level: number;
  category: string;
  ordinal: number;
}

/** The drafts that remove a place named by its stored fields (`place` and its identity): none while a live removal
 *  already does, a paused one switched back on, else a new block. */
export function removeChoicePlaceDrafts(host: Host, fields: Record<string, unknown>): ChoiceDraft[] {
  const same = storedChoiceBlocks(host).filter((b) => b.kind === KIND && !b.broken && PLACE_FIELDS.every((f) => b.params?.[f] === fields[f]));
  if (same.some((b) => tweakMarkState(host, b) === 'live')) return [];
  if (same[0]) return [{ key: same[0].key, kind: KIND, on: true }];
  return [{ kind: KIND, fields }];
}

/** The drafts that remove a feat place (WP6). */
export function removePlaceDrafts(host: Host, p: FeatPlaceRef): ChoiceDraft[] {
  return removeChoicePlaceDrafts(host, { place: 'feat', level: p.level, category: p.category, ordinal: p.ordinal });
}

type Patch = (p: (b: BuildState) => Partial<BuildState>) => void;

/** WP14: the card menu's "Remove this place" for a skill increase or a boost place — one write through the door, no
 *  confirm (Restore and Ctrl+Z undo it); a refusal is said and nothing is written. */
export function removeChoicePlace(build: BuildState, patch: Patch, fields: Record<string, unknown>): void {
  const tried = writeChoiceTweak(build, removeChoicePlaceDrafts(build, fields));
  if (tried.refused) {
    void notSaved(tried.refused);
    return;
  }
  patch((b) => {
    const r = writeChoiceTweak(b, removeChoicePlaceDrafts(b, fields));
    return r.refused ? {} : r.build;
  });
}

/** WP14: Restore = the removal deleted (the answer never left its store, so the place is back with it). */
export function restoreChoicePlace(patch: Patch, key: string): void {
  patch((b) => {
    const r = dropChoiceTweak(b, key);
    return r.refused ? {} : r.build;
  });
}

/**
 * WP14 (C47): a removed skill-increase or boost place where its card or select was. Holding an answer: the kept row
 * ("Stealth — kept, doesn't count (place removed)", the Tweak mark, Restore). Empty: the thin line (`text`, e.g. "Skill
 * increase at level 5 removed", Restore). `placeKey`: `skillIncrease:<lane>:<level>` / `boost:<set>:<level>:<index>`.
 */
export function RemovedChoicePlace({
  placeKey,
  text,
  answer,
  reason,
  onRestore,
  onShow,
}: {
  placeKey: string;
  text: string;
  answer?: string;
  reason?: string;
  onRestore: () => void;
  onShow?: () => void;
}) {
  if (!answer) return <RemovedPlaceLine slotKey={placeKey} label="" text={text} reason={reason} onRestore={onRestore} onShow={onShow} />;
  return (
    <div className="lvl-removed-kept" data-removed-place={placeKey}>
      <KeptAnswerRow
        answer={answer}
        status="kept, doesn't count (place removed)"
        reason={reason}
        action={{ label: 'Restore', onClick: onRestore }}
        mark={<TweakMark kind={KIND} state="live" rule="A place the book gives, removed by a tweak" reason={reason} onShow={onShow} />}
      />
    </div>
  );
}

const SET_WORD: Record<string, string> = { ancestry: 'Ancestry boost', background: 'Background boost', free: 'Free boost', level: 'Attribute boost' };

/**
 * WP14: one boost set's tweak parts — the stored indexes a live removal names (`removed`: draw no select there), the
 * card menu's entries ("Remove boost place 3 (Dexterity)", one per place still counting; Tweaks on only, else
 * undefined) and the removed places' rows. `count`: the places the set draws; `picks`: its stored list.
 */
export function boostSetParts(
  build: BuildState,
  patch: Patch,
  set: 'ancestry' | 'background' | 'free' | 'level',
  count: number,
  picks: readonly (AbilityId | null)[] | undefined,
  level?: number,
  onShow?: (key: string) => void,
): { removed: ReadonlyMap<number, string>; menu: SlotCardMenuItem[] | undefined; rows: ReactNode[] } {
  const removed = removedBoostIndexes(build, set, level);
  const fields = (i: number) => ({ place: 'boost', set, ...(set === 'level' ? { level } : {}), index: i });
  const items: SlotCardMenuItem[] = [];
  for (let i = 0; i < count; i++) {
    if (removed.has(i)) continue;
    const pick = picks?.[i];
    items.push({ label: `Remove boost place ${i + 1}${pick ? ` (${ABILITY_NAME[pick] ?? pick})` : ''}`, icon: 'ti-square-minus', onSelect: () => removeChoicePlace(build, patch, fields(i)) });
  }
  const rows: ReactNode[] = [];
  for (const [i, key] of [...removed].sort((a, b) => a[0] - b[0])) {
    if (i >= count) continue;
    const pick = picks?.[i];
    const placeKey = `boost:${set}:${set === 'level' ? (level ?? 0) : 0}:${i}`;
    rows.push(
      <RemovedChoicePlace
        key={placeKey}
        placeKey={placeKey}
        text={`${SET_WORD[set]} place ${i + 1} removed`}
        answer={pick ? (ABILITY_NAME[pick] ?? pick) : undefined}
        reason={storedChoiceBlocks(build).find((b) => b.key === key)?.reason}
        onRestore={() => restoreChoicePlace(patch, key)}
        onShow={onShow ? () => onShow(key) : undefined}
      />,
    );
  }
  return { removed, menu: tweaksPageOn(build) && items.length ? items : undefined, rows };
}

/** The thin line a removed printed feat slot leaves on its level page: "Class feat place removed", the Tweak mark,
 *  Restore. WP14: `text` replaces the words (a removed empty skill increase or boost place). */
export function RemovedPlaceLine({
  slotKey,
  label,
  text,
  reason,
  onRestore,
  onShow,
}: {
  slotKey: string;
  label: string;
  text?: string;
  reason?: string;
  onRestore: () => void;
  onShow?: () => void;
}) {
  return (
    <div className="lvl-removed-place" data-removed-place={slotKey}>
      <span className="lvl-removed-text">{text ?? `${label} place removed`}</span>
      <TweakMark kind={KIND} state="live" rule="A place the book gives, removed by a tweak" reason={reason} onShow={onShow} />
      <button className="lvl-restore-btn" type="button" onClick={onRestore}>
        <i className="ti ti-arrow-back-up" aria-hidden="true" /> Restore
      </button>
    </div>
  );
}
