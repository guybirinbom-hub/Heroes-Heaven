/*
 * Temporary items the player chooses at DAILY PREPARATIONS.
 *
 * "Each day during your daily preparations, you can create a single temporary scroll containing a
 * 1st-rank spell." Seven records say something of that shape and none of them delivered anything.
 *
 * `Feat.advancedAlchemy` was the proof the shape works and the proof it was built too narrowly: it
 * is alchemist-only, feat-keyed, and hardcoded to alchemical items, so a record handing over a
 * temporary SCROLL — or a healing item, or a potion — had nowhere to live. The answers are play
 * state, re-picked every morning, exactly like the alchemist's.
 */
import { PROFICIENCY_RANKS, type Character, type ContentDatabase, type Feat, type ProficiencyRank } from './types';
import { resolveFormula } from './derive';
import { knownFormulas } from './formulaBook';

type Def = NonNullable<Feat['dailyTemporaryItems']>[number];

/** One slot the player fills at rest. A source granting three scrolls produces three of these. */
export interface DailyItemSlot {
  /** Storage key in PlayState.dailyItems — `${sourceId}:${defId}#${index}`. */
  key: string;
  /** The record that granted it, for the "from …" label. */
  sourceId: string;
  sourceName: string;
  label: string;
  /** A scroll/wand slot: the spell rank it must contain. */
  spellRank?: number;
  /** Restrict the spell pool to the character's own spellbook. */
  fromSpellbook?: boolean;
  /** An ITEM slot: the traits it must have and the level ceiling. */
  traits?: string[];
  maxLevel?: number;
  fromKnownFormulas?: boolean;
  /** A printed restriction the app cannot enforce. */
  note?: string;
}

export const dailyItemKey = (sourceId: string, defId: string, index: number) => `${sourceId}:${defId}#${index}`;

/** How many slots this definition grants a character of `level`. */
function countOf(def: Def, c: Character): number {
  if (def.countByProficiency) {
    const rank: ProficiencyRank =
      def.countByProficiency.key === 'spell-dc'
        ? (c.spellcasting.reduce<ProficiencyRank>(
            (best, e) => (PROFICIENCY_RANKS.indexOf(e.proficiency) > PROFICIENCY_RANKS.indexOf(best) ? e.proficiency : best),
            'untrained',
          ) as ProficiencyRank)
        : (c.proficiencies.skills[def.countByProficiency.key as 'arcana'] ?? 'untrained');
    // The highest threshold the character has REACHED, so a legendary caster still gets a master
    // entry's count if legendary is not listed.
    let n = 0;
    for (const [r, v] of Object.entries(def.countByProficiency.ranks)) {
      if (PROFICIENCY_RANKS.indexOf(rank) >= PROFICIENCY_RANKS.indexOf(r as ProficiencyRank)) n = Math.max(n, v ?? 0);
    }
    return n;
  }
  if (def.countByLevel?.length) {
    return def.countByLevel.filter((e) => c.level >= e.level).reduce((n, e) => Math.max(n, e.count), 0);
  }
  return def.count ?? 0;
}

/** The spell rank a slot's scroll must contain — the highest threshold this level has reached. */
function rankOf(def: Def, level: number): number | undefined {
  const byLevel = def.filter.spellRankByLevel ?? [];
  const reached = byLevel.filter((e) => level >= e.level).reduce((n, e) => Math.max(n, e.rank), 0);
  return reached || def.filter.spellRank;
}

/**
 * Every temporary-item slot this character fills at rest.
 *
 * Deduped by source+definition, so a feat listed twice does not double its scrolls, and ordered by
 * the record that granted them so the Rest sheet reads as a list of feats rather than a flat pile.
 */
export function dailyItemSlots(c: Character, db: ContentDatabase): DailyItemSlot[] {
  const sources: { id: string; name: string; g: Pick<Feat, 'dailyTemporaryItems'> }[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string | undefined, g: Pick<Feat, 'dailyTemporaryItems'> | undefined) => {
    if (!g?.dailyTemporaryItems?.length || seen.has(id)) return;
    seen.add(id);
    sources.push({ id, name: name ?? id, g });
  };
  // Feats only, like `advancedAlchemy` beside it: every record of this shape is a feat, and putting
  // the field on ClassFeature as well would create a lane with no users and no test that it works.
  for (const f of c.feats ?? []) add(f.featId, db.feats[f.featId]?.name, db.feats[f.featId]);

  const out: DailyItemSlot[] = [];
  for (const src of sources) {
    for (const def of src.g.dailyTemporaryItems ?? []) {
      const n = countOf(def, c);
      const spellRank = rankOf(def, c.level);
      const maxLevel =
        typeof def.filter.maxLevel === 'string'
          ? resolveFormula(def.filter.maxLevel, { level: c.level })
          : def.filter.maxLevel;
      for (let i = 0; i < n; i++) {
        out.push({
          key: dailyItemKey(src.id, def.id, i),
          sourceId: src.id,
          sourceName: src.name,
          label: n > 1 ? `${def.label} (${i + 1} of ${n})` : def.label,
          ...(spellRank ? { spellRank } : {}),
          ...(def.filter.fromSpellbook ? { fromSpellbook: true } : {}),
          ...(def.filter.traits?.length ? { traits: def.filter.traits } : {}),
          ...(maxLevel != null ? { maxLevel } : {}),
          ...(def.filter.fromKnownFormulas ? { fromKnownFormulas: true } : {}),
          ...(def.filter.note ? { note: def.filter.note } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * What a slot may be filled with.
 *
 * A SPELL slot offers spells of exactly that rank — from the character's own spellbook when the
 * record says so, otherwise every spell of that rank. An ITEM slot offers items carrying the
 * required traits at or below the level ceiling. An empty list means the character cannot fill the
 * slot yet, which the Rest sheet should say rather than showing an empty picker.
 */
export function dailyItemOptions(
  slot: DailyItemSlot,
  c: Character,
  db: ContentDatabase,
): { id: string; name: string; note?: string }[] {
  if (slot.spellRank != null) {
    const known = new Set(
      c.spellcasting.flatMap((e) => [...e.cantrips, ...Object.values(e.repertoire ?? {}).flat(), ...Object.values(e.grantedRepertoire ?? {}).flat()]),
    );
    return Object.values(db.spells)
      .filter((s) => s.rank === slot.spellRank && !s.ritual && (!slot.fromSpellbook || known.has(s.id)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, name: s.name }));
  }
  const wantTraits = slot.traits ?? [];
  // "It must be an item whose formula you know" — a clause with nothing to filter against until the
  // formula book existed. An empty book now yields an empty list, which the Rest sheet already says.
  const knownIds = slot.fromKnownFormulas ? new Set(knownFormulas(c.inventory, db)) : null;
  return Object.values(db.items)
    .filter((i) => {
      if (knownIds && !knownIds.has(i.id)) return false;
      if (slot.maxLevel != null && (i.level ?? 0) > slot.maxLevel) return false;
      const traits = new Set(i.traits ?? []);
      return wantTraits.every((t) => traits.has(t));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ id: i.id, name: i.name, note: (i.level ?? 0) > 0 ? `Level ${i.level}` : undefined }));
}
