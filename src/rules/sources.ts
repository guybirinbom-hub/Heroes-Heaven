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
  /*
   * ⚠ IMPOSSIBLE MAGIC SHELVED AS "Other" AND "Other" IS HIDDEN BY DEFAULT.
   *
   * NICHE_CATEGORIES is {'Other'}, `showNicheSources` defaults false (src/data/prefs.ts) and the
   * Sources card drops niche groups, so the book never appeared on the card at all — Setup → Sources
   * read "4/223" with no row to switch it on. Behind that one missing line sat 1,029 choosable
   * records: the magus, summoner, necromancer and runesmith, 362 feats, 331 spells, 313 items and 19
   * actions. Searching the class picker for "necro" or "rune" returned no matches in the shipped app.
   *
   * It is the ONLY class-bearing book that fell through to "Other": Guns & Gears, Rage of Elements,
   * War of Immortals, Battlecry! and Dark Archive (Remastered) are all on this list already, which is
   * what put them on the Rulebooks shelf. Impossible Magic is the same kind of book and belongs in
   * the same tier. Guarded by test/impossible-magic-source-shelf.test.ts.
   */
  'Pathfinder Impossible Magic',
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
  // The Archives shelve High Seas as Lost Omens; its records ship as "Pathfinder High Seas", which
  // matched nothing here and fell to the hidden "Other" shelf with 119 choosable records behind it.
  // Guarded by the shelf check in scripts/player-coverage-check.mjs.
  'high seas',
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
/** Books put on the niche "Other" shelf ON PURPOSE, whatever shelf the Archives give them — see the
 *  first test in categoryOfBook. Exported for the shelf guard in scripts/player-coverage-check.mjs,
 *  which fails on any OTHER book the Archives shelve for players and this file hides. */
export const NICHE_BY_DESIGN = /Blog|Web Supplement|Article|Fools Aplenty|April Fools|Special:|Fumbus|Comic/;

