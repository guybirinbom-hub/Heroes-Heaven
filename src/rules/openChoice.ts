/*
 * OPEN-ENDED build choices — "choose any 1st-level dwarf ancestry feat", "any common language",
 * "one martial weapon".
 *
 * A fixed `options` array can't express these: the legal set is defined by a FILTER over content, and
 * enumerating it into the record would both bloat core.json and go stale the moment content changes.
 * This resolves the filter at render time, so the builder shows a searchable list of exactly the legal
 * picks.
 *
 * Spells already had this (SpellChoiceFilter + spellsMatching, used by effect-choices); `from.type
 * 'spell'` delegates to that rather than growing a second spell matcher that could disagree with it.
 */
import type { ContentDatabase, Feat, OpenChoiceFrom, SpellChoiceFilter } from './types';
import { spellsMatching } from './spellChoice';

export interface OpenOption {
  id: string;
  name: string;
  /** Short right-aligned hint in the picker (a feat's level, a spell's rank). */
  note?: string;
  description?: string;
}

/** Feats a filter admits: category, level ceiling and required traits. */
function featsMatching(from: OpenChoiceFrom, content: ContentDatabase): Feat[] {
  const wantTraits = (from.traits ?? []).map((t) => t.toLowerCase());
  return Object.values(content.feats)
    .filter((f) => {
      if (from.featCategory && f.category !== from.featCategory) return false;
      if (from.maxLevel !== undefined && f.level > from.maxLevel) return false;
      if (wantTraits.length) {
        const tr = new Set((f.traits ?? []).map((t) => String(t).toLowerCase()));
        if (!wantTraits.every((t) => tr.has(t))) return false;
      }
      return true;
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/**
 * The legal picks for an open choice, ready for SearchSelect.
 *
 * Returns [] for a descriptor this cannot resolve rather than throwing — an empty picker is a visible
 * "nothing matches", where a throw would take down the whole builder screen.
 */
export function openChoiceOptions(
  from: OpenChoiceFrom | undefined,
  content: ContentDatabase,
  opts?: { hideLegacy?: boolean },
): OpenOption[] {
  if (!from) return [];
  switch (from.type) {
    case 'spell': {
      const filter: SpellChoiceFilter = {
        traditions: from.traditions,
        rank: from.rank,
        minRank: from.minRank,
        maxRank: from.maxRank,
        traits: from.traits,
        cantripsOnly: from.cantripsOnly,
        grantAs: 'innate', // unused here; spellsMatching only reads the filter fields
      };
      const any = (from.anyTraits ?? []).map((t) => t.toLowerCase());
      const matchesAny = (s: { traits?: string[] }) =>
        !any.length || (s.traits ?? []).some((t) => any.includes(String(t).toLowerCase()));
      return spellsMatching(filter, content, opts?.hideLegacy).filter(matchesAny).map((s) => ({
        id: s.id,
        name: s.name,
        note: (s.rank ?? 0) === 0 ? 'Cantrip' : `${s.rank} rank`,
        description: s.description,
      }));
    }
    case 'feat':
      return featsMatching(from, content).map((f) => ({
        id: f.id,
        name: f.name,
        note: `Level ${f.level}`,
        description: f.description,
      }));
    case 'weapon':
      return Object.values(content.items)
        .filter((i) => i.itemType === 'weapon' && (!from.weaponCategory || (i as { category?: string }).category === from.weaponCategory))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ id: i.id, name: i.name, description: i.description }));
    case 'language':
      return Object.values(content.languages ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ id: l.id, name: l.name, note: l.rarity !== 'common' ? l.rarity : undefined }));
    default:
      return [];
  }
}

/** Label for a stored open-choice answer, or the raw id when it no longer resolves (retired content,
 *  a disabled source book) — showing the slug is better than showing a blank row. */
export function openChoiceLabel(id: string, content: ContentDatabase): string {
  if (!id) return '';
  const rec = content.spells[id] ?? content.feats[id] ?? content.items[id] ?? content.languages?.[id];
  return rec?.name ?? id;
}
