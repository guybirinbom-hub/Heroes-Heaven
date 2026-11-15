/*
 * WHAT A WANDERER'S GUIDE EXPORT CANNOT CARRY (plan B, WP9a; docs/overrides-redesign.md Building blocks item 6,
 * decision B20).
 *
 * The Wanderer's Guide v4 file has nowhere to put a tweak: `exportWg` (src/data/transfer.ts) bakes the LIVE
 * tweaks into the numbers it writes and drops `overrides` itself. A re-import therefore brings none of them
 * back as tweaks. Before such an export the roster lists every one of them (src/sheet/RosterScreen.tsx
 * `askExport`), so the player knows what the file loses:
 *   - EVERY stored tweak, grouped by kind (registry order), each as one readable line;
 *   - a tweak that does nothing right now — paused, starting at a later level, or Tweaks switched off — is
 *     marked "(off now)": it is lost on a re-import just like a live one (B20), so it is listed too;
 *   - a stored entry this version cannot read is listed as such ("can't be read"), never skipped
 *     (decision 13; UNKNOWN ≠ EMPTY);
 *   - the blocks kept unread (`readTweaks().foreign`: a newer app's version, a kind this app does not know,
 *     an element it cannot parse), one line each.
 *
 * Pure and read-only: it reads the stored `overrides` through the one stored reader (`readTweaks`), with the
 * character's read-time rank sort laid over it (`withRankSort`, so an old rank entry reads as the sheet
 * applies it), and asks the one "live" predicate (`entryLive`, blocks/active.ts). Nothing here writes.
 */
import type { ContentDatabase } from '../types';
import type { SavedChar } from '../../data/storage';
import { entryLive } from './active';
import { withRankSort } from './migrate';
import { recordName, targetName as nameOfTarget, type NamedEntries } from './names';
import { BLOCK_KINDS, blockKind, placeWords, ruleWords, type BlockInstance } from './registry';
import { readTweaks, type ForeignBlock } from './stored';

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Tweaks phase 2: the content bucket each "Take anyway" picker's record lives in (a subclass is a class feature;
 *  a sanctification names the asking feat or class feature). */
const PICKER_BUCKETS: Record<string, (keyof ContentDatabase)[]> = {
  heritage: ['heritages'],
  background: ['backgrounds'],
  deity: ['deities'],
  subclass: ['classFeatures'],
  spell: ['spells'],
  sanctification: ['feats', 'classFeatures'],
};

/** A record's name from the first bucket that has it; its id when none does. */
function nameIn(content: ContentDatabase | null | undefined, buckets: (keyof ContentDatabase)[], id: unknown): string {
  if (typeof id !== 'string' || !id) return 'an unnamed record';
  for (const b of buckets) {
    const rec = (content?.[b] as Record<string, { name?: string }> | undefined)?.[id];
    if (rec?.name) return rec.name;
  }
  return id;
}

/** A skill key as words: "stealth" → "Stealth", "lore:bardic" → "Bardic Lore". */
function skillWord(key: unknown): string {
  if (typeof key !== 'string' || !key) return '?';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return key.startsWith('lore:') ? `${cap(key.slice(5))} Lore` : cap(key);
}

/** A choice tweak's line (Tweaks phase 2, C34): the place, rule or answer it names, never the bare title. */
function choiceText(b: BlockInstance, content: ContentDatabase | null | undefined): string | undefined {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker': {
      const name = nameIn(content, PICKER_BUCKETS[String(p.picker)] ?? ['feats'], b.record);
      if (p.picker === 'sanctification') return `Taken anyway: ${typeof p.value === 'string' ? p.value : '?'} sanctification for ${name}`;
      return `Taken anyway (${String(p.picker)}): ${name}`;
    }
    case 'choice.anyList':
      return `Picked from any list: ${recordName(content, 'feats', b.record)}, past ${ruleWords(p.rule) ?? 'a rule'}`;
    case 'choice.moreTakes': {
      const n = typeof p.times === 'number' ? p.times : 0;
      return `Taken more times: ${recordName(content, 'feats', b.record)} (${n} more time${n === 1 ? '' : 's'})`;
    }
    case 'choice.addPlace': {
      const what = p.place === 'skillIncrease' && typeof p.skill === 'string' ? `: ${skillWord(p.skill)}` : p.place === 'boost' && typeof p.attribute === 'string' ? `: ${p.attribute.toUpperCase()}` : '';
      return `Extra ${placeWords(p) ?? 'place'}${what}`;
    }
    case 'remove.choicePlace':
      return `Removed: ${placeWords(p) ?? 'a choice place'}`;
    default:
      return undefined;
  }
}

const numberText = (b: BlockInstance) => (typeof b.value === 'number' ? String(b.value) : '?');
const rankText = (b: BlockInstance) => b.rank ?? '?';

/** One tweak as one line, without its state. `entries` names a spell attack / DC target's casting entry.
 *  Exported as `wgRowText` for the per-kind test (every kind's line differs from its bare title). */
export function wgRowText(b: BlockInstance, content: ContentDatabase | null | undefined, entries: NamedEntries): string {
  return rowText(b, content, entries);
}