export function categoryOfBook(book: string): SourceCategory {
  if (CORE_BOOKS.includes(book)) return 'Core';
  const base = stripBook(book);
  // Joke products, blogs and web supplements → the niche "Other" shelf. This MUST run BEFORE the
  // Lost Omens test: a few of them are titled "Lost Omens: …" ("Pathfinder Lost Omens: Fools
  // Aplenty" is an April Fools product; "…Divine Mysteries Web Supplement" is a web extra), so the
  // /Lost Omens/ test used to shelve them as normal setting books — leaving joke feats (Wombat
  // Style, Dad Joke) selectable even with niche sources turned off. The real "Lost Omens Divine
  // Mysteries" hardcover does NOT match and stays a Lost Omens book.
  if (NICHE_BY_DESIGN.test(book)) return 'Other';
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
    /Crown of the Kobold King|Night of the Gray Death|Troubles in Grayce|Seven Dooms|Hellknight Hill|Fall of Plaguestone|Beginner Box: Heroes/.test(book) ||
    // Two more standalone adventures the Archives shelve as "Adventures", which ship under a bare
    // "Pathfinder <title>" and fell to the hidden "Other" shelf (the six Dead God's Hand backgrounds
    // could not be reached with every shown shelf on). Guarded by scripts/player-coverage-check.mjs.
    /Dead God.s Hand|Shadows at Sundown/.test(book)
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
 *  Add-companion picker applies the same enabled-books set explicitly.
 *
 *  2026-09-30 (desk sources-apply-to-everything, the owner: "yes the player sources should aplly to everything
 *  he has accses to"): the maps a player buys, adds or picks from that were left out join, listed in
 *  SOURCE_MAPS_ADDED_2026_09_30. Measured over public/core.json at 2a23c10: siegeWeapons 62 records, every one
 *  with a book (Battlecry! 28, Guns & Gears 19, Howl of the Wild 13, #215 1, #223 1); runesmithRune 44, all
 *  Impossible Magic (the Builder's runic repertoire, runesmithRuneOptions); vehicles 107, none with a book yet,
 *  so the filter passes every one of them (entrySourceOn: no book = always) until the import gives them one,
 *  and the card then carries that book's row the same day. Every one of those books already had a Sources row
 *  and was a v0.1.40 key, so the card gains no row, only counts. The regenerating lane of the same day gave the
 *  vehicles their book (scripts/import-core-v2.mjs: the book of each one's joined Archives document): 103 of 107,
 *  across 12 books that were every one a card key already (84 rows before and after); bone-ship's is its High
 *  Seas stat block (creature-4838); flying-carpet, sandsailer, warship, second-kiss (no document) carry none and
 *  stay unfiltered.
 *
 *  The CLASS SUB-PICKS join the same day, through classOptionRecords() below rather than this list: the
 *  Builder does not pick a bloodline, patron, school, order, instinct, eidolon … from the `bloodline` /
 *  `patron` / … maps (those carry no book, and no picker reads them) but from `classes.<id>.subclass.options`
 *  and `classes.<id>.extraChoices[].options`, and every one of those options has its own classFeatures record
 *  under the same id that carries the book (measured at 2a23c10: 250 options, 250 with a classFeatures record
 *  and a book, 166 of them not Core — a wizard's Impossible Magic, Rival Academies and Shining Kingdoms
 *  schools, a druid's Secrets of Magic and #202 orders, a sorcerer's eight non-Core bloodlines, the summoner's
 *  Secrets of Magic / Battlecry! / Book of the Dead eidolons, the animist's #216 / #223 apparitions, the
 *  exemplar's #217 epithets; their 26 books were every one a card key already and a v0.1.40 key). applySources
 *  filters those nested lists, sourceCatalog counts them, and the sheet's eidolon rows and eidolon type select
 *  (CompanionsTab) read the same record. Where the Archives print an option again in a later book than its
 *  record names (the eleven eidolons in Impossible Magic, The Unseen Broker in Dark Archive (Remastered)),
 *  CLASS_OPTION_REPRINTS adds that book and the option is on through either (classOptionOn). An option printed
 *  in its class's own book goes with the class (a held psychic keeps its own subconscious minds when Dark
 *  Archive is switched off), and so does a held runesmith's runic repertoire (CLASS_OWN_PICK_MAPS). A chosen option stays (collectChosenIds: subclassId, subclassId2,
 *  extraChoices, primaryApparition, archetypeEidolonType) and, being part of the class rather than a record of
 *  a choosable map, is never listed or removed by the Sources card. The Builder's Mythic Calling picker follows
 *  the same way through mythicCallingRecords() (the `calling`-trait classFeatures), with the chosen calling kept.
 *  So do the same sub-picks where a FEAT asks for them (a multiclass dedication's school, bloodline, order,
 *  patron, mystery …, and the witch's Basic / Greater / Major Lesson): applySources narrows a choice whose
 *  answers are class features (`ownsFeature`, or every option a class sub-pick), keeping the stored answer
 *  (featChoices, grantedFeatChoices) and what the asking record's own book prints.
 *
 *  Languages and conditions stay out. A language is open to a character by its rarity and the ancestry or region
 *  that grants it — its book is only where the Archives print its page; a condition is applied in play. Runes
 *  are not in this list because the `runes` map carries no book of its own (0 of 160); every rune's item twin
 *  does (160 of 160: the 142 property runes, 87 of them not Core, and the 18 fundamental runes, all GM Core). So
 *  the closing pass filters the two property-rune pickers through the twin: the Builder's Living rune card
 *  (applySources' runes pass, the chosen bodyRune kept) and the sheet's item editor rune slot (ItemEditorModal,
 *  an etched rune kept). The same pass narrows the Advanced / Quick Alchemy picker (AlchemyPanel; a known
 *  formula kept), a generic scroll's or wand's stored-spell picker (ItemDetail; the stored spell kept), the
 *  Magical Understudy eidolon cantrips (CompanionsTab; a chosen one, and the granting feat's own book, kept) and
 *  the item editor's "Start from an existing item…" and bound-spell lists (the base item, carried items and the
 *  bound spell kept; the Homebrew page opens that editor with no character and offers every book).
 *
 *  The sheet's surfaces over these maps (AddItemsModal's vehicle / siege rows, the Add companion picker's Vehicle
 *  and Siege tabs, the companion editor's Type selects) filter with the same entrySourceOn(enabledBookSet(...));
 *  what the character already owns stays (the sheet's content is never filtered, and a companion is never among
 *  chosenFromBooks). A record with no book at all is never filtered anywhere (entrySourceOn: no book = on). */
export const SOURCE_MAPS_ADDED_2026_09_30 = ['siegeWeapons', 'vehicles', 'runesmithRune'] as const;
/**
 * 2026-09-30 (desk #170, refuter's pass): a map that IS one class's own pick list, with the records that open it
 * (the class, or its dedication). An entry printed in the book of an opener the character HOLDS stays when that
 * book is off, the rule a class sub-pick printed in its class's own book follows (applySources): a held runesmith
 * — or a Runesmith Dedication — with Impossible Magic switched off (an imported character with no stored Sources
 * reads as Core only) can still add runes to its repertoire at level-up, as it could before runesmithRune joined.
 */
export const CLASS_OWN_PICK_MAPS: Readonly<Partial<Record<string, readonly { map: 'classes' | 'feats'; id: string }[]>>> = {
  runesmithRune: [
    { map: 'classes', id: 'runesmith' },
    { map: 'feats', id: 'runesmith-dedication' },
  ],
};
export const CHOOSABLE_SOURCE_MAPS = [
  'ancestries', 'heritages', 'backgrounds', 'classes', 'feats', 'spells', 'items', 'deities', 'actions',
  'animalCompanions', 'companionSpecializations', 'specificFamiliars', 'familiarAbilities', 'companionAdvanced',
  ...SOURCE_MAPS_ADDED_2026_09_30,
] as const;

/** The name the class sub-picks go by where a map name is expected (the every-row guard's measure). */
export const CLASS_OPTIONS_SOURCE_KEY = 'classOptions';

/**
 * 2026-09-30 (desk sources-apply-to-everything): the record that carries each class sub-pick's book, by option
 * id — every `classes.<id>.subclass.options[]` and `extraChoices[].options[]` entry whose id has a classFeatures
 * record. An option without one (a homebrew class's option, the kineticist's single / dual gate) is absent here,
 * so it has no book and is never filtered. Each id once, whichever class lists it.
 */
export function classOptionRecords(content: ContentDatabase): Map<string, ClassOptionRecord> {
  const out = new Map<string, ClassOptionRecord>();
  const features = (content.classFeatures ?? {}) as Record<string, { source?: SourceInfo; homebrewSourceId?: string }>;
  for (const c of Object.values(content.classes ?? {})) {
    for (const opts of [c?.subclass?.options ?? [], ...(c?.extraChoices ?? []).map((g) => g?.options ?? [])]) {
      for (const o of opts) {
        const r = o?.id ? features[o.id] : undefined;
        if (!r || out.has(o.id)) continue;
        const reprints = CLASS_OPTION_REPRINTS[o.id];
        out.set(o.id, reprints ? { ...r, reprintBooks: reprints.map((p) => p.book) } : r);
      }
    }
  }
  return out;
}

/** A class sub-pick's book record: its classFeatures record, plus the books of its later printings. */
export type ClassOptionRecord = { source?: SourceInfo; homebrewSourceId?: string; reprintBooks?: readonly string[] };

/**
 * 2026-09-30 (desk #170, refuter's pass): the class sub-picks whose classFeatures record still names an EARLIER
 * printing than the Archives hold. Impossible Magic (the remastered summoner's own book, pg. 71-77) prints eleven
 * eidolons again that our records file under Secrets of Magic or Book of the Dead, and Dark Archive (Remastered)
 * prints The Unseen Broker again after Divine Mysteries. The Archives link none of these pairs, so
 * scripts/reprint-check.mjs cannot see them, and a filter keyed on the old book alone hid Angel, Beast, Dragon …
 * from a summoner with Impossible Magic on (the owner's words, "everything he has accses to", and R12, the newest
 * printing wins). An option is offered when ANY of its printings is in a book that is on (classOptionOn), the
 * shop's rule for an item's printings, each by its own book.
 *
 * DERIVED, never hand-picked: scripts/lib/class-option-reprints.mjs reads the AoN mirror (same category, same
 * name, a different book released strictly later than the record's own page), and test/class-option-reprints.test.ts
 * fails when this table and the mirror differ (`npx jiti scripts/class-option-reprints.mjs` prints both). Every
 * book here must be a Sources card key; the Sources card counts each option once, under its record's own book.
 */
export const CLASS_OPTION_REPRINTS: Readonly<Record<string, readonly { book: string; aonId: string }[]>> = {
  'angel-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-15' }],
  'anger-phantom-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-16' }],
  'beast-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-17' }],
  'construct-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-18' }],
  'demon-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-19' }],
  'devotion-phantom-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-20' }],
  'dragon-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-21' }],
  'fey-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-22' }],
  'plant-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-24' }],
  'psychopomp-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-25' }],
  'undead-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-26' }],
  'the-unseen-broker': [{ book: 'Pathfinder Dark Archive (Remastered)', aonId: 'patron-29' }],
};

