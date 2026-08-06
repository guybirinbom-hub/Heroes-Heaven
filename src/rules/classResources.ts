/*
 * Class signature resources — the per-class trackers a player flips or ticks during
 * play (Barbarian Rage, Alchemist Infused Reagents, Oracle Cursebound, …). The focus
 * pool is NOT here (it's tracked separately); only ~7 classes have a trackable
 * resource — the rest are passive or focus-based.
 *
 * Sourced from a per-class research pass over the Foundry pack data + Remaster rules.
 */
import type { AbilityId } from './types';

export interface ClassResource {
  id: string;
  name: string;
  kind: 'counter' | 'toggle';
  /** When the resource resets (informational; Rest resets everything to its initial value). */
  refresh: 'rest' | 'encounter' | 'manual';
  note: string;
  // --- counter only ---
  /** Flat base of the max. */
  maxBase?: number;
  /** Per-level coefficient (1 => + level). */
  maxPerLevel?: number;
  /** Ability mod added to the max. */
  maxAbility?: AbilityId;
  /** Stepped max keyed by level threshold ([level, max]); overrides the formula. */
  maxAtLevels?: [number, number][];
  /** A "meter" starts at 0 and fills UP to max (Cursebound); otherwise a pool starts full and depletes. */
  meter?: boolean;
  /**
   * A refreshed value BELOW the maximum, per level. Sanguimancy Hit Points cap at twice your level,
   * but a night's rest only restores your level's worth — the rest is earned during the day (1 per 10
   * HP that Treat Wounds restores on you). A pool that started full would hand out double.
   */
  initialPerLevel?: number;
  /** Also grant this resource to a character who owns this dedication feat (archetype parity), not just
   *  the base class. Only set for resources an archetype dedication actually grants with the same shape. */
  feat?: string;
}

export const CLASS_RESOURCES: Record<string, ClassResource[]> = {
  /*
   * Not a class. resourcesForCharacter walks every key and admits a resource when the character owns
   * its `feat`, so a bucket whose key matches no class id contains exactly the archetype-only ones —
   * a resource that belongs to an archetype and to no class had nowhere else to live.
   */
  archetype: [
    {
      id: 'sanguimancy-hp',
      name: 'Sanguimancy HP',
      kind: 'counter',
      refresh: 'rest',
      maxPerLevel: 2,
      initialPerLevel: 1,
      feat: 'sanguimancer-dedication',
      note: 'Temporary HP you can also SPEND to power sanguimancy feats. Max twice your level; a full 8-hour rest restores your level’s worth (lasting 8 hours), and Treat Wounds adds 1 per 10 HP it restores.',
    },
  ],
  alchemist: [
    {
      id: 'versatile-vials',
      name: 'Versatile Vials',
      kind: 'counter',
      refresh: 'rest',
      maxBase: 2,
      maxPerLevel: 0,
      maxAbility: 'int',
      note: 'Remaster: 2 + your Intelligence modifier; refill 2 per 10 min of exploration. Power Quick/Advanced Alchemy.',
    },
  ],
  barbarian: [
    { id: 'rage', name: 'Rage', kind: 'toggle', refresh: 'encounter', feat: 'barbarian-dedication', note: 'Raging: lasts 1 min / until the encounter ends.' },
  ],
  magus: [
    {
      id: 'arcane-cascade',
      name: 'Arcane Cascade',
      kind: 'toggle',
      refresh: 'encounter',
      note: 'Stance: bonus damage to Strikes and hybrid-study effects.',
    },
  ],
  swashbuckler: [
    { id: 'panache', name: 'Panache', kind: 'toggle', refresh: 'encounter', feat: 'swashbuckler-dedication', note: 'Gained via bravado actions; spent on finishers; clears at encounter end.' },
  ],
  psychic: [
    { id: 'unleash-psyche', name: 'Unleash Psyche', kind: 'toggle', refresh: 'encounter', note: 'Amped spellcasting for 2 rounds, then a 2-round cooldown.' },
  ],
  commander: [
    { id: 'commanders-banner', name: "Commander's Banner", kind: 'toggle', refresh: 'manual', note: '+1 status to allies’ Will & DCs vs fear within 30 ft.' },
  ],
  ranger: [
    {
      id: 'hunt-prey',
      name: 'Hunt Prey',
      kind: 'toggle',
      refresh: 'encounter',
      feat: 'ranger-dedication',
      note: 'Designate one target as your prey: +2 circumstance to Seek/Track it and to Recall Knowledge about it, ignore its cover/concealment when you Seek, and apply your hunter’s edge (Flurry / Precision / Outwit) against it. Re-Hunt to change targets.',
    },
  ],
  investigator: [
    {
      id: 'devise-stratagem',
      name: 'Devise a Stratagem',
      kind: 'toggle',
      refresh: 'encounter',
      note: 'Roll a d20 now (before you Strike) against a chosen creature; use that roll plus your Intelligence for your next Strike against it this turn, and add your Strategic Strike precision damage on a hit.',
    },
  ],
  oracle: [
    {
      id: 'cursebound',
      name: 'Cursebound',
      kind: 'counter',
      refresh: 'rest',
      meter: true,
      maxAtLevels: [
        [1, 2],
        [11, 3],
        [17, 4],
      ],
      note: 'Rises when you use cursebound abilities; drops by 1 when you Refocus.',
    },
  ],
};

