import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applySources, collectChosenIds, emptyBuild } from '../src/rules/build';
import { CORE_BOOKS, sourceCatalog, enabledBookSet, categoryOfBook, NICHE_CATEGORIES } from '../src/rules/sources';

const db = content();

describe('source catalog', () => {
  it('lists many books and groups the four Core books under "Core"', () => {
    const cat = sourceCatalog(db);
    expect(cat.allBooks.length).toBeGreaterThan(50);
    const core = cat.groups.find((g) => g.category === 'Core');
    expect(core?.entries.flatMap((e) => e.books).sort()).toEqual([...CORE_BOOKS].sort());
    // every entry has a positive content count and at least one book
    expect(cat.groups.every((g) => g.entries.every((e) => e.count > 0 && e.books.length > 0))).toBe(true);
  });

  it('bundles Adventure Path volumes into named-AP toggles (far fewer than the raw book count)', () => {
    const cat = sourceCatalog(db);
    const ap = cat.groups.find((g) => g.category === 'Adventure Paths')!;
    // ~150 AP books collapse into a few dozen named-AP bundles
    expect(ap.bookCount).toBeGreaterThan(100);
    expect(ap.entries.length).toBeLessThan(45);
    // Age of Ashes bundles its six volumes (#145–150) + player's guide into one entry
    const aoa = ap.entries.find((e) => e.label === 'Age of Ashes')!;
    expect(aoa).toBeTruthy();
    expect(aoa.books.length).toBeGreaterThanOrEqual(6);
    expect(aoa.books.some((b) => /#145/.test(b))).toBe(true);
    expect(aoa.books.some((b) => /Player.?s Guide/.test(b))).toBe(true);
    // the workflow's correction: #199 belongs to Season of Ghosts, not Wardens of Wildwood
    const sog = ap.entries.find((e) => e.label === 'Season of Ghosts')!;
    expect(sog.books.some((b) => /#199/.test(b))).toBe(true);
    // nothing is left as a raw guide / hardcover-line / compilation book — all folded into AP names
    expect(ap.entries.every((e) => !/Player.?s Guide|Adventure Path:|Hardcover Compilation/.test(e.label))).toBe(true);
    // a "(Remastered)" guide that lacks the "Pathfinder " prefix still merges into its AP
    expect(ap.entries.find((e) => e.label === 'Gatewalkers')!.books.length).toBeGreaterThanOrEqual(3);
    // Pathfinder Society now lives under Adventure Paths as one bundle of many scenarios/quests
    const society = ap.entries.find((e) => e.label === 'Pathfinder Society')!;
    expect(society).toBeTruthy();
    expect(society.books.length).toBeGreaterThan(5);
  });

  it('folds AP volumes / scenarios / bestiaries out of "Other" so it stays small', () => {
    expect(categoryOfBook('Pathfinder Player Core')).toBe('Core');
    expect(categoryOfBook('Pathfinder Lost Omens Tian Xia Character Guide')).toBe('Lost Omens');
    expect(categoryOfBook('Pathfinder #219: Lord of the Trinity Star')).toBe('Adventure Paths');
    expect(categoryOfBook('Pathfinder Season of Ghosts Hardcover Compilation')).toBe('Adventure Paths');
    expect(categoryOfBook('Pathfinder Stolen Fate Player’s Guide')).toBe('Adventure Paths');
    expect(categoryOfBook("Pathfinder Stolen Fate Player's Guide")).toBe('Adventure Paths');
    expect(categoryOfBook('Pathfinder Adventure: The Slithering')).toBe('Adventure Paths');
    expect(categoryOfBook('Pathfinder Society Scenario #1-03: Escaping the Grave')).toBe('Adventure Paths'); // Society folds in with APs
    expect(categoryOfBook('Pathfinder NPC Core')).toBe('Rulebooks');
    // the Advanced Player's Guide is a rulebook, NOT swept into APs by the "Player's Guide" rule
    expect(categoryOfBook("Pathfinder Advanced Player's Guide")).toBe('Rulebooks');
    // AoN exports Lost Omens / hardcover titles WITHOUT the "Lost Omens:" prefix or with a
    // "(Remastered)" suffix — they must still shelve correctly, not fall into "Other".
    expect(categoryOfBook('Pathfinder Tian Xia Character Guide')).toBe('Lost Omens');
    expect(categoryOfBook('Pathfinder Ancestry Guide')).toBe('Lost Omens');
    expect(categoryOfBook('Pathfinder Gods & Magic')).toBe('Lost Omens');
    expect(categoryOfBook('Pathfinder Guns & Gears (Remastered)')).toBe('Rulebooks');
    // "Other" holds only genuinely niche material — blogs, specials, standalone one-offs. It's larger
    // than the pre-migration catalog (fresh records surfaced more books) but must stay a short tail,
    // with Society/APs/Lost Omens/Rulebooks all shelved elsewhere.
    const cat = sourceCatalog(db);
    const other = cat.groups.find((g) => g.category === 'Other')!;
    expect(other.entries.length).toBeLessThanOrEqual(12);
    expect(other.entries.some((e) => /Blog/.test(e.label))).toBe(true);
    expect(other.entries.every((e) => e.label !== 'Pathfinder Society')).toBe(true);
    // no Lost Omens setting book leaked into the "Other" shelf
    expect(other.entries.every((e) => !/Tian Xia|Ancestry Guide|Character Guide|Mwangi/.test(e.label))).toBe(true);
  });

  it('shelves joke/web-supplement books as niche even when titled "Lost Omens: …"', () => {
    // Regression: the /Lost Omens/ test used to run FIRST, so the April Fools product and the web
    // supplement shelved as normal Lost Omens setting books — their joke feats (Wombat Style, Dad
    // Joke) stayed selectable with niche sources turned off.
    expect(categoryOfBook('Pathfinder Lost Omens: Fools Aplenty')).toBe('Other');
    expect(categoryOfBook('Pathfinder Fools Aplenty')).toBe('Other');
    expect(categoryOfBook('Pathfinder Lost Omens Divine Mysteries Web Supplement')).toBe('Other');
    expect(categoryOfBook('Pathfinder Special: Fumbus!')).toBe('Other');
    // …while the real hardcovers with similar names are untouched.
    expect(categoryOfBook('Pathfinder Lost Omens Divine Mysteries')).toBe('Lost Omens');
    expect(categoryOfBook('Pathfinder Lost Omens Character Guide')).toBe('Lost Omens');
    // "Other" is the only niche category, so these are hidden unless niche sources are shown.
    expect(NICHE_CATEGORIES.has('Other')).toBe(true);
    // Both Fools Aplenty titles collapse into ONE toggle rather than two stray rows.
    const other = sourceCatalog(db).groups.find((g) => g.category === 'Other')!;
    const fools = other.entries.filter((e) => /Fools Aplenty/.test(e.label));
    expect(fools).toHaveLength(1);
    expect(fools[0].books.length).toBeGreaterThanOrEqual(2);
  });
});

describe('applySources', () => {
  const coreSet = enabledBookSet(undefined); // absent → Core-only

  it('keeps Core content, drops non-Core, but always keeps chosen ids', () => {
    const nonCore = Object.values(db.feats).find((f) => f.source?.book && !coreSet.has(f.source.book))!;
    const core = Object.values(db.feats).find((f) => f.source?.book && coreSet.has(f.source.book))!;
    const otherNonCore = Object.values(db.feats).find(
      (f) => f.source?.book && !coreSet.has(f.source.book) && f.id !== nonCore.id,
    )!;
    expect(nonCore && core && otherNonCore).toBeTruthy();

    const filtered = applySources(db, coreSet, new Set([nonCore.id]));
    expect(filtered.feats[core.id]).toBeTruthy(); // Core book → kept
    expect(filtered.feats[nonCore.id]).toBeTruthy(); // non-Core but chosen (keepIds) → kept
    expect(filtered.feats[otherNonCore.id]).toBeUndefined(); // non-Core, not chosen → dropped
  });

  it('returns the same content ref when every book is enabled (memo-safe)', () => {
    const all = new Set(sourceCatalog(db).allBooks);
    expect(applySources(db, all, new Set())).toBe(db);
  });

  it('does not touch non-choosable maps (languages, runes, conditions)', () => {
    const filtered = applySources(db, coreSet, new Set());
    expect(filtered.languages).toBe(db.languages);
    expect(filtered.runes).toBe(db.runes);
    expect(filtered.conditions).toBe(db.conditions);
  });
});

describe('collectChosenIds', () => {
  it('collects every id the build already references', () => {
    const b = {
      ...emptyBuild(),
      ancestryId: 'human',
      classId: 'fighter',
      featPicks: { '1:class:0': 'power-attack' },
      cantrips: ['detect-magic'],
      spells: { 1: ['heal'] },
      inventory: [{ itemId: 'longsword', quantity: 1 }],
    };
    const ids = collectChosenIds(b, db);
    for (const id of ['human', 'fighter', 'power-attack', 'detect-magic', 'heal', 'longsword']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
