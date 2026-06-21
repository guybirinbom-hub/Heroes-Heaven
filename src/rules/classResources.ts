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
}

export const CLASS_RESOURCES: Record<string, ClassResource[]> = {
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
    { id: 'rage', name: 'Rage', kind: 'toggle', refresh: 'encounter', note: 'Raging: lasts 1 min / until the encounter ends.' },
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
    { id: 'panache', name: 'Panache', kind: 'toggle', refresh: 'encounter', note: 'Gained via bravado actions; spent on finishers; clears at encounter end.' },
  ],
  psychic: [
    { id: 'unleash-psyche', name: 'Unleash Psyche', kind: 'toggle', refresh: 'encounter', note: 'Amped spellcasting for 2 rounds, then a 2-round cooldown.' },
  ],
  commander: [
    { id: 'commanders-banner', name: "Commander's Banner", kind: 'toggle', refresh: 'manual', note: '+1 status to allies’ Will & DCs vs fear within 30 ft.' },
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

/** A resource's starting/refreshed value: toggles off, meters empty, pools full. */
export function resourceInitial(r: ClassResource, level: number, abilityMods: Record<AbilityId, number>): number {
  if (r.kind === 'toggle' || r.meter) return 0;
  return resourceMax(r, level, abilityMods);
}

/** The initial resource map for a class (id -> value), or {} if the class has none. */
export function initialClassResources(
  classId: string | null,
  level: number,
  abilityMods: Record<AbilityId, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of (classId && CLASS_RESOURCES[classId]) || []) out[r.id] = resourceInitial(r, level, abilityMods);
  return out;
}
