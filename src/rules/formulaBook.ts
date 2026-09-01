/*
 * The formula book.
 *
 * "Each formula book can hold the formulas for up to 100 different items." The item shipped, the
 * alchemist's class feature described it, and eighteen more records said they add formulas to it —
 * but nothing anywhere held a list of known formulas, so `dailyItems.ts`'s `fromKnownFormulas` flag
 * filtered against a pool that did not exist and Improbable Elixirs recorded its potions in a
 * free-text box marked inert.
 *
 * A formula is a REFERENCE to an item, never a copy of it: the book lists "<item name> formula" and
 * the inventory stays untouched. The list lives on the BOOK'S OWN inventory instance
 * (`InventoryItem.formulas`), which is what makes the rest of this module unusual.
 *
 * ⚠ A grant is a ONE-TIME WRITE, not a live derivation — the opposite of every other grant in this
 * app. Picking a formula copies it into the book, and from then on the book owns it: if the book is
 * lost the formulas go with it and the granting record does NOT hand them over again. That is why
 * there are two stores rather than one. The book holds the formulas; a separate SPENT LEDGER
 * (`formulaPicks`, slot key → item id) records that a grant slot has been used, and it deliberately
 * does not live on the book, so destroying the book cannot resurrect the grant.
 */
import { ownedFeatureIds, resolveFormula } from './derive';
import { PROFICIENCY_RANKS, type Character, type ContentDatabase, type InventoryItem, type Item, type ProficiencyKey, type ProficiencyRank, type Rarity } from './types';

/** The blank Formula Book equipment record — what "you gain a formula book" hands over. */
export const FORMULA_BOOK_ITEM_ID = 'formula-book-blank';

/** "Each formula book can hold the formulas for up to 100 different items." */
export const FORMULA_BOOK_CAPACITY = 100;

/** One run of like slots inside a grant — "four common 1st-level alchemical items", "one more each level". */
export interface FormulaGrantPart {
  /** What one of these slots is, shown on the empty slot and above its picker. */
  label: string;
  /** The record NAMES the formulas: one slot per id, each offering only that id. */
  fixed?: string[];
  /** How many slots, as a number or a formula over `@actor.level` / ability mods (see resolveFormula). */
  count?: number | string;
  /** Slot count by proficiency rank — the highest threshold the character has REACHED wins. */
  countByProficiency?: { key: ProficiencyKey; ranks: Partial<Record<ProficiencyRank, number>> };
  /** Restrict the pool to exactly these items (a printed menu). */
  ids?: string[];
  /** Items carrying ALL of these traits. */
  traits?: string[];
  /** …and at least ONE of these ("a common oil or potion"). */
  anyTraits?: string[];
  /** Level ceiling: a number, or 'self' for the character's own level. Absent = no ceiling. */
  maxLevel?: number | 'self';
  /** Rarities offered. Absent = every rarity, because only a record that SAYS "common" restricts one. */
  rarities?: Rarity[];
  /** A printed restriction the app cannot express. */
  note?: string;
}

export interface FormulaGrantSpec {
  /** This record gives the character a formula book (or needs one to write into): if they have none, add it. */
  book?: boolean;
  /** "You gain formulas to create these as alchemical consumables" — the formulas join the Advanced
   *  Alchemy prepare list and the Quick Alchemy picker (ruling Q19). */
  alchemical?: boolean;
  parts: FormulaGrantPart[];
  /**
   * Records whose formula list this one REPLACES rather than adds to.
   *
   * *"You gain the Alchemical Crafting feat, EXCEPT you must select the following items to add to your
   * formula book…"* (Skilled Herbalist). The granter hands Alchemical Crafting over, so both records
   * were owned and both specs fired: the character wrote the three named herbal formulas AND the four
   * free common formulas belonging to the very list this one was supposed to override.
   */
  supersedes?: string[];
}

/*
 * Every record that WRITES formulas into a formula book, from its own text and no further.
 *
 * Snare Crafting and Snarecrafter Dedication are deliberately absent: their formulas already have a
 * lane of their own (snareFormulas.ts + the builder's Snare formulas card), and a second one would
 * ask the same question twice. The five records that say you DON'T need a formula book (Herbalist,
 * Poisoner and Scrounger Dedication, Talisman Dabbler, Talisman Esoterica) are absent for the reason
 * they print.
 */