/** Is this class sub-pick on? Its record's book (entrySourceOn: no book = always), or any later printing's. */
export function classOptionOn(enabled: Set<string>, r: ClassOptionRecord): boolean {
  return entrySourceOn(enabled, r) || !!r.reprintBooks?.some((b) => enabled.has(b));
}

/** Is this class sub-pick printed in `book` — its record's book or a later printing's? */
export function classOptionInBook(r: ClassOptionRecord, book: string | undefined): boolean {
  const b = book?.trim();
  return !!b && (r.source?.book?.trim() === b || !!r.reprintBooks?.includes(b));
}

/** The name the Mythic Calling records go by where a map name is expected (the every-row guard's measure). */
export const MYTHIC_CALLINGS_SOURCE_KEY = 'mythicCallings';

/**
 * 2026-09-30 (desk #170, second refuter's pass): the records the Builder's Mythic Calling picker offers
 * (SetupUnlockedChoices) — the classFeatures carrying the `calling` trait. They are not a class's sub-pick, so
 * classOptionRecords never saw them, and classFeatures as a whole stays out of CHOOSABLE_SOURCE_MAPS (a class
 * GRANTS its features; nothing picks them). Measured at 2a23c10: 18 callings, every one with a book — War of
 * Immortals 11, Revenge of the Runelords Player's Guide 4, Pathfinder Society Scenario #6-09: The Power of
 * Legends 3 (the three "Echoes of …"). applySources drops a calling whose book is off unless it is the chosen
 * one (collectChosenIds: mythicCalling), and sourceCatalog counts them, so Scenario #6-09 — carried by no other
 * choosable record — is a key no older selection holds: a row of its own on the card (sourceCatalog's ownRow),
 * OFF until the player switches it on (test/_sources-added-maps.ts). A calling with no book would never be filtered.
 * The Mythic on/off toggle is a separate axis and unchanged (applyContentToggles).
 */
