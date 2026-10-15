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

/**
 * Sorcerer / oracle spell slots: the SAME rank ladder as a full caster with ONE MORE slot at every
 * rank — 3 the level a rank opens, 4 thereafter, plus the capstone 10th-rank slot at 19th.
 *
 * Transcribed from the Archives of Nethys "Oracle Spells per Day" table (class-61, Player Core 2),
 * which the class text also states in words: "Each day, you can cast up to three 1st-rank spells."
 * The universal full-caster table starts at TWO, so an oracle was one slot short at every rank from
 * 1st to 20th, and one repertoire pick short with it. The sorcerer table (class-62) is identical,
 * but the sorcerer record stays on 'full' until the owner rules on it.
 */
export function fullPlusCasterSlots(level: number): Record<number, number> {
  const slots: Record<number, number> = {};
  for (let r = 1; r <= 9; r++) {
    if (level >= 2 * r) slots[r] = 4;
    else if (level === 2 * r - 1) slots[r] = 3;
  }
  if (level >= 19) slots[10] = 1; // capstone 10th-rank slot
  return slots;
}

/** Spell slots per rank for the given class progression (defaults to full caster). */
export function casterSlots(
  level: number,
  progression: 'full' | 'full-plus' | 'two-rank' | 'psychic' | 'animist' = 'full',
): Record<number, number> {
  if (progression === 'full-plus') return fullPlusCasterSlots(level);
  if (progression === 'two-rank') return twoRankCasterSlots(level);
  if (progression === 'psychic') return psychicSlots(level);
  if (progression === 'animist') return animistPreparedSlots(level); // prepared pool; apparition pool added separately
  return fullCasterSlots(level);
}

/**
 * Known spells per rank for a SPONTANEOUS caster: the slot count, plus any `extraRepertoire` the class
 * prints beyond it.
 *
 * Two classes print a repertoire larger than their slot table and had no carrier for it at all — the
 * summoner (*"your spell repertoire reaches its maximum size of five spells"* against a stated maximum
 * of four slots) and the oracle's Oracular Clarity (*"Add two common 10th-rank divine spells to your
 * repertoire. You gain a single 10th-rank spell slot"*).
 *
 * A rank the caster cannot actually cast yet is DROPPED (`rank <= topRank`): without that guard the
 * oracle's `{10: 1}` would offer a 10th-rank repertoire pick to a 1st-level character, since rank 10
 * simply isn't in the slot table before 19th. The summoner's `{1: 1}` survives the guard at every
 * level, including those where the two-rank table has moved off 1st-rank slots entirely — which is
 * right: the repertoire keeps its five spells while the slots move up.
 *
 * ONE function, called by buildCharacter (which slices the repertoire) and by the builder (which caps
 * the picker), because two implementations of a pick cap are how a picker comes to offer a spell the
 * sheet then throws away.
 */
export function repertoireCounts(
  slots: Record<number, number>,
  extra?: Record<number, number>,
): Record<number, number> {
  if (!extra) return slots;
  const ranks = Object.keys(slots).map(Number);
  if (!ranks.length) return slots;
  const topRank = Math.max(...ranks);
  const out: Record<number, number> = { ...slots };
  for (const [rankStr, n] of Object.entries(extra)) {
    const rank = Number(rankStr);
    if (rank > topRank) continue;
    out[rank] = (out[rank] ?? 0) + n;
  }
  return out;
}

/**
 * Leveled spells in a LEARNED prepared caster's spellbook at a level: the 1st-level book plus
 * `perLevel` more each level after. The necromancer's dirge is *"the 1st-rank spell harm, and four
 * other 1st-rank occult spells… Each time you gain a level, you add two occult spells"* — not the
 * wizard's 5 + 2 — so the numbers come off the class record instead of a hardcoded class-id test.
 */
export function spellbookBudget(spec: { spells: number; perLevel: number }, level: number): number {
  return spec.spells + spec.perLevel * (Math.max(1, level) - 1);
}

/** The slice of a class record the book helpers read — structural, so this file imports nothing. */
type BookClass = { id: string; spellcasting?: { type?: string; repertoire?: boolean; spellbook?: { cantrips?: number; noun?: string } } } | null | undefined;

/**
 * Does this class prepare out of a BOOK (a spellbook, a familiar, a dirge) rather than off its whole
 * tradition? The same test buildCharacter's book branch and the builder's `isWizardBook` make: a
 * prepared class whose record declares `spellcasting.spellbook`, or a wizard or witch (which carry no
 * `spellbook` object — the builder's Unified Magical Theory +1 depends on that absence).
 */
export function isBookCaster(cls: BookClass): boolean {
  const sp = cls?.spellcasting;
  if (!sp || sp.repertoire || (sp.type && sp.type !== 'prepared')) return false;
  return !!sp.spellbook || cls!.id === 'wizard' || cls!.id === 'witch';
}

/**
 * How many CANTRIPS a book caster's book holds at 1st level — the BOOK, not the five (six) prepared
 * from it each morning. Print, newest printing:
 *   · wizard 10 — *"The spellbook contains your choice of 10 arcane cantrips"* (class-feature-793);
 *   · witch 10 — *"Your familiar starts off knowing 10 cantrips"* (class-feature-772);
 *   · magus 8 — *"eight arcane cantrips"* (class-feature-1258, Impossible Magic);
 *   · necromancer 8 — *"Your dirge contains your choice of eight occult cantrips"* (class-75).
 * The record's own `spellbook.cantrips` first; the wizard and witch fall back to 10 because they carry
 * no `spellbook` object. Undefined for a class with no book. test/book-cantrips.test.ts holds every
 * number against the record's own printed sentence.
 */