export const FORMULA_GRANTS: Record<string, FormulaGrantSpec> = {
  // CLASS FEATURE — the alchemist's own book. "You start with a standard Formula Book for free. The
  // formula book contains the formulas for two common 1st-level alchemical items of your choice…
  // Each time you gain a level, you can add the formulas for two common alchemical items… These new
  // formulas can be for any level of item you can create."
  'formula-book': {
    book: true,
    alchemical: true,
    parts: [
      { label: 'Common 1st-level alchemical item', count: 2, traits: ['alchemical'], maxLevel: 1, rarities: ['common'] },
      { label: 'Common alchemical item', count: '2*@actor.level-2', traits: ['alchemical'], maxLevel: 'self', rarities: ['common'] },
    ],
  },
  // "you immediately add the formulas for four common 1st-level alchemical items to your formula book"
  'alchemical-crafting': {
    book: true,
    alchemical: true,
    parts: [{ label: 'Common 1st-level alchemical item', count: 4, traits: ['alchemical'], maxLevel: 1, rarities: ['common'] }],
  },
  // "Add an additional common 1st-level alchemical formula … when you take this feat. Each time you
  // gain a level beyond 1st, add one common alchemical formula of that level."
  'alchemical-scholar': {
    book: true,
    alchemical: true,
    parts: [
      { label: 'Common 1st-level alchemical formula', count: 1, traits: ['alchemical'], maxLevel: 1, rarities: ['common'] },
      { label: 'Common alchemical formula', count: '@actor.level-1', traits: ['alchemical'], maxLevel: 'self', rarities: ['common'] },
    ],
  },
  // "Add the formulas for four additional common alchemical items to your formula book, in addition
  // to those you gain from Alchemical Crafting." No level clause, so the character's own level caps it.
  'alchemist-dedication': {
    book: true,
    alchemical: true,
    parts: [{ label: 'Common alchemical item', count: 4, traits: ['alchemical'], maxLevel: 'self', rarities: ['common'] }],
  },
  // "you must select the following items to add to your formula book: Antidote (Lesser), Antiplague
  // (Lesser), and Elixir of Life (Minor), as well as a fourth 1st-level common alchemical formula."
  'skilled-herbalist': {
    book: true,
    alchemical: true,
    /* *"You gain the Alchemical Crafting feat, EXCEPT you must select the following items…"* — this
     * list is Alchemical Crafting's, replaced. Without this both fired and the herbalist wrote four
     * extra free formulas. */
    supersedes: ['alchemical-crafting'],
    parts: [
      { label: 'Named herbal formula', fixed: ['antidote-lesser', 'antiplague-lesser', 'elixir-of-life-minor'] },
      { label: 'Common 1st-level alchemical formula', count: 1, traits: ['alchemical'], maxLevel: 1, rarities: ['common'] },
    ],
  },
  // "You gain a formula book that includes the formula for black powder and four 1st-level types of
  // common or uncommon alchemical ammunition or bombs of your choice."
  'munitions-crafter': {
    book: true,
    alchemical: true,
    parts: [
      { label: 'Black powder', fixed: ['black-powder'] },
      {
        label: '1st-level alchemical bomb',
        count: 4,
        traits: ['alchemical', 'bomb'],
        maxLevel: 1,
        rarities: ['common', 'uncommon'],
        note: 'The feat also allows alchemical ammunition, which nothing in the data marks as ammunition — pick those with Add formula.',
      },
    ],
  },
  // "You immediately gain the formulas for four common 1st-level oils or potions. At 4th level and
  // every 2 levels beyond that, you gain the formula for a common oil or potion of that level or
  // lower." NOT `alchemical`: a cauldron's oils and potions are Crafted, not made with Quick Alchemy.
  cauldron: {
    book: true,
    parts: [
      { label: 'Common 1st-level oil or potion', count: 4, anyTraits: ['oil', 'potion'], maxLevel: 1, rarities: ['common'] },
      { label: 'Common oil or potion', count: 'floor(@actor.level/2)-1', anyTraits: ['oil', 'potion'], maxLevel: 'self', rarities: ['common'] },
    ],
  },
  // "Select a number of potions equal to your Intelligence modifier (minimum 1); these potions must
  // be of 9th level or lower. You gain formulas to create these potions as alchemical consumables."
  // No rarity clause is printed, so none is applied (ruling Q5).
  'improbable-elixirs': {
    book: true,
    alchemical: true,
    parts: [{ label: 'Potion of 9th level or lower', count: 'max(1,@actor.int.mod)', traits: ['potion'], maxLevel: 9 }],
  },
  // "You learn the formula for the Philosopher's Stone and can add it to your formula book."
  'craft-philosophers-stone': {
    book: true,
    alchemical: true,
    parts: [{ label: "Philosopher's Stone", fixed: ['philosophers-stone'] }],
  },
  // "If your proficiency rank in Crafting is expert, you gain the formulas for three common or
  // uncommon snares. If your rank is master, you gain 6. If your rank is legendary, you gain 9."
  'snare-specialist': {
    book: true,
    parts: [
      {
        label: 'Common or uncommon snare',
        countByProficiency: { key: 'crafting', ranks: { expert: 3, master: 6, legendary: 9 } },
        traits: ['snare'],
        maxLevel: 'self',
        rarities: ['common', 'uncommon'],
      },
    ],
  },
  // "You gain the formulas for three common or uncommon gadgets… three additional at master… another
  // three at legendary, for a total of nine."
  'gadget-specialist': {
    book: true,
    parts: [
      {
        label: 'Common or uncommon gadget',
        countByProficiency: { key: 'crafting', ranks: { trained: 3, master: 6, legendary: 9 } },
        traits: ['gadget'],
        maxLevel: 'self',
        rarities: ['common', 'uncommon'],
      },
    ],
  },
};