export function mythicCallingRecords(content: ContentDatabase): { id: string; source?: SourceInfo }[] {
  const features = (content.classFeatures ?? {}) as Record<string, { id: string; traits?: string[]; source?: SourceInfo }>;
  return Object.values(features).filter((f) => !!f && (f.traits ?? []).includes('calling'));
}

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
  // The choosable maps, then the class sub-picks and the Mythic Callings (2026-09-30), which applySources
  // filters by the same books. Each list says whether it joined the filter on 2026-09-30.
  const added = new Set<string>(SOURCE_MAPS_ADDED_2026_09_30);
  const lists: [boolean, Iterable<{ source?: SourceInfo }>][] = [];
  for (const m of CHOOSABLE_SOURCE_MAPS) {
    const map = content[m] as Record<string, { source?: SourceInfo }> | undefined;
    if (map) lists.push([added.has(m), Object.values(map)]);
  }
  lists.push([true, classOptionRecords(content).values()]);
  lists.push([true, mythicCallingRecords(content)]);
  /*
   * 2026-09-30 (desk #170, third refuter's pass): a book ONLY what joined the filter that day carries is a key no
   * stored selection holds, so it is OFF for every one of them (never derived — the every-row guard in
   * test/sources.test.ts). It gets a ROW OF ITS OWN, never a seat inside an Adventure Path / Society / blog
   * bundle: inside a bundle an old whole-row selection would read part-on (the Gatewalkers #187 / #188 loss that
   * BOOK_SPLITS documents), and one checkbox would switch the old books and the new one together. Measured at
   * 2a23c10: one such book, "Pathfinder Society Scenario #6-09: The Power of Legends" (the three Echoes
   * callings). Once another choosable record carries the book it folds back into its bundle, held by name.
   */
  const lateBooks = new Set<string>();
  const earlyBooks = new Set<string>();
  for (const [isAdded, list] of lists) {
    for (const e of list) {
      const b = e.source?.book?.trim(); // a few core.json book names carry stray whitespace
      if (e.source?.license === 'homebrew') {
        // Homebrew gets its own section in the Sources card (keyed by the Source's name).
        if (b) hbCounts[b] = (hbCounts[b] ?? 0) + 1;
        continue;
      }
      if (b) {
        counts[b] = (counts[b] ?? 0) + 1;
        (isAdded ? lateBooks : earlyBooks).add(b);
      }
    }
  }
  const ownRow = (book: string) => lateBooks.has(book) && !earlyBooks.has(book);
  const byCat: Partial<Record<SourceCategory, string[]>> = {};
  for (const book of Object.keys(counts)) (byCat[categoryOfBook(book)] ??= []).push(book);

  const groups: SourceGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const books = byCat[cat];
    if (!books?.length) continue;
    // Adventure Paths fold into per-AP bundles; the niche "Other" shelf folds into Society + blogs;
    // every other shelf lists books individually.
    const bundles: Record<string, SourceEntry> = {};
    const singles: Record<string, SourceEntry> = {}; // keyed by the DISPLAY label with curly apostrophes folded — "Season of Ghosts Player's Guide" and "…Player’s Guide" are two book names and must be ONE row, not two the player cannot tell apart. Toggling the row toggles every book behind it.
    // 2026-09-30 (desk #170, round-3 refuter): an own-row book is SHOWN right after the bundle it would otherwise
    // have joined (Scenario #6-09 after "Pathfinder Society", not under "Standalone Adventures" at the shelf's end).
    // Only where the row sits on the card changes; it stays a row of its own (ownRow above).
    const homeOf = new Map<SourceEntry, string>();
    for (const book of [...books].sort((a, b) => a.localeCompare(b))) {
      const home = cat === 'Adventure Paths' ? apBundleLabel(book) : cat === 'Other' ? otherBundleLabel(book) : null;
      const label = ownRow(book) ? null : home;
      if (label) {
        const bd = (bundles[label] ??= { label, books: [], count: 0 });
        bd.books.push(book);
        bd.count += counts[book];
      } else {
        { const l = book.replace(/^Pathfinder /, ''); const e = (singles[l.replace(/’/g, "'")] ??= { label: l, books: [], count: 0 }); e.books.push(book); e.count += counts[book]; if (home && ownRow(book)) homeOf.set(e, home); }
      }
    }
    // Bundles first (alphabetical, "Standalone Adventures" last), each own-row book right after its home bundle,
    // then any other individual books.
    const bundleEntries = Object.values(bundles)
      .map((e) => ({ ...e, books: e.books.sort() }))
      .sort((a, b) => (a.label === 'Standalone Adventures' ? 1 : b.label === 'Standalone Adventures' ? -1 : a.label.localeCompare(b.label)));
    const singleEntries = Object.values(singles);
    const placed = new Set<SourceEntry>();
    const entries: SourceEntry[] = [];
    for (const bd of bundleEntries) {
      entries.push(bd);
      for (const s of singleEntries) if (homeOf.get(s) === bd.label) { entries.push(s); placed.add(s); }
    }
    for (const s of singleEntries) if (!placed.has(s)) entries.push(s);
    groups.push({ category: cat, entries, bookCount: books.length });
  }
  const homebrew = Object.entries(hbCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, allBooks: Object.keys(counts).sort(), homebrew };
}

