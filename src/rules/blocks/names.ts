/*
 * TWEAK WORDING — a target key or a record id as the player reads it (plan B, WP6). One copy, read by the
 * Tweaks page (src/builder/tweaks/model.ts) and the Wanderer's Guide export warning (blocks/wgExport.ts), so
 * the two never name the same tweak two ways. Pure: no build, no `overrides`.
 *
 * A spell attack / spell DC target names its casting entry by the entry's NAME (the character's
 * `spellcasting` list), never its id (wp9a-report "Out of scope"); a casting entry the character no longer
 * has keeps its id, so the player still sees which one it was.
 */
import type { ContentDatabase } from '../types';
import { parseTargetRef } from './targets';

export const ABILITY_NAME: Record<string, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
const SAVE_NAME: Record<string, string> = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A Lore detail (`lore:sailing`, or an old raw `lore:Sailing Lore`) → "Sailing Lore". */
export function loreName(detail: string): string {
  const subject = detail
    .slice('lore:'.length)
    .replace(/-/g, ' ')
    .replace(/\s*\blore\b\s*$/i, '')
    .trim();
  return subject ? `${subject.split(/\s+/).map(cap).join(' ')} Lore` : 'Lore';
}

/** The casting entries a target may name (a Character's `spellcasting`). */
export type NamedEntries = readonly { id: string; name: string }[] | null | undefined;

/** A casting entry's name; its id when the character no longer has it. */
export function castingEntryName(entries: NamedEntries, id: string | undefined): string {
  if (!id) return 'a spellcasting entry';
  return entries?.find((e) => e.id === id)?.name || id;
}

/**
 * A target key (targets.ts) as the player reads it; the key itself when this app does not know it.
 * `opts.page` uses the Tweaks page's shorter words (decision 4.4 of plan B: "AC", "Speed"; the export says
 * "Land Speed").
 */
export function targetName(key: string | undefined, entries?: NamedEntries, opts: { page?: boolean } = {}): string {
  if (!key) return 'an unknown statistic';
  const ref = parseTargetRef(key);
  if (!ref) return key;
  const d = ref.detail ?? '';
  const entry = ref.owner === 'casting-entry' ? ` (${castingEntryName(entries, ref.ownerId)})` : '';
  switch (ref.kind) {
    case 'score':
      return `${ABILITY_NAME[d] ?? d} score`;
    case 'max-hp':
      return 'Maximum HP';
    case 'ac':
      return 'AC';
    case 'save':
      return `${SAVE_NAME[d] ?? cap(d)} save`;
    case 'perception':
      return 'Perception';
    case 'skill':
      return d.startsWith('lore:') ? loreName(d) : cap(d);
    case 'class-dc':
      return 'Class DC';
    case 'initiative':
      return 'Initiative';
    case 'spell-attack':
      return `Spell attack${entry}`;
    case 'spell-dc':
      return `Spell DC${entry}`;
    case 'weapon':
      return `${cap(d)} weapons`;
    case 'armor':
      return d === 'unarmored' ? 'Unarmored defense' : `${cap(d)} armor`;
    case 'speed':
      return opts.page && d === 'land' ? 'Speed' : `${cap(d)} Speed`;
    default:
      return key;
  }
}

export type RecordBucket = 'feats' | 'classFeatures' | 'languages' | 'spells';

/** A record's name from the content the character is viewed with; its id when the record is missing. */
export function recordName(content: ContentDatabase | null | undefined, bucket: RecordBucket, id: unknown): string {
  if (typeof id !== 'string' || !id) return 'an unnamed record';
  const rec = (content?.[bucket] as Record<string, { name?: string }> | undefined)?.[id];
  return rec?.name || id;
}
