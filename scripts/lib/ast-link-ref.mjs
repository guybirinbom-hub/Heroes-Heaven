/*
 * A LINK TO A CLASS FEATURE OPENS THAT FEATURE, NOT THE CLASS IT IS PRINTED IN (package M, 2026-10-16).
 *
 * The bug, as the owner met it: the swashbuckler's page says "Confident Evasion", and AoN auto-links the
 * word "Evasion" to `class-feature-25` — the Core Rulebook alchemist's Evasion, which the app ships as
 * `classFeatures/evasion`. Tapping it opened the ALCHEMIST CLASS page. The shipped tree said
 * `{ ref: 'classes:alchemist', to: 'class-feature-25' }`.
 *
 * Why: the AST link resolver (resolveTo in scripts/import-core-v2.mjs) sends a link to a PRUNED document
 * (one the Archives mark `superseded_by`) to whatever replaced it — the right thing for a reprinted spell
 * or rule. But a class feature, a sidebar and an item's bonus line are SUB-PAGES: they have no page of their
 * own, they carry the url of the page they are printed on, and their `remaster_id` (from which the export
 * derives `superseded_by`) names the reprint of THAT page. class-feature-25 says `remaster_id: ["class-56"]`
 * — the Player Core 2 Alchemist class page, not a feature on it. scripts/lib/reprint.mjs already reads it
 * that way ("A cross-category link is therefore its page's link"), and import-core-v2's
 * `parentPagePointer` reads a sidebar's pointer the same way when it prunes; the link resolver was the one
 * reader that still followed it as the feature's own replacement.
 *
 * THE RULE (isPageLink): a pruned sub-page whose `superseded_by` names a document of ANOTHER category with
 * ANOTHER name is pointing at its page's reprint. Same category, or the same name (sidebar-2312 "Building
 * an Infiltration" -> the rules page of that name, which IS its prose reprinted), is a real replacement and
 * is followed as before. A spell replaced by a ritual (spell-377 Wish -> ritual-125 Wish) is not a
 * sub-page, so it is never touched here.
 *
 * WHAT SUCH A LINK OPENS INSTEAD (subPageRef), most authoritative first:
 *   1. the newest printing of the document ITSELF, by scripts/lib/reprint.mjs — the same rule (R12, with
 *      the owner's 2026-09-23 class-hop ruling) that decides which document a record is built from;
 *   2. the document's own record: its name's slug in its own bucket (a kept legacy record such as
 *      classFeatures/evasion), when that record ships;
 *   3. nothing: `ref: null`, which AstRenderer draws as inert text. Never the page hop. A link opens what it
 *      names or nothing — the hop is what sent "ability boost" in 119 links (104 backgrounds, seven class
 *      pages, the swashbuckler's among them) to the INVENTOR class (class-feature-1209 is the inventor's
 *      legacy Ability Boost, printed on class-19, which no record carries), and "hex" in 29 links, kingdom
 *      actions included, to the Witch class.
 *
 * Measured on the shipped trees before the fix (2026-10-16), 27 linked documents in all:
 *   • 13 now open the feature's own record (56 links): Evasion, Formula Book, Second Skin, Occult
 *     Spellcasting, Deific Weapon, Iron Will, Wizard Weapon Expertise, Heightened Senses, Swashbuckler's
 *     Style, Studious Spells and the three alchemist Perpetual features;
 *   • 8 ship no record and become inert text (173 links): Ability Boost (inventor), Hexes (witch), Divine /
 *     Primal / Arcane Spellcasting, Exalt, Deity and Cause, Divine Smite. The cost: a link such as "divine
 *     spellcasting" on the Cleric archetype page no longer opens the whole Cleric class page;
 *   • the 6 others are pages of their own replaced across categories (Wish, Miracle, Alter Reality, Primal
 *     Phenomenon and Glyph of Warding by rituals, the Ganzi ancestry by a feat), not sub-pages, and are
 *     untouched.
 * scripts/ast-link-carrier-check.mjs (in `npm run verify`) is the guard; scripts/repair-subpage-link-refs.mjs
 * repaired the shipped trees without a full `npm run data`; test/package-m-links-subpage.test.ts pins this
 * file's rule.
 *
 * Readers: scripts/import-core-v2.mjs (resolveTo) and scripts/repair-subpage-link-refs.mjs. Imported,
 * never copied.
 *
 * ── PACKAGE I, LANE L8 (2026-10-17): THE LINK OPENS THE PAGE'S OWN RECORD (the second half of this file) ──
 *
 * import-core-v2's resolveTo() resolves a link against the importer's own id map, but later chain steps
 * mint or re-stamp the records that ship (import-siege-and-gaps' condition additions become `aon-*`,
 * stamp-aonid, fix-aonid-collisions). So the stored ref went stale: 3,771 links opened nothing although a
 * record carries their page (`ref: null` for 1,125, a record that does not ship for 2,646 —
 * `conditions:lost` while `conditions:aon-lost` ships), and 14 live link pairs opened another printing's
 * record (Miracle -> the Wish ritual, Feather Token (Chest) -> the Marvelous Miniature family page, the
 * Dragon Disciple Dedication's "Draconic Scent" -> the Dragonblood feat). planLink() below is the rule;
 * scripts/relink-carried-pages.mjs applies it to the shipped trees (the last tree step of `npm run data`),
 * scripts/rebuild-ast-entries.mjs applies it to a page it rebuilds, and scripts/ast-link-carrier-check.mjs
 * (npm run verify) fails while any link would still change. test/package-i-links.test.ts pins it.
 * Measured on the first --write (2026-10-17): 931 dead links revived (682 AoN-authored, 249 auto-links naming
 * the page's whole name), 85 re-pointed (the 14 wrong pairs), 1,571 common-word auto-links made inert; the
 * other 2,840 of the 3,771 stay dead on purpose (army-condition words, pages several records carry, mis-stamps).
 *
 * Readers of the second half: those three scripts and the test. Imported, never copied.
 */