export function bookCantripCapacity(cls: BookClass): number | undefined {
  if (!isBookCaster(cls)) return undefined;
  return cls!.spellcasting!.spellbook?.cantrips ?? (cls!.id === 'wizard' || cls!.id === 'witch' ? 10 : undefined);
}

/** What player text calls a book caster's book: "spellbook" (wizard, magus), "familiar" (witch: *"Your
 *  familiar is the source and repository of the spells your patron has bestowed upon you"*), "dirge"
 *  (necromancer, from its record). Undefined for a class with no book. */
export function bookNoun(cls: BookClass): string | undefined {
  if (!isBookCaster(cls)) return undefined;
  return cls!.spellcasting!.spellbook?.noun ?? (cls!.id === 'witch' ? 'familiar' : 'spellbook');
}

/** The book as a TITLE — "Spellbook", "Familiar's spells", "Dirge". */
export function bookTitle(noun: string | undefined): string {
  const n = noun ?? 'spellbook';
  return n === 'familiar' ? 'Familiar’s spells' : n.charAt(0).toUpperCase() + n.slice(1);
}

/** The builder's cantrip row label for a book caster — "Spellbook cantrips", "Familiar’s cantrips". */
export function bookCantripLabel(noun: string | undefined): string {
  const n = noun ?? 'spellbook';
  return n === 'familiar' ? 'Familiar’s cantrips' : `${n.charAt(0).toUpperCase() + n.slice(1)} cantrips`;
}

/** The sheet's marker on a spell an entry is DRAWING that its book does not hold. One sentence, so the
 *  test and every surface say the same thing. */
export function notInBookNote(noun: string | undefined): string {
  return `Not in your ${noun ?? 'spellbook'} — add it in the builder`;
}

/** The sheet's marker on a restricted slot drawing a pick its own list does not hold — prepared in an
 *  ordinary slot the character no longer has (`RestrictedSlot.keptOffList`, lane C2). That slot is the
 *  old +1 slot a second-class wizard had before its curriculum (a save from before C2), or — the stored
 *  key cannot tell them apart — a Ring of Wizardry's slot after the ring came off, or an ordinary slot
 *  after a level-down. The words are true of all three; "before this slot was limited" was not
 *  (C2 check round 2). */
export function keptOffListNote(label: string): string {
  return `Not a ${label.toLowerCase()} spell — prepared in a slot you no longer have`;
}

/** The sheet's marker on a pick drawn PAST a sorcerer's allowance (`grantsCountInside`, lane C2): the
 *  bloodline's gift is one of the `places`, and a builder from before the gift was counted offered one
 *  more. Drawn and castable all the same; this says why the rank holds one too many.
 *
 *  `onSheet`: the rank's list was set on the sheet (`SpellcastingEntry.repertoireOnSheet`), so the
 *  builder's picks there are not read and removing one in the builder would change nothing — the
 *  sheet's Repertoire button is where it goes. Cantrips never are: a spontaneous caster's cantrips
 *  have no sheet writer, so the builder is the place for them.
 *
 *  The gift is always ONE of the places (`grantedPlaces`), even where the record lists one per variant
 *  (lane C4: C3's "your bloodline's 4 spells take all of your 4" told players to remove correct picks). */
export function overGiftNote(places: number, cantrip: boolean, onSheet = false): string {
  const where = onSheet ? 'with the Repertoire button' : 'in the builder';
  const noun = cantrip ? 'cantrip' : 'spell';
  return `One too many — your bloodline’s ${noun} is one of your ${places}; remove one ${where}`;
}

/** The marker on a class's own cantrip drawn past its cap (`cantripCapWas`): a save made while a
 *  Dual Class cantrip bonus still fed this class as well as the class that took the feat.
 *
 *  `prepared`: the class prepares its cantrips on the sheet, and a cantrip prepared there into an
 *  opening the larger cap gave is in no builder list — the Prepare button is where it is emptied. */
export function overCantripCapNote(places: number, prepared = false): string {
  const where = prepared ? 'leave one empty with the Prepare button, or remove one in the builder' : 'remove one in the builder';
  return `One too many — this class has ${places} cantrips; ${where}`;
}

/** The marker on a sorcerous gift drawn at a rank where the bloodline's record lists one gift per
 *  VARIANT (`variantGiftCount`, lane C4): print gives the character one of the `count`, and the record
 *  does not say which, so all are drawn — together one of the rank's places — and each says so. */
export function variantGiftNote(count: number): string {
  return `Your bloodline gives only one of these ${count} (by dragon, element or genie) — the app can’t tell which yet`;
}

/**
 * Free leveled spells in a wizard's spellbook: 5 at level 1, +2 each level after.
 * (The 10 starting cantrips — `bookCantripCapacity` — and the school-curriculum additions are not
 * counted here.)
 */
export function wizardSpellbookSize(level: number): number {
  return spellbookBudget({ spells: 5, perLevel: 2 }, level);
}

/**
 * A wizard's total spellbook budget at a level, including the School of Unified Magical Theory bonus.
 * UMT (Player Core): "you add one 1st-rank spell of your choice to your spellbook" — a flat +1 to the
 * initial spellbook, so the across-rank budget is one larger at every level.
 */
export function wizardSpellbookBudget(level: number, isUmt = false): number {
  return wizardSpellbookSize(level) + (isUmt ? 1 : 0);
}
