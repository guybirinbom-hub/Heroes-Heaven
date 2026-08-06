/*
 * Mythic destinies (War of Immortals).
 *
 * "At 12th level, they must use their extra feat to take the 12th-level destiny feat for a mythic
 * destiny, and from 14th level on, they can take feats from that mythic destiny or take lower-level
 * mythic feats they haven't already taken. Characters can have only one mythic destiny."
 *   — Mythic Progression, War of Immortals p.77
 *
 * Two things follow that the slot filter got wrong. The 12th-level slot is not "any mythic feat", and
 * a 14th-level slot must not offer feats belonging to a SECOND destiny. Both need to know which
 * destiny the character has, which is why the destiny is an explicit build choice rather than being
 * inferred from whichever dedication happens to be in the feat list.
 */
import type { ContentDatabase, Feat } from './types';

/** The level at which the mythic feat slot must be spent on a destiny dedication. */
export const DESTINY_LEVEL = 12;

/**
 * Is this feat a mythic destiny's dedication?
 *
 * Not simply `traits.includes('mythic')`: Mortal Herald is a destiny by its own rules text ("A mythic
 * character can select the mortal herald archetype as their mythic destiny") but ships with only the
 * archetype and dedication traits, so a mythic-trait test made the 14th destiny unreachable from the
 * one slot the rules say must buy it. The archetype owning mythic feats is the reliable signal.
 */
export function isDestinyDedication(f: Feat, content: ContentDatabase): boolean {
  if (!f.archetype || f.level !== DESTINY_LEVEL || !/\bdedication$/i.test(f.name)) return false;
  return (f.traits ?? []).includes('destiny') || destinySlugs(content).has(f.archetype);
}

let cachedFor: ContentDatabase | null = null;
let cachedSlugs: Set<string> = new Set();

/** Archetype slugs that are mythic destinies — those owning at least one mythic-trait feat, plus any
 *  whose own dedication carries the `destiny` trait. Cached per content database (an ~22 MB singleton). */
export function destinySlugs(content: ContentDatabase): Set<string> {
  if (cachedFor === content) return cachedSlugs;
  const out = new Set<string>();
  for (const f of Object.values(content.feats)) {
    if (!f.archetype) continue;
    if ((f.traits ?? []).includes('mythic') || (f.traits ?? []).includes('destiny')) out.add(f.archetype);
  }
  // Mortal Herald owns no mythic-trait feat at all, so it is named by its own rules page rather than
  // discovered. Guarded on existence so a data change cannot resurrect a dead slug.
  if (content.feats['mortal-herald-dedication']) out.add('mortal-herald');
  cachedFor = content;
  cachedSlugs = out;
  return out;
}

/** Every destiny dedication, for the builder's picker. */
export function destinyDedications(content: ContentDatabase): Feat[] {
  return Object.values(content.feats)
    .filter((f) => isDestinyDedication(f, content))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * May a mythic feat slot at `slotLevel` offer this feat, given the chosen destiny?
 *
 * - At 12, only a destiny dedication: the rule says the extra feat *must* be spent there.
 * - Above 12, a mythic feat that belongs to no archetype (a general mythic feat) or to the character's
 *   OWN destiny. Anything from another destiny would be a second destiny, which the rules forbid.
 * - Below 12, any mythic feat; no destiny exists yet.
 */
export function mythicSlotAllows(f: Feat, slotLevel: number, destiny: string | null | undefined, content: ContentDatabase): boolean {
  const isDedication = isDestinyDedication(f, content);
  if (slotLevel === DESTINY_LEVEL) return isDedication;
  if (isDedication) return false; // a destiny is taken once, at 12
  if (!(f.traits ?? []).includes('mythic')) return false;
  if (slotLevel < DESTINY_LEVEL) return true;
  // Past 12: general mythic feats always; archetype-bound ones only from the chosen destiny. With no
  // destiny chosen yet, only the general ones are offered rather than everything — offering another
  // destiny's feats is precisely the mistake this is here to prevent.
  if (!f.archetype || !destinySlugs(content).has(f.archetype)) return true;
  return !!destiny && f.archetype === destiny;
}