import { newestPrinting } from './reprint.mjs';

/** The kinds of Archives document that are printed ON another page (scripts/lib/reprint.mjs SUBPAGE). */
export const SUBPAGE_KINDS = new Set(['class-feature', 'sidebar', 'item-bonus']);

/**
 * The bucket each sub-page kind ships in — import-core-v2's CAT_BUCKET for `class-feature`, and its
 * camel-cased reference bucket for the other two. The repair script needs it without running the importer.
 */
export const SUBPAGE_BUCKET = { 'class-feature': 'classFeatures', sidebar: 'sidebar', 'item-bonus': 'itemBonus' };

/** The slug rule record keys are minted with (import-core-v2 `slug`, reprint.mjs `slugify`). */
const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * True when `doc`'s supersession pointer names the reprint of the page it is printed on, not its own.
 * `doc` and `byDoc` are export documents ({ category, name }); an unknown `byDoc` is never a page link
 * (nothing could be resolved through it anyway).
 */
export function isPageLink(doc, byDoc) {
  if (!doc || !byDoc || !SUBPAGE_KINDS.has(String(doc.category))) return false;
  if (String(byDoc.category) === String(doc.category)) return false;
  return slugify(doc.name) !== slugify(byDoc.name);
}

/**
 * The record a link to the pruned sub-page `to` opens in place of its page hop, as "bucket:slug", or null
 * when nothing of its own ships.
 *   own      { bucket, slug } — the document's own bucket and name slug (import-core-v2 supIdInfo[to])
 *   idMap    document id -> { bucket, slug } (public/idmap.json)
 *   live     ({ bucket, slug }) -> boolean: does that record ship
 *   reprints the scripts/lib/reprint.mjs index (optional: absent, step 1 is skipped)
 */
export function subPageRef(to, own, { idMap, live, reprints }) {
  const R = reprints ? newestPrinting(reprints, String(to)) : null;
  const paired = R ? idMap?.[R] : null;
  if (paired && live(paired)) return `${paired.bucket}:${paired.slug}`;
  if (own?.bucket && own?.slug && live(own)) return `${own.bucket}:${own.slug}`;
  return null;
}

/* ═════════════════════ PACKAGE I, LANE L8: A LINK OPENS ITS PAGE'S OWN RECORD ═════════════════════ */

