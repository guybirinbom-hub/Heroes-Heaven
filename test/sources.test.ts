import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { content } from './_content';
import { applySources, buildCharacter, collectChosenIds, emptyBuild } from '../src/rules/build';
import { CORE_BOOKS, CHOOSABLE_SOURCE_MAPS, sourceCatalog, enabledBookSet, categoryOfBook, NICHE_CATEGORIES, BOOK_FOLDS, BOOK_SPLITS, BOOK_SPLIT_MARK, storedSources } from '../src/rules/sources';

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
    // Fools Aplenty is ONE toggle rather than two stray rows. Its two titles used to meet in that row; since
    // 2026-09-29 (desk #166 applied) scripts/data/book-names.json folds "Pathfinder Fools Aplenty" into the
    // Lost Omens spelling, so the row holds the one key (and BOOK_FOLDS keeps an old selection of the other).
    const other = sourceCatalog(db).groups.find((g) => g.category === 'Other')!;
    const fools = other.entries.filter((e) => /Fools Aplenty/.test(e.label));
    expect(fools).toHaveLength(1);
    expect(fools[0].books).toEqual(['Pathfinder Lost Omens: Fools Aplenty']);
    expect(enabledBookSet(['Pathfinder Fools Aplenty']).has('Pathfinder Lost Omens: Fools Aplenty')).toBe(true);
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

/*
 * desk #166 (owner, 2026-09-25, "Middle way"): book aliases stopped folding different books together, so
 * Bestiary 3's records left "Monster Core 2" for their own book. A saved Sources choice must never be
 * narrowed by that — UNKNOWN ≠ EMPTY, and a player's choice is never overwritten by the app.
 */