/** Stable key for one grant slot. Position-based, so a slot keeps its identity as the character levels. */
export const formulaSlotKey = (sourceId: string, partIndex: number, index: number) => `${sourceId}#${partIndex}:${index}`;

/** One formula the character is owed but has not written into the book yet. */
export interface FormulaSlot {
  key: string;
  /** The feat / class feature that grants it, for the "from …" label. */
  sourceId: string;
  sourceName: string;
  label: string;
  /** Which run of slots it belongs to, so the picker can find its pool again. */
  partIndex: number;
  index: number;
  note?: string;
}

/** The records this character owns that write formulas, in a stable order. */
export function formulaGrantsOwned(featIds: Iterable<string>, featureIds: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of [...featIds, ...featureIds]) if (FORMULA_GRANTS[id] && !out.includes(id)) out.push(id);
  /* A record that REPLACES another's list wins over it — see `supersedes`. Resolved after collection
   * so it does not matter which of the pair was reached first. */
  const superseded = new Set(out.flatMap((id) => FORMULA_GRANTS[id]?.supersedes ?? []));
  return superseded.size ? out.filter((id) => !superseded.has(id)) : out;
}

/** True when one of these records hands the character a formula book. */
export function grantsFormulaBook(recordIds: Iterable<string>): boolean {
  for (const id of recordIds) if (FORMULA_GRANTS[id]?.book) return true;
  return false;
}

/** The name of the first record that grants a book, for the "from …" label on the granted item. */
export function formulaBookSource(recordIds: Iterable<string>, db: ContentDatabase): string | undefined {
  for (const id of recordIds) {
    if (!FORMULA_GRANTS[id]?.book) continue;
    return db.feats[id]?.name ?? db.classFeatures[id]?.name ?? id;
  }
  return undefined;
}

/** How many slots one part grants this character. */
function countOf(part: FormulaGrantPart, c: Character): number {
  if (part.fixed) return part.fixed.length;
  if (part.countByProficiency) {
    const rank = c.proficiencies.skills[part.countByProficiency.key as 'crafting'] ?? 'untrained';
    // The highest threshold REACHED, so a legendary crafter still gets a master entry's count when
    // legendary is not listed.
    let n = 0;
    for (const [r, v] of Object.entries(part.countByProficiency.ranks)) {
      if (PROFICIENCY_RANKS.indexOf(rank) >= PROFICIENCY_RANKS.indexOf(r as ProficiencyRank)) n = Math.max(n, v ?? 0);
    }
    return n;
  }
  return Math.max(0, resolveFormula(part.count ?? 0, { level: c.level, abilities: c.abilities }));
}

