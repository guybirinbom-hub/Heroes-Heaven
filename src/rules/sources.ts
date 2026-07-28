/*
 * Source books — per-character content filtering. Every choosable content entry carries
 * `source.book`; the builder lets a player enable/disable books, and disabled books' content is
 * hidden from the pickers (already-chosen content is always kept — see collectChosenIds in build.ts).
 */
import type { ContentDatabase, SourceInfo } from './types';

/** The four Remaster Core rulebooks — the default-enabled set for a new character. */
export const CORE_BOOKS = [
  'Pathfinder Player Core',
  'Pathfinder Player Core 2',
  'Pathfinder GM Core',
  'Pathfinder Monster Core',
];

export type SourceCategory = 'Core' | 'Lost Omens' | 'Rulebooks' | 'Adventure Paths' | 'Other';
const CATEGORY_ORDER: SourceCategory[] = ['Core', 'Lost Omens', 'Rulebooks', 'Adventure Paths', 'Other'];
/** Categories hidden from the Sources card unless the "show niche sources" pref is on. */
export const NICHE_CATEGORIES: ReadonlySet<SourceCategory> = new Set<SourceCategory>(['Other']);

/** Pre-Remaster + Remaster hardcover rulebooks (not Core, not Lost Omens) → the "Rulebooks" shelf. */
const LEGACY_HARDCOVERS = new Set([
  'Pathfinder Core Rulebook',
  "Pathfinder Advanced Player's Guide",
  'Pathfinder Secrets of Magic',
  'Pathfinder Guns & Gears',
  'Pathfinder Book of the Dead',
  'Pathfinder Dark Archive',
  'Pathfinder Dark Archive (Remastered)',
  'Pathfinder Treasure Vault',
  'Pathfinder Treasure Vault (Remastered)',
  'Pathfinder Rage of Elements',
  'Pathfinder Gamemastery Guide',
  'Pathfinder Howl of the Wild',
  'Pathfinder War of Immortals',
  'Pathfinder Battlecry!',
  'Pathfinder Bestiary',
  'Pathfinder Bestiary 2',
  'Pathfinder Bestiary 3',
]);

/** Lost Omens setting books, by normalized base title. AoN's data exports these WITHOUT the "Lost
 *  Omens:" line prefix (just "Tian Xia Character Guide"), so the /Lost Omens/ test alone can't catch
 *  them — match the bare title too so they shelve as Lost Omens, not "Other". */
const LOST_OMENS_TITLES = new Set([
  'world guide', 'character guide', 'gods & magic', 'legends', 'ancestry guide',
  'the mwangi expanse', 'mwangi expanse', 'grand bazaar', 'absalom city of lost omens',
  'absalom, city of lost omens', 'monsters of myth', 'impossible lands', 'travel guide',
  'knights of lastwall', 'highhelm', 'tian xia character guide', 'tian xia world guide',
  'firebrands', 'rival academies', 'shining kingdoms', 'divine mysteries', 'draconic codex',
  'pathfinder society guide', 'the grand bazaar',
]);
/** Strip the "Pathfinder " / "Lost Omens:" prefixes and a trailing "(Remastered)" so a bare or
 *  remastered title can be matched against the title sets above / LEGACY_HARDCOVERS. */
const stripBook = (b: string) =>
  b.replace(/^Pathfinder /, '').replace(/^Lost Omens:?\s*/i, '').replace(/\s*\((?:Remastered|Remaster)\)$/i, '').trim().toLowerCase();
/** Legacy-hardcover base titles (remaster-stripped) plus a couple of AoN plural/variant spellings. */
const RULEBOOK_TITLES = new Set([...[...LEGACY_HARDCOVERS].map(stripBook), 'dark archives', 'guns & gears']);

/** The "shelf" a book belongs to, for grouping the Sources list. Most of the catalog is Adventure
 *  Path material — individual volumes ("Pathfinder #219: …"), compilations, and the free player's
 *  guides — so those are folded into one collapsible "Adventure Paths" group instead of swamping
 *  "Other". Society scenarios/quests/one-shots get their own "Organized Play" shelf. */