/** The max value of a counter resource at a given level + ability mods. */
export function resourceMax(r: ClassResource, level: number, abilityMods: Record<AbilityId, number>): number {
  if (r.maxAtLevels) {
    let m = 0;
    for (const [lvl, max] of r.maxAtLevels) if (level >= lvl) m = max;
    return m;
  }
  const base = (r.maxBase ?? 0) + (r.maxPerLevel ?? 0) * level + (r.maxAbility ? abilityMods[r.maxAbility] : 0);
  return Math.max(0, base);
}

/**
 * A resource's daily maximum for a SPECIFIC character — the formula above, raised by any feat that
 * prints a bigger figure (Additional Servings: "your number of versatile vials per day increases
 * to 5", again to 6 at 12th and 7 at 18th).
 *
 * Prefer this to resourceMax() anywhere a real character is in hand. Both sheet call sites used the
 * bare formula, so a feat whose entire content is a larger number had no effect anywhere.
 */
export function resourceMaxFor(
  r: ClassResource,
  character: { level: number; resourceFloors?: Record<string, number> },
  abilityMods: Record<AbilityId, number>,
): number {
  return Math.max(resourceMax(r, character.level, abilityMods), character.resourceFloors?.[r.id] ?? 0);
}

/** A resource's starting/refreshed value: toggles off, meters empty, pools full — except where a rest
 *  restores less than the cap (`initialPerLevel`), which is Sanguimancy HP's whole shape. */
export function resourceInitial(r: ClassResource, level: number, abilityMods: Record<AbilityId, number>): number {
  if (r.kind === 'toggle' || r.meter) return 0;
  const max = resourceMax(r, level, abilityMods);
  if (r.initialPerLevel != null) return Math.min(max, r.initialPerLevel * level);
  return max;
}

/** The resources a character actually has: their base class's, PLUS any granted by an archetype
 *  dedication they own (e.g. Barbarian Dedication → Rage, Swashbuckler Dedication → Panache). */
export function resourcesForCharacter(classId: string | null, featIds: Set<string> = new Set()): ClassResource[] {
  const out: ClassResource[] = [];
  const seen = new Set<string>();
  for (const [clsId, list] of Object.entries(CLASS_RESOURCES)) {
    const isBaseClass = classId === clsId;
    for (const r of list) {
      if ((isBaseClass || (r.feat && featIds.has(r.feat))) && !seen.has(r.id)) {
        out.push(r);
        seen.add(r.id);
      }
    }
  }
  return out;
}

/** The initial resource map for a character (id -> value), or {} if it has none. */
export function initialClassResources(
  classId: string | null,
  level: number,
  abilityMods: Record<AbilityId, number>,
  featIds: Set<string> = new Set(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of resourcesForCharacter(classId, featIds)) out[r.id] = resourceInitial(r, level, abilityMods);
  return out;
}