const keyOf = (ref) => { const s = String(ref ?? ''); const i = s.indexOf(':'); return i > 0 ? s.slice(i + 1) : ''; };
const bucketOf = (ref) => { const s = String(ref ?? ''); const i = s.indexOf(':'); return i > 0 ? s.slice(0, i) : ''; };
/** A name without its trailing "(…)": "Draconic Scent (Dragon Disciple)" -> "draconic-scent". */
const bare = (s) => slugify(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''));
const textOf = (n) => (!n || typeof n !== 'object' ? '' : n.t === 'text' ? String(n.v ?? '') : (n.c ?? []).map(textOf).join(''));
/** The words a link shows, whitespace folded. */
export const labelOf = (n) => textOf(n).replace(/\s+/g, ' ').trim();

/**
 * Archives categories whose page is a creature, a hazard or an NPC. Their records live in the bestiary, never
 * in public/core.json, so a core record that carries such a page is a name mis-stamp (the Sloth creature
 * family carried by classFeatures/sloth, Dinosaur by items/aon-dinosaur: 36 links measured) and a link to the
 * page never revives into it.
 */
export const ENTITY_CATEGORIES = new Set(['creature', 'creature-family', 'creature-ability', 'hazard', 'class-sample', 'npc']);

/** Words of a book's name that name a series, not a book: a "(Lost Omens)" suffix says nothing about which book. */
const SERIES_WORDS = new Set(['pathfinder', 'lost-omens', 'pathfinder-lost-omens', 'adventure-path', 'pathfinder-adventure-path', 'remastered', 'legacy']);

/**
 * The bucket of each class's own sub-options -> that class. A page in one of these buckets is "of" the class
 * (classWordInert): the Champion's causes may say "cause", the Witch's patrons "patron".
 */
export const SUBCLASS_BUCKET_CLASS = Object.freeze({
  cause: 'champion', tenet: 'champion', doctrine: 'cleric', instinct: 'barbarian', muse: 'bard', racket: 'rogue',
  druidicOrder: 'druid', bloodline: 'sorcerer', arcaneSchool: 'wizard', arcaneThesis: 'wizard', patron: 'witch',
  lesson: 'witch', mystery: 'oracle', methodology: 'investigator', hybridStudy: 'magus', implement: 'thaumaturge',
  innovation: 'inventor', researchField: 'alchemist', element: 'kineticist', consciousMind: 'psychic',
  subconsciousMind: 'psychic', way: 'gunslinger', style: 'swashbuckler', huntersEdge: 'ranger', apparition: 'animist',
  practice: 'animist', grimFascination: 'necromancer', fatalMethod: 'necromancer', ikon: 'exemplar', epithet: 'exemplar',
  follower: 'commander', tactic: 'commander', runesmithRune: 'runesmith',
  // A draconic exemplar page is the sorcerer's draconic bloodline and the barbarian's dragon instinct at once:
  // each page lists the "Bloodline Skill" and "Sorcerous Gifts" (measured on draconicExemplar/adamantine).
  draconicExemplar: ['sorcerer', 'barbarian'],
});

/**
 * Two-word phrases the Archives auto-linker sends to ONE class's feature from ordinary prose, measured per
 * phrase on the shipped trees (2026-10-17): "divine will" (the Champion's, from backgrounds/abadars-avenger and
 * rules/divine-involvement), "second skin" (the Ranger's, from armorGroup/leather "The thick second skin of the
 * armor"), "reaction time", "perfected form", "indomitable will", "iron will". Every other multi-word label is
 * a specific term ("divine font", "formula book", "spell repertoire", "raging resistance") and keeps its link.
 */
export const CLASS_WORD_IDIOMS = Object.freeze(['divine will', 'second skin', 'reaction time', 'perfected form', 'indomitable will', 'iron will']);

const ownersCache = new WeakMap();
/**
 * classFeatures key -> the set of class keys whose TABLE lists it: `features[].featureId`, the sub-options
 * (`subclass.options`, `extraChoices[].options`) and their `featureIds`. A feature in two or more tables is
 * shared (Medium Armor Expertise is in six); one in none takes its page's class (featureOwner). Read from
 * the class tables, never from a record's own `traits`: classFeatures/resolve says ['magus'] although its
 * page is the Inventor's Resolve.
 */