function rowText(b: BlockInstance, content: ContentDatabase | null | undefined, entries: NamedEntries): string {
  const targetName = (key: string | undefined) => nameOfTarget(key, entries);
  /** A rank entry's track; an entry whose key names no track (a bare `lore:Lore`) shows its stored key. */
  const rankTarget = (x: BlockInstance) => targetName(x.target ?? `skill:${x.key.slice('proficiencies:'.length)}`);
  switch (b.kind) {
    case 'number.add':
    case 'attribute.add':
      return `${targetName(b.target)} ${typeof b.value === 'number' ? signed(b.value) : '?'}${b.bonusType ? ` ${b.bonusType}` : ''}`;
    case 'number.set':
    case 'number.setMaxHp':
    case 'attribute.set':
      return `${targetName(b.target)} set to ${numberText(b)}`;
    case 'number.atLeast':
      return `${targetName(b.target)} at least ${numberText(b)}`;
    case 'rank.atLeast':
      return `${rankTarget(b)}: at least ${rankText(b)}`;
    case 'rank.exactly':
      return `${rankTarget(b)}: exactly ${rankText(b)}`;
    case 'rank.legacySet':
      return `${rankTarget(b)}: set to ${rankText(b)}`;
    case 'grant.feat': {
      const level = Number(b.params?.level);
      return `Feat given: ${recordName(content, 'feats', b.record)}${Number.isFinite(level) ? ` (level ${level})` : ''}`;
    }
    case 'grant.classFeature': {
      const level = Number(b.params?.level);
      return `Class feature given: ${recordName(content, 'classFeatures', b.record)}${Number.isFinite(level) ? ` (level ${level})` : ''}`;
    }
    case 'grant.language':
      return `Language added: ${recordName(content, 'languages', b.record)}`;
    case 'grant.spell': {
      const rank = b.params?.rank;
      return `Spell added: ${recordName(content, 'spells', b.record)}${typeof rank === 'number' ? ` (rank ${rank})` : ''}`;
    }
    case 'remove.feat':
      return `Feat removed: ${recordName(content, 'feats', b.record)}`;
    case 'choice.allowAnyway':
      return `Taken anyway: ${recordName(content, 'feats', b.record)}`;
    case 'text.edit': {
      const rec = typeof b.record === 'string' ? b.record : '';
      const slash = rec.indexOf('/');
      const bucket = rec.slice(0, slash) === 'classFeatures' ? 'classFeatures' : 'feats';
      return `Your text for: ${recordName(content, bucket, slash < 0 ? rec : rec.slice(slash + 1))}`;
    }
    // Tweaks phase 2 (C34): each choice kind this version applies has its own case (checkChoiceKinds fails on a
    // missing one). WP13: a kind nothing applies yet ("Change an answer", "Edit a list") has none — its stored block
    // reads as a newer app's and is listed by `foreignText` (checkChoiceKinds fails on a case for one).
    case 'choice.allowAnywayAnyPicker':
    case 'choice.anyList':
    case 'choice.moreTakes':
    case 'choice.addPlace':
    case 'remove.choicePlace':
      return choiceText(b, content) ?? blockKind(b.kind)?.title ?? b.kind;
    default:
      return blockKind(b.kind)?.title ?? b.kind;
  }
}

/** A block kept unread (`readTweaks().foreign`) as one line. */
function foreignText(f: ForeignBlock): string {
  const raw = f.raw as { kind?: unknown } | null;
  const title = raw && typeof raw === 'object' && typeof raw.kind === 'string' ? blockKind(raw.kind)?.title : undefined;
  const what = title ? `A tweak (${title})` : 'A tweak';
  if (f.why === 'newer-version') return `${what} made by a newer version of the app`;
  return `${what} this version of the app can't read`;
}

const KIND_ORDER = new Map(BLOCK_KINDS.map((k, i) => [k.id, i]));

/**
 * The tweaks a Wanderer's Guide export of this character cannot carry, one line each, grouped by kind
 * (registry order, stored order within a kind), then the blocks kept unread. Empty when the character
 * stores no tweak at all — the export then asks nothing. `content` (the view the character is exported
 * with) only names the records; without it a record shows its id.
 */
export function tweaksWgCannotCarry(saved: SavedChar, content?: ContentDatabase | null): string[] {
  const c = saved.character;
  // The read-time rank sort laid over the stored meta, so an old rank entry reads as the sheet applies it.
  const { instances, foreign } = readTweaks(withRankSort(c.overrides, c.tweakRankSort));
  const sorted = instances
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (KIND_ORDER.get(x.b.kind) ?? 999) - (KIND_ORDER.get(y.b.kind) ?? 999) || x.i - y.i)
    .map(({ b }) => b);
  const lines = sorted.map((b) => {
    const reason = b.reason ? ` (${b.reason})` : '';
    const state = b.broken ? ` (can't be read: ${b.broken})` : entryLive(b, c) ? '' : ' (off now)';
    // B20: the newer-version entries are named as such — a rank whose mode a newer app wrote (stored.ts
    // `newer`) is still listed in its kind's place, marked (WP6 fix round 1).
    const newer = b.newer ? ' (made in a newer version)' : '';
    return `${rowText(b, content, c.spellcasting)}${reason}${newer}${state}`;
  });
  return [...lines, ...foreign.map(foreignText)];
}