/** The Sources card rows (their labels, in card order) that hold any of these books. 2026-09-30 (desk #170,
 *  round-3 refuter): the Builder's empty Mythic Calling hint names EVERY row that would unlock a calling — War
 *  of Immortals, Revenge of the Runelords and Society Scenario #6-09 — not War of Immortals alone. */
export function sourceRowLabelsFor(groups: readonly SourceGroup[], books: Iterable<string | undefined>): string[] {
  const want = new Set<string>();
  for (const b of books) if (b?.trim()) want.add(b.trim());
  return groups.flatMap((g) => g.entries).filter((e) => e.books.some((b) => want.has(b))).map((e) => e.label);
}

/**
 * desk #166 (owner, 2026-09-25, "Middle way"): scripts/data/book-names.json stopped folding different books
 * together, so records that sat under the fold target now carry their own book — Bestiary 3's are no longer
 * "Monster Core 2". [old key, new key] pairs: a selection that had the old key ON gets the new key ON too.
 *
 * ⚠ ONLY WHERE THE NEW KEY WAS NEVER THE PLAYER'S TO SET. A stored list holds what the player chose from the
 * Sources card, so a book with a row of its own that is absent from the list was switched OFF — deriving it
 * ON would overwrite that choice. A pair belongs here only when the player could not have chosen the new
 * book on its own before the split: it held no choosable record (Bestiary 3, each blog post), or the card
 * toggled it in the same row as the old key (the Hellbreakers and Hell's Destiny volumes, the "Blogs & web
 * articles" row, and the Gatewalkers volumes #187 and #188: six Greater / Major grades moved to them from
 * "Adventure Path: Gatewalkers" with the Archives refresh e26a64c, inside the one Gatewalkers row, so an old
 * whole-row selection read 5 of 7 books on and lost them). test/sources.test.ts compares every Sources row
 * with the v0.1.40 card read from git, so a key a relabel adds to a row fails until a pair here covers it.
 *
 * NOT here either, because they are not splits: the Azarketi Ancestry Web Supplement (a free reprint of
 * Absalom, City of Lost Omens' own chapter) and the 2020 Beginner Box Game Master's Guide (Secrets of the
 * Unlit Star is the remastered Beginner Box) are the SAME book as their fold target, so book-names.json
 * still folds them (#166 applied, scripts/data/book-names-reasons.json).
 *
 * NOT here: Dark Archive (Remastered) -> Gatewalkers Player's Guide (Remastered). The guide already had a
 * Gatewalkers row of its own with its own backgrounds, so a selection with Dark Archive (Remastered) on and
 * the guide off had switched the guide off. Its eight feats (Sonic Dash … Feed the Void, feat-8030..8037,
 * printed in the guide only) had shown under Dark Archive (Remastered) purely by the fold; they now show to
 * whoever has the guide on — the choice that was made — and a character that took one keeps it
 * (collectChosenIds). test/sources.test.ts pins both halves.
 *
 * A split moves only what the old book does NOT print: a new selection sees the two books as separate
 * toggles, so a record printed in both that moved to the new key would vanish for a player with only the
 * old one on (scripts/reprint-check.mjs CHECK 7 holds every pair here to that).
 */
