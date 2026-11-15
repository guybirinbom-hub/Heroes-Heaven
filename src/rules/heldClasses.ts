/*
 * Which classes a character holds — its own module so the light rule files (classResources.ts,
 * versatileVial.ts) can ask the same Dual Class question derive.ts asks without importing derive.ts,
 * which imports them. derive.ts re-exports `heldClasses`, so every existing import keeps working.
 */

/** The fields that say which classes a character — or a BuildState — holds. */
export type HeldClassFields = {
  classId?: string | null;
  subclassId?: string | null;
  classId2?: string | null;
  subclassId2?: string | null;
  variantRules?: { dualClass?: boolean };
};

/**
 * Every class the character holds, with the subclass chosen for it: the first class always, the SECOND
 * only under the Dual Class variant rule — *"gain the proficiencies, HP, features and feats of a second
 * class"*. The same guard deriveMaxHp and buildCharacter use, so a `classId2` left behind on a record
 * with the rule off grants nothing.
 *
 * Exists because the second class was read in a handful of places and missed in the rest: the sheet's
 * owned-feature set walked only the first class's table, so a Fighter/Guardian owned no Guardian's
 * Armor and woke fatigued in full plate, a Fighter/Rogue had no Sneak Attack and a Wizard/Fighter no
 * weapon specialization. Anything that asks "which class / which subclass" asks here.
 */
export function heldClasses(c: HeldClassFields): { classId: string | null; subclassId: string | null }[] {
  const out = [{ classId: c.classId ?? null, subclassId: c.subclassId ?? null }];
  if (c.variantRules?.dualClass && c.classId2) out.push({ classId: c.classId2, subclassId: c.subclassId2 ?? null });
  return out;
}

/**
 * The names of every held class, joined for display — "Fighter / Barbarian" under Dual Class, "Fighter"
 * otherwise, undefined with no class (or none found). The sheet header, the roster card and the party
 * card each printed `classes[classId].name` alone, so a Dual Class character was named as its first
 * class everywhere but the Details tab. The same class taken twice is named once ("Fighter", not
 * "Fighter / Fighter").
 */
export function heldClassNames(c: HeldClassFields, classes: Record<string, { name: string } | undefined>): string | undefined {
  const names = heldClasses(c)
    .map((s) => (s.classId ? classes[s.classId]?.name : undefined))
    .filter((n): n is string => !!n);
  return names.length ? [...new Set(names)].join(' / ') : undefined;
}