export function featureOwners(core) {
  if (core && ownersCache.has(core)) return ownersCache.get(core);
  const owners = new Map();
  const add = (id, cls) => {
    const k = typeof id === 'string' ? id : id?.id ?? id?.featureId;
    if (!k) return;
    (owners.get(k) ?? owners.set(k, new Set()).get(k)).add(cls);
  };
  for (const [cid, cl] of Object.entries(core?.classes ?? {})) {
    for (const f of cl?.features ?? []) add(f?.featureId, cid);
    for (const o of cl?.subclass?.options ?? []) { add(o, cid); for (const f of o?.featureIds ?? []) add(f, cid); }
    for (const ec of cl?.extraChoices ?? []) for (const o of ec?.options ?? []) { add(o, cid); for (const f of o?.featureIds ?? []) add(f, cid); }
  }
  if (core) ownersCache.set(core, owners);
  return owners;
}

const classNameCache = new WeakMap();
/** slug of a class's name -> its key ("champion" -> "champion"). */
function classesByName(core) {
  if (core && classNameCache.has(core)) return classNameCache.get(core);
  const m = new Map();
  for (const [k, c] of Object.entries(core?.classes ?? {})) { m.set(slugify(c?.name), k); m.set(k, k); }
  if (core) classNameCache.set(core, m);
  return m;
}

/** Every trait chip label in a page tree (`{ t: 'traits', c: [{ t: 'trait', label }] }`, any depth). */
function traitLabels(tree) {
  const out = [];
  const walk = (n, inTraits) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k, inTraits); return; }
    if (inTraits && n.t === 'trait' && n.label) out.push(String(n.label));
    if (n.c) walk(n.c, inTraits || n.t === 'traits');
  };
  walk(tree, false);
  return out;
}

/**
 * The classes a page is "of": classes/<c>; a page in c's sub-option bucket (SUBCLASS_BUCKET_CLASS), or whose
 * own Archives document is of such a category (classFeatures/first-doctrine-warpriest is built from doctrine-5);
 * a classFeatures page in c's table; feats/<c>-dedication and archetype/<c> (the class's multiclass archetype);
 * a page whose trait chips, or whose record's own traits, name c; a page whose own Archives document says
 * `class: c`. `docs` (the reprint index's slim documents) is optional — without it the document tests are
 * skipped.
 */
export function pageClasses(bucket, key, tree, core, docs = null) {
  const byName = classesByName(core);
  const out = new Set();
  const add = (c) => { for (const x of [].concat(c ?? [])) if (x) out.add(x); };
  if (bucket === 'classes') add(key);
  add(SUBCLASS_BUCKET_CLASS[bucket]);
  if (bucket === 'classFeatures') for (const c of featureOwners(core).get(key) ?? []) add(c);
  if (bucket === 'feats' || bucket === 'archetype') add(byName.get(String(key).replace(/-dedication$/, '')));
  for (const label of traitLabels(tree)) add(byName.get(slugify(label)));
  for (const t of [].concat(core?.[bucket]?.[key]?.traits ?? [])) add(byName.get(slugify(t)));
  const doc = docs?.get(String(tree?.aon ?? ''));
  if (doc?.data?.class) add(byName.get(slugify(doc.data.class)));
  /* A feat of the class's own multiclass archetype is the class's page too (package I, the L8 checker): its doc
   * names the archetype ("Sorcerer"), and Basic Sorcerer Spellcasting's "bloodline", Instinct Ability's
   * "instinct" or Tactical Excellence's "tactics" are that class's own words there, not a stray common word. */
  for (const a of [].concat(doc?.data?.archetype ?? [])) add(byName.get(slugify(a)));
  const cat = String(doc?.category ?? '').replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  if (cat) add(SUBCLASS_BUCKET_CLASS[cat]);
  return out;
}

/**
 * Everything the rule reads, built once. `core` is public/core.json; `reprints` the scripts/lib/reprint.mjs
 * index (loadReprintIndex: its `docs` are the export's documents, slimmed — name, category, level, books,
 * data.class, data.archetype); `createdRefs` the importer-created records ('bucket:key', from
 * scripts/migration/out/archive-created.json — scripts/lib/archive-coverage.mjs createdRefs).
 */