export function categoryOfBook(book: string): SourceCategory {
  if (CORE_BOOKS.includes(book)) return 'Core';
  const base = stripBook(book);
  // Joke products, blogs and web supplements → the niche "Other" shelf. This MUST run BEFORE the
  // Lost Omens test: a few of them are titled "Lost Omens: …" ("Pathfinder Lost Omens: Fools
  // Aplenty" is an April Fools product; "…Divine Mysteries Web Supplement" is a web extra), so the
  // /Lost Omens/ test used to shelve them as normal setting books — leaving joke feats (Wombat
  // Style, Dad Joke) selectable even with niche sources turned off. The real "Lost Omens Divine
  // Mysteries" hardcover does NOT match and stays a Lost Omens book.
  if (/Blog|Web Supplement|Article|Fools Aplenty|April Fools|Special:|Fumbus|Comic/.test(book)) return 'Other';
  if (/Lost Omens/.test(book) || LOST_OMENS_TITLES.has(base)) return 'Lost Omens';
  // Rulebooks first, so the Advanced Player's Guide isn't swept up by the AP "Player's Guide" rule.
  if (LEGACY_HARDCOVERS.has(book) || RULEBOOK_TITLES.has(base) || /Bestiary|NPC Core|Monster Core 2|Beginner Box/.test(book)) return 'Rulebooks';
  if (
    /Pathfinder Society|Organized Play|One-Shot|\bPFS\b/.test(book) || // Society play folds in with Adventure Paths
    /Adventure Path/.test(book) || // the Adventure Path hardcover line
    /^Pathfinder #\d+/.test(book) || // individual AP volumes: "Pathfinder #219: Lord of the Trinity Star"
    /Hardcover Compilation|\(Hardcover\)/.test(book) || // collected-AP hardcovers (incl. "Gatewalkers (Hardcover)")
    /Player.?s Guide/.test(book) || // the free per-AP player's guides
    /^Pathfinder Adventures?:/.test(book) || // standalone adventures: "Pathfinder Adventure: The Slithering"
    /Kingmaker|Claws of the Tyrant|Wake the Dead|Malevolence|Quest for the Frozen Flame/.test(book) ||
    /Crown of the Kobold King|Night of the Gray Death|Troubles in Grayce|Seven Dooms|Hellknight Hill|Fall of Plaguestone|Beginner Box: Heroes/.test(book)
  )
    return 'Adventure Paths';
  return 'Other';
}

/** The content maps a player chooses from — exactly what a source filter governs (NOT classFeatures,
 *  which are auto-granted by a chosen class, nor non-choosable maps like languages/runes/conditions).
 *
 *  The companion maps joined this list once the AoN re-import gave every record a real `source.book`
 *  (they previously had NO source attribution at all, being Foundry-era leftovers). They are picked
 *  from the SHEET's Companions tab rather than the builder, so see companionSourceFilter() — the
 *  Add-companion picker applies the same enabled-books set explicitly. */
export const CHOOSABLE_SOURCE_MAPS = [
  'ancestries', 'heritages', 'backgrounds', 'classes', 'feats', 'spells', 'items', 'deities', 'actions',
  'animalCompanions', 'companionSpecializations', 'specificFamiliars', 'familiarAbilities', 'companionAdvanced',
] as const;

/* ---- Adventure Path bundling -------------------------------------------------------------------
 * The catalog has ~127 Adventure Path books — mostly individual monthly volumes ("Pathfinder #219:
 * Lord of the Trinity Star"). On their own that's an unusable wall of checkboxes, so we group each
 * AP's volumes + its player's guide + its hardcover compilation into ONE toggle named for the AP.
 * The volume# → AP map below is web-verified (Paizo store / PathfinderWiki / Foundry package ids). */
