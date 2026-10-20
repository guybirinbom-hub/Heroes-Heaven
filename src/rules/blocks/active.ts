/*
 * THE ONE READER of the tweak NUMBER blocks a character carries (`overrides.blocks`), for the term lists
 * in derive.ts and the attribute seam in build.ts.
 *
 * Design: docs/overrides-redesign.md, spec items 2 and 4, Building blocks items 4–6. A block reaches a
 * number only when ALL of these hold:
 *   - its kind is registered with `applies: 'blocks'` and is a number or score kind;
 *   - it is on (not paused) and not `broken` (decision 13: a broken block is listed, never applied);
 *   - its start level (`gate.startLevel`) is at or below the character's level (spec item 9);
 *   - its target is one this phase builds (`targetBuilt`);
 *   - the Tweaks master switch is on. "ON by read" (spec item 2): a character whose `overrides.v` is
 *     absent has never been saved by a Tweaks-aware app, so its changes were always live — it reads as
 *     ON. From `overrides.v >= 2` (written by part B's first real Builder save, together with the
 *     switch) the stored `options.overridesEnabled` is obeyed. Part A never writes `v` (checker C4); the
 *     field is read through a narrow cast because part B declares it when it starts writing it.
 *
 * Tweak terms are never Modes and never light the "a mode moved this number" highlight (decision 4): they
 * enter the term lists as layer 'tweak', and the highlight reads `activeModes` only.
 */
import type { AbilityId, BuildOverrides, CharacterOptions } from '../types';
import { blockKind, type BlockInstance } from './registry';
import { parseStoredBlocks } from './stored';
import { targetBuilt } from './targets';
import type { Term } from './terms';

/** What the reader needs from a Character (or a BuildState, at the build seam). */
export interface TweakHost {
  overrides?: BuildOverrides;
  options?: CharacterOptions;
  level: number;
}

/** The Tweaks master switch, as spec item 2 reads it. */
export function tweaksSwitchOn(h: Pick<TweakHost, 'overrides' | 'options'>): boolean {
  const ov = h.overrides;
  if (!ov) return false;
  const v = (ov as { v?: unknown }).v;
  if (typeof v === 'number' && v >= 2) return h.options?.overridesEnabled === true;
  return true;
}

/** Parsed once per stored list. Keyed by the `overrides.blocks` value itself (every edit writes a new
 *  list), so an edit can never be served a stale parse. */
const PARSED = new WeakMap<object, BlockInstance[]>();
function parsedBlocks(list: unknown): BlockInstance[] {
  if (!list || typeof list !== 'object') return parseStoredBlocks(list).known;
  let got = PARSED.get(list);
  if (!got) {
    got = parseStoredBlocks(list).known;
    PARSED.set(list, got);
  }
  return got;
}

/** Every active number or score block the character carries (see the header for "active"). */
export function activeNumberBlocks(h: TweakHost): BlockInstance[] {
  const ov = h.overrides;
  if (!ov || ov.blocks === undefined || !tweaksSwitchOn(h)) return [];
  return parsedBlocks(ov.blocks).filter((b) => {
    const def = blockKind(b.kind);
    if (!def || def.applies !== 'blocks' || !('aspect' in def.accepts)) return false;
    if (!b.on || b.broken || typeof b.value !== 'number' || !b.target) return false;
    if ((b.gate?.startLevel ?? 1) > (h.level ?? 1)) return false;
    return targetBuilt(b.target, def.accepts.aspect);
  });
}

/** One block as a term of its number's list (layer 'tweak', slot from the registry). */
export function blockTerm(b: BlockInstance): Term {
  const def = blockKind(b.kind)!;
  const slot = def.slot === 'set' ? 'set' : def.slot === 'atLeast' ? 'atLeast' : 'add';
  return {
    // A set or "at least" names a number, not a bonus: its type plays no part.
    type: slot === 'add' ? (b.bonusType ?? 'untyped') : 'untyped',
    value: b.value as number,
    label: def.line(b),
    layer: 'tweak',
    key: b.key,
    source: b.source,
    slot,
  };
}

/** The tweak terms aimed at one number target (a TargetRef key: `save:fortitude`, `skill:lore:sailing`,
 *  `spell-dc@casting-entry:<id>`, `speed:land`, …), in stored order. */
export function numberTweakTerms(h: TweakHost, target: string): Term[] {
  const out: Term[] = [];
  for (const b of activeNumberBlocks(h)) {
    if (b.target !== target || blockKind(b.kind)?.family !== 'number') continue;
    out.push(blockTerm(b));
  }
  return out;
}

/** The active `attribute.add` blocks on one attribute score, in stored order. */
export function scoreAddBlocks(h: TweakHost, ability: AbilityId): BlockInstance[] {
  return activeNumberBlocks(h).filter((b) => b.kind === 'attribute.add' && b.target === `score:${ability}`);
}
