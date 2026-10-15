/*
 * The VERSATILE VIAL thrown as a bomb — the alchemist's, and the Firework Technician's pyrotechnic one.
 *
 * Alchemy (Player Core 2, class-feature-817): *"A vial you create is always the highest type you could
 * Craft. See the sidebar for statistics on using a versatile vial as a bomb."* That sidebar is not in
 * our Archives mirror (the class page and the feature both stop at the sentence above); it was read on
 * the live Archives page, Classes.aspx?ID=56, on 2026-10-15:
 *
 *   lesser   Item 1                                       1d6 acid, 1 acid splash
 *   moderate Item 4   +1 item bonus to attack rolls       2d6 acid, 2 acid splash
 *   greater  Item 12  +2 item bonus to attack rolls       3d6 acid, 3 acid splash
 *   major    Item 18  +3 item bonus to attack rolls       4d6 acid, 4 acid splash
 *
 * Both item records (`items/versatile-vial`, `items/pyrotechnic-versatile-vial`) hold the LESSER vial
 * and nothing else, so an 18th-level alchemist was throwing a 1st-level bomb and the sheet said so.
 *
 * ⚠ THE GATES ARE THE VIAL'S OWN: 1 / 4 / 12 / 18. Every other graded bomb in the data (acid flask,
 * alchemist's fire, necrotic bomb …) steps at 1 / 3 / 11 / 17. Borrowing a sibling's ladder puts a
 * 3rd-, 11th- and 17th-level character a whole type ahead of print.
 *
 * "The highest type you could Craft" is Craft's own test (Player Core, action-2385): *"The item is your
 * level or lower … If the item is 9th level or higher, you must be a master in Crafting, and if it's
 * 17th or higher, you must be legendary."* So the type needs BOTH the character level and the Crafting
 * rank: a greater vial (Item 12) needs master, a major one (Item 18) legendary, and Craft itself is a
 * trained action, so a moderate one needs trained. The lesser vial is the floor — it is what the class
 * feature creates whatever the rank. (Foundry's rule elements read the level alone; print is the
 * authority here.) Deliberately NOT `advancedAlchemy.level`, which caps what Advanced Alchemy may
 * prepare: a vial is not an Advanced Alchemy item.
 *
 * WHO MAKES VIALS comes from the one list the app already keeps: the `versatile-vials` counter in
 * classResources.ts (the alchemist class, Alchemist Dedication, Wandering Chef Dedication, Firework
 * Technician Dedication, Munitions Machinist). Reading that list, rather than keeping a second one here,
 * is what stops the vial counter and the bomb type from disagreeing. The archetypes print only "creating
 * up to 4 versatile vials"; the vials they create are the same items, with the same types.
 *
 * …per KIND of vial. The Firework Technician creates *"pyrotechnic versatile vials. These vials have
 * the fire trait and deal fire damage instead of acid"* (feat-8528) and no others; every other maker
 * creates the plain acid one. So the pyrotechnic vial needs that dedication, and the plain one needs a
 * maker other than it.
 *
 * A vial held by a character who did not make it keeps the printed lesser statistics: vials are infused,
 * destroyed at the next daily preparations and have no price, so one you hold was made by someone else,
 * and the sheet cannot know that maker's level.
 */
import { resourcesForCharacter } from './classResources';
import { PROFICIENCY_RANKS, type Character, type ProficiencyRank } from './types';

export interface VersatileVialTier {
  /** The printed type name. */
  tier: 'lesser' | 'moderate' | 'greater' | 'major';
  /** The item level of that type — the character level that can first Craft it. */
  minLevel: number;
  /** Damage dice, all d6. */
  dice: number;
  /** Item bonus to attack rolls. The lesser vial grants none. */
  itemAttack: number;
  /** Splash damage, in points. */
  splash: number;
}

/** Ascending by level, so `versatileVialTierFor` keeps the last one that qualifies. */
export const VERSATILE_VIAL_TIERS: readonly VersatileVialTier[] = [
  { tier: 'lesser', minLevel: 1, dice: 1, itemAttack: 0, splash: 1 },
  { tier: 'moderate', minLevel: 4, dice: 2, itemAttack: 1, splash: 2 },
  { tier: 'greater', minLevel: 12, dice: 3, itemAttack: 2, splash: 3 },
  { tier: 'major', minLevel: 18, dice: 4, itemAttack: 3, splash: 4 },
];