export function linkContext({ core, reprints = null, createdRefs = new Set() }) {
  const carriers = new Map(); // aonId -> ['bucket:key', …]
  const holder = new Map(); // `bucket|lower name` -> key of a record the importer did NOT create
  for (const [bucket, rows] of Object.entries(core ?? {})) {
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    for (const [key, r] of Object.entries(rows)) {
      if (!r || typeof r !== 'object') continue;
      if (r.aonId) {
        const a = String(r.aonId);
        (carriers.get(a) ?? carriers.set(a, []).get(a)).push(`${bucket}:${key}`);
      }
      if (r.name && !createdRefs.has(`${bucket}:${key}`)) {
        const nk = `${bucket}|${String(r.name).toLowerCase()}`;
        if (!holder.has(nk) || key === slugify(r.name)) holder.set(nk, key);
      }
    }
  }
  const docs = reprints?.docs ?? new Map();
  const books = new Set();
  const archetypes = new Set();
  for (const d of docs.values()) {
    for (const b of d?.books ?? []) books.add(slugify(b));
    for (const a of [].concat(d?.data?.archetype ?? [])) archetypes.add(slugify(a));
    if (d?.category === 'archetype') archetypes.add(slugify(d.name));
  }
  books.delete('');
  archetypes.delete('');
  const recordOf = (ref) => {
    if (!ref) return undefined;
    const i = String(ref).indexOf(':');
    const r = i > 0 ? core?.[ref.slice(0, i)]?.[ref.slice(i + 1)] : undefined;
    return r && typeof r === 'object' ? r : undefined;
  };
  return {
    core, reprints, docs, createdRefs, carriers, holder, recordOf,
    bookSlugs: [...books].map((b) => `-${b}-`), archetypeSlugs: archetypes,
    pageCache: new Map(), bookLikeCache: new Map(),
  };
}

/** A record's "(Suffix)" names a book: some book's name holds it as whole words, and it is not a series word. */
function namesABook(s, ctx) {
  if (ctx.bookLikeCache.has(s)) return ctx.bookLikeCache.get(s);
  const needle = `-${s}-`;
  const v = !SERIES_WORDS.has(s) && ctx.bookSlugs.some((b) => b.includes(needle));
  ctx.bookLikeCache.set(s, v);
  return v;
}

/**
 * CARRIER SANITY: why the record `ref` cannot be page `doc`'s own record, or null. A twin minted by name
 * (scripts/migration/build-map.mjs 'slug-noparen') can carry ANOTHER printing's page: feats/even-the-odds-
 * eagle-knight (level 14) carries feat-6145, the Swashbuckler's Even the Odds (level 4). Refused when
 *   • its level differs from the page's, or
 *   • its "(Suffix)" names an archetype the page is not in (the page's data.archetype), or
 *   • its "(Suffix)" names a book the page is not printed in (series words excluded).
 * These seven twins are already listed by scripts/reprint-check.mjs CHECK 6 (scripts/data/book-doc-baseline.json).
 */
export function carrierRefusal(ref, doc, ctx) {
  const r = ctx.recordOf(ref);
  if (!r || !doc) return 'no-record';
  const rl = r.level === '' || r.level == null ? NaN : Number(r.level);
  const dl = doc.level === '' || doc.level == null ? NaN : Number(doc.level);
  if (Number.isFinite(rl) && Number.isFinite(dl) && rl !== dl) return `level ${rl} against the page's ${dl}`;
  const m = /\(([^()]+)\)\s*$/.exec(String(r.name ?? ''));
  if (!m || slugify(m[1]) === '' || String(doc.name ?? '').trim().endsWith(`(${m[1]})`)) return null;
  const s = slugify(m[1]);
  if (ctx.archetypeSlugs.has(s)) {
    const own = [].concat(doc.data?.archetype ?? []).map(slugify);
    if (!own.includes(s)) return `"(${m[1]})" names an archetype the page is not in`;
    return null;
  }
  if (namesABook(s, ctx) && !(doc.books ?? []).some((b) => `-${slugify(b)}-`.includes(`-${s}-`))) {
    return `"(${m[1]})" names a book the page is not printed in`;
  }
  return null;
}