export const BOOK_SPLITS: ReadonlyArray<readonly [string, string]> = [
  ['Pathfinder Monster Core 2', 'Pathfinder Bestiary 3'],
  ['Pathfinder Adventure Path: Hellbreakers', 'Pathfinder #222: Hellbreakers'],
  ["Pathfinder Adventure Path: Hell's Destiny", "Pathfinder #223: Hell's Destiny"],
  ['Pathfinder Adventure Path: Gatewalkers', 'Pathfinder #187: The Seventh Arch'],
  ['Pathfinder Adventure Path: Gatewalkers', 'Pathfinder #188: They Watched the Stars'],
  ["Pathfinder Extinction Curse Player's Guide", "Pathfinder Blog: Come One, Come All, to the Extinction Curse Player's Guide!"],
  ...[
    'Battle of the Pantheons Winner Announcement', 'Celebrating Hispanic Heritage Month', 'Friends in High Places',
    "GM's Toolkit: Secret Keeper's Mask", 'Gods of the Expanse', 'Redpitch Alchemy',
  ].map((t) => ['Pathfinder Blog', `Pathfinder Blog: ${t}`] as const),
];
/**
 * The other direction (desk #166: a "(Remastered)" printing folds into its own book). A few records carried
 * a printing's spelling that the table now folds — "Pathfinder Guns & Gears (Remastered)" (2 records) into
 * "Pathfinder Guns & Gears", legacy "Pathfinder Dark Archive" (3) into "Dark Archive (Remastered)", legacy
 * "Pathfinder Treasure Vault" (13) into "Treasure Vault (Remastered)", legacy "Pathfinder Gatewalkers
 * Player's Guide" (1) into its (Remastered) key. scripts/reprint-check.mjs CHECK 4 fails a choosable record
 * whose book is not a fold target but has a fold target's title (bookTitle, scripts/lib/aon-facets.mjs:
 * "(Remastered)", "(Hardcover)" / "Hardcover Compilation", a "Lost Omens" / "Adventure:" line, curly
 * apostrophes …), and two shipped spellings of one title where neither is a target. Until 2026-09-29 it
 * failed only a "(Remastered)" difference; it keeps that wording where that is the difference.
 *
 * A fold carries the old spelling's RECORDS under the target key and nothing else. [old key, new key] here
 * derives the target ON for a stored selection from before, which is the split's rule and has the split's
 * limit: ONLY WHERE THE NEW KEY WAS NEVER THE PLAYER'S TO SET. At v0.1.40 (41c2b05, sourceCatalog measured)
 * Guns & Gears (700), Dark Archive (Remastered) (425) and Treasure Vault (Remastered) (1,436) each had a
 * Sources row of their own beside the folded spelling's row, so a selection without them had switched them
 * off, and deriving them on would overwrite that (desk #166; the owner's standing rule that a player's change
 * is never overwritten by the app outranks "never narrowed" where the two conflict). Those rows keep what the
 * selection says; the folded-in records follow the target row, and a character that holds one keeps it
 * (collectChosenIds, src/rules/build.ts). A pair goes here only where both spellings sat in ONE v0.1.40 row,
 * which toggled them together: the Gatewalkers guide was the first ("Gatewalkers" row); the 2026-09-29
 * paragraph below adds six more of that shape. test/sources.test.ts pins both halves.
 *
 * 2026-09-29, the same rule over the other spellings of one book (scripts/data/book-names.json, folded in the
 * chain by foldBookSpellings, scripts/lib/aon-facets.mjs). Read against the v0.1.40 card (41c2b05 sourceCatalog
 * over its own core.json): ten of them had a row of their own beside their book's row — Grand Bazaar (25
 * records then), Tian Xia Character Guide, Draconic Codex, The Fall of Plaguestone, Crown of the Kobold King,
 * Night of the Gray Death, Troubles in Grayce, Shadows at Sundown, Gatewalkers (Hardcover), Season of Ghosts
 * (Hardcover) — so they are the Guns & Gears case: no pair, the saved selection decides the book's row and the
 * folded-in records follow it. Six sat in ONE row with their book's key, like the Gatewalkers guide, and are
 * paired below: the curly and the unprefixed Gatewalkers Player's Guide (Remastered) ("Gatewalkers" row), the
 * curly Season of Ghosts Player's Guide ("Season of Ghosts"), the Foolish Housekeeping blog post ("Blogs & web
 * articles"), Fools Aplenty ("Fools Aplenty (April Fools)") and One-Shot #2 ("Pathfinder Society").
 * Two more, through table rows that change the title (the refuter's pass, same day): "Pathfinder PFS Guide"
 * (a "PFS Guide" row of its own beside "Lost Omens Pathfinder Society Guide") and "Pathfinder Society Year 4
 * Rule Updates" (in the "Pathfinder Society" row, its Blog key in "Blogs & web articles") — each read at v0.1.40
 * apart from its key's row, so no pair: the saved selection decides the key's row.
 *
 * 2026-09-30, one more of the paired shape: "Pathfinder #207: The Resurrection Flood" (8 tattoo and marking
 * grades) beside its key "Pathfinder #207: Resurrection Flood" (22 records). A mid-title "The" hid the pair from
 * scripts/reprint-check.mjs CHECK 4 until that day; the table folds it now (book-names.json, with its reason).
 * Read against the v0.1.40 card (41c2b05), both spellings sat in the ONE "Triumph of the Tusk" row, which toggled
 * them together, so an old selection with the stray on reads the key on — paired below.
 */