const AP_VOLUME_MAP: Record<number, string> = {
  145: 'Age of Ashes', 146: 'Age of Ashes', 147: 'Age of Ashes', 148: 'Age of Ashes', 149: 'Age of Ashes', 150: 'Age of Ashes',
  151: 'Extinction Curse', 152: 'Extinction Curse', 153: 'Extinction Curse', 154: 'Extinction Curse', 155: 'Extinction Curse', 156: 'Extinction Curse',
  157: 'Agents of Edgewatch', 158: 'Agents of Edgewatch', 159: 'Agents of Edgewatch', 160: 'Agents of Edgewatch', 161: 'Agents of Edgewatch', 162: 'Agents of Edgewatch',
  163: 'Abomination Vaults', 164: 'Abomination Vaults', 165: 'Abomination Vaults',
  166: 'Fists of the Ruby Phoenix', 167: 'Fists of the Ruby Phoenix', 168: 'Fists of the Ruby Phoenix',
  169: 'Strength of Thousands', 170: 'Strength of Thousands', 171: 'Strength of Thousands', 172: 'Strength of Thousands', 173: 'Strength of Thousands', 174: 'Strength of Thousands',
  175: 'Quest for the Frozen Flame', 176: 'Quest for the Frozen Flame', 177: 'Quest for the Frozen Flame',
  178: 'Outlaws of Alkenstar', 179: 'Outlaws of Alkenstar', 180: 'Outlaws of Alkenstar',
  181: 'Blood Lords', 182: 'Blood Lords', 183: 'Blood Lords', 184: 'Blood Lords', 185: 'Blood Lords', 186: 'Blood Lords',
  187: 'Gatewalkers', 188: 'Gatewalkers', 189: 'Gatewalkers',
  190: 'Stolen Fate', 191: 'Stolen Fate', 192: 'Stolen Fate',
  193: "Sky King's Tomb", 194: "Sky King's Tomb", 195: "Sky King's Tomb",
  196: 'Season of Ghosts', 197: 'Season of Ghosts', 198: 'Season of Ghosts', 199: 'Season of Ghosts',
  200: 'Seven Dooms for Sandpoint',
  201: 'Wardens of Wildwood', 202: 'Wardens of Wildwood', 203: 'Wardens of Wildwood',
  204: 'Curtain Call', 205: 'Curtain Call', 206: 'Curtain Call',
  207: 'Triumph of the Tusk', 208: 'Triumph of the Tusk', 209: 'Triumph of the Tusk',
  210: 'Spore War', 211: 'Spore War', 212: 'Spore War',
  213: 'Shades of Blood', 214: 'Shades of Blood', 215: 'Shades of Blood',
  216: 'Myth-Speaker', 217: 'Myth-Speaker', 218: 'Myth-Speaker',
  219: 'Revenge of the Runelords', 220: 'Revenge of the Runelords', 221: 'Revenge of the Runelords',
  222: 'Hellbreakers',
  223: "Hell's Destiny",
};

/** Canonical AP display names — used to fold name variants (case, "The" vs "the", Remastered guides)
 *  from a book's title onto a single bundle so a guide merges with its volumes + compilation. */
const AP_CANON = [
  ...new Set(Object.values(AP_VOLUME_MAP)),
  'Claws of the Tyrant', 'Wake the Dead', 'Malevolence', 'Kingmaker',
];
function canonAp(name: string): string {
  const k = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return AP_CANON.find((c) => c.toLowerCase() === k) ?? name.trim();
}