/**
 * THE PAGE'S RECORD. For the Archives document `to`: { T0, T, doc } or null.
 *   T0  the ONE record carrying `to` (its aonId) that is named as the page, tried in order: the exact name; a
 *       single canonical (non-`aon-`) record among several exact names; a single bare-name match ("Draconic
 *       Scent (Dragon Disciple)" for "Draconic Scent"); a single "<page name> (…)" twin. Never a record of an
 *       entity page (ENTITY_CATEGORIES), never one carrierRefusal() refuses.
 *   T   T0's `remasteredAs` when that record ships (followed up to four hops; desk #158, gold-set R12: a link
 *       follows the reprint), else T0 — and never an importer-CREATED record when a record of its bucket that
 *       was not created carries its name (scripts/archive-coverage-check.mjs LINK: "a same-named record keeps
 *       its links").
 *   When records carry `to` but none qualifies as T0, the page's newest printing (reprint index) answers
 *   instead, when THAT page has a record of its own (`via` names it).
 * null when the export does not know `to`, no record carries it, or none is named as the page.
 */
export function pageRecordRef(to, ctx) {
  const id = String(to ?? '');
  if (ctx.pageCache.has(id)) return ctx.pageCache.get(id);
  const out = pageRecordOf(id, ctx);
  ctx.pageCache.set(id, out);
  return out;
}
function pageRecordOf(to, ctx) {
  const doc = ctx.docs.get(to);
  if (!doc || ENTITY_CATEGORIES.has(String(doc.category))) return null;
  const cs = ctx.carriers.get(to) ?? [];
  if (!cs.length) return null;
  const own = ownPageRecord(to, doc, cs, ctx);
  if (own) return own;
  /*
   * A page that records carry but none of them as its own (every carrier refused): its NEWEST printing's own
   * record, when that page has one. Feather Token (Chest) (equipment-244-244, Core Rulebook, level 3) is carried
   * only by the level-5 "Feather Token (Chest) (Ammunition)"; its newest printing equipment-3002-2862 is
   * items/marvelous-miniature-chest's own page, so the link opens that instead of the Marvelous Miniature family.
   */
  const np = ctx.reprints ? newestPrinting(ctx.reprints, to) : null;
  const viaNewest = np && np !== to ? pageRecordRef(np, ctx) : null;
  return viaNewest ? { ...viaNewest, doc, via: np } : null;
}
function ownPageRecord(to, doc, cs, ctx) {
  const name = String(doc.name ?? '');
  const nameOf = (c) => ctx.recordOf(c)?.name;
  let T0 = null;
  const exact = cs.filter((c) => slugify(nameOf(c)) === slugify(name));
  if (exact.length === 1) T0 = exact[0];
  else if (exact.length > 1) {
    const canon = exact.filter((c) => !keyOf(c).startsWith('aon-'));
    T0 = canon.length === 1 ? canon[0] : null;
  } else {
    const b = cs.filter((c) => bare(nameOf(c)) === bare(name));
    if (b.length === 1) T0 = b[0];
    else {
      const sfx = cs.filter((c) => String(nameOf(c) ?? '').startsWith(`${name} (`));
      T0 = sfx.length === 1 ? sfx[0] : null;
    }
  }
  if (!T0 || carrierRefusal(T0, doc, ctx)) return null;
  // The newest printing's own record first (the reprint index, R12 — as subPageRef above), then T0's own
  // `remasteredAs`. They agree on every link but one measured (2026-10-17): a Gnoll link whose carrier says
  // remasteredAs trait:kholo, where the index's newest printing ancestry-79 is ancestries/kholo's own page.
  const np = ctx.reprints ? newestPrinting(ctx.reprints, to) : null;
  const viaNewest = np && np !== to ? pageRecordRef(np, ctx) : null;
  if (viaNewest) return { T0, T: viaNewest.T, doc, via: np };
  let T = T0;
  for (let hop = 0; hop < 4; hop++) {
    const ra = ctx.recordOf(T)?.remasteredAs;
    const next = ra?.bucket && ra?.id ? `${ra.bucket}:${ra.id}` : null;
    if (!next || next === T || !ctx.recordOf(next)) break;
    T = next;
  }
  if (ctx.createdRefs.has(T)) {
    const h = ctx.holder.get(`${bucketOf(T)}|${String(ctx.recordOf(T)?.name ?? '').toLowerCase()}`);
    if (h && h !== keyOf(T)) T = `${bucketOf(T)}:${h}`;
  }
  return { T0, T, doc };
}