describe('enabledBookSet — the 2026-09-25 book split never narrows a saved choice', () => {
  const MC2 = 'Pathfinder Monster Core 2';
  const B3 = 'Pathfinder Bestiary 3';

  it('a stored selection with the old fold target ON gets the real book ON too', () => {
    const on = enabledBookSet([...CORE_BOOKS, MC2]);
    expect(on.has(MC2)).toBe(true);
    expect(on.has(B3)).toBe(true);
    expect(on.has(BOOK_SPLIT_MARK)).toBe(true);
    // idempotent: the set it returns, stored and read again, is the same set
    expect([...enabledBookSet([...on])].sort()).toEqual([...on].sort());
  });

  it('a stored selection with the old fold target OFF keeps the real book OFF', () => {
    const off = enabledBookSet([...CORE_BOOKS, 'Pathfinder Bestiary 2']);
    expect(off.has(MC2)).toBe(false);
    expect(off.has(B3)).toBe(false);
  });

  /* The first-toggle defect (browser, 2026-09-25): from "Core only" the Sources card wrote
   * [...Core, Monster Core 2] with no mark, and the next read switched Bestiary 3 on beside it. */
  it('no selection stored is "Core only" as a NEW selection: toggling Monster Core 2 on leaves Bestiary 3 off', () => {
    const none = enabledBookSet(undefined);
    expect([...none].filter((b) => b !== BOOK_SPLIT_MARK).sort()).toEqual([...CORE_BOOKS].sort());
    const n = new Set(none);
    n.add(MC2); // SourcesCard.setBooks
    const reread = enabledBookSet(storedSources(n));
    expect(reread.has(MC2)).toBe(true);
    expect(reread.has(B3)).toBe(false);
  });

  it('a saved OLD selection gains the new book once, then never again', () => {
    const first = enabledBookSet([...CORE_BOOKS, MC2]); // stored before the split: no mark
    expect(first.has(B3)).toBe(true);
    const n = new Set(first);
    n.delete(B3); // the player then switches Bestiary 3 off
    const stored = storedSources(n);
    expect(enabledBookSet(stored).has(B3)).toBe(false);
    expect(enabledBookSet(storedSources(enabledBookSet(stored))).has(B3)).toBe(false);
  });

  /* The guard: a list stored any other way reads as pre-split. Copies of a stored list and the "Core only"
   * reset (undefined) are fine; anything that BUILDS a list must go through storedSources. */
  it('every writer of enabledSources in src/ stores through storedSources', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));
    const ok = /^(storedSources\(|undefined\b|string\[\]|\{?\[?(\.\.\.)?[\w!?.]+\.enabledSources\]?\}?)/; // a call, the reset, a type, a copy
    const bad = walk('src').flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/\benabledSources\s*(?::|=(?!=))\s*(.*)/g)].filter((m) => !ok.test(m[1])).map((m) => `${f}: ${m[0].slice(0, 90)}`),
    );
    expect(bad).toEqual([]);
  });

  it('every split names a book the shipped content really carries, and the mark names none', () => {
    const books = new Set(sourceCatalog(db).allBooks);
    const missing = BOOK_SPLITS.map(([, to]) => to).filter((to) => !books.has(to));
    expect(missing, 'a split pair whose new book has no choosable record').toEqual([]);
    expect(books.has(BOOK_SPLIT_MARK)).toBe(false);
  });

  /*
   * …and never OVERWRITTEN either: a book with a Sources row of its own that the stored list leaves out was
   * switched off by the player. The Gatewalkers Player's Guide (Remastered) had its own row (with its own
   * backgrounds) before the split, so Dark Archive (Remastered) being on must not switch it on.
   */
  it('a book the player could switch on themselves is never derived on (Dark Archive (Remastered) on, the Gatewalkers guide off)', () => {
    const DAR = 'Pathfinder Dark Archive (Remastered)';
    const GPG = "Pathfinder Gatewalkers Player's Guide (Remastered)";
    const set = enabledBookSet([...CORE_BOOKS, DAR]);
    expect(set.has(DAR)).toBe(true);
    expect(set.has(GPG)).toBe(false);
    expect(BOOK_SPLITS.some(([, to]) => to === GPG)).toBe(false);
  });

  /* Not splits: one book under two titles folds (scripts/data/book-names-reasons.json). Secrets of the Unlit
   * Star is the remastered Beginner Box; the Azarketi web supplement reprints Absalom's own chapter. A
   * character with only the fold target on keeps every record, as before desk #166. */
  it('the two Beginner Box guides, and the Azarketi supplement with Absalom, fold into one book', () => {
    for (const id of ['pyrite-rat', 'belt-of-good-health', 'hunters-bow', 'smoking-sword', 'poisonous-dagger', 'storm-hammer']) {
      expect(db.items[id]?.source?.book, id).toBe('Pathfinder Beginner Box: Secrets of the Unlit Star');
    }
    const ABSALOM = 'Pathfinder Lost Omens Absalom, City of Lost Omens';
    expect(db.ancestries.azarketi?.source?.book).toBe(ABSALOM);
    expect(db.items['boarding-axe']?.source?.book).toBe(ABSALOM);
    expect(db.items['gill-hook']?.source?.book).toBe(ABSALOM);
    expect(sourceCatalog(db).allBooks).not.toContain("Pathfinder Beginner Box: Game Master's Guide");
    expect(BOOK_SPLITS.some(([, to]) => /Azarketi|Beginner Box/.test(to))).toBe(false);
  });

  /* A spelling that escaped its fold (desk #166, 2026-09-25): the Sources card showed "Guns & Gears
   * (Remastered)" with 2 records beside Guns & Gears with 700, and a legacy Dark Archive and Gatewalkers guide
   * row the same way. The records carry the fold target now, through scripts/data/book-names.json. */
  it('the Guns & Gears, Dark Archive, Treasure Vault and Gatewalkers guide printings are one row each', () => {
    const books = sourceCatalog(db).allBooks;
    for (const b of ['Pathfinder Guns & Gears (Remastered)', 'Pathfinder Dark Archive', 'Pathfinder Treasure Vault', "Pathfinder Gatewalkers Player's Guide"]) {
      expect(books, b).not.toContain(b);
    }
    expect(db.feats['firework-technician-dedication']?.source?.book).toBe('Pathfinder Guns & Gears');
    expect(db.items['pyrotechnic-versatile-vial']?.source?.book).toBe('Pathfinder Guns & Gears');
    for (const id of ['mind-weapon', 'mind-smiths-keepsake']) expect(db.items[id]?.source?.book, id).toBe('Pathfinder Dark Archive (Remastered)');
    expect(db.actions['binding-vow']?.source?.book).toBe('Pathfinder Dark Archive (Remastered)');
    expect(db.backgrounds['wish-for-riches']?.source?.book).toBe("Pathfinder Gatewalkers Player's Guide (Remastered)");
  });

  /*
   * …and a fold never flips a row the player could set. Round 6 derived the fold target ON for an old
   * selection with the folded spelling on, which switched Guns & Gears (700 records) or Dark Archive
   * (Remastered) (425) back on for a player who had them off. The owner's standing rule — a player's change is
   * never overwritten by the app — outranks "never narrowed" where the two conflict (desk #166): the target
   * row keeps what the selection says, the folded-in records follow it, and a character that holds one keeps
   * it (collectChosenIds; the sheet reads the unfiltered content).
   *
   * The Sources card at v0.1.40 — the rows every saved selection before this lane was made from — read from
   * git, not listed by hand: that release's own sourceCatalog (41c2b05:src/rules/sources.ts; the shelves and
   * the row merge have changed since) over its own public/core.json. A hand list of the rows a pair names
   * missed the Gatewalkers row gaining two volumes (below), because no pair named them.
   */
  const V0_1_40 = '41c2b05';
  let rows40 = new Map<string, string[]>(); // "category / label" -> books
  let keys40 = new Set<string>();
  let shipped40 = new Set<string>(); // every v0.1.40 record, as "bucket/id" and as its Archives page
  beforeAll(async () => {
    const at40 = (path: string) => execFileSync('git', ['show', `${V0_1_40}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const file = join(mkdtempSync(join(tmpdir(), 'sources-v0.1.40-')), 'sources.ts');
    writeFileSync(file, at40('src/rules/sources.ts')); // its one import is `import type`, which the transform drops
    const { sourceCatalog: catalog40 } = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { sourceCatalog: typeof sourceCatalog };
    const core40 = JSON.parse(at40('public/core.json'));
    const cat = catalog40(core40);
    rows40 = new Map(cat.groups.flatMap((g) => g.entries.map((e) => [`${g.category} / ${e.label}`, e.books] as const)));
    keys40 = new Set(cat.allBooks);
    shipped40 = new Set(
      Object.entries(core40).flatMap(([m, recs]) =>
        recs && typeof recs === 'object' && !Array.isArray(recs)
          ? Object.entries(recs as Record<string, { aonId?: string }>).flatMap(([id, r]) => [`${m}/${id}`, ...(r?.aonId ? [r.aonId] : [])])
          : [],
      ),
    );
  }, 120_000);
  const rowAt = (book: string) => [...rows40].find(([, bs]) => bs.includes(book))?.[0];
  const GATEWALKERS_VOLUME_GRADES = [
    'stalk-goggles-greater', 'stalk-goggles-major', // #187: The Seventh Arch
    'pickled-demon-tongue-greater', 'pickled-demon-tongue-major', 'polished-demon-horn-greater', 'polished-demon-horn-major', // #188
  ];

  it('every split or fold derives only a key that was never the player’s to set', () => {
    expect(rows40.size).toBeGreaterThan(50);
    for (const [from, to] of [...BOOK_SPLITS, ...BOOK_FOLDS]) {
      expect(keys40.has(from), `${from}: no v0.1.40 selection could hold it`).toBe(true);
      if (!keys40.has(to)) continue; // no row of its own then: never the player's to set
      expect(rowAt(to), `${from} -> ${to} would switch on a row the player could set`).toBe(rowAt(from));
    }
    expect(BOOK_FOLDS.some(([from]) => BOOK_SPLITS.some(([f]) => f === from))).toBe(false);
  });

  /*
   * …and no relabel inside a row narrows a saved choice in silence. A selection stored before this lane holds
   * the book keys its rows had at v0.1.40. A key in a row now that no v0.1.40 row had is one that selection
   * cannot hold, so every record under it hides from a player who had the whole row on — six Gatewalkers grades
   * moved from "Adventure Path: Gatewalkers" to the #187 and #188 volumes (e26a64c) and read 5/7 books on.
   * Each such key must be derived by a split or fold pair; a key that only moved rows (a shelf change) is still
   * held by name. One case needs no pair, and is measured, not listed: a new book in a row no v0.1.40 card had,
   * none of whose records shipped at v0.1.40 (by id or by Archives page) — nothing was taken from anyone, and
   * a pair would switch on a row nobody was ever shown (the Bastion of Blasphemies Player's Guide: six
   * backgrounds that arrived with 7e2e285, while its volume #224 sits in "Other Adventure Paths").
   */
  it('every book in every Sources row was a v0.1.40 key, or a split or fold derives it', () => {
    const derived = new Set([...BOOK_SPLITS, ...BOOK_FOLDS].map(([, to]) => to));
    const shippedUnder = (book: string) =>
      CHOOSABLE_SOURCE_MAPS.flatMap((m) =>
        Object.entries((db[m] ?? {}) as Record<string, { source?: { book?: string }; aonId?: string }>)
          .filter(([id, r]) => r.source?.book?.trim() === book && (shipped40.has(`${m}/${id}`) || (!!r.aonId && shipped40.has(r.aonId))))
          .map(([id]) => `${m}/${id}`),
      );
    const uncovered = sourceCatalog(db).groups.flatMap((g) =>
      g.entries.flatMap((e) => {
        const row = `${g.category} / ${e.label}`;
        return e.books
          .filter((b) => !keys40.has(b) && !derived.has(b) && (rows40.has(row) || shippedUnder(b).length > 0))
          .map((b) => `${row}: ${b}${rows40.has(row) ? '' : ` (records that shipped at v0.1.40: ${shippedUnder(b).slice(0, 4).join(', ')})`}`);
      }),
    );
    expect(uncovered, 'a book key no v0.1.40 selection could hold: cover it with a BOOK_SPLITS pair from the key its records left').toEqual([]);
  });

  it('an old whole-row Gatewalkers selection reads every book on, and the #187 / #188 grades stay in the pickers', () => {
    const old = rows40.get('Adventure Paths / Gatewalkers')!;
    expect(old).toContain('Pathfinder Adventure Path: Gatewalkers');
    expect(old).not.toContain('Pathfinder #187: The Seventh Arch');
    const on = enabledBookSet([...CORE_BOOKS, ...old]); // stored before the split: no mark
    const row = sourceCatalog(db).groups.find((g) => g.category === 'Adventure Paths')!.entries.find((e) => e.label === 'Gatewalkers')!;
    expect(row.books.filter((b) => !on.has(b))).toEqual([]);
    const picker = applySources(db, on, collectChosenIds(emptyBuild(), db));
    for (const id of GATEWALKERS_VOLUME_GRADES) expect(picker.items[id], id).toBeTruthy();
    // …and once saved again (marked) it stays whole
    expect(row.books.filter((b) => !enabledBookSet(storedSources(on)).has(b))).toEqual([]);
  });

  it('a marked selection with the Gatewalkers row off keeps it off', () => {
    const on = enabledBookSet(storedSources(CORE_BOOKS));
    const row = sourceCatalog(db).groups.find((g) => g.category === 'Adventure Paths')!.entries.find((e) => e.label === 'Gatewalkers')!;
    expect(row.books.filter((b) => on.has(b))).toEqual([]);
    const picker = applySources(db, on, collectChosenIds(emptyBuild(), db));
    for (const id of GATEWALKERS_VOLUME_GRADES) expect(picker.items[id], id).toBeUndefined();
  });

  it('saved Core + Guns & Gears (Remastered), Guns & Gears off: it stays off, its 2 folded records leave the pickers, a held vial stays', () => {
    const GG = 'Pathfinder Guns & Gears';
    const saved = [...CORE_BOOKS, 'Pathfinder Guns & Gears (Remastered)']; // stored before the fold: no mark
    const on = enabledBookSet(saved);
    expect(on.has(GG)).toBe(false);
    expect(enabledBookSet(storedSources(on)).has(GG)).toBe(false); // …and stays off once saved again
    const picker = applySources(db, on, collectChosenIds(emptyBuild(), db));
    expect(picker.items['pyrotechnic-versatile-vial']).toBeUndefined();
    expect(picker.feats['firework-technician-dedication']).toBeUndefined();
    const holder = { ...emptyBuild(), enabledSources: saved, inventory: [{ instanceId: 'v1', itemId: 'pyrotechnic-versatile-vial', quantity: 1 }] };
    expect(applySources(db, on, collectChosenIds(holder, db)).items['pyrotechnic-versatile-vial']).toBeTruthy();
    expect(buildCharacter(holder, db).inventory.map((i) => i.itemId)).toContain('pyrotechnic-versatile-vial');
  });

  it('saved Core + legacy Dark Archive, Dark Archive (Remastered) off: it stays off', () => {
    const DAR = 'Pathfinder Dark Archive (Remastered)';
    const on = enabledBookSet([...CORE_BOOKS, 'Pathfinder Dark Archive']);
    expect(on.has(DAR)).toBe(false);
    expect(enabledBookSet(storedSources(on)).has(DAR)).toBe(false);
    expect(applySources(db, on, collectChosenIds(emptyBuild(), db)).items['mind-weapon']).toBeUndefined();
    // …and a selection with it ON keeps it on, the folded records with it
    const withDar = enabledBookSet([...CORE_BOOKS, DAR]);
    expect(applySources(db, withDar, new Set()).items['mind-weapon']).toBeTruthy();
  });

  it('the Gatewalkers guide still folds for an old selection: both spellings were one row', () => {
    const GPG = "Pathfinder Gatewalkers Player's Guide (Remastered)";
    expect(enabledBookSet([...CORE_BOOKS, "Pathfinder Gatewalkers Player's Guide"]).has(GPG)).toBe(true);
    expect(enabledBookSet(storedSources([...CORE_BOOKS, "Pathfinder Gatewalkers Player's Guide"])).has(GPG)).toBe(false);
  });

  /*
   * The stray-spelling lane (2026-09-29, desk #166 applied): six more spellings sat in ONE v0.1.40 row with their
   * book's key, like the Gatewalkers guide above, and got a BOOK_FOLDS pair. Each pair has a test of its own that
   * names it, so deleting one pair fails exactly that test (proved by mutation on 2026-09-30 for two of them). The
   * row each read in is the v0.1.40 card measured from git (rowAt), not a hand list.
   */
  const PAIRED_2026_09_29: [from: string, to: string, row: string][] = [
    ['Gatewalkers Player’s Guide (Remastered)', "Pathfinder Gatewalkers Player's Guide (Remastered)", 'Adventure Paths / Gatewalkers'],
    ["Gatewalkers Player's Guide (Remastered)", "Pathfinder Gatewalkers Player's Guide (Remastered)", 'Adventure Paths / Gatewalkers'],
    ['Pathfinder Season of Ghosts Player’s Guide', "Pathfinder Season of Ghosts Player's Guide", 'Adventure Paths / Season of Ghosts'],
    ['Pathfinder Foolish Housekeeping and Other Articles', 'Paizo Blog: Foolish Housekeeping and Other Articles', 'Other / Blogs & web articles'],
    ['Pathfinder Fools Aplenty', 'Pathfinder Lost Omens: Fools Aplenty', 'Other / Fools Aplenty (April Fools)'],
    ['Pathfinder One-Shot #2: Dinner at Lionlodge', 'Pathfinder One-Shot 2: Dinner at Lionlodge', 'Adventure Paths / Pathfinder Society'],
  ];
  for (const [from, to, row] of PAIRED_2026_09_29) {
    it(`an old selection with "${from}" on reads "${to}" on: one v0.1.40 row (${row})`, () => {
      const pair = `BOOK_FOLDS pair "${from}" -> "${to}"`;
      expect(BOOK_FOLDS.some(([a, b]) => a === from && b === to), `${pair}: missing from src/rules/sources.ts`).toBe(true);
      expect(rowAt(from), `${pair}: the stray's v0.1.40 row`).toBe(row);
      expect(rowAt(to), `${pair}: the key's v0.1.40 row`).toBe(row);
      const on = enabledBookSet([...CORE_BOOKS, from]); // stored before the fold: no mark
      expect(on.has(to), `${pair}: a selection stored before the fold with the stray on reads the key off`).toBe(true);
      expect(enabledBookSet(storedSources(on)).has(to), `${pair}: the key is lost once the selection is saved again`).toBe(true);
      // a selection made since (marked) is taken as the player left it: the pair never runs on it
      expect(enabledBookSet(storedSources([...CORE_BOOKS, from])).has(to), `${pair}: ran on a marked selection`).toBe(false);
    });
  }
});