/** Every formula slot this character's records grant, whether filled or not. */
export function formulaSlots(c: Character, db: ContentDatabase): FormulaSlot[] {
  const sources = formulaGrantsOwned(
    (c.feats ?? []).map((f) => f.featId),
    ownedFeatureIds(c, db),
  );
  const out: FormulaSlot[] = [];
  for (const sourceId of sources) {
    const sourceName = db.feats[sourceId]?.name ?? db.classFeatures[sourceId]?.name ?? sourceId;
    const spec = FORMULA_GRANTS[sourceId];
    spec.parts.forEach((part, partIndex) => {
      const n = countOf(part, c);
      for (let i = 0; i < n; i++) {
        out.push({
          key: formulaSlotKey(sourceId, partIndex, i),
          sourceId,
          sourceName,
          label: part.fixed ? db.items[part.fixed[i]]?.name ?? part.label : part.label,
          partIndex,
          index: i,
          ...(part.note ? { note: part.note } : {}),
        });
      }
    });
  }
  return out;
}

/** The items a slot may hold. A fixed slot offers exactly the one formula the record names. */
export function formulaOptions(slot: FormulaSlot, c: Character, db: ContentDatabase): Item[] {
  const part = FORMULA_GRANTS[slot.sourceId]?.parts[slot.partIndex];
  if (!part) return [];
  const byId = (ids: string[]) => ids.map((id) => db.items[id]).filter((it): it is Item => !!it);
  if (part.fixed) return byId([part.fixed[slot.index]].filter(Boolean));
  if (part.ids) return byId(part.ids).sort((a, b) => a.name.localeCompare(b.name));
  const maxLevel = part.maxLevel === 'self' ? c.level : part.maxLevel;
  return Object.values(db.items)
    .filter((it) => {
      if (maxLevel != null && (it.level ?? 0) > maxLevel) return false;
      if (part.rarities && !part.rarities.includes((it.rarity ?? 'common') as Rarity)) return false;
      const traits = new Set(it.traits ?? []);
      if (part.traits && !part.traits.every((t) => traits.has(t))) return false;
      if (part.anyTraits && !part.anyTraits.some((t) => traits.has(t))) return false;
      return true;
    })
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

/** The formula books in an inventory (a character may carry more than one). */
export function formulaBooks(inventory: InventoryItem[] | undefined, db: ContentDatabase): InventoryItem[] {
  return (inventory ?? []).filter((inv) => isFormulaBook(db.items[inv.itemId]));
}

/** True for the Formula Book item — and for a homebrew or copy-on-write clone of it, which keeps the
 *  name but not the id. Nothing in the data marks a book as a book, so the name is the only signal. */
export function isFormulaBook(item: Item | undefined): boolean {
  if (!item) return false;
  return item.id === FORMULA_BOOK_ITEM_ID || /\bformula book\b/i.test(item.name);
}

/** Every formula the character actually holds, across every book they carry. */
export function knownFormulas(inventory: InventoryItem[] | undefined, db: ContentDatabase): string[] {
  const out: string[] = [];
  for (const book of formulaBooks(inventory, db)) for (const id of book.formulas ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * Formulas that Advanced Alchemy and Quick Alchemy can make (ruling Q19).
 *
 * "You gain formulas to create these potions AS ALCHEMICAL CONSUMABLES" — so a 9th-level potion the
 * book holds becomes something the alchemist can brew, even though the potion itself is not an
 * alchemical item. Membership is the intersection of two things: the formula must be IN a book the
 * character is carrying, and the ledger must attribute it to a grant that said "as alchemical
 * consumables". Losing the book therefore empties the pool, which is the whole point of point 9.
 */
export function craftableFormulas(c: Character, db: ContentDatabase): string[] {
  const held = new Set(knownFormulas(c.inventory, db));
  const out: string[] = [];
  for (const [key, itemId] of Object.entries(c.formulaPicks ?? {})) {
    if (!held.has(itemId) || out.includes(itemId)) continue;
    if (FORMULA_GRANTS[key.split('#')[0]]?.alchemical) out.push(itemId);
  }
  return out;
}

/** Add a formula to a book's list: a set, capped at 100. Returns null when nothing would change —
 *  already known, or the book is full — so callers can leave the state object untouched. */
export function withFormula(formulas: string[] | undefined, itemId: string): string[] | null {
  const cur = formulas ?? [];
  if (cur.includes(itemId) || cur.length >= FORMULA_BOOK_CAPACITY) return null;
  return [...cur, itemId];
}
