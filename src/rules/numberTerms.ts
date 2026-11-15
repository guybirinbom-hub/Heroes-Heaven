/*
 * ONE DISPATCHER from a number target to its term list (plan B WP5): `numberTermsFor(c, db, target)`
 * returns the list the sheet number is the total of — the same list its breakdown resolves — so the Tweaks
 * rows (the line a tweak adds, "not applied right now", WP6) and a set's book baseline (`bookTotal`, WP4's
 * baseline.ts, extended in WP7) read what the sheet reads, never a copy.
 *
 * Its own module, not derive.ts (where the plan named it): Initiative's list lives in initiative.ts, which
 * imports derive.ts, so a derive.ts dispatcher would close an import cycle. Nothing here computes a number
 * of its own; each case calls the term builder the derive function totals.
 *
 * The targets are the phase-1 NUMBER targets of blocks/targets.ts: max HP, AC, the 3 saves, Perception, every
 * skill and Lore, class DC, Initiative, spell attack and spell DC per casting entry, land Speed. Attribute
 * scores ('score' aspect) and rank targets have no term list; they return null, as does a key this phase does
 * not build (a companion's, another Speed, a casting entry the character no longer has).
 */
import { contentFor } from './blocks/content';
import { resolveTerms, type Term } from './blocks/terms';
import { parseTargetRef, targetBuilt } from './blocks/targets';
import { acTerms, classDcTerms, landSpeedResolved, maxHpTerms, perceptionTerms, saveTerms, skillResolved, skillTerms, spellTerms } from './derive';
import { initiativeTermsFor } from './initiative';
import type { Character, ContentDatabase, ProficiencyKey, SaveId } from './types';

/**
 * The term list of one number target, or null when the target names no number this phase builds. Its
 * total (`termsTotal`) is the number the sheet shows:
 *   - a skill whose unconditional stand-in beats it (a chirurgeon's Medicine rolled with Crafting) gets the
 *     stand-in as one more untyped line ("Crafting instead"), in the 'transient' layer so a set on the skill
 *     cannot swallow it — the sheet shows the better of the two either way;
 *   - max HP gets its "Minimum 0" line when the total went below 0, as the breakdown does;
 *   - land Speed is ordered stages, not one pool (derive.ts `landSpeedResolved`): its breakdown lines come
 *     back as untyped terms with their layer, so they sum to the Speed.
 */
export function numberTermsFor(c: Character, db: ContentDatabase, target: string): Term[] | null {
  if (!targetBuilt(target, 'number')) return null;
  const ref = parseTargetRef(target)!;
  switch (ref.kind) {
    case 'ac':
      return acTerms(c, db);
    case 'max-hp': {
      const terms = maxHpTerms(c, contentFor(db, c));
      const total = resolveTerms(terms).total;
      return total < 0 ? [...terms, { type: 'untyped', value: -total, label: 'Minimum 0', layer: 'transient' }] : terms;
    }
    case 'save':
      return saveTerms(c, ref.detail as SaveId, db);
    case 'perception':
      return perceptionTerms(c, db);
    case 'skill': {
      const key = ref.detail as ProficiencyKey;
      const terms = skillTerms(c, key, db);
      const r = skillResolved(c, key, db);
      if (!r.substitutedFrom) return terms;
      const own = resolveTerms(terms).total;
      return [...terms, { type: 'untyped', value: r.modifier - own, label: r.parts[r.parts.length - 1].label, note: r.parts[r.parts.length - 1].note, layer: 'transient' }];
    }
    case 'class-dc':
      return classDcTerms(c);
    case 'initiative':
      return initiativeTermsFor(c, db);
    case 'spell-attack':
    case 'spell-dc': {
      const entry = (c.spellcasting ?? []).find((e) => e.id === ref.ownerId);
      if (!entry) return null;
      return spellTerms(c, entry, ref.kind === 'spell-dc' ? 'dc' : 'attack');
    }
    case 'speed':
      return landSpeedResolved(c, db).parts.map((p) => ({
        type: 'untyped',
        value: p.value,
        label: p.label,
        ...(p.note !== undefined ? { note: p.note } : {}),
        layer: p.layer ?? 'book',
      }));
  }
  return null;
}

/**
 * The PERMANENT part of a term list (blocks/terms.ts: the 'base' and 'book' layers, pooled among
 * themselves): the number the book gives before any tweak or anything on in play — what a set replaced
 * (its `baseline`, "Book number changed: was X, now Y", WP6 / WP7).
 */
export function bookTotal(terms: Term[]): number {
  return resolveTerms(terms.filter((t) => t.layer === 'base' || t.layer === 'book')).total;
}
