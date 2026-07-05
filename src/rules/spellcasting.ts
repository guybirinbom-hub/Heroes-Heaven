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
 * Magus / summoner spell slots: 2 slots of the highest rank plus 2 of the rank below
 * (max 4 leveled slots), gaining a new rank every 2 levels up to 9th at 17th. Only the
 * opening levels ramp: L1 has a single 1st-rank slot, and a newly-unlocked rank starts
 * at 1 slot ONLY for the very first two ranks (L1→2 for 1st, L3→4 for 2nd); from 3rd rank
 * onward (L5+) a new top rank arrives with 2 slots immediately. (Transcribed verbatim from
 * the Archives of Nethys magus & summoner "Spells per Day" tables, which are identical —
 * the table's footnoted `*` cells are the magus's Studious Spells, added separately by
 * magusStudiousSpells(), NOT base slots, and are excluded here.)
 */
export function twoRankCasterSlots(level: number): Record<number, number> {
  if (level <= 1) return { 1: 1 };
  if (level === 2) return { 1: 2 };
  if (level === 3) return { 1: 2, 2: 1 }; // 2nd rank just unlocked → 1 slot (the last per-rank ramp)
  const maxR = Math.min(9, Math.ceil(level / 2));
  // L4+: the top two accessible ranks each hold 2 slots. Unlike the full-caster/psychic tables, the
  // AoN magus/summoner table gives a newly-unlocked top rank its full 2 slots on the level it appears
  // (5th rank at L9, …, 9th at L17), so there is no odd-level "1 slot" ramp beyond L3.
  return { [maxR - 1]: 2, [maxR]: 2 };
}

/**
 * Psychic spell slots: a rank every 2 levels but only 2 slots per rank (1 the level a rank is first
 * gained). The psychic is a LIMITED caster and caps at 9th-rank spells — it does NOT get a 10th-rank
 * slot (only full casters do). (Transcribed from the Archives of Nethys psychic table.) Amped psi
 * cantrips are a separate focus subsystem, not modelled here.
 */
export function psychicSlots(level: number): Record<number, number> {
  const slots: Record<number, number> = {};
  for (let r = 1; r <= 9; r++) {
    if (level >= 2 * r) slots[r] = 2;
    else if (level === 2 * r - 1) slots[r] = 1;
  }
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

/**
 * A wizard's total spellbook budget at a level, including the School of Unified Magical Theory bonus.
 * UMT (Player Core): "you add one 1st-rank spell of your choice to your spellbook" — a flat +1 to the
 * initial spellbook, so the across-rank budget is one larger at every level.
 */
export function wizardSpellbookBudget(level: number, isUmt = false): number {
  return wizardSpellbookSize(level) + (isUmt ? 1 : 0);
}
