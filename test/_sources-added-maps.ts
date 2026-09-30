import { CHOOSABLE_SOURCE_MAPS, CLASS_OPTIONS_SOURCE_KEY, MYTHIC_CALLINGS_SOURCE_KEY, SOURCE_MAPS_ADDED_2026_09_30, classOptionRecords, mythicCallingRecords } from '../src/rules/sources';
import type { ContentDatabase } from '../src/rules/types';

/** What joined the Sources on 2026-09-30: three maps, the class sub-picks (classOptionRecords) and the Mythic
 *  Callings (mythicCallingRecords). */
export const ADDED_2026_09_30: readonly string[] = [...SOURCE_MAPS_ADDED_2026_09_30, CLASS_OPTIONS_SOURCE_KEY, MYTHIC_CALLINGS_SOURCE_KEY];

/*
 * desk sources-apply-to-everything (owner, 2026-09-30: "yes the player sources should aplly to everything he
 * has accses to"): siegeWeapons, vehicles and runesmithRune joined CHOOSABLE_SOURCE_MAPS, and the class
 * sub-picks (every class's subclass / extraChoices options, by their classFeatures record's book) joined
 * sourceCatalog and applySources through classOptionRecords, and so did the Builder's Mythic Calling picker
 * (the `calling`-trait classFeatures, mythicCallingRecords). A book the Sources
 * card shows ONLY because one of those maps is now counted is a key no v0.1.40 selection could hold. The rule
 * (decided by the orchestrator under the owner's standing rule that a player's change is never overwritten):
 * it appears as ITS OWN ROW, OFF for every existing selection, because the app never derives it on — "New
 * characters start with the Core books only" — and a stored selection is never widened or narrowed by it. A
 * player who wants it switches it on. Never a seat inside an Adventure Path / Society / blog bundle row: there an
 * old whole-row selection would read part-on (sourceCatalog's ownRow; addedKeyRowViolations below).
 *
 * This is the one exception test/sources.test.ts's every-row guard makes, and it is measured, not listed:
 * such a key must be carried ONLY by records of the 2026-09-30 maps, and no BOOK_SPLITS / BOOK_FOLDS pair may
 * name it (a pair would derive it on, or derive something from it). Measured 2026-09-30 at 2a23c10: there is
 * none — every siege weapon's book and Impossible Magic already had a row and were v0.1.40 keys, and so were
 * the 26 books of the 250 class sub-picks. The Mythic Callings (18, measured the same day) bring one:
 * "Pathfinder Society Scenario #6-09: The Power of Legends", carried by the three Echoes callings and by no
 * other choosable record: a row of its own, switched off, and the Pathfinder Society row keeps its v0.1.40 books.
 */

/** Books (not homebrew) carried by records of what joined on 2026-09-30 and by no other choosable record. */
export function booksOnlyInAddedMaps(db: ContentDatabase): Set<string> {
  const added = new Set<string>(SOURCE_MAPS_ADDED_2026_09_30);
  const inAdded = new Set<string>();
  const elsewhere = new Set<string>();
  const lists: [boolean, Iterable<{ source?: { book?: string; license?: string } }>][] = CHOOSABLE_SOURCE_MAPS.map((m) => [
    added.has(m),
    Object.values((db[m] ?? {}) as Record<string, { source?: { book?: string; license?: string } }>),
  ]);
  lists.push([true, classOptionRecords(db).values()]);
  lists.push([true, mythicCallingRecords(db)]);
  for (const [isAdded, recs] of lists) {
    for (const r of recs) {
      if (r?.source?.license === 'homebrew') continue;
      const b = r?.source?.book?.trim();
      if (b) (isAdded ? inAdded : elsewhere).add(b);
    }
  }
  return new Set([...inAdded].filter((b) => !elsewhere.has(b)));
}

/**
 * The exception's two clauses, as messages (empty = holds): every key in `uncovered` (a card key no v0.1.40
 * selection could hold and no pair derives) is carried only by the 2026-09-30 maps, and no split or fold pair
 * names such a key on either side.
 */
export function addedMapKeyViolations(
  uncovered: readonly string[],
  onlyAdded: ReadonlySet<string>,
  pairs: ReadonlyArray<readonly [string, string]>,
): string[] {
  const out: string[] = [];
  for (const k of uncovered) {
    if (!onlyAdded.has(k)) out.push(`${k}: no v0.1.40 selection could hold it, and records outside ${ADDED_2026_09_30.join(', ')} carry it`);
  }
  for (const [from, to] of pairs) {
    for (const k of [from, to]) {
      if (onlyAdded.has(k)) out.push(`${from} -> ${to} names ${k}, a key only the 2026-09-30 maps carry: it starts OFF and is never derived`);
    }
  }
  return out;
}

/**
 * The design's third clause, as messages (empty = holds): a key only the 2026-09-30 records carry is a row of its
 * own. Inside a bundle row an old whole-row selection would read part-on and one checkbox would switch the old
 * books and the new one together (desk #170, third refuter's pass).
 */
export function addedKeyRowViolations(
  groups: readonly { category: string; entries: readonly { label: string; books: readonly string[] }[] }[],
  onlyAdded: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const e of g.entries) {
      for (const b of e.books) {
        if (onlyAdded.has(b) && e.books.length !== 1) out.push(`${g.category} / ${e.label}: ${b} shares the row with ${e.books.length - 1} other book(s)`);
      }
    }
  }
  return out;
}
