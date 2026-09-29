import { describe, it, expect } from 'vitest';
import { categoryOfBook, NICHE_CATEGORIES, CORE_BOOKS, sourceCatalog } from '../src/rules/sources';
import { content } from './_content';

/**
 * IMPOSSIBLE MAGIC IS A SHOWN SOURCE.
 *
 * The four Impossible Magic classes could not be built at all. `categoryOfBook('Pathfinder Impossible
 * Magic')` fell through every test in src/rules/sources.ts and returned 'Other'; NICHE_CATEGORIES is
 * {'Other'}; `showNicheSources` defaults false; and the Sources card drops niche groups. So Setup →
 * Sources read "4/223" with no row for the book anywhere on the card, the class picker offered 16
 * classes, and searching it for "necro" or "rune" returned no matches — with 1,029 choosable records
 * behind that one gap: 4 classes, 362 feats, 331 spells, 313 items, 19 actions.
 *
 * It was the ONLY class-bearing book that shelved as 'Other'. Guns & Gears, Rage of Elements, War of
 * Immortals, Battlecry! and Dark Archive (Remastered) are all on the Rulebooks shelf, which is where
 * this belongs too.
 */
describe('Impossible Magic shelves as a rulebook', () => {
  it('is not niche', () => {
    expect(categoryOfBook('Pathfinder Impossible Magic')).toBe('Rulebooks');
    expect(NICHE_CATEGORIES.has(categoryOfBook('Pathfinder Impossible Magic'))).toBe(false);
  });

  it('shelves beside the other remaster hardcovers that carry a class', () => {
    for (const book of [
      'Pathfinder Guns & Gears', 'Pathfinder Rage of Elements', 'Pathfinder War of Immortals',
      'Pathfinder Battlecry!', 'Pathfinder Dark Archive (Remastered)',
    ]) {
      expect(categoryOfBook(book), book).toBe(categoryOfBook('Pathfinder Impossible Magic'));
    }
  });

  /*
   * …AND THE CARD SHOWS THE BOOK WITHOUT TURNING NICHE SOURCES ON — which is the whole of what this
   * asserts, and is NOT the same as the classes being offered to a new character.
   *
   * ⚠ A NEW CHARACTER STILL DOES NOT GET THEM. The Sources card says so in its own words — "New
   * characters start with the Core books only" — and the defaults are 4/223, Core 4/4, Rulebooks
   * 0/23: the picker offers 16 classes and searching "mag" or "necro" returns no match until the
   * player switches Impossible Magic ON, at which point the picker goes 16 -> 20. That is the
   * designed behaviour for every non-Core book, not a gap; what was broken was that the book had no
   * row to switch. `CORE_BOOKS` is asserted below to keep the two claims from being confused again:
   * this book is reachable, and it is not default-on.
   */
  it('shows on a non-niche shelf, and is not one of the default-on Core books', () => {
    const db = content();
    for (const id of ['magus', 'summoner', 'necromancer', 'runesmith']) {
      const book = db.classes[id]?.source?.book;
      expect(book, `${id} source book`).toBe('Pathfinder Impossible Magic');
      const shelf = categoryOfBook(book!);
      expect(NICHE_CATEGORIES.has(shelf), `${id} is behind the niche gate`).toBe(false);
      // …and not silently folded into the four Core books, which ARE on by default for a new
      // character. A player reaches these four by switching the book on, one toggle, in Setup.
      expect(CORE_BOOKS.includes(book!)).toBe(false);
    }
  });
});

/*
 * NO TWO ROWS ON THE CARD LOOK THE SAME.
 *
 * The catalog carries two book names that differ only by a curly apostrophe — "Pathfinder Season of
 * Ghosts Player's Guide" (10 entries) and "…Player’s Guide" (2) — and three spellings of the
 * Gatewalkers guide, one of them without the "Pathfinder " prefix. On the Adventure Paths shelf those
 * happen to fold into an AP bundle, so nothing showed; on any other shelf they would have drawn two
 * rows a player cannot tell apart, and toggling one would have left the other's content hidden.
 * `sourceCatalog` now keys its single-book rows by the display label with the curly apostrophe folded,
 * so the row carries every book behind it and one toggle moves them together.
 */
describe('the Sources card draws no two identical rows', () => {
  const fold = (s: string) => s.replace(/’/g, "'").toLowerCase();

  it('every row in every shelf has a distinct label', () => {
    const dupes: string[] = [];
    for (const g of sourceCatalog(content()).groups) {
      const seen = new Map<string, string>();
      for (const e of g.entries) {
        const k = fold(e.label);
        if (seen.has(k)) dupes.push(`${g.category}: "${seen.get(k)}" vs "${e.label}"`);
        else seen.set(k, e.label);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('a row that merges spellings carries every book behind it', () => {
    const { groups, allBooks } = sourceCatalog(content());
    const books = new Set(groups.flatMap((g) => g.entries).flatMap((e) => e.books));
    // Every book key is reachable from some row — a merged row must not drop one of the names, or the
    // content filed under it becomes unreachable.
    for (const b of allBooks) expect(books.has(b), `${b} is on no row`).toBe(true);
    // The curly spelling itself is gone from the shipped data since 2026-09-29: scripts/data/book-names.json
    // folds it into the straight one (desk #166 applied), so only the row merge below is left to pin.
    expect(allBooks).toContain("Pathfinder Season of Ghosts Player's Guide");
    expect(allBooks).not.toContain('Pathfinder Season of Ghosts Player’s Guide');
    // …and the merge still holds for two apostrophes on a single-book shelf, where nothing else folds them.
    const db = {
      feats: {
        a: { id: 'a', name: 'A', source: { book: "Pathfinder Test Book's Guide" } },
        b: { id: 'b', name: 'B', source: { book: 'Pathfinder Test Book’s Guide' } },
      },
    } as unknown as Parameters<typeof sourceCatalog>[0];
    const rows = sourceCatalog(db).groups.flatMap((g) => g.entries).filter((e) => /Test Book/.test(e.label));
    expect(rows).toHaveLength(1);
    expect(rows[0].books.sort()).toEqual(["Pathfinder Test Book's Guide", 'Pathfinder Test Book’s Guide'].sort());
  });
});