export const BOOK_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ["Pathfinder Gatewalkers Player's Guide", "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ['Gatewalkers Player’s Guide (Remastered)', "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ["Gatewalkers Player's Guide (Remastered)", "Pathfinder Gatewalkers Player's Guide (Remastered)"],
  ['Pathfinder Season of Ghosts Player’s Guide', "Pathfinder Season of Ghosts Player's Guide"],
  ['Pathfinder Foolish Housekeeping and Other Articles', 'Paizo Blog: Foolish Housekeeping and Other Articles'],
  ['Pathfinder Fools Aplenty', 'Pathfinder Lost Omens: Fools Aplenty'],
  ['Pathfinder One-Shot #2: Dinner at Lionlodge', 'Pathfinder One-Shot 2: Dinner at Lionlodge'],
  ['Pathfinder #207: The Resurrection Flood', 'Pathfinder #207: Resurrection Flood'],
];
/**
 * Marks a selection made with the split books as separate toggles. A stored list WITHOUT it is from before
 * the split and gets the split once, on read; a list WITH it is taken as the player left it, so a book
 * they switched off (Bestiary 3 while keeping Monster Core 2) stays off. Every writer stores through
 * `storedSources`, so every list written from now on carries it. It names no book, so no filter matches it.
 */
export const BOOK_SPLIT_MARK = 'split:book-names-2026-09-25';

