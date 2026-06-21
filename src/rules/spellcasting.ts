/*
 * Spellcasting progression (PF2e Player Core).
 *
 * All five Player Core casters (bard, cleric, druid, witch, wizard) are FULL
 * casters and share one spell-slot table: a new spell rank every two levels with
 * 2 then 3 slots, capping at 3 each of ranks 1–9, plus a single 10th-rank slot at
 * 19th–20th (granted by the class capstone). Like proficiency advancement, this
 * table is system-code data in Foundry, not in the class JSON, so it lives here.
 */

/** Cantrips a full caster knows. */
export const CANTRIPS_KNOWN = 5;

/**
 * Cantrips a class prepares/knows from its spell list. Wizards add one curriculum
 * cantrip from their school; a psychic chooses 3 from the occult list (its bonus
 * psi cantrips are granted separately by the conscious mind, not modelled here).
 */
export function cantripsKnown(classId: string | null | undefined): number {
  if (classId === 'wizard') return CANTRIPS_KNOWN + 1;
  if (classId === 'psychic') return 3;
  if (classId === 'animist') return 2; // 2 prepared "animist" cantrips (apparition cantrips are granted)
  return CANTRIPS_KNOWN;
}

/** Spell slots per rank (1–10) for a full caster at the given character level. */
export function fullCasterSlots(level: number): Record<number, number> {
  const slots: Record<number, number> = {};
  for (let r = 1; r <= 9; r++) {
    if (level >= 2 * r) slots[r] = 3;
    else if (level === 2 * r - 1) slots[r] = 2;
  }
  if (level >= 19) slots[10] = 1; // capstone 10th-rank slot
  return slots;
}

/** Highest spell rank a full caster can cast at the given level (0 = cantrips only). */
export function maxSpellRank(level: number): number {
  const ranks = Object.keys(fullCasterSlots(level)).map(Number);
  return ranks.length ? Math.max(...ranks) : 0;
}

/**
 * Magus / summoner spell slots: a short progression of 2 slots of the highest rank
 * plus 2 of the rank below (max 4 leveled slots), gaining a new rank every 2 levels
 * up to 9th at 19th, with a 1→2→3-slot ramp over levels 1–3. (Transcribed from the
 * Archives of Nethys magus & summoner tables, which are identical.) Magus's bonus
 * Studious Spells slots and summoner's are not added here.
 */
export function twoRankCasterSlots(level: number): Record<number, number> {
  if (level <= 1) return { 1: 1 };
  if (level === 2) return { 1: 2 };
  if (level === 3) return { 1: 2, 2: 1 };
  const maxR = Math.min(9, Math.ceil(level / 2));
  // A newly-unlocked top rank starts with ONE slot (gained at the odd level), filling to two at the
  // next (even) level — the same first-access ramp the full-caster/psychic tables use.
  return { [maxR - 1]: 2, [maxR]: level % 2 === 1 ? 1 : 2 };
}

/**
 * Psychic spell slots: the full-caster rank progression (new rank every 2 levels,
 * 10th at 19th) but only 2 slots per rank — 1 the level a rank is first gained.
 * (Transcribed from the Archives of Nethys psychic table.) Amped psi cantrips are
 * a separate focus subsystem, not modelled here.
 */
export function psychicSlots(level: number): Record<number, number> {
  const slots: Record<number, number> = {};
  for (let r = 1; r <= 9; r++) {
    if (level >= 2 * r) slots[r] = 2;
    else if (level === 2 * r - 1) slots[r] = 1;
  }
  if (level >= 19) slots[10] = 1;
  return slots;
}

/**
 * The animist casts divine spells through TWO pools (AoN "X+Y" table): a prepared
 * "animist" pool and a spontaneous "apparition" pool fed by attuned apparitions.
 *
 * Prepared pool: the full-caster rank progression at 2 slots/rank (1 for a new rank),
 * no 10th — i.e. the psychic shape without the capstone slot.
 */
export function animistPreparedSlots(level: number): Record<number, number> {
  const s: Record<number, number> = {};
  for (let r = 1; r <= 9; r++) {
    if (level >= 2 * r) s[r] = 2;
    else if (level === 2 * r - 1) s[r] = 1;
  }
  return s;
}

/** Spontaneous "apparition" pool (the AoN table's Y column), per level then rank. */
const APPARITION_SLOTS: Record<number, Record<number, number>> = {
  1: { 1: 1 },
  2: { 1: 1 },
  3: { 1: 1, 2: 1 },
  4: { 1: 1, 2: 1 },
  5: { 1: 1, 2: 1, 3: 1 },
  6: { 1: 1, 2: 1, 3: 1 },
  7: { 1: 1, 2: 1, 3: 1, 4: 1 },
  8: { 1: 1, 2: 1, 3: 1, 4: 1 },
  9: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
  10: { 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 },
  11: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 },
  12: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 },
  13: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1 },
  14: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1 },
  15: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 },
  16: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 },
  17: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 },
  18: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 },
  19: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1 },
  20: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1 },
};

/** Spontaneous "apparition" spell slots at the given character level. */
export function apparitionSlots(level: number): Record<number, number> {
  return APPARITION_SLOTS[Math.min(20, Math.max(1, level))] ?? {};
}

/**
 * Magus Studious Spells (level 7+): two bonus prepared slots restricted to a curated
 * utility list, at a tier rank that steps 2nd (L7–10) → 3rd (L11–12) → 4th (L13+).
 * Returns the tier rank + the curated spells we auto-prepare into those slots (a
 * representative pair from the feature's always-added list — Sure Strike heightened
 * plus the tier's signature utility spell). Null below level 7.
 */
export function magusStudiousSpells(level: number): { rank: number; spells: string[] } | null {
  if (level < 7) return null;
  if (level >= 13) return { rank: 4, spells: ['sure-strike', 'fly'] };
  if (level >= 11) return { rank: 3, spells: ['sure-strike', 'haste'] };
  return { rank: 2, spells: ['sure-strike', 'water-breathing'] };
}

/** Spell slots per rank for the given class progression (defaults to full caster). */
export function casterSlots(
  level: number,
  progression: 'full' | 'two-rank' | 'psychic' | 'animist' = 'full',
): Record<number, number> {
  if (progression === 'two-rank') return twoRankCasterSlots(level);
  if (progression === 'psychic') return psychicSlots(level);
  if (progression === 'animist') return animistPreparedSlots(level); // prepared pool; apparition pool added separately
  return fullCasterSlots(level);
}

/**
 * Free leveled spells in a wizard's spellbook: 5 at level 1, +2 each level after.
 * (The 10 starting cantrips and the school-curriculum additions are not counted here.)
 */
export function wizardSpellbookSize(level: number): number {
  return 5 + 2 * (Math.max(1, level) - 1);
}
