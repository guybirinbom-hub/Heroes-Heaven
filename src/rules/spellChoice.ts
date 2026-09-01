/*
 * Open-ended spell choices ("choose ANY 1st-rank arcane spell") — the filtered counterpart to the
 * fixed-option effect-choice picker. A SpellChoiceFilter describes the legal set; the builder shows a
 * searchable list of exactly these spells, and buildCharacter turns the pick into the grant the filter
 * names (an innate spell at some cadence, or a focus spell).
 */
import type { ContentDatabase, EffectChoice, EffectGrant, Spell, SpellChoiceFilter } from './types';

/** The spells a filter admits, sorted for display (rank then name). */
export function spellsMatching(filter: SpellChoiceFilter, content: ContentDatabase, hideLegacy?: boolean): Spell[] {
  const out: Spell[] = [];
  for (const s of Object.values(content.spells)) {
    if (s.ritual) continue;
    if (hideLegacy && (s as { edition?: string }).edition === 'legacy') continue;
    const rank = s.rank ?? 0;
    if (filter.cantripsOnly === true && rank !== 0) continue;
    if (filter.cantripsOnly === false && rank === 0) continue;
    if (filter.rank !== undefined && rank !== filter.rank) continue;
    if (filter.minRank !== undefined && rank < filter.minRank) continue;
    if (filter.maxRank !== undefined && rank > filter.maxRank) continue;
    if (filter.traditions?.length && !filter.traditions.some((t) => s.traditions?.includes(t))) continue;
    if (filter.traits?.length) {
      const tr = new Set((s.traits ?? []).map((t) => String(t).toLowerCase()));
      if (!filter.traits.every((t) => tr.has(t.toLowerCase()))) continue;
    }
    out.push(s);
  }
  return out.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name));
}

/** Turn a chosen spell id into the grant its filter describes, or null if the pick is illegal here. */
export function grantForSpellPick(
  filter: SpellChoiceFilter,
  spellId: string,
  content: ContentDatabase,
  level: number,
): EffectGrant | null {
  if (filter.minLevel && level < filter.minLevel) return null;
  if (!content.spells[spellId]) return null;
  if (!spellsMatching(filter, content).some((s) => s.id === spellId)) return null;
  if (filter.grantAs === 'focus') return { focusSpells: [spellId] };
  // 'staff': the pick is LOADED INTO a staff the record hands you, not cast from nothing.
  if (filter.grantAs === 'staff') return { staffSpells: [spellId] };
  /*
   * THE TRADITION THE PLAYER ANSWERED HAS TO REACH THE GRANTED SPELL.
   *
   * A filter narrowed to ONE tradition is the record asking a question whose answer decides how the
   * spell is cast — Minor Magic's arcane/divine/occult/primal, Wayfinder Resonance Tinkerer's
   * wayfinder cantrip, Esoteric Spellcasting's occult-or-divine. Without this the innate spell fell
   * back to the SPELL's own first tradition, so a player who answered "divine" could be handed an
   * arcane cantrip. Callers narrow the filter first (`narrowSpellFilter`); a filter still naming
   * several traditions, or none, behaves exactly as before.
   */
  const only = filter.traditions?.length === 1 ? filter.traditions[0] : undefined;
  return { innateSpells: [{ spellId, ...(only ? { tradition: only } : {}), ...(filter.innate ?? {}) }] };
}

/** The filtered choices on a record that are unlocked at this level (a scaling feat offers more picks
 *  as the character levels). */
export function activeSpellChoices(choices: EffectChoice[] | undefined, level: number): EffectChoice[] {
  return (choices ?? []).filter((c) => c.spellFilter && level >= (c.spellFilter.minLevel ?? 1));
}