/** The Adventure Path bundle a given AP-category book belongs to (its toggle's display label). */
function apBundleLabel(book: string): string {
  if (/Pathfinder Society|Organized Play|One-Shot/.test(book)) return 'Pathfinder Society';
  const vol = book.match(/^Pathfinder #(\d+)/);
  if (vol) return AP_VOLUME_MAP[Number(vol[1])] ?? 'Other Adventure Paths';
  // "Pathfinder Adventure Path: Gatewalkers" — the collected hardcover of a recent AP.
  let m = book.match(/^Pathfinder Adventure Path: (.+)$/);
  if (m) return canonAp(m[1]);
  // Player's guide (one book, "Gatewalkers Player's Guide (Remastered)", lacks the "Pathfinder " prefix).
  m = book.match(/^(?:Pathfinder )?(.+?) Player.?s Guide(?: \(Remastered\))?$/);
  if (m) return canonAp(m[1]);
  m = book.match(/^Pathfinder (.+?) Hardcover Compilation$/);
  if (m) return canonAp(m[1]);
  if (/^Pathfinder Adventures?:/.test(book)) return 'Standalone Adventures';
  if (/Kingmaker/.test(book)) return 'Kingmaker';
  if (/Claws of the Tyrant/.test(book)) return 'Claws of the Tyrant';
  if (/Wake the Dead/.test(book)) return 'Wake the Dead';
  return canonAp(book.replace(/^Pathfinder /, ''));
}

/** One selectable row in the Sources card: a single book, or — in the Adventure Paths shelf — a
 *  bundle of books (an AP's volumes + guide + compilation) toggled together. */
export interface SourceEntry {
  /** Display label (book name minus "Pathfinder ", or the AP name for a bundle). */
  label: string;
  /** The underlying book name(s) this row enables/disables. */
  books: string[];
  /** Total content entries across all member books. */
  count: number;
}
export interface SourceGroup {
  category: SourceCategory;
  entries: SourceEntry[];
  /** Total raw book count in this group (an entry may bundle several books). */
  bookCount: number;
}

/** Which condensed bundle (if any) a niche "Other"-shelf book folds into — keeps that shelf to a
 *  couple of toggles (all Society play together, all blog/web posts together). null = its own entry. */
function otherBundleLabel(book: string): string | null {
  // The joke line ships under two titles ("Pathfinder Fools Aplenty" and "Pathfinder Lost Omens:
  // Fools Aplenty") — one toggle for both.
  if (/Fools Aplenty/.test(book)) return 'Fools Aplenty (April Fools)';
  if (/Blog|Web Supplement|Article/.test(book)) return 'Blogs & web articles';
  if (/Special:|Fumbus|Comic/.test(book)) return 'Specials & comics';
  return null;
}

/** Every book seen across the choosable content, grouped by category — with the Adventure Paths
 *  shelf collapsed into per-AP bundles. Depends only on the base DB — memoize on `content` identity. */
export function sourceCatalog(content: ContentDatabase): {
  groups: SourceGroup[];
  allBooks: string[];
  /** User homebrew sources (by their name, used as the "book" key) with how many entries each holds. */
  homebrew: { name: string; count: number }[];
} {
  const counts: Record<string, number> = {};
  const hbCounts: Record<string, number> = {};
  for (const m of CHOOSABLE_SOURCE_MAPS) {
    const map = content[m] as Record<string, { source?: SourceInfo }> | undefined;
    if (!map) continue;
    for (const e of Object.values(map)) {
      const b = e.source?.book?.trim(); // a few core.json book names carry stray whitespace
      if (e.source?.license === 'homebrew') {
        // Homebrew gets its own section in the Sources card (keyed by the Source's name).
        if (b) hbCounts[b] = (hbCounts[b] ?? 0) + 1;
        continue;
      }
      if (b) counts[b] = (counts[b] ?? 0) + 1;
    }
  }
  const byCat: Partial<Record<SourceCategory, string[]>> = {};
  for (const book of Object.keys(counts)) (byCat[categoryOfBook(book)] ??= []).push(book);

  const groups: SourceGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const books = byCat[cat];
    if (!books?.length) continue;
    // Adventure Paths fold into per-AP bundles; the niche "Other" shelf folds into Society + blogs;
    // every other shelf lists books individually.
    const bundles: Record<string, SourceEntry> = {};
    const singles: SourceEntry[] = [];
    for (const book of [...books].sort((a, b) => a.localeCompare(b))) {
      const label = cat === 'Adventure Paths' ? apBundleLabel(book) : cat === 'Other' ? otherBundleLabel(book) : null;
      if (label) {
        const bd = (bundles[label] ??= { label, books: [], count: 0 });
        bd.books.push(book);
        bd.count += counts[book];
      } else {
        singles.push({ label: book.replace(/^Pathfinder /, ''), books: [book], count: counts[book] });
      }
    }
    // Bundles first (alphabetical, "Standalone Adventures" last), then any individual books.
    const bundleEntries = Object.values(bundles)
      .map((e) => ({ ...e, books: e.books.sort() }))
      .sort((a, b) => (a.label === 'Standalone Adventures' ? 1 : b.label === 'Standalone Adventures' ? -1 : a.label.localeCompare(b.label)));
    groups.push({ category: cat, entries: [...bundleEntries, ...singles], bookCount: books.length });
  }
  const homebrew = Object.entries(hbCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, allBooks: Object.keys(counts).sort(), homebrew };
}

/** Resolve a build's enabled-books field to the concrete set (absent → Core-only). */
export function enabledBookSet(enabledSources: string[] | undefined): Set<string> {
  return new Set(enabledSources ?? CORE_BOOKS);
}
