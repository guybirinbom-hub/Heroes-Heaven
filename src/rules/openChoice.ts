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

/**
 * What each source is CALLED to a player, for the picker's "Search …" placeholder.
 *
 * The builder printed `from.type` raw, so sixteen records showed the player a slug —
 * "Search own-deity-spell…", "Search own-item…". Kept beside the cases it names so adding one without
 * a label is visible here rather than on the page; `test/innate-tradition.test.ts` fails if a case has
 * no entry.
 */
export const OPEN_SOURCE_LABEL: Record<string, string> = {
  spell: 'spells',
  feat: 'feats',
  weapon: 'weapons',
  language: 'languages',
  heritage: 'heritages',
  ancestry: 'ancestries',
  'own-deity-spell': "your deity's spells",
  'own-spell': 'spells you know',
  'own-feat': 'feats you have',
  'own-item': 'your items',
  'own-companion': 'your companions',
};

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
      // "…from a magical tradition OTHER THAN YOUR OWN" (Adapted Cantrip). The legal set depends on the
      // character, so `traditions` could never carry it and the record shipped a note apologising that
      // "the picker can't filter that, because your tradition depends on your class". It can: this
      // resolver already runs against a built character (Builder.tsx:424 passes `featPrereqChar`).
      // Class pools only — an innate or item entry is not a tradition you cast in for this purpose —
      // and with no class casting at all nothing is excluded, so the list is never emptied.
      const ownTraditions = new Set<string>(
        (opts?.character?.spellcasting ?? []).filter((e) => e.type === 'prepared' || e.type === 'spontaneous').map((e) => e.tradition),
      );
      const traditionOk = (s: { traditions?: string[] }) =>
        !from.excludeOwnTraditions || !ownTraditions.size || !(s.traditions ?? []).some((t) => ownTraditions.has(t));
      return spellsMatching(filter, content, opts?.hideLegacy).filter(matchesAny).filter(traditionOk).map((s) => ({
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

    // "The awakened animal heritage you selected at 1st level." A character who took a VERSATILE
    // heritage has that recorded as their one `heritageId`, so the ancestry heritage they would
    // otherwise have had was never stored anywhere. This is the picker that records it. Versatile
    // heritages are excluded: one is what you took INSTEAD of the heritage being asked about.
    case 'heritage':
      return Object.values(content.heritages ?? {})
        .filter((h) => (!from.ancestry || h.ancestryId === from.ancestry) && !h.versatile)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((h) => ({ id: h.id, name: h.name, description: h.description }));

    /*
     * "Choose a common ancestry or another ancestry to which you have access" (Adopted Ancestry), and
     * "You can choose any ancestry" (As in Life, So in Death). The record enumerated 8 common
     * ancestries; core.json ships 50 (8 common, 20 uncommon, 22 rare), so a skeleton who was a kobold,
     * hobgoblin or tengu in life could not record it.
     *
     * Rarity is SHOWN, not filtered — access is the GM's to grant, and hard-blocking it made a pick the
     * rules allow unreachable. `excludeOwn` drops the character's own ancestry, which is the one answer
     * that grants nothing.
     */
    case 'ancestry':
      return Object.values(content.ancestries ?? {})
        .filter((a) => !(from.excludeOwn && a.id === opts?.character?.ancestryId))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({
          id: a.id,
          name: a.name,
          note: a.rarity !== 'common' ? a.rarity : undefined,
          description: a.description,
        }));

    // ---- BUILD-RESOLVED sources: the pool is what this character has -------------------------
    // Without a character these return [] rather than falling back to all of content, because
    // offering every spell for "one spell YOU KNOW" would let the player pick one they don't have.

    // "Add up to three of your DEITY'S spells (spells your deity grants to clerics) to your spell list"
    // — Blessed Blood. The legal set is this character's deity's cleric spells: neither a static options
    // array nor a content-wide filter can express it, which is why the pick was never asked at all and
    // the app silently added the deity's WHOLE list instead, nine spells deep for twelve deities.
    //
    // ⚠ It is an `own-` kind, and the prefix is load-bearing rather than cosmetic: two shipped guards
    // (`test/choice-lane-applied.test.ts`, `test/multi-pick-choices.test.ts`) require every OTHER open
    // choice to resolve a non-empty list with no character, and a deity-scoped pool cannot.
    case 'own-deity-spell': {
      // ⚠ A built Character keeps its deity on `details`, not at the top level — `build.deityId` is a
      // BuildState field, and this resolver is handed the built character (Builder.tsx passes
      // `featPrereqChar`). Reading `character.deityId` type-checks against nothing and is always
      // undefined, which would have emptied the picker in silence.
      const deityId = opts?.character?.details?.deityId;
      const deity = deityId ? content.deities[deityId] : undefined;
      return (deity?.spells ?? [])
        .map((id) => content.spells[id])
        .filter(Boolean)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          name: s.name,
          note: (s.rank ?? 0) === 0 ? 'Cantrip' : `${s.rank} rank`,
          description: s.description,
        }));
    }

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
        /*
         * Prepared casters know their whole book; today's prepared slots are a loadout, not knowledge.
         *
         * That comment stood here alone, and acted on neither half: `prepared` was correctly skipped,
         * but the BOOK it points at was never read. So every `own-spell` picker was empty for a wizard
         * or a witch — Westyr's Wayfinder Repository, whose text names the spellbook FIRST ("one
         * 1st-rank spell from your spellbook or spell repertoire"), and all four Library Robes. A
         * wizard's menu showed a single entry and it was a FOCUS spell that leaked in through the
         * class's focus entry; a witch's showed nothing at all. Sorcerer and bard were always right,
         * which is why a suite whose only `own-spell` fixture sets `repertoire` stayed green.
         *
         * `learned` is the Learn a Spell store. play.ts already merges a spellbook caster's learned
         * spells into `spellbook`, so this line only reaches the repertoire caster who has learned a
         * spell without slotting it, and cannot double-count.
         */
        for (const [rank, list] of Object.entries(e.spellbook ?? {})) for (const id of list) note(id, Number(rank));
        for (const [rank, list] of Object.entries(e.learned ?? {})) for (const id of list) note(id, Number(rank));
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
  const rec =
    content.spells[id] ??
    content.feats[id] ??
    content.items[id] ??
    content.languages?.[id] ??
    // …and the buckets an open choice can also name: Late Awakener picks a HERITAGE, and other picks
    // name an ancestry or a class feature. Without these the sheet fell back to the raw slug.
    content.heritages?.[id] ??
    content.ancestries?.[id] ??
    content.classFeatures?.[id];
  return rec?.name ?? id;
}
