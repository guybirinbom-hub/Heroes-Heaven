/*
 * ONE BOOK, ONE KEY — the chain's same-book fold (desk #166, applied 2026-09-29).
 *
 * `source.book` is the key the Sources card and every picker filter run on (src/rules/sources.ts), so a
 * book reaching core.json under two spellings is two rows on the card: measured 2026-09-29, 15 books did
 * ("Pathfinder Grand Bazaar" — 16 companion and familiar records — beside "Pathfinder Lost Omens The Grand
 * Bazaar", "Pathfinder Season of Ghosts (Hardcover)" beside "… Hardcover Compilation", a curly
 * "Player’s Guide" beside the straight one, "One-Shot #2" beside "One-Shot 2" …). None was minted by an
 * importer reading scripts/data/book-names.json: they came from overlay `source` rows that
 * import-siege-and-gaps re-applies after import-core-v2's own fold, overlay `create` rows, and records kept
 * from the Foundry-era reference. `foldBookSpellings` (scripts/lib/aon-facets.mjs) now runs in both
 * importers, and folds a spelling only through a row of scripts/data/book-names.json — its exact spelling's
 * row, else the row the importer's normalised lookup (rowKey) finds (a title match alone is the guard's
 * business, never the fold's). Every stray also has a row under its exact spelling; only two of them are
 * load-bearing today (Fools Aplenty, One-Shot #2), the other thirteen being reached through an older row by
 * rowKey too, and the row-presence test below keeps all of them so a narrower rowKey cannot silently unfold
 * one. A row folds whatever its title: the refuter's pass (2026-09-29) found two rows that rename the title —
 * "PFS Guide", "Pathfinder Society Year 4 Rule Updates" — that the fold had skipped, and 8 choosable records
 * the shipped core still carried under them; each such row names the same book by its reason (CHECK 4).
 * This pins the mapping on every one of those spellings,
 * the books it must never fold together, that no row means no fold, and the two calls in the chain. The shipped result is scripts/reprint-check.mjs CHECK 4 in `npm run verify`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookTitle, foldedBook, foldBookSpellings } from '../scripts/lib/aon-facets.mjs';

const TABLE = JSON.parse(readFileSync('scripts/data/book-names.json', 'utf8')) as Record<string, string>;

/** Every stray spelling measured on 2026-09-29 -> the key its book already carries (the table's target). */
const STRAYS: [string, string][] = [
  ['Pathfinder Grand Bazaar', 'Pathfinder Lost Omens The Grand Bazaar'],
  ['Pathfinder Tian Xia Character Guide', 'Pathfinder Lost Omens Tian Xia Character Guide'],
  ['Pathfinder Draconic Codex', 'Pathfinder Lost Omens Draconic Codex'],
  ['Pathfinder Fools Aplenty', 'Pathfinder Lost Omens: Fools Aplenty'],
  ['Pathfinder The Fall of Plaguestone', 'Pathfinder Adventure: The Fall of Plaguestone'],
  ['Pathfinder Crown of the Kobold King', 'Pathfinder Adventure: Crown of the Kobold King'],
  ['Pathfinder Season of Ghosts Player’s Guide', "Pathfinder Season of Ghosts Player's Guide"],
  ['Gatewalkers Player’s Guide (Remastered)', "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ["Gatewalkers Player's Guide (Remastered)", "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ['Pathfinder Night of the Gray Death', 'Pathfinder Adventure: Night of the Gray Death'],
  ['Pathfinder Gatewalkers (Hardcover)', 'Pathfinder Adventure Path: Gatewalkers'],
  ['Pathfinder Season of Ghosts (Hardcover)', 'Pathfinder Season of Ghosts Hardcover Compilation'],
  ['Pathfinder Shadows at Sundown', 'Pathfinder Adventure: Shadows at Sundown'],
  ['Pathfinder Foolish Housekeeping and Other Articles', 'Paizo Blog: Foolish Housekeeping and Other Articles'],
  ['Pathfinder Troubles in Grayce', 'Pathfinder Adventures: Troubles in Grayce'],
  ['Pathfinder One-Shot #2: Dinner at Lionlodge', 'Pathfinder One-Shot 2: Dinner at Lionlodge'],
  // two rows that change the title (each with its same-book reason), which the fold skipped until the refuter's pass
  ['Pathfinder PFS Guide', 'Pathfinder Lost Omens Pathfinder Society Guide'],
  ['Pathfinder Society Year 4 Rule Updates', 'Pathfinder Blog: Pathfinder Society Year 4 Rule Updates'],
  // 2026-09-30: a mid-title "The" (8 records), which CHECK 4's title strip did not see until that day
  ['Pathfinder #207: The Resurrection Flood', 'Pathfinder #207: Resurrection Flood'],
  // the printing folds the pass made before it was widened still hold
  ['Pathfinder Guns & Gears (Remastered)', 'Pathfinder Guns & Gears'],
  ['Pathfinder Dark Archive', 'Pathfinder Dark Archive (Remastered)'],
  ["Pathfinder Gatewalkers Player's Guide", "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ['Pathfinder Treasure Vault', 'Pathfinder Treasure Vault (Remastered)'],
];

describe('the same-book fold', () => {
  it('maps every stray spelling to its book’s one key', () => {
    for (const [stray, key] of STRAYS) expect(foldedBook(stray), stray).toBe(key);
  });

  it('every stray spelling on a record has its row in the table, each to the same key', () => {
    for (const [stray, key] of STRAYS.slice(0, 19)) expect(TABLE[stray], stray).toBe(key);
  });

  it('leaves a book that is already a key alone, and never guesses between two keys of one title', () => {
    const targets = [...new Set(Object.values(TABLE))];
    for (const t of targets) expect(foldedBook(t), t).toBeUndefined();
    const byTitle = new Map<string, string[]>();
    for (const t of targets) byTitle.set(bookTitle(t), [...(byTitle.get(bookTitle(t)) ?? []), t]);
    expect([...byTitle].filter(([, ts]) => ts.length > 1), 'two fold targets share a title: one book under two keys, and reprint-check CHECK 4 could not name the one').toEqual([]);
  });

  it('every row of the table folds its spelling into its own key, a row that changes the title too', () => {
    // A row that changes the title names the SAME book by its reason (scripts/reprint-check.mjs CHECK 4 fails
    // one without), so the fold follows it exactly as the importers' lookup does an Archives title.
    const targets = new Set(Object.values(TABLE).map((t) => t.trim()));
    const off = Object.entries(TABLE).filter(([a, t]) => !targets.has(a.trim()) && foldedBook(a) !== t.trim());
    expect(off, 'a row the fold does not follow').toEqual([]);
    expect(foldedBook('Pathfinder PFS Guide')).toBe('Pathfinder Lost Omens Pathfinder Society Guide');
    expect(foldedBook('Pathfinder Azarketi Ancestry Web Supplement')).toBe(TABLE['Azarketi Ancestry Web Supplement']);
  });

  it('never folds two different books together', () => {
    // two books are kept apart because no row sends one to the other: Bestiary 3 stays Bestiary 3, never Monster Core 2
    expect(foldedBook('Pathfinder Bestiary 3')).toBeUndefined();
    expect(foldedBook('Bestiary 3')).toBe('Pathfinder Bestiary 3');
    expect(foldedBook('Pathfinder Bestiary')).toBeUndefined();
    // a later volume, a player's guide and its Adventure Path, a volume and its Adventure Path
    expect(bookTitle('Pathfinder Monster Core 2')).not.toBe(bookTitle('Pathfinder Monster Core'));
    expect(bookTitle('Pathfinder Bestiary 3')).not.toBe(bookTitle('Pathfinder Monster Core 2'));
    expect(bookTitle("Pathfinder Gatewalkers Player's Guide (Remastered)")).not.toBe(bookTitle('Pathfinder Adventure Path: Gatewalkers'));
    expect(bookTitle('Pathfinder #187: The Seventh Arch')).not.toBe(bookTitle('Pathfinder Adventure Path: Gatewalkers'));
    expect(foldedBook('Pathfinder Unknown Book')).toBeUndefined();
    // …and one volume under two spellings the table already maps stays one
    expect(bookTitle('Pathfinder #172: Secrets of the Temple City')).toBe(bookTitle('Pathfinder #172: Secrets of the Temple-City'));
  });

  it('a title match alone folds nothing: a row of the table decides, and the guard sees the rest', () => {
    // Each has a fold target's TITLE (so reprint-check CHECK 4 fails it if it ever ships on a choosable
    // record) but no row, so the chain leaves it where it is: a blog post titled like a book, a spelling
    // nobody has ruled on, is never moved without a row someone wrote (desk #166: different books never fold).
    const targets = new Set(Object.values(TABLE));
    const titles = new Map([...targets].map((t) => [bookTitle(t), t]));
    for (const b of [
      'Pathfinder Blog: Tian Xia Character Guide',
      'Pathfinder Blog: Gatewalkers',
      'Pathfinder Season of Ghosts',
      'Pathfinder Lost Omens Fall of Plaguestone',
      'Pathfinder Adventure: Grand Bazaar',
    ]) {
      expect(TABLE[b], b).toBeUndefined();
      expect(titles.has(bookTitle(b)), `${b} carries a fold target's title`).toBe(true);
      expect(foldedBook(b), b).toBeUndefined();
    }
    // a book that is nothing but a prefix keeps its whole spelling as its title, never "" beside the others
    expect(bookTitle('Pathfinder Blog')).not.toBe('');
    expect(bookTitle('Pathfinder Blog')).not.toBe(bookTitle('Paizo Blog'));
    expect(bookTitle('Pathfinder Lost Omens')).not.toBe(bookTitle('Pathfinder Blog'));
  });

  it('folds a db in place, skips the named buckets and homebrew, and says what it moved', () => {
    const db = {
      animalCompanions: { beetle: { id: 'beetle', source: { book: 'Pathfinder Grand Bazaar' } } },
      items: { x: { id: 'x', source: { book: 'Pathfinder Grand Bazaar', license: 'homebrew' } }, y: { id: 'y', source: { book: 'Pathfinder Player Core' } } },
      reference: { r: { id: 'r', source: { book: 'Pathfinder Gatewalkers (Hardcover)' } } },
    };
    const moved = foldBookSpellings(db, new Set(['reference']));
    expect(moved).toEqual(['animalCompanions/beetle: Pathfinder Grand Bazaar -> Pathfinder Lost Omens The Grand Bazaar']);
    expect(db.animalCompanions.beetle.source.book).toBe('Pathfinder Lost Omens The Grand Bazaar');
    expect(db.items.x.source.book).toBe('Pathfinder Grand Bazaar');
    expect(db.items.y.source.book).toBe('Pathfinder Player Core');
    expect(db.reference.r.source.book).toBe('Pathfinder Gatewalkers (Hardcover)');
  });

  it('CHECK 4 reads a title with every "the" set aside, so a mid-title "The" no longer hides a pair (2026-09-30)', () => {
    // bookTitle alone strips a LEADING "the" only: the #207 pair (8 records beside 22, one v0.1.40 row) passed CHECK 4.
    expect(bookTitle('Pathfinder #207: The Resurrection Flood')).not.toBe(bookTitle('Pathfinder #207: Resurrection Flood'));
    const src = readFileSync('scripts/reprint-check.mjs', 'utf8');
    expect(src).toContain("const looseBookTitle = (s) => bookTitle(String(s || '').replace(/\\bthe\\b/gi, ' '));");
    const check4 = src.slice(src.indexOf('const targets = new Set(Object.values(names));'), src.indexOf('CHECK 5 —'));
    expect(check4.length, 'CHECK 4 block not found').toBeGreaterThan(500);
    expect(check4.match(/looseBookTitle\(/g)?.length, 'CHECK 4 titles every book through looseBookTitle').toBeGreaterThanOrEqual(5);
    expect(check4, 'a bare bookTitle( left in CHECK 4 would hide a mid-title "The" again').not.toMatch(/\bbookTitle\(/);
  });

  it('runs in the chain after each overlay pass: import-core-v2 and import-siege-and-gaps (after its re-apply)', () => {
    const v2 = readFileSync('scripts/import-core-v2.mjs', 'utf8');
    expect(v2.indexOf('foldBookSpellings(db, LABELLED_BUCKETS)')).toBeGreaterThan(v2.indexOf('applyBackfill(db)'));
    const gaps = readFileSync('scripts/import-siege-and-gaps.mjs', 'utf8');
    expect(gaps.indexOf('foldBookSpellings(core, LABELLED_BUCKETS)')).toBeGreaterThan(gaps.indexOf('applyBackfill(core)'));
  });
});