/**
 * The one way a selection is stored: the books chosen, plus the mark. A list written without the mark read
 * as pre-split, so the first toggle from "Core only" (no list stored yet) saved `[...Core, Monster Core 2]`
 * and the next read switched Bestiary 3 on beside it — a book the player never touched. test/sources.test.ts
 * fails on a writer that builds `enabledSources` any other way.
 */
export function storedSources(books: Iterable<string>): string[] {
  return [...new Set([...books, BOOK_SPLIT_MARK])].sort();
}

/** Resolve a build's enabled-books field to the concrete set (absent → Core-only). */
export function enabledBookSet(enabledSources: string[] | undefined): Set<string> {
  // unknown ≠ empty: no stored choice stays "Core only". A new selection, so the split never runs on it.
  if (!enabledSources) return new Set([...CORE_BOOKS, BOOK_SPLIT_MARK]);
  const set = new Set(enabledSources);
  if (!set.has(BOOK_SPLIT_MARK)) {
    for (const [from, to] of [...BOOK_SPLITS, ...BOOK_FOLDS]) if (set.has(from)) set.add(to);
    set.add(BOOK_SPLIT_MARK);
  }
  return set;
}

/**
 * A HOMEBREW source (the player's own, a GM's shared campaign source, a copy kept from one) is switched
 * on by this token in `enabledSources`, not by its name: by name, a GM renaming a shared source switched
 * it off on every player's characters. Printed books stay keyed by name. The kept prefix is folded, so a
 * kept copy (`hbsrc-kept-<id>`, data/campaignHomebrew.ts) and the source it was kept from are ONE switch.
 */
export function sourceIdToken(sourceId: string): string {
  return `hbsrc:${sourceId.replace(/^hbsrc-kept-/, '')}`;
}

/** Is this entry's source on? Its book by name (every printed book, and each homebrew toggle written
 *  before the token), or its homebrew source by id. No book = always (the hand-authored records). */
export function entrySourceOn(enabled: Set<string>, e: { source?: SourceInfo; homebrewSourceId?: string }): boolean {
  const book = e.source?.book?.trim(); // match sourceCatalog's whitespace-normalized book names
  return !book || enabled.has(book) || (!!e.homebrewSourceId && enabled.has(sourceIdToken(e.homebrewSourceId)));
}