/** An Archives auto-link whose words are the page's whole name, two words or more ("Necklace of Fireballs III"). */
export function isFullNameAuto(node, doc) {
  if (!node?.auto || !doc) return false;
  const label = labelOf(node);
  return /\s/.test(label) && slugify(label) === slugify(doc.name);
}

/**
 * Why a live link whose record is not the page's own record still opens the right thing, or null:
 *   E1b the record carries the reprint index's newest printing of `to` (Gnoll -> Kholo, the legacy Amulet ->
 *       the thaumaturge's implement-17);
 *   E4  a classFeatures record in two or more class tables (Medium Armor Expertise), or in none and with
 *       the same bare name as a classFeatures record carrying the page (the generic Spell Repertoire) —
 *       package M: the class card shows the class's own text;
 *   E3  its aonId is `${to}-…`: a link to an item FAMILY page opens the family's base grade.
 * `like` is the list of records the comparison runs against: the page's record T0 (the relink pass) or
 * every carrier of the page (scripts/ast-link-carrier-check.mjs classify).
 */
export function keepReason(ref, to, like, ctx) {
  const R = ctx.recordOf(ref);
  if (!R) return null;
  const np = ctx.reprints ? newestPrinting(ctx.reprints, String(to)) : null;
  if (np && String(R.aonId ?? '') === String(np)) return 'E1b';
  if (bucketOf(ref) === 'classFeatures') {
    const n = featureOwners(ctx.core).get(keyOf(ref))?.size ?? 0;
    if (n >= 2) return 'E4';
    if (n === 0 && like.some((c) => bucketOf(c) === 'classFeatures' && bare(ctx.recordOf(c)?.name) === bare(R.name))) return 'E4';
  }
  if (String(R.aonId ?? '').startsWith(`${to}-`)) return 'E3';
  return null;
}

/**
 * THE RELINK RULE for one link node ({ t: 'link', to, ref, auto? }): { ref, why }.
 *   • its record carries `to` -> kept ('own');
 *   • no page record (pageRecordRef null) -> kept as it is, live or dead;
 *   • DEAD (ref null, or naming a record that does not ship): an AoN-authored link (no `auto`) opens T
 *     ('revive'); an auto link whose words are the page's whole name, 2+ words, opens T unless T is an
 *     animal companion ("fire elemental" also names creatures) ('revive-full-name'); every other auto link
 *     stays dead — 1,714 of them are Kingmaker ARMY conditions our Archives auto-linker attached to ordinary
 *     English ("lost" x693, "destroyed" x542, 221 of them on item pages);
 *   • LIVE on another record: kept when it is T0 or T, when keepReason() says so, or when it has T0's exact
 *     name (E2, the importer's "a same-named record keeps its links"); else it opens T ('repoint') — but a
 *     plain auto link is never moved onto an `aon-` record (see planLink).
 */
export function relinkVerdict(node, ctx) {
  const to = String(node?.to ?? '');
  const ref = node?.ref ?? null;
  const R = ctx.recordOf(ref);
  if (R && String(R.aonId ?? '') === to) return { ref, why: 'own' };
  const page = pageRecordRef(to, ctx);
  if (!page) return { ref, why: R ? 'keep-no-page-record' : 'dead-no-page-record' };
  const { T0, T, doc } = page;
  const fullName = isFullNameAuto(node, doc);
  if (!R) {
    if (!node.auto) return { ref: T, why: 'revive' };
    if (fullName && bucketOf(T) !== 'animalCompanions') return { ref: T, why: 'revive-full-name' };
    return { ref, why: 'dead-auto' };
  }
  if (ref === T || ref === T0) return { ref, why: 'keep-page-record' };
  const kept = keepReason(ref, to, [T0], ctx);
  if (kept) return { ref, why: `keep-${kept}` };
  if (slugify(R.name) !== '' && slugify(R.name) === slugify(ctx.recordOf(T0)?.name)) return { ref, why: 'keep-E2' };
  if (node.auto && !fullName && keyOf(T).startsWith('aon-')) return { ref, why: 'keep-auto-reach' };
  return { ref: T, why: 'repoint' };
}

