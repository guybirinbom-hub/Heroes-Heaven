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
import type { Character, ContentDatabase, Feat, OpenChoiceFrom, SpellChoiceFilter } from './types';
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
  opts?: { hideLegacy?: boolean; character?: Character },
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
      // Category alone left "choose a level 0 weapon" and "an uncommon simple or martial weapon"
      // resolving to all 1,039 weapons — a searchable list, but not the one the rules describe.
      return Object.values(content.items)
        .filter((i) => {
          if (i.itemType !== 'weapon') return false;
          if (from.weaponCategory && (i as { category?: string }).category !== from.weaponCategory) return false;
          if (from.maxLevel !== undefined && (i.level ?? 0) > from.maxLevel) return false;
          if (from.rarity && (i.rarity ?? 'common') !== from.rarity) return false;
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ id: i.id, name: i.name, note: (i.level ?? 0) > 0 ? `Level ${i.level}` : undefined, description: i.description }));
    case 'language':
      return Object.values(content.languages ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ id: l.id, name: l.name, note: l.rarity !== 'common' ? l.rarity : undefined }));

    // ---- BUILD-RESOLVED sources: the pool is what this character has -------------------------
    // Without a character these return [] rather than falling back to all of content, because
    // offering every spell for "one spell YOU KNOW" would let the player pick one they don't have.
    case 'own-spell': {
      const ch = opts?.character;
      if (!ch) return [];
      // Track the rank each spell is KNOWN AT, not the spell's base rank. "A spell you know of 5th
      // rank or lower" is about your repertoire slot: a 1st-rank spell known at 5th is a 5th-rank
      // pick, and filtering on the base rank would wrongly admit it under a lower ceiling.
      const knownAt = new Map<string, number>();
      const note = (id: string, rank: number) => {
        const prev = knownAt.get(id);
        if (prev === undefined || rank < prev) knownAt.set(id, rank);
      };
      for (const e of ch.spellcasting ?? []) {
        for (const id of e.cantrips ?? []) note(id, 0);
        for (const [rank, list] of Object.entries(e.repertoire ?? {})) for (const id of list) note(id, Number(rank));
        for (const [rank, list] of Object.entries(e.grantedRepertoire ?? {})) for (const id of list) note(id, Number(rank));
        // Prepared casters know their whole book; today's prepared slots are a loadout, not knowledge.
      }
      return [...knownAt.entries()]
        .filter(([id, rank]) => {
          if (!content.spells[id]) return false;
          if (from.rank !== undefined && rank !== from.rank) return false;
          if (from.minRank !== undefined && rank < from.minRank) return false;
          if (from.maxRank !== undefined && rank > from.maxRank) return false;
          if (from.cantripsOnly === true && rank !== 0) return false;
          if (from.cantripsOnly === false && rank === 0) return false;
          return true;
        })
        .sort((a, b) => a[1] - b[1] || content.spells[a[0]].name.localeCompare(content.spells[b[0]].name))
        .map(([id, rank]) => ({
          id,
          name: content.spells[id].name,
          note: rank === 0 ? 'Cantrip' : `${rank} rank`,
          description: content.spells[id].description,
        }));
    }
    case 'own-feat': {
      const ch = opts?.character;
      if (!ch) return [];
      const want = (from.traits ?? []).map((t) => t.toLowerCase());
      const seen = new Set<string>();
      return (ch.feats ?? [])
        .filter((f) => !seen.has(f.featId) && seen.add(f.featId))
        .map((f) => content.feats[f.featId])
        .filter((f): f is NonNullable<typeof f> => {
          if (!f) return false;
          if (!want.length) return true;
          const tr = new Set((f.traits ?? []).map((t) => String(t).toLowerCase()));
          return want.every((t) => tr.has(t));
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ id: f.id, name: f.name, note: `Level ${f.level}`, description: f.description }));
    }
    case 'own-item': {
      const ch = opts?.character;
      if (!ch) return [];
      const out: OpenOption[] = [];
      const seen = new Set<string>();
      for (const inv of ch.inventory ?? []) {
        if (from.investedOnly && !inv.invested) continue;
        const item = content.items[inv.itemId];
        if (!item || seen.has(item.id)) continue;
        if (from.itemType && item.itemType !== from.itemType) continue;
        seen.add(item.id);
        out.push({ id: item.id, name: item.name, description: item.description });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    case 'own-companion': {
      const ch = opts?.character;
      if (!ch) return [];
      return (ch.companions ?? [])
        .map((cmp) => ({ id: cmp.id, name: cmp.name || cmp.kind || cmp.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
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