const PLAIN_VIAL = 'versatile-vial';
const PYROTECHNIC_VIAL = 'pyrotechnic-versatile-vial';
/** The only maker of pyrotechnic vials, and the one maker that makes no plain ones. */
const FIREWORK_TECHNICIAN = 'firework-technician-dedication';

/** The Crafting rank Craft asks for an item of this level (action-2385). */
export function craftRankFor(itemLevel: number): ProficiencyRank {
  return itemLevel >= 17 ? 'legendary' : itemLevel >= 9 ? 'master' : 'trained';
}

const atLeast = (rank: ProficiencyRank, needed: ProficiencyRank) => PROFICIENCY_RANKS.indexOf(rank) >= PROFICIENCY_RANKS.indexOf(needed);

/** The highest type this level and Crafting rank could Craft. Floors at lesser — the type the class
 *  feature creates whatever the rank — so a level-0 or untrained sheet is safe. */
export function versatileVialTierFor(level: number, crafting: ProficiencyRank): VersatileVialTier {
  let best = VERSATILE_VIAL_TIERS[0];
  for (const t of VERSATILE_VIAL_TIERS) if (level >= t.minLevel && atLeast(crafting, craftRankFor(t.minLevel))) best = t;
  return best;
}

const hasVialCounter = (classId: string | null, featIds: Set<string>) =>
  resourcesForCharacter(classId, featIds).some((r) => r.id === 'versatile-vials');

/** Whether this character makes THIS kind of vial — the vial counter, narrowed to the vial's kind. */
export function makesVersatileVial(c: Pick<Character, 'classId' | 'feats'>, itemId: string): boolean {
  const feats = new Set((c.feats ?? []).map((f) => f.featId));
  const classId = c.classId ?? null;
  if (itemId === PYROTECHNIC_VIAL) return feats.has(FIREWORK_TECHNICIAN) && hasVialCounter(classId, feats);
  feats.delete(FIREWORK_TECHNICIAN);
  return hasVialCounter(classId, feats);
}

export interface VersatileVialThrow {
  tier: VersatileVialTier;
  /** This character made the vial, so it is the highest type they could Craft. */
  made: boolean;
  /** The next type, when the character's LEVEL reaches it but their Crafting rank does not. */
  blocked?: { tier: VersatileVialTier; needs: ProficiencyRank };
}

/** The vial this character throws. Null when the item is no vial. */
export function versatileVialFor(
  c: Pick<Character, 'classId' | 'feats' | 'level'>,
  itemId: string,
  crafting: ProficiencyRank,
): VersatileVialThrow | null {
  if (itemId !== PLAIN_VIAL && itemId !== PYROTECHNIC_VIAL) return null;
  if (!makesVersatileVial(c, itemId)) return { tier: VERSATILE_VIAL_TIERS[0], made: false };
  const tier = versatileVialTierFor(c.level, crafting);
  const next = VERSATILE_VIAL_TIERS[VERSATILE_VIAL_TIERS.indexOf(tier) + 1];
  const blocked = next && c.level >= next.minLevel ? { tier: next, needs: craftRankFor(next.minLevel) } : undefined;
  return { tier, made: true, ...(blocked ? { blocked } : {}) };
}

/** "Greater pyrotechnic versatile vial" — the label the attack breakdown puts on the item bonus. */
export function versatileVialLabel(t: VersatileVialTier, itemName: string): string {
  return `${t.tier.charAt(0).toUpperCase()}${t.tier.slice(1)} ${itemName.toLowerCase()}`;
}

/** The damage-breakdown sentence naming the type, so dice that moved (or didn't) say why. */
export function versatileVialNote(v: VersatileVialThrow, itemName: string, damageType: string): string {
  const t = v.tier;
  const bonus = t.itemAttack ? `, +${t.itemAttack} item bonus to attack rolls` : '';
  const why = v.blocked
    ? ` A ${v.blocked.tier.tier} vial (item level ${v.blocked.tier.minLevel}) needs ${v.blocked.needs} in Crafting.`
    : '';
  return (
    `A vial you create is always the highest type you could Craft, so you throw a ` +
    `${versatileVialLabel(t, itemName).toLowerCase()} (${t.dice}d6 ${damageType}${bonus}, ${t.splash} ${damageType} splash).${why}`
  );
}