/** The one class whose feature `ref` is, or null (shared by 2+ tables, or no class at all). */
function featureOwner(ref, ctx) {
  const o = featureOwners(ctx.core).get(keyOf(ref));
  if (o?.size === 1) return [...o][0];
  if (o?.size) return null;
  const cls = ctx.docs.get(String(ctx.recordOf(ref)?.aonId ?? ''))?.data?.class;
  return cls ? classesByName(ctx.core).get(slugify(cls)) ?? null : null;
}

/**
 * I10c: an auto link that sends a COMMON WORD to another class's feature is inert. True when
 *   • the link is an Archives auto-link (AoN itself never links a class feature: all 5,104 links to a
 *     class-feature document in our trees are `auto`), and
 *   • `ref` (default: the node's own) is a classFeatures record owned by exactly one class (featureOwners;
 *     a record in no table takes its page's `class`), and
 *   • its words are one word, or one of CLASS_WORD_IDIOMS, and
 *   • the page it sits on is not of that class (pageClasses).
 * "cause" in a kingdom action ("Investments below this amount cause your attempt…") stops opening the
 * Champion's Cause; "cause" on the Champion's own page keeps it; "divine font" on a deity page keeps it.
 * `page` is { bucket, key, tree }; its classes are computed once and kept on it.
 */
export function classWordInert(node, page, ctx, ref = node?.ref, anyWords = false) {
  if (!node?.auto || bucketOf(ref) !== 'classFeatures' || !ctx.recordOf(ref)) return false;
  const owner = featureOwner(ref, ctx);
  if (!owner) return false;
  const label = labelOf(node).toLowerCase();
  if (!label || (!anyWords && /\s/.test(label) && !CLASS_WORD_IDIOMS.includes(label))) return false;
  page.classes ??= pageClasses(page.bucket, page.key, page.tree, ctx.core, ctx.docs);
  return !page.classes.has(owner);
}

/**
 * THE PLAN for one link: relinkVerdict, then two rules that make a live auto link inert:
 *   • 'inert-auto-reach': a plain auto link (not the page's whole name) never opens an `aon-` record. Those are
 *     the records minted after the importer's id map (Archives-only twins and additions: conditions/aon-lost,
 *     items/aon-fist); measured 2026-10-17, no auto link on the shipped trees opened one, and the 1,714 army-
 *     condition words are all such links. A writer that resolves by carrier alone (scripts/rebuild-ast-entries)
 *     would light them up; this keeps every writer where the importer left them.
 *   • 'inert-class-word': classWordInert.
 * And a dead auto-link that tier 2 would revive stays dead when it would open ONE class's feature from a page
 * not of that class, whatever its words ('dead-other-class'): the runesmith's "formula book" is the ALCHEMIST's
 * Formula Book (test/feature-text.test.ts, package M: no class page link opens another class's page).
 * `page` is { bucket, key, tree }. Returns { ref, why }; ref === the node's ref means no change.
 */
export function planLink(node, page, ctx) {
  const v = relinkVerdict(node, ctx);
  if (!v.ref || !ctx.recordOf(v.ref) || !node?.auto) return v;
  if (v.why === 'revive-full-name' && classWordInert(node, page, ctx, v.ref, true)) return { ref: node.ref ?? null, why: 'dead-other-class' };
  if (keyOf(v.ref).startsWith('aon-') && !isFullNameAuto(node, ctx.docs.get(String(node.to)))) return { ref: null, why: 'inert-auto-reach' };
  if (classWordInert(node, page, ctx, v.ref)) return { ref: null, why: 'inert-class-word' };
  return v;
}

/**
 * Walk every link of one page tree and plan it: [{ node, from, ref, why }] for the links whose ref would
 * change (`from` is the ref as stored, null for none). Nothing is written; the caller sets `node.ref = ref`.
 */
export function planTree(bucket, key, tree, ctx) {
  const page = { bucket, key, tree };
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    if (n.t === 'link' && n.to != null) {
      const from = n.ref ?? null;
      const { ref, why } = planLink(n, page, ctx);
      if ((ref ?? null) !== from) out.push({ node: n, from, ref: ref ?? null, why });
    }
    if (n.c) walk(n.c);
  };
  walk(tree);
  return out;
}
