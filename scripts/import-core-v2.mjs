/**
 * NEW importer (migration Step 0) — builds public/core.json from the AoN export at
 * hh-data-export/without-images, instead of the Foundry packs.
 *
 * Milestone A strategy (transcribe-then-verify, per the approved plan):
 *   • CONTENT (what the player sees) comes from the NEW data: name, traits, rarity, level, description.
 *   • MECHANICS (engine calc) are transcribed from the CURRENT core.json by slug — the untrusted-but-
 *     structurally-faithful reference. Later steps re-derive these from facets, gated by a diff harness.
 *   • Editions: prune every `superseded_by` record; keep one record per slug via edition priority.
 *   • Old-only slugs (renames/curated/treasure) are KEPT as-is so nothing the tests reference disappears.
 *   • Purely hand-authored buckets (runes/modes/stances/services/followers/pets) carry over wholesale.
 *   • Emits public/idmap.json (numeric AoN id -> {bucket, slug}) for the Step-1 ast link resolver.
 *
 * The gate: `npm test` (1208 Vitest tests) must pass against the regenerated core.json.
 * Run: node scripts/import-core-v2.mjs
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { applyBackfill } from './lib/apply-backfill.mjs';
import { aonFacets, backgroundFacets, packOf, fillFrequencyCounters, prerequisitesFrom, foldBookSpellings } from './lib/aon-facets.mjs';
import { loadLivePages, liveEdition } from './lib/live-pages.mjs';
import { loadReprintIndex, repointDoc } from './lib/reprint.mjs';
import { creationPlan, subclassLink, ancestryOf, appendSubclassOptions } from './lib/player-create.mjs';
import {
  BESTIARY_CATEGORIES, LABELLED_BUCKETS, REFERENCE, asPage as archivePage, createBucket, creationPlan as archivePlan, loadPages, namesBook, nonPlayerCategories, parentPageOf,
  recordKey,
} from './lib/archive-coverage.mjs';

const DATA = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT = 'public/core.json';
const IDMAP_OUT = 'public/idmap.json';
// The PRISTINE Foundry-built core.json is the transcription reference. On the first run it IS core.json;
// after that it lives in the backup (never overwritten), so re-runs stay idempotent.
const BACKUP = 'public/core.foundry-backup.json';
const REF = existsSync(BACKUP) ? BACKUP : OUT;

// --- the EXACT slug() the engine + saved characters key off (must not drift) ---
const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// new category -> ContentDatabase bucket
const CAT_BUCKET = {
  spell: 'spells', ritual: 'spells',
  equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', relic: 'items', 'set-relic': 'items', 'class-kit': 'items',
  class: 'classes', 'class-feature': 'classFeatures', feat: 'feats',
  ancestry: 'ancestries', heritage: 'heritages', background: 'backgrounds', deity: 'deities', language: 'languages',
  action: 'actions', condition: 'conditions',
  'animal-companion': 'animalCompanions', 'animal-companion-advanced': 'animalCompanions', 'animal-companion-unique': 'animalCompanions',
  'animal-companion-specialization': 'companionSpecializations',
  'familiar-ability': 'familiarAbilities', 'familiar-specific': 'familiarAbilities',
  vehicle: 'vehicles', 'siege-weapon': 'siegeWeapons',
};
// buckets carried from the current core.json wholesale — either hand-authored (no AoN source) or
// mechanics-heavy stat blocks whose new-data content is re-sourced later (Step 3 stat blocks).
//
// `siegeWeapons` was REMOVED from this list (2026-07-28). It was in CAT_BUCKET *and* here, and this
// loop runs AFTER the merge — so it silently overwrote the merged bucket with the 5 hand-authored
// records and discarded all 62 AoN siege weapons (audit/missing-content.md §3: 57 missing names, 90%
// of the whole content gap). `vehicles` is deliberately LEFT here: the audit measured vehicles at
// 96/96 present, so the carried bucket is complete and re-deriving it would be pure risk.
//
// NOTE: removing it from the carry list stops the CLOBBER but does not by itself fill the bucket —
// siegeWeapons is in neither FRESH_BUCKETS nor REFERENCE_BUCKETS, so new-only records still fall to
// `deferred` (the 5 old records survive as kept orphans, step 2 below). The AoN corpus is merged in
// by the targeted, re-runnable scripts/import-siege-and-gaps.mjs — RUN THAT AFTER a full regen, or
// the 57 imported siege weapons (plus the High Seas heritages/deity, the Iblydosi language and the
// two archetype reference entries) will be lost again.
const CARRY_WHOLESALE = [
  'modes', 'stances', 'runes', 'services', 'followers', 'pets',
  'animalCompanions', 'familiarAbilities', 'companionSpecializations', 'vehicles',
];

const EDITION_RANK = { remaster: 0, 'remaster-era': 1, neutral: 2, 'legacy-era': 3, legacy: 4 };
const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);

// REFERENCE (glossary) categories — shipped as lightweight {id,name,edition} records + their ast, so the
// cross-links inside descriptions (rules pages, traits, sources, skills, domains, class sub-options, …)
// RESOLVE and open a popup instead of rendering as dead text. Before this, 70% of all description links
// were inert because their target category wasn't shipped. Any AoN category NOT already a first-class
// bucket (CAT_BUCKET) and not a heavy entity stat-block (REF_SKIP) becomes a reference bucket automatically.
// Entity stat-blocks are skipped: they're large, rarely linked from builder content, and belong to a later
// step. camelCase keeps the internal bucket key valid; the key is arbitrary (resolveTo emits "bucket:slug").
// ⚠ These are the HEAVY entity stat-blocks only. Five smaller categories used to sit in this list and
// were shipped by scripts/import-archive-buckets.mjs instead — kingdom-structure (76), kingdom-event
// (45), creature-theme-template (16), creature-adjustment (54 after dropping reprinted legacy) and
// campsite-meal (27, which the owner ruled should be buyable items with no encoded effect). None is a
// stat-block, all carry a parsed ast, and none was reachable while they were skipped here. Removed so a
// regen keeps producing them; keep the genuine stat-blocks below.
const REF_SKIP = new Set([
  'creature', 'npc', 'hazard', 'weather-hazard', 'creature-ability', 'creature-family',
  'eidolon', 'article', 'class-sample',
  'warfare-army', 'warfare-tactic', 'cult-activity',
  /*
   * runesmith-rune was one of FOUR categories the archive had never scraped (with follower,
   * grim-fascination and fatal-method), so HH's 44 runes are hand-authored `create: true` rows in
   * scripts/data/effect-backfill.json and exist nowhere else — not in core.foundry-backup.json,
   * which is what this importer rebuilds every bucket from.
   *
   * The 2026-09-07 archive delta added the category (44 documents, the same count). The moment
   * runesmith-rune.json appears in the export, the auto-create below would classify it as a
   * REFERENCE bucket and replace all 44 full records with {id, name, edition} stubs. Those stubs
   * carry no `level`, runesmithRuneOptions filters on `level <= character level`, and so every
   * character would silently see an empty rune list — while the importer reported them as "added".
   *
   * Skipped so the authored records survive. Promoting them to a real CAT_BUCKET sourced from the
   * archive is the right end state now that the documents exist, but that is a deliberate mapping
   * with its own verification, not a silent side effect of the category appearing.
   */
  'runesmith-rune',
]);
// campsite-meal lands in `items` rather than a bucket of its own (the owner's ruling), so it is a
// CAT_BUCKET entry, not a reference bucket.
CAT_BUCKET['campsite-meal'] = 'items';
const camel = (s) => String(s).replace(/-(\w)/g, (_, c) => c.toUpperCase());
const REFERENCE_BUCKETS = new Set();

// --- ast -> plain text (search + fallback display); strips AoN template + md-escape artifacts ---
function stripTemplates(s) {
  if (s.indexOf('<%') !== -1) s = s.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' ');
  if (s.indexOf('\\') !== -1) s = s.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return s;
}
function astText(node, out) {
  if (!node) return;
  if (node.t === 'text') { out.push(stripTemplates(String(node.v == null ? '' : node.v))); return; }
  if (node.t === 'br') { out.push('\n'); return; }
  (node.c || []).forEach((c) => astText(c, out));
  if (node.t === 'p' || node.t === 'heading' || node.t === 'li' || node.t === 'row') out.push('\n');
}
function plainDesc(ast) {
  if (!ast) return '';
  const out = [];
  astText(ast, out);
  // this plain text is for SEARCH + fallback only (display uses the ast renderer). Drop AoN's stray
  // square-bracket markup artifacts (orphan closers) so the plain text stays clean.
  return out.join('').replace(/[[\]]/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// normalize new traits: lowercase, drop the rarity + edition words (rarity is a separate field)
function normTraits(traits) {
  const out = [];
  for (const t of traits || []) {
    const k = String(t).toLowerCase();
    if (RARITY.has(k)) continue;
    out.push(k);
  }
  return [...new Set(out)];
}

// Step-0 boundary (spine + pipeline): on an OVERLAID record (new slug that matches an old one) adopt
// only the new canonical NAME and preserve ALL old content + mechanics. Descriptions swap to the ast
// renderer in Step 1; traits/level/mechanics + the fuller new-only corpus arrive in Step 2 (diff-gated).
// This keeps the gate honest — only complete, verified records ship — while the importer, edition
// prune/dedup, and idMap (which covers EVERY new record) are proven end-to-end.
// Declared BEFORE overlayContent, not after: the function is hoisted but these are not, and a `const`
// read before its initialiser throws. (Same trap that bit the Spells tab earlier in this project.)
const facetStats = {};
const facetNotes = [];
// Where a granted activity's cost came from, and which pages the Archives left untagged.
const actionNotes = [];

/*
 * base-item name -> archive doc, for the magic-weapon trait union in aonFacets().
 * Filled during the load loop below. Weapons/armour/shields first: a base_item named "Starknife"
 * must resolve to weapon-44, not to some equipment page that happens to share the name.
 */
/*
 * THE VERIFIED JOIN. scripts/migration/out/map.json pairs each Heroes Heaven record with its archive
 * document id, built and checked across the whole migration (93.9% by id, the rest hand-confirmed).
 *
 * It is needed because the per-slug dedup below is NOT safe once facets are adopted. Two genuinely
 * different feats can share a name: `Death from Above` is BOTH feat-7380 (level 16, Mythic, Eternal
 * Legend) and feat-7610 (level 8, Archetype, Verduran Shadow). They slugify identically, so
 * bestByBucket keeps only the higher edition rank — harmless while overlayContent copied just the
 * name, but it put a Mythic trait and level 16 onto the Verduran Shadow feat as soon as facets came
 * across, which dragged an ordinary level-2 archetype into the mythic destiny list.
 *
 * Optional: if the file is absent the importer still runs, on slug dedup alone, and says so.
 */
const SHELF_RANK = { Rulebooks: 0, 'Lost Omens': 1, Adventures: 2, 'Adventure Paths': 3, Society: 4, Comics: 5, 'Blog Posts': 6, 'April Fools': 7 };
const shelfOf = new Map();
function indexShelf(rec) {
  if (rec?.category === 'source' && rec.name) shelfOf.set(String(rec.name).trim(), rec.data?.primary_source_category);
}
function bestBook(rec) {
  const list = Array.isArray(rec?.data?.source) ? rec.data.source.map((s) => String(s).trim()).filter(Boolean) : [];
  if (list.length < 2) return rec?.book;
  let best = list[0];
  let bestRank = SHELF_RANK[shelfOf.get(best)] ?? 99;
  for (const s of list.slice(1)) {
    const r = SHELF_RANK[shelfOf.get(s)] ?? 99;
    if (r < bestRank) { best = s; bestRank = r; }
  }
  return best;
}

const docById = new Map();
/*
 * bucket -> slug -> the archive doc id this record was ACTUALLY built from.
 *
 * The migration map records where a record SHOULD come from; this records where it DID. They differ
 * whenever preferBase() re-binds a family summary to its base page, or the exclude_from_search guard
 * keeps a visible doc over a hidden one. Stamping `aonId` from the map alone would therefore assert a
 * provenance that is not where the values came from. build-map.mjs reads this file first.
 */
const usedDocs = {};
let mapDocFor = () => null;
try {
  const mig = JSON.parse(readFileSync('scripts/migration/out/map.json', 'utf8')).map ?? {};
  // `joinDocId`: where an owner's aonId ruling replaced the join's page, the page this record has
  // always been built from (see build-map.mjs) — the ruling is stamped later, by stamp-aonid.mjs.
  mapDocFor = (bucket, s) => {
    const m = mig[bucket]?.[s];
    return m && (m.status === 'doc' || m.status === 'scraped') ? m.joinDocId ?? m.docId : null;
  };
  console.log(`migration map loaded: ${Object.keys(mig).length} buckets`);
} catch {
  console.warn('WARNING: scripts/migration/out/map.json not found — falling back to slug dedup, which');
  console.warn('         picks the wrong twin when two different records share a name.');
}

const baseItemIndex = new Map();
const BASE_CATS = ['weapon', 'armor', 'shield'];
/*
 * A BASE-ITEM NAME IS NOT UNIQUE, and the loser of the tie hands its mechanics to somebody else's
 * item. 290 base-item names are claimed by more than one document; on 7 of them the live documents
 * disagree about the TRAITS, which is the whole reason this index exists:
 *
 *   leiomano        weapon-166 (Pathfinder #166) Deadly   vs weapon-292 (Treasure Vault (Rem.)) Fatal
 *   chakri          weapon-270 (Impossible Lands) Deadly  vs weapon-333 (Treasure Vault (Rem.)) Recovery
 *   jiu huan dao / tekko-kagi / butterfly sword / throwing knife / bola — same shape
 *
 * `items/dragontooth-club` names "Leiomano" and took weapon-166's Deadly d10 in place of the Fatal
 * d10 its own Treasure Vault printing is built on — a different crit mechanic, from an adventure
 * path the item has nothing to do with. First-wins is not a rule, so the tie is broken by the rule
 * this repo already applies everywhere else (gold-set R12, "the newest printing wins"): a document
 * something supersedes never wins, and among live candidates the later release date does.
 */
const baseRank = (rec) => [
  BASE_CATS.includes(rec.category) ? 1 : 0,
  rec.superseded_by ? 0 : 1,
  String(rec.release_date ?? ''),
];
function indexBaseItem(rec) {
  if (!rec?.name) return;
  const k = String(rec.name).toLowerCase();
  const prev = baseItemIndex.get(k);
  if (!prev) { baseItemIndex.set(k, rec); return; }
  const [a, b] = [baseRank(rec), baseRank(prev)];
  const better = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
  if (better) baseItemIndex.set(k, rec);
}
/*
 * url -> docs, for the id-based base-item hop. `data.base_item` is NAMES only; only
 * `data.base_item_markdown` carries the URL, and 1,086 URLs are claimed by more than one doc.
 * Combination weapons are the reason: /Weapons.aspx?ID=218 is BOTH `weapon-218` (Gun Sword (Ranged))
 * and `weapon-218--melee`, and the export lists the --melee twin FIRST, so first-wins picks wrong.
 * Heroes Heaven mirrors the ranged half, so the non---melee doc wins.
 */
const byUrl = new Map();
const PAGE2CAT = { weapons: 'weapon', shields: 'shield', armor: 'armor', equipment: 'equipment', spells: 'spell', feats: 'feat' };
function indexUrl(id, rec) {
  if (!rec?.url) return;
  const k = String(rec.url).toLowerCase();
  (byUrl.get(k) ?? byUrl.set(k, []).get(k)).push(id);
}
function docByUrl(url) {
  const k = String(url).toLowerCase();
  const cat = PAGE2CAT[k.split('.aspx')[0].replace(/^\//, '')];
  const ids = (byUrl.get(k) ?? []).filter((id) => !cat || docById.get(id)?.category === cat);
  const pick = ids.find((id) => !id.endsWith('--melee')) ?? ids[0];
  return pick ? docById.get(pick) : null;
}

const resolveBaseItem = (arg, want) => {
  // 'stats' mode: the doc that actually carries combat statistics for this record.
  /*
   * A spell link on an item page, resolved to the HH slug of the spell we actually SHIP.
   *
   * The link usually points at the LEGACY printing: a Staff of Sieges links
   * /Spells.aspx?ID=280, which is `spell-280` "Shield", superseded by the remaster `spell-1671`.
   * Superseded docs are pruned before `idMap` is written, so a bare idMap lookup returns nothing and
   * the staff loses almost every spell it holds. Follow `superseded_by` first, then fall back to the
   * doc's own slug if it is a spell we ship.
   */
  if (want === 'featSlug') {
    const d = docByUrl(arg);
    if (!d) return null;
    if (idMap[d.id]?.bucket === 'feats') return idMap[d.id].slug;
    const s = slug(d.name);
    return bestByBucket.feats?.[s] ? s : null;
  }
  if (want === 'spellSlug') {
    let d = docByUrl(arg);
    for (let hops = 0; d?.superseded_by && hops < 4; hops++) d = docById.get(d.superseded_by) ?? d;
    if (!d) return null;
    if (idMap[d.id]?.bucket === 'spells') return idMap[d.id].slug;
    const s = slug(d.name);
    return bestByBucket.spells?.[s] ? s : null;
  }
  if (want === 'stats') {
    const md = arg?.data?.base_item_markdown;
    if (typeof md === 'string') {
      for (const m of md.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const d = docByUrl(m[1]);
        if (d?.data && (d.data.damage != null || d.data.ac != null || d.data.hardness != null)) return d;
      }
    }
    return null;
  }
  return baseItemIndex.get(String(arg).toLowerCase()) ?? null;
};

/*
 * THE RENAME BOUNDARY — a case-only difference is AoN's heading style, not a rename.
 *
 * Owner, 2026-09-12: "we cant be using old data (not to be confused with pre remaster and after
 * remster data)" — so a record takes its reprint WHOLE, including a real rename (equipment-251
 * "Broom of Flying" -> equipment-3023 "Flying Broomstick" is adopted, as today). But the Archives
 * TITLE-CASE a reprint's page heading, and the printed book does not: measured over the 384-record
 * newest-printing repoint, 28 names changed and every single one was only letter case —
 * "Fulu of Fire Suppression" -> "Fulu Of Fire Suppression", "Bathe in Blood" -> "Bathe In Blood",
 * "Five-Feather Wreath" -> "Five-feather Wreath", "The World's a Stage" -> "The World's a stage",
 * "Meld into Eidolon" -> "Meld Into Eidolon". Shipping those would be a visible regression against a
 * name the book does not print.
 *
 * So: same letters, different case (whitespace collapsed) => the record keeps the name it ships
 * under. Different letters => the reprint's name is adopted, unchanged from before.
 *
 * `data.legacy_name` is NOT the instrument here — it re-cases in both directions on 101 records
 * ("Air Cartridge Firing System" -> "…Firing system"), so it cannot decide which spelling is right.
 */
// Declared BEFORE overlayContent for the same reason facetStats is: the function is hoisted, a `const`
// read before its initialiser throws.
let caseOnlyKept = 0;
const foldName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const caseOnlyRename = (a, b) => {
  const x = foldName(a); const y = foldName(b);
  return !!x && !!y && x !== y && x.toLowerCase() === y.toLowerCase();
};

function overlayContent(rec, old = {}, bucket = null, shippedName = null) {
  /*
   * The NAME plus every facet the Archives can state — level, rarity, traits, price, bulk.
   *
   * This used to return only { name }, which meant an overlaid record kept its Foundry facets and
   * 76.9% of every value in core.json was byte-identical to core.foundry-backup.json. The user's rule
   * is that no value may originate in Foundry, so the Archives now win wherever they have an answer.
   *
   * The old comment justified keeping Foundry's facets with "Uplifting Winds: Foundry=12, AoN=16 …
   * HH's tests assert 12". That is no longer true and may never have been: there is ONE doc,
   * feat-4761, its page heading reads "Feat 16", live core.json already ships 16, and
   * test/campaign-toggles.test.ts:30 asserts 16. The stated reason for the exception had already
   * dissolved.
   *
   * Where the Archives say nothing, aonFacets() returns no key at all, so `...old` survives for that
   * field. Those leftovers are real and are counted in facetStats below — not papered over.
   */
  const { facets, notes } = aonFacets(rec, old, resolveBaseItem, bucket, (id, want) => (want === 'slug' ? (idMap[id]?.bucket === 'actions' ? idMap[id].slug : null) : docById.get(id) ?? null), (r) => actionNotes.push(r));

  /*
   * The BOOK comes from the Archives, canonicalised through the HH-owned table above. The LICENCE does
   * not: 0 of 43,686 archive docs contain "OGL", "ORC" or "Open Game License" anywhere, and it is not
   * derivable from edition (ORC x legacy-era 243, OGL x remaster-era 95) nor from the book (37 of 221
   * books carry mixed licences). Asked under hard rule 2, the user chose to keep the existing values —
   * a recorded exception, documented in MIGRATION.md, not an oversight.
   */
  const book = mapBook(bestBook(rec));
  if (book) {
    facets.source = { book };
    if (old?.source?.license) facets.source.license = old.source.license;
  }
  for (const n of notes) facetNotes.push({ slug: slug(rec.name), name: rec.name, ...n });
  for (const k of Object.keys(facets)) facetStats[k] = (facetStats[k] ?? 0) + 1;
  // See the rename boundary above: case-only => keep what ships; different letters => adopt.
  const name = caseOnlyRename(shippedName, rec.name) ? shippedName : rec.name;
  if (name !== rec.name) caseOnlyKept++;
  return { name, ...facets };
}

// ------------------------------------------------------------------ load reference (pristine Foundry core)
const cur = JSON.parse(readFileSync(REF, 'utf8'));

// Canonical book-name lookup. AoN exports SHORT book names ("Tian Xia Character Guide"); the pristine
// Foundry data uses full ones ("Pathfinder Lost Omens: Tian Xia Character Guide"). Aligning a fresh
// record's book to the Foundry name puts it under the SAME source toggle + shelf as its overlaid
// siblings (so sources.ts categorises it correctly and it doesn't spawn a duplicate "Other" entry).
const normBook = (s) => String(s || '').toLowerCase()
  .replace(/^pathfinder /, '').replace(/^lost omens:? /, '').replace(/\((?:remastered|remaster)\)/g, '').replace(/[^a-z0-9]/g, '');
const foundryBookByNorm = {};
for (const m of ['ancestries', 'heritages', 'backgrounds', 'classes', 'feats', 'spells', 'items', 'deities', 'actions']) {
  for (const id in (cur[m] || {})) {
    const b = cur[m][id]?.source?.book?.trim();
    if (b && !foundryBookByNorm[normBook(b)]) foundryBookByNorm[normBook(b)] = b;
  }
}

// ------------------------------------------------------------------ load + dedup new data
const bestByBucket = {}; // bucket -> slug -> {rec, rank}
const allByBucket = {};  // bucket -> slug -> [rec, …]  — every candidate, for pickByArchetype
const idMap = {};        // numericId -> {bucket, slug}
const supersededRecs = []; // {bucket, slug, by} for each pruned legacy record (for orphan rename-dedup)
/*
 * bucket -> slug -> the best PRUNED (superseded_by) document of that name.
 *
 * A pruned printing is dropped from the per-slug pick, but the RECORD it belongs to does not go with
 * it: the owner's desk #158 ruling keeps the old page as its own record, marked legacy and carrying a
 * "remastered as" link. That record then falls to the kept-orphan branch below, where its content came
 * from the Foundry reference instead of from the page it says it is — so the day AoN adds a
 * `superseded_by`, the record silently reverts to Foundry values.
 *
 * Measured on the 2026-09-23 refresh: 82 documents gained the pointer, 73 of them ship a record, and
 * the reversion cost `spells/summon-kaiju` its printed traits and level, `items/staff-storing-shield-*`
 * their usage and Bulk, `items/cantrip-deck-full-pack` its variable activation and
 * `items/noxious-incense-greater` its hands. Keeping the pruned document here is what lets the orphan
 * branch build those records from their own page.
 */
const prunedBest = {}; // bucket -> slug -> {rec, rank}

/*
 * A SIDEBAR IS A FRAGMENT OF ITS PARENT PAGE, SO ITS `remaster_id` IS ABOUT THE PARENT.
 *
 * The export derives `superseded_by` from AoN's own `remaster_id`, and for a spell that is exactly
 * what it means: spell-3 "Acid Splash" names spell-1461 "Caustic Blast", the reprint of ITSELF. A
 * sidebar has no page of its own — its `url` is its parent's (`sidebar-1573` "Spellstrike Options"
 * carries `/Classes.aspx?ID=17` and its own markdown prints "**Parent page** [Magus]") — so the only
 * thing its `remaster_id` can name is the REMASTERED PARENT. sidebar-1573 points at class-74, the
 * remastered Magus; sidebar-1115 "Tianjing" and sidebar-1936 "The Shaded Library" both point at
 * ancestry-68, Nephilim. Fetched live: none of class-74, class-77 or ancestry-68 contains the string
 * "Spellstrike Options", "Summoning Spells" or "Tianjing". Nothing reprinted that prose anywhere.
 *
 * Treating that pointer as a supersession deleted 13 shipped sidebars in the 2026-09-23 refresh —
 * ~700-1,200 characters of readable prose each, reachable nowhere afterwards — against the owner's
 * standing rule that legacy-only content STAYS. 254 of the 709 sidebar documents carry the pointer and
 * 78 more had been dropped this way before anyone measured it.
 *
 * Bounded by the category, because a sidebar is the only shipped bucket whose documents are page
 * fragments, and by the NAME: `sidebar-2312` "Building an Infiltration" and `sidebar-2311`
 * "Propulsion" name a rules page of the same name, which IS that prose reprinted, and those two stay
 * pruned. scripts/lib/reprint.mjs already refuses every cross-category link for the same reason; this
 * is the prune side of that rule, which had never been given it.
 *
 * The name half reads `docById`, which holds the categories whose file sorts before `sidebar.json`
 * (rules, ancestry, class, archetype, action, feat, condition, equipment…) and not the few that sort
 * after (skill, spell, trait). A target that is not loaded yet reads as "no name", which lands on KEEP
 * THE RECORD — the safe side of a loss guard, and the one all 21 of those targets want anyway, since
 * every one of them is a differently-named parent page.
 */
const parentPagePointer = (category, rec) =>
  category === 'sidebar'
  && !String(rec.superseded_by).startsWith('sidebar-')
  && slug(docById.get(String(rec.superseded_by))?.name ?? '') !== slug(rec.name);

let total = 0, pruned = 0;

for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(join(DATA, f), 'utf8')); } catch { continue; }
  let bucket = CAT_BUCKET[raw.category];
  if (!bucket) {
    // Not a first-class bucket: register it as a reference/glossary bucket unless it's a skipped entity.
    if (!raw.category || REF_SKIP.has(raw.category)) continue;
    bucket = camel(raw.category);
    CAT_BUCKET[raw.category] = bucket; // so AON_BUCKETS (computed after this loop) writes its ast
    REFERENCE_BUCKETS.add(bucket);
  }
  for (const numericId in (raw.docs || {})) {
    const rec = raw.docs[numericId];
    total++;
    indexBaseItem(rec);
    indexShelf(rec);
    docById.set(numericId, rec);
    indexUrl(numericId, rec);
    // A record AoN flags `exclude_from_search` is a hidden/older printing, and deriveFresh /
    // deriveReference drop it outright — so letting it WIN the per-slug pick silently deletes the
    // visible twin. That is exactly how the Jalmeri Heavenseeker and Bright Lion archetype reference
    // entries went missing: each book ships a hidden earlier printing at the SAME edition rank, and
    // it happened to be seen first. Rank hidden records strictly below every visible one.
    // Computed before the prune below, because the pruned pick uses the same ordering.
    const rank0 = (EDITION_RANK[rec.edition] ?? 5) + (rec.exclude_from_search === 1 ? 10 : 0);
    if (rec.superseded_by && !parentPagePointer(raw.category, rec)) {
      pruned++;
      supersededRecs.push({ id: numericId, bucket, slug: slug(rec.name), by: rec.superseded_by });
      const ps = slug(rec.name);
      const pv = (prunedBest[bucket] ||= {});
      if (!pv[ps] || rank0 < pv[ps].rank) pv[ps] = { rec, rank: rank0 };
      continue;
    }
    const s = slug(rec.name);
    // Keep EVERY candidate too, not just the winner: two different feats can share a name, and the
    // archetype is what tells them apart. See pickByArchetype below.
    ((allByBucket[bucket] ||= {})[s] ||= []).push(rec);
    (bestByBucket[bucket] ||= {});
    const prev = bestByBucket[bucket][s];
    if (!prev || rank0 < prev.rank) bestByBucket[bucket][s] = { rec, rank: rank0, numericId };
    idMap[numericId] = { bucket, slug: s };
  }
}

/*
 * THE NEWEST PRINTING WINS (owner, 2026-09-12: "we cant be using old data (not to be confused with pre
 * remaster and after remster data)"; gold-set R12). Built from the documents already loaded above —
 * `data.legacy_id` / `data.remaster_id` state the pairing, so no name matching is involved. See
 * scripts/lib/reprint.mjs for the rule and its two exceptions.
 *
 * Read from the WHOLE export (loadReprintIndex), not from `docById`: the sub-page rules resolve a sidebar
 * through the page it is printed on, and `docById` skips the REF_SKIP categories, eidolon among them —
 * built from it, the map lost exactly one pair build-map.mjs has (sidebar-1576 "Embodiments of Sin" ->
 * sidebar-3755, printed on the eidolon page eidolon-19), so the record would have been stamped with the
 * reprint's page while built from the old one. One map, the same in both places.
 */
const reprints = loadReprintIndex(DATA);

// ------------------------------------------------------------------ fresh-record derivation (new-only corpus)
// New-only records (no old baseline) that Foundry never had. Added with facet-derived fields so they're
// selectable + described. Advanced grants aren't modeled yet (inert like today's un-mechanized content),
// but nothing crashes. Only low-risk buckets are enabled here (no NaN / ancestry-linkage requirements).
//
// Every OTHER player kind — backgrounds, heritages, class features and class options — and a page whose
// slug another record already holds (the second "Zombie Horde") are created by step 4 below, gated by
// the coverage rule. Adding those buckets HERE would create every new slug unconditionally, chassis rows
// and already-shipped twins included; see scripts/lib/player-create.mjs for the measurement.
const FRESH_BUCKETS = new Set(['feats', 'actions', 'spells', 'items']);
const DIE = new Set([4, 6, 8, 10, 12]);
function cpToCoins(cp) {
  const c = { gp: Math.floor(cp / 100) };
  const sp = Math.floor((cp % 100) / 10); if (sp) c.sp = sp;
  const rem = cp % 10; if (rem) c.cp = rem;
  if (!c.gp) delete c.gp;
  return Object.keys(c).length ? c : { cp: 0 };
}
function deriveFreshItem(base, rec) {
  // apex items boost a specific attribute stated only in prose; until that's modeled, drop the apex trait
  // (the item still works as normal gear) so it doesn't read as a broken apex item.
  base.traits = base.traits.filter((t) => t !== 'apex');
  // unarmed "weapons" (Fist, Claw, …) are innate strikes, not gear — don't add them as items at all
  if (rec.category === 'weapon' && String(rec.weapon_category || '').toLowerCase() === 'unarmed') return null;
  const level = clamp(num(rec.level, 0), 0, 30);
  const bulk = num(rec.bulk_num, 0);
  const common = { ...base, level, bulk };
  if (typeof rec.price_cp === 'number' && rec.price_cp > 0) common.price = cpToCoins(rec.price_cp);
  // weapons are fully derivable from facets (damage/category/group) — usable Strikes. Skip UNARMED
  // weapons (Fist, Claw, …): those are innate strikes the engine models specially, not inventory gear —
  // adding them as items breaks unarmed-attack handling (e.g. Deadly Simplicity on Irori's fist).
  if (rec.category === 'weapon' && String(rec.weapon_category || '').toLowerCase() !== 'unarmed' && DIE.has(Number(rec.damage_die))) {
    const w = { ...common, itemType: 'weapon', category: String(rec.weapon_category || 'martial').toLowerCase(),
      group: String(rec.weapon_group || '').toLowerCase(), damage: { dice: 1, die: 'd' + rec.damage_die, type: String(rec.damage_type || 'bludgeoning').toLowerCase() } };
    if (typeof rec.range_ft === 'number' && rec.range_ft > 0) w.range = rec.range_ft;
    return w;
  }
  // armor/shield/other: their AC/hardness stats aren't cleanly faceted (NaN risk) → carry as equipment
  // or consumable (still buyable/carryable), full mechanics deferred to the item overlay.
  const catl = String(rec.item_category || '').toLowerCase();
  const itemType = /potion|scroll|elixir|mutagen|oil|talisman|consumable|ammunition|snare|drug|poison|bomb|drug/.test(catl) ? 'consumable' : 'equipment';
  return { ...common, itemType };
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v, d) => (typeof v === 'number' ? v : d);
const ACTIONS = { 'single action': 1, 'one action': 1, '1 action': 1, 'two actions': 2, '2 actions': 2, 'three actions': 3, '3 actions': 3 };
function parseActionCost(str) {
  const s = String(str || '').trim().toLowerCase(); if (!s) return undefined;
  if (ACTIONS[s]) return { type: 'actions', value: ACTIONS[s] };
  if (s === 'reaction') return { type: 'reaction' };
  if (s === 'free action' || s === 'free') return { type: 'free' };
  return { type: 'passive' };
}
/**
 * Every class the APP has — not merely every class the Foundry base file had.
 *
 * `featCategory` calls a feat a CLASS feat when one of its traits is a class slug, and `cur` is the
 * Foundry-sourced reference. A class authored after that file was made is therefore invisible here
 * and all of its feats are filed `general` instead. Measured 2026-08-16: every one of the 52
 * runesmith and 74 necromancer feats came out `general`, which left "runesmith feat" at 1st level a
 * slot nothing could fill — a class you can pick and then cannot build.
 *
 * Hand-authored classes live in `work/new-classes/*.json` and are merged by
 * `scripts/import-new-classes.mjs`, which runs AFTER this, so their ids are read from there.
 */
const classSlugs = new Set(Object.keys(cur.classes || {}));
try {
  const authoredDir = 'work/new-classes';
  if (existsSync(authoredDir)) {
    for (const f of readdirSync(authoredDir).filter((x) => x.endsWith('.json'))) {
      const id = JSON.parse(readFileSync(join(authoredDir, f), 'utf8'))?.class?.id;
      if (id) classSlugs.add(id);
    }
  }
} catch { /* no authored classes is the normal case */ }
const ancestrySlugs = new Set(Object.keys(cur.ancestries || {}));
function featCategory(traits) {
  const t = new Set(traits);
  if (t.has('archetype')) return 'archetype';
  if (t.has('mythic')) return 'mythic';
  if (t.has('skill')) return 'skill';
  for (const x of traits) if (classSlugs.has(x)) return 'class';
  for (const x of traits) if (ancestrySlugs.has(x)) return 'ancestry';
  return 'general';
}
// AoN's export stores the book as a short display name ("Player Core", "High Seas"); HH's source
// filter (applySources / sourceCatalog) keys off Foundry-style full names ("Pathfinder Player Core").
// Prefixing "Pathfinder " aligns the four Core books EXACTLY with CORE_BOOKS (so fresh Core content
// stays visible by default) and turns every non-Core book into a properly gated source — without a
// source.book, applySources always kept a fresh record (bug: e.g. Friend of the Sea from High Seas
// showing on a Core-only character).
/*
 * The Archives book name -> Heroes Heaven's canonical display string.
 *
 * This used to read `core.foundry-backup.json` (via foundryBookByNorm) and was the last Foundry
 * dependency in the importer. The mapping now lives in scripts/data/book-names.json, which
 * `scripts/migration/gen-book-names.mjs` produced once and is HH-owned from here on.
 *
 * The Archives supply the book IDENTITY — every doc carries a /Sources.aspx?ID=N link — but NOT a long
 * title: their doc for "Pathfinder Player Core" is named just "Player Core". That prefix is HH's own
 * display convention, and `source.book` is the PRIMARY KEY of the source filter (`CORE_BOOKS`,
 * src/rules/sources.ts:9), so the exact strings must be preserved or every default character's builder
 * empties out.
 */
const BOOK_NAMES = (() => {
  try { return JSON.parse(readFileSync('scripts/data/book-names.json', 'utf8')); } catch { return {}; }
})();
const bookByNorm = {};
for (const [aon, hh] of Object.entries(BOOK_NAMES)) bookByNorm[normBook(aon)] = hh;

/*
 * A doc can be printed in SEVERAL books, and `rec.book` is just `data.source[0]` — array order carries
 * no meaning. `weapon-365` Spear lists ["Tian Xia Character Guide", "Player Core"], so taking the first
 * moved a basic Player Core weapon onto a setting book. `source.book` is the key the source filter
 * runs on, so that removes the Spear from the builder for anyone using the default Core-only setup.
 *
 * The Archives rank the books themselves: each source doc carries `primary_source_category`
 * (Rulebooks / Lost Omens / Adventures / Adventure Paths / Society / Blog Posts / …). Prefer the
 * highest shelf. Ties keep the printed order.
 */
function mapBook(book) {
  const b = String(book || '').trim();
  if (!b) return undefined;
  const canon = bookByNorm[normBook(b)];
  if (canon) return canon;
  return /^Pathfinder /i.test(b) ? b : `Pathfinder ${b}`; // a book the table has not seen yet
}
function deriveFresh(bucket, s, rec) {
  // skip AoN's hidden/test entries (exclude_from_search) + anything with no usable name/slug
  if (!s || rec.exclude_from_search === 1 || !rec.name || !String(rec.name).trim()) return null;
  const traits = normTraits(rec.traits);
  const base = { id: s, name: rec.name, traits, rarity: RARITY.has(rec.rarity) ? rec.rarity : 'common' };
  const book = mapBook(rec.book); if (book) base.source = { book };
  const desc = plainDesc(rec.ast); if (desc) base.description = desc;
  const ac = parseActionCost(rec.action_cost);
  if (bucket === 'feats') {
    const f = { ...base, level: clamp(num(rec.level, 1), 1, 20), category: featCategory(traits) };
    if (ac && ac.type !== 'passive') f.actionCost = ac;
    /*
     * …and the PREREQUISITES, through the same reader an overlaid feat uses.
     *
     * A new-only feat never passes through overlayContent, so `prerequisitesFrom` never ran for it and
     * every one of them shipped with the gate wide open — 272 of them measured 2026-09-23, including
     * the whole Marine Marauder and Pirate archetypes ("Marine Marauder Dedication" printed, nothing
     * enforced) and `feats/overwhelming-harm`, whose "mastery of life and death" the Archives print
     * and the record did not carry.
     *
     * checkPrerequisites() (src/rules/build.ts) enforces a clause ONLY when it resolves to a known
     * skill rank, an attribute modifier or a feat this database ships, so an unparsed clause stays
     * under-enforced rather than locking a legal character out.
     */
    const pre = prerequisitesFrom(rec);
    if (pre?.length) f.prerequisites = pre;
    return f;
  }
  if (bucket === 'actions') { const a = { ...base }; if (ac) a.actionCost = ac; return a; }
  if (bucket === 'spells') { const cantrip = traits.includes('cantrip') || /cantrip/i.test(rec.spell_type || ''); return { ...base, rank: cantrip ? 0 : clamp(num(rec.spell_rank, 1), 0, 10), traditions: [] }; }
  if (bucket === 'items') return deriveFreshItem(base, rec);
  return null;
}

// A reference/glossary record: just enough for the popup to resolve + title itself (name), with the
// display coming from its lazy-loaded ast. No plain description (rules pages are long — keep core.json
// lean; the ast renderer supplies the body). Traits/rarity carried when present so a trait chip colours.
function deriveReference(s, rec) {
  if (!s || rec.exclude_from_search === 1 || !rec.name || !String(rec.name).trim()) return null;
  const base = { id: s, name: rec.name, edition: rec.edition };
  const traits = normTraits(rec.traits); if (traits.length) base.traits = traits;
  if (RARITY.has(rec.rarity) && rec.rarity !== 'common') base.rarity = rec.rarity;
  return base;
}

// superseded legacy slug -> the remaster slug that replaced it (resolved via idMap, now complete).
// Used to rename-dedup: an OLD orphan matching a superseded legacy slug is the outdated half of a change
// whose remaster version is present — mark it edition:'superseded' so pickers hide it (always), but keep
// it resolvable so a pre-migration character that referenced the old slug still loads.
const supersededMap = {}; // bucket -> oldSlug -> newSlug
const supIdInfo = {};     // pruned record id -> { bucket, slug, by } (for the ast link resolver)
for (const r of supersededRecs) {
  supIdInfo[r.id] = r;
  const newSlug = idMap[r.by]?.slug;
  if (newSlug) (supersededMap[r.bucket] ||= {})[r.slug] = newSlug;
}

/*
 * THE SHIPPED ARTEFACT — read for its `aonId` stamps and for the NAME a record already ships under.
 *
 * `cur` (the transcription reference, public/core.foundry-backup.json) is PRE-ARCHIVE: it carries no
 * aon* field on any of its 17,772 records, and it never can — `aonId` is written by
 * scripts/migration/stamp-aonid.mjs, a LATER stage of `npm run data`, from scripts/migration/out/map.json.
 * So `db[bucket][s].aonId` in the ast writer is undefined for every record except the authored `aonId`
 * overlay rows applyBackfill() just wrote, and the guard that reads it fired for almost nobody.
 *
 * public/core.json is the previous run's FINAL, stamped output. It is not overwritten until the end of
 * this file, so reading it here gives what the chain last agreed on — the provenance for the ast
 * writer, and the display name for the case-only rename boundary in overlayContent().
 *
 * ⚠ The NAME reader must be this file and NOT `cur`: measured 2026-09-12, 272 records differ from the
 * Foundry reference by case alone and in BOTH directions ("Transmute Rock And Mud" -> the Archives'
 * better "Transmute Rock and Mud"), so comparing against `cur` would drag 272 unrelated names back to
 * Foundry spellings. Against the shipped artefact it is exactly the 28 the reprint re-cased.
 */
const shippedCore = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
/*
 * …AND THE PROSE THAT WAS SPLIT OUT OF IT.
 *
 * split-descriptions.mjs moves `description` and `descRefs` into public/core-descriptions.json and
 * DELETES them from core.json, so `shippedCore` carries the identity of a record and none of its
 * text. Step 3 below rebuilds a record by copying what shipped; copying it from core.json alone
 * resurrected 20 records with a blank popup — `items/universal-solvent` and its three variants,
 * `items/world-forge`, `items/mythic-resilent`, `feats/irrepressible-ganzi`, `feats/guding-retort`,
 * `trait/negative`, … — each of which a saved character can still be holding.
 */
const SHIPPED_DESC = 'public/core-descriptions.json';
const shippedDesc = existsSync(SHIPPED_DESC) ? JSON.parse(readFileSync(SHIPPED_DESC, 'utf8')) : {};
/** The records step 4 (below) created on the LAST run — scripts/migration/out/player-created.json. Step 3
 *  leaves them to step 4, and step 4's rule does not count them as a page's presence. */
const PLAYER_CREATED = 'scripts/migration/out/player-created.json';
const prevPlayerCreated = existsSync(PLAYER_CREATED) ? JSON.parse(readFileSync(PLAYER_CREATED, 'utf8')) : {};
/** …and the records step 5 created on the last run (scripts/migration/out/archive-created.json), for
 *  the same two reasons. */
const ARCHIVE_CREATED = 'scripts/migration/out/archive-created.json';
const prevArchiveCreated = existsSync(ARCHIVE_CREATED) ? JSON.parse(readFileSync(ARCHIVE_CREATED, 'utf8')) : {};
/** The record as it last SHIPPED, prose included — the two files rejoined. */
const shippedFull = (bucket, s) => {
  const was = shippedCore[bucket]?.[s];
  if (!was) return was;
  const p = shippedDesc[bucket]?.[s];
  if (!p || (p.d === undefined && p.r === undefined)) return was;
  return { ...was, ...(p.d !== undefined ? { description: p.d } : {}), ...(p.r !== undefined ? { descRefs: p.r } : {}) };
};

// ------------------------------------------------------------------ assemble the new ContentDatabase
const db = {};
const stats = {};
const AON_BUCKETS = [...new Set(Object.values(CAT_BUCKET))];

for (const bucket of AON_BUCKETS) {
  const oldMap = cur[bucket] || {};
  const newMap = bestByBucket[bucket] || {};
  const out = {};
  const supers = supersededMap[bucket] || {};
  let overlaid = 0, deferred = 0, orphanKept = 0, added = 0, superseded = 0, mapCorrected = 0, repointed = 0;
  let fromPruned = 0, renamedKept = 0, mapRenamed = 0;

  // 1. every new record that MATCHES an old slug: adopt the new name, keep old content+mechanics.
  //    New-only records are DEFERRED to Step 2 (they need real mechanics before they can ship).
  /*
   * A FAMILY SUMMARY must bind to the family's own page, not to one of its variants.
   *
   * The Archives give a variant family a base doc plus one doc per variant: equipment-2948
   * "Potion of Flying" (no price — it is the summary) and equipment-2948-2817 / -2818 (the lesser and
   * greater, priced). Heroes Heaven mirrors that with `potion-of-flying` plus `potion-of-flying-greater`.
   * The join bound the SUMMARY to the lesser variant, so adopting facets put a 100 gp price on a record
   * that is supposed to have none — which is exactly what the umbrella-item detection keys off.
   *
   * A record is a summary when two or more of its siblings' keys extend it, which is the same test
   * findUmbrellaIds uses (src/data/index.ts:217).
   */
  // Both key sets: `potion-of-flying` exists only in the AoN corpus (it is a FRESH record, absent from
  // the Foundry reference), so counting kin over oldMap alone missed exactly the records this protects.
  const allKeysSorted = [...new Set([...Object.keys(oldMap), ...Object.keys(newMap)])].sort();
  // Every slug this bucket can end up holding — the test for reprint exception 2 (see reprint.mjs).
  const keySet = new Set(allKeysSorted);
  const hasSlug = (k) => keySet.has(k);
  const kinCount = (s) => {
    let n = 0;
    for (let i = allKeysSorted.indexOf(s) + 1; i > 0 && i < allKeysSorted.length && allKeysSorted[i].startsWith(`${s}-`); i++) n++;
    return n;
  };
  const preferBase = (docId, s) => {
    const m = /^(.*)-(\d+)-\d+$/.exec(docId ?? '');
    if (!m) return docId;
    const base = docById.get(`${m[1]}-${m[2]}`);
    const variant = docById.get(docId);
    if (!base || !variant || base.name !== variant.name) return docId;
    return kinCount(s) >= 2 ? `${m[1]}-${m[2]}` : docId;
  };

  for (const s in newMap) {
    /*
     * The migration map's doc wins over the slug-dedup winner — see mapDocFor above — EXCEPT when it
     * would swap a visible doc for a hidden one. `exclude_from_search` marks an older/hidden printing;
     * the ranking above puts those strictly below every visible doc, and deriveFresh/deriveReference
     * drop them outright, so forcing one deletes the record. `Knockdown` is action-21 (visible) and
     * action-130 (hidden); idmap names the hidden one, and honouring that lost the record entirely.
     * This is the same trap the ranking comment above describes for Jalmeri Heavenseeker.
     */
    /*
     * TWO DIFFERENT FEATS CAN SHARE A NAME, and the archetype is what separates them. There are two
     * "Stone Blood" feats, both level 6: feat-890 (Living Monolith, prereq Ka Stone Ritual) and
     * feat-4380 (Stonebound, prereq Stonebound Dedication). They slugify identically, so whichever the
     * dedup or the idmap happens to name wins — and Heroes Heaven's Living Monolith feat was getting
     * the Stonebound one's prerequisites. Same shape as the Death from Above bug.
     *
     * Heroes Heaven records the archetype; so do the Archives, in `data.archetype`. When they agree,
     * that beats every other selection rule.
     */
    const pickByArchetype = () => {
      const want = oldMap[s]?.archetype;
      if (!want) return null;
      const cands = allByBucket[bucket]?.[s] ?? [];
      if (cands.length < 2) return null;
      return cands.find((d) => (d?.data?.archetype ?? []).some((a) => slug(a) === want)) ?? null;
    };

    const fallback = pickByArchetype() ?? newMap[s].rec;
    const mappedDoc = pickByArchetype() ?? docById.get(preferBase(mapDocFor(bucket, s), s));
    /*
     * …AND THE MAP'S DOC HAS TO BE A DOCUMENT OF THIS NAME.
     *
     * The map exists to separate two documents that SHARE a slug (Death from Above, Stone Blood), so
     * inside this loop — where a document of this name provably exists — a row naming a differently
     * named page is a stale row, not a disambiguation. And the map is stale by construction on the run
     * that first sees a rename: build-map.mjs runs AFTER this file, so map.json still holds the last
     * chain's answer.
     *
     * Measured 2026-09-23: AoN renamed feat-7201 "Irrepressible (Ganzi)" to "Irrepressible
     * (Nephilim)". The map still said `irrepressible-nephilim -> feat-4469`, which is the level-9
     * HALFLING Irrepressible, so the record came back as a halfling feat eight levels above the
     * nephilim one it had always been — and, because used-docs.json feeds build-map.mjs, the next run
     * wrote that answer back into the map. Two slugs change with this guard in place:
     * `feats/irrepressible-nephilim` (-> feat-7201, the nephilim feat) and
     * `feats/incredible-familiar-animist` (-> feat-9420 "Incredible Familiar (Animist)" instead of
     * feat-5004 "Incredible Familiar"). preferBase() only ever hops to a document of the SAME name,
     * so the family-summary rebind is unaffected.
     */
    const mapNamesThisSlug = !mappedDoc || slug(mappedDoc.name) === s;
    const mapped = mappedDoc && mapNamesThisSlug && !(mappedDoc.exclude_from_search === 1 && fallback.exclude_from_search !== 1)
      ? mappedDoc
      : null;
    if (mappedDoc && !mapNamesThisSlug) mapRenamed++;
    const joined = mapped ?? fallback;
    /*
     * …and THEN the newest printing of whatever the join landed on. Owner, 2026-09-12: "we cant be
     * using old data (not to be confused with pre remaster and after remster data)" — where the SAME
     * thing was reprinted in a newer book the record takes the reprint WHOLE: facets, text, edition,
     * and therefore the AST page below. The pairing is stated by the documents themselves
     * (`data.legacy_id` / `data.remaster_id`), never guessed from a name.
     *
     * Exception 1 — an overlay `aonId` ruling — is honoured because a pinned record keeps its own
     * aonId through the AST resolution below and stamp-aonid.mjs re-applies the authored rows last.
     * Exception 2 — the reprint already ships as a record of its own — is `hasSlug`: repointing there
     * would collapse two records onto one page, which is a merge decision for the owner.
     *
     * NAMES: the reprint's display name is adopted, through the existing "adopt only the new canonical
     * NAME" boundary in overlayContent — the id (slug) never changes, so overlay rows, tests and saved
     * characters keep resolving. Measured on this repoint: 28 of the 384 change, and every one of them
     * is the Archives' own title-casing of the reprint heading ("Bathe in Blood" -> "Bathe In Blood",
     * "Fulu of the Drunken Monkey" -> "Fulu Of The Drunken Monkey"). Left as the Archives print it:
     * `data.legacy_name` is not a better source (it re-cases in BOTH directions — "Air Cartridge
     * Firing System" -> "…firing system"), so a casing repair would be a lane of its own, not part of
     * this rule.
     */
    const rep = repointDoc(reprints, joined?.id, s, hasSlug);
    const rec = (rep && docById.get(rep)) || joined;
    if (mapped && mapped !== fallback) mapCorrected++;
    if (rec !== joined) repointed++;
    if (rec?.id) (usedDocs[bucket] ??= {})[s] = rec.id;
    const old = oldMap[s];
    if (old) { out[s] = { ...old, ...overlayContent(rec, old, bucket, shippedCore[bucket]?.[s]?.name), id: s, edition: rec.edition }; overlaid++; }
    else if (REFERENCE_BUCKETS.has(bucket)) { const fr = deriveReference(s, rec); if (fr) { out[s] = fr; added++; } else deferred++; }
    else if (FRESH_BUCKETS.has(bucket)) { const fr = deriveFresh(bucket, s, rec); if (fr) { fr.edition = rec.edition; out[s] = fr; added++; } else deferred++; }
    else deferred++;
  }
  // 2. keep old records with no new match (renames/curated/treasure) so nothing referenced disappears.
  //    If an orphan is the superseded (renamed) half of a remaster change AND its replacement is present,
  //    mark it edition:'superseded' — hidden from pickers, but still resolvable for old character refs.
  for (const s in oldMap) {
    if (s in out) continue;
    const replacement = supers[s];
    /*
     * THE RECORD'S OWN PAGE, EVEN WHEN THAT PAGE IS A PRINTING AoN HAS REPLACED.
     *
     * `prunedBest` (see its declaration) holds the superseded document of this exact name. The pick
     * above dropped it, but desk #158 keeps the RECORD — so without this the record is built from the
     * Foundry reference while `aonId`, the AST page and `remasteredAs` all say it is that document.
     * That is not a cosmetic disagreement: it is how `spells/summon-kaiju` lost the Conjuration trait
     * and the level its page prints the moment AoN added `superseded_by` to spell-1009.
     *
     * NOT the general "overlay every orphan" idea rejected below: the document here is the one whose
     * NAME this record already answers to and whose id it is already stamped with, so nothing is being
     * guessed at and no curated near-duplicate is touched (an `aon-` twin has no document of its own
     * name). `edition` is deliberately NOT taken from it — the shipped-twin ruling decides that later,
     * in stamp-aonid.mjs.
     */
    const pdoc = REFERENCE_BUCKETS.has(bucket) ? null : prunedBest[bucket]?.[s]?.rec;
    const base = pdoc
      ? { ...oldMap[s], ...overlayContent(pdoc, oldMap[s], bucket, shippedCore[bucket]?.[s]?.name), id: s }
      : oldMap[s];
    if (pdoc) { fromPruned++; (usedDocs[bucket] ??= {})[s] = pdoc.id; }
    if (replacement && replacement in out) { out[s] = { ...base, edition: 'superseded' }; superseded++; }
    /*
     * A KEPT ORPHAN is left exactly as it is. Overlaying Archives facets onto orphans was tried and
     * REVERTED: it brought 1,897 more records under Archives sourcing but broke four tests, because an
     * orphan is usually an orphan on purpose — a curated near-duplicate, an `aon-` scrape twin, or a
     * deliberate rename that the app hides or reshapes. `test/aon-dedupe.test.ts`,
     * `test/grade-spelling-duplicates.test.ts` and `test/granted-actions.test.ts` all encode that
     * curation. If this is revisited, it needs to respect those, not bulldoze them.
     */
    else { out[s] = base; orphanKept++; }
  }
  /*
   * 3. A KEY THE LAST RUN SHIPPED DOES NOT VANISH BECAUSE THE ARCHIVES MOVED ITS PAGE.
   *
   * Step 2 keeps a slug alive only when the FOUNDRY reference has it. A record with no Foundry
   * ancestor takes its key from the document's own name, and then two ordinary Archives events delete
   * it outright — with it, the feat or item on a saved character's sheet:
   *
   *   · A RENAME. feat-7201 "Irrepressible (Ganzi)" became "Irrepressible (Nephilim)"; feat-9271's
   *     "Guding Retort" typo was corrected to "Guiding Retort"; equipment-3499 "Mythic Resilent" to
   *     "Mythic Resilient". The same page now answers to another key, so this one is kept
   *     `superseded` — resolvable, never offered, so nothing is pickable twice.
   *   · A REPRINT. The document gained `superseded_by` and was pruned, and desk #158's "keep both,
   *     mark the old one legacy" had nothing to keep, because the record only ever existed as a fresh
   *     one. `items/universal-solvent` and its three variants, `feats/azata-magic`,
   *     `feats/invigorating-mercy`, `feats/elucidating-mercy`, `items/shadow-essence`,
   *     `items/fulus-of-concealment` and `spells/efficient-apport` all disappeared that way on
   *     2026-09-23 while their reprints shipped beside them. The record is carried through exactly as
   *     the last chain agreed it; stamp-aonid.mjs re-applies `legacy` + `remasteredAs` after this.
   *
   * Bounded by the document still EXISTING and its successor still SHIPPING in this bucket: a page the
   * Archives really delete, or one whose replacement we do not carry, is not resurrected here.
   */
  for (const s in (shippedCore[bucket] ?? {})) {
    if (s in out) continue;
    /* A record step 4 below CREATED is step 4's to make again or not — it re-creates every page still
     * missing. Reviving it here kept one step 4 had stopped making: the first run created Keep Pace
     * from the APG page as well as from its Player Core 2 reprint, and this branch carried the APG
     * copy on as "the legacy half of a reprint" — which then answered for the reprint's page, so step 4
     * stopped making the Player Core 2 record instead. Known by the last run's list, and by step 4's
     * own key shape `<page slug>-<book slug>` (a list that no longer names it cannot recall it; the
     * LEFTOVER check in scripts/player-coverage-check.mjs measured that shape on no other record). */
    if (prevPlayerCreated[bucket]?.[s] || prevArchiveCreated[bucket]?.[s]) continue;
    const was = shippedFull(bucket, s);
    const d = was?.aonId ? docById.get(String(was.aonId)) : null;
    if (!d) continue;
    if (s === `${slug(d.name)}-${slug(d.book)}`) continue;
    /*
     * A DISAMBIGUATED KEY IS NOT A RENAME. `<document slug>-<class id>` is the shape this database
     * already uses to give one class its own copy of a feature every class prints under the same name
     * — `arcane-spellcasting-magus`, `spell-repertoire-bard`, `medium-armor-expertise-inventor`. The
     * document is still called "Weapon Expertise", so the bare test below reads the suffix as "the page
     * now answers to another key" and stamps the record `superseded`.
     *
     * That is not cosmetic: `applyEditionFilter` drops `superseded` from the Builder's content ALWAYS,
     * whatever the "Hide legacy data" toggle says, so `levelGrants` falls back to `?? f.featureId` and
     * the class table prints a RAW SLUG with no Details button. Measured on the 17 per-class rows built
     * for the summoner, necromancer and runesmith: a level-1 runesmith's page read
     * `shield-block-runesmith`. The magus's 12 escaped only because their own pages are remaster-era
     * and they never reached this branch.
     *
     * The test is the document's slug being a PREFIX of the key, which no rename in this corpus
     * produces: "Guding Retort" -> "Guiding Retort", "Mythic Resilent" -> "Mythic Resilient" and
     * "Irrepressible (Ganzi)" -> "Irrepressible (Nephilim)" all change a letter inside the name, never
     * append to it. So it needs no list of class ids and cannot go stale when a class is added.
     */
    const disambiguated = s.startsWith(`${slug(d.name)}-`);
    const renamedTo = slug(d.name) !== s && !disambiguated ? slug(d.name) : null;
    const replacedBy = d.superseded_by ? idMap[d.superseded_by]?.slug : null;
    /*
     * …AND THE PROSE, whichever way it has to come back.
     *
     * `shippedFull` rejoins the text the split moved out, which is enough from the run after this one
     * on. It is not enough for the twenty records the run that introduced this step already shipped
     * empty — there is nothing left to rejoin — so a record that comes back without prose takes it
     * off the document it names, through the same reader deriveFresh uses for a new record.
     */
    const revivedDesc = was.description ? null : plainDesc(d.ast);
    const revived = revivedDesc ? { ...was, description: revivedDesc } : was;
    if (renamedTo) {
      if (!(renamedTo in out)) continue;
      out[s] = { ...revived, edition: 'superseded' };
    } else if (replacedBy && replacedBy !== s && replacedBy in out) {
      out[s] = { ...revived };
    } else continue;
    renamedKept++;
  }
  db[bucket] = out;
  stats[bucket] = { total: Object.keys(out).length, overlaid, added, deferred, orphanKept, superseded, mapCorrected, repointed, fromPruned, renamedKept, mapRenamed };
}

/*
 * 4. A PLAYER PAGE NO RECORD ANSWERS FOR BECOMES A RECORD (owner, 2026-09-24: "the players' missing
 * data is more important — add it").
 *
 * Which pages: exactly those scripts/player-coverage-check.mjs would call MISSING — the same rule, from
 * scripts/lib/player-coverage.mjs, run here in its importer view (a record THIS STEP created on the last
 * run — scripts/migration/out/player-created.json — does not count as the page being present). Hidden and
 * allow-listed pages are never created. Why this is not a wider FRESH_BUCKETS: scripts/lib/player-create.mjs.
 *
 * Keys: the page's slug; when another record already holds it (two different "Zombie Horde" feats) the
 * page's book is appended — `zombie-horde-impossible-magic` — and the shipped older record keeps its key.
 * A class option takes the id its class's option list already gives it, so the option and the record
 * stay one pick. Content only: the page's text, traits, rarity, level, prerequisites, action cost, book
 * and edition; aonId and the display tree follow through used-docs.json and the ast pass below. The
 * mechanics are the parity batch's — except a BACKGROUND's, which the Archives state as structured
 * fields (its two boosts, its trained skill and Lore, its skill feat) and every shipped background
 * already takes through `backgroundFacets` (scripts/lib/aon-facets.mjs). A created background left
 * without them handed a player two boosts, two trainings and a skill feat fewer than the page prints.
 *
 * Rarity and edition follow the LIVE page where it has been read (scripts/data/live-pages.json — the
 * export says common for two Uncommon class options and neutral for Legacy Content pages);
 * scripts/player-coverage-check.mjs fails while a created record's page is unread.
 */
const playerCreated = {}; // bucket -> key -> { doc, classId?, groupId? }
{
  const livePages = loadLivePages();
  const ALLOW = 'scripts/data/player-coverage-allow.json';
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const { create, noCreator } = creationPlan({ docs: docById, reprint: reprints, shippedCore, shippedDesc, allow, prevCreated: prevPlayerCreated });
  const unmade = noCreator.map((d) => `${d.id} ${d.category} "${d.name}": no creator for this kind`);
  for (const { doc, bucket } of create) {
    const map = (db[bucket] ||= {});
    const subclass = bucket === 'classFeatures' && doc.category !== 'class-feature';
    const link = subclass ? subclassLink(doc, shippedCore) : null;
    if (link?.error) { unmade.push(`${doc.id} "${doc.name}": ${link.error}`); continue; }
    let key = link?.optionId ?? slug(doc.name);
    if (map[key]) key = `${key}-${slug(doc.book)}`;
    if (map[key]) { unmade.push(`${doc.id} "${doc.name}": key ${key} is taken too`); continue; }
    const traits = normTraits(doc.traits);
    const base = { id: key, name: doc.name, traits, rarity: RARITY.has(doc.rarity) ? doc.rarity : 'common' };
    const book = mapBook(doc.book); if (book) base.source = { book };
    const desc = plainDesc(doc.ast); if (desc) base.description = desc;
    let rec;
    if (FRESH_BUCKETS.has(bucket)) rec = deriveFresh(bucket, key, doc);
    else if (bucket === 'backgrounds') rec = { ...base, abilityBoosts: [], ...backgroundFacets(doc, (u) => resolveBaseItem(u, 'featSlug')) };
    else if (bucket === 'heritages') {
      const ancestryId = ancestryOf(doc.name, db.ancestries);
      if (!ancestryId) { unmade.push(`${doc.id} "${doc.name}": no single ancestry's name ends this heritage's name`); continue; }
      rec = { ...base, ancestryId, versatile: false };
    } else if (link) {
      rec = { ...base, traits: [...new Set([...traits, ...link.traits])], level: link.level, actionCost: link.actionCost, ...(link.otherTags.length ? { otherTags: link.otherTags } : {}) };
      if (rec.actionCost == null) delete rec.actionCost;
    } else if (bucket === 'classFeatures') {
      const ac = parseActionCost(doc.action_cost);
      rec = { ...base, level: clamp(num(doc.level, 1), 1, 20), ...(ac ? { actionCost: ac } : {}) };
    }
    if (!rec) { unmade.push(`${doc.id} "${doc.name}": the ${bucket} builder declined it`); continue; }
    const read = livePages[doc.id];
    if (RARITY.has(read?.rarity)) rec.rarity = read.rarity;
    rec.edition = liveEdition(doc.edition, read);
    map[key] = rec;
    (usedDocs[bucket] ??= {})[key] = doc.id;
    (playerCreated[bucket] ??= {})[key] = { doc: doc.id, ...(link?.classId ? { classId: link.classId, groupId: link.groupId } : {}) };
    // A link to this page used to resolve to the OTHER record of its name — point it at its own.
    if (!idMap[doc.id] || (idMap[doc.id].bucket === bucket && idMap[doc.id].slug !== key)) idMap[doc.id] = { bucket, slug: key };
  }
  const n = Object.values(playerCreated).reduce((a, m) => a + Object.keys(m).length, 0);
  console.log(`player pages created: ${n} (${Object.entries(playerCreated).map(([b, m]) => `${b} ${Object.keys(m).length}`).join(', ') || 'none'})`);
  if (unmade.length) console.warn(`!! ${unmade.length} missing player page(s) NOT created — scripts/player-coverage-check.mjs will fail on them:\n  ${unmade.join('\n  ')}`);
}

/*
 * 5. EVERY OTHER PAGE NO SEARCHABLE RECORD ANSWERS FOR BECOMES A RECORD (owner, 2026-09-24: "every record
 * of PF2e needs to be accessible to the GM in the tracker's search").
 *
 * Which pages: exactly those scripts/archive-coverage-check.mjs would call MISSING among the non-player
 * categories — the rule in scripts/lib/archive-coverage.mjs, newest printing only, never an AoN-hidden
 * page, a nameless stub, an allow-listed page or a bestiary kind (creatures and hazards are the tracker's
 * public/data files). Presence is read off what the Search will reach: the last chain's artefact AND this
 * run's records by the page each was built from (usedDocs), minus what this step made last time.
 *
 * Where: a kind with a glossary bucket (rules, sidebar, categoryPage, disease, …) gets its record there,
 * in that bucket's shape plus the book — the reason the page is missing is almost always that another
 * page of its name holds the slug, and the book is what tells the two apart in the Search. Every other
 * kind — no bucket at all (article, class-sample, creature-family, …) or a bucket a picker reads
 * (actions, vehicles) — goes to the ONE plain bucket `reference`: { id, name, kind (the Archives
 * category), source.book, level?, traits?, rarity?, edition }, aonId by the usual stamp. No plain
 * description: the page's display tree IS its text, written to public/ast/<bucket>.json.gz below and
 * fetched only when the popup opens (the phone rule — nothing here grows core-descriptions.json).
 *
 * Every created record also carries `parentPage` when the Archives file the page under another one
 * (parentPageOf), and its book page (`printedPage`): a book prints twelve "Key Terms" sidebars, one per
 * class, and two "Backgrounds" rules pages in one chapter, and the GM Search's detail line
 * (src/integration/hostSearchRecords.ts) is the only thing that tells those rows apart.
 */
// The name of the document that OWNS a url (`class-2` for /Classes.aspx?ID=2 — not the sidebars and
// class features printed on that page, which carry the same url).
const pageNameAt = (url) => {
  const id = /[?&]ID=(\d+)/i.exec(String(url ?? ''))?.[1];
  const own = id ? (byUrl.get(String(url).toLowerCase()) ?? []).find((d) => d.endsWith(`-${id}`)) : null;
  return own ? String(docById.get(own)?.name ?? '').trim() : '';
};
/* The book a step-5 row names is its page's own Source line, spelt the app's way only where the app's
 * spelling names that same book and printing (namesBook): book-names.json files a Bestiary 3 creature
 * family under Monster Core 2, and the Search row is what tells the GM which page it opens. These
 * buckets feed no source filter (src/rules/sources.ts CHOOSABLE_SOURCE_MAPS). */
const pageBook = (book) => {
  const b = String(book ?? '').trim();
  const hh = mapBook(b);
  return !hh || namesBook(hh, b) ? hh : /^Pathfinder /i.test(b) ? b : `Pathfinder ${b}`;
};
const archiveCreated = {}; // bucket -> key -> { doc }
const archivePages = new Map(); // doc id -> page, display tree kept
{
  const ALLOW = 'scripts/data/archive-coverage-allow.json';
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
  const cats = nonPlayerCategories(DATA).filter((c) => !BESTIARY_CATEGORIES.has(c));
  for (const [id, d] of docById) if (cats.includes(d.category)) archivePages.set(id, archivePage(d, true));
  // The categories the load loop above skips (REF_SKIP) are read here, and only these.
  for (const [id, p] of loadPages(DATA, cats.filter((c) => REF_SKIP.has(c)), true)) archivePages.set(id, p);
  const view = {};
  for (const [b, rows] of Object.entries(shippedCore)) if (rows && typeof rows === 'object' && !Array.isArray(rows)) view[b] = { ...rows };
  for (const [b, rows] of Object.entries(db)) {
    for (const [k, r] of Object.entries(rows ?? {})) {
      if (r?.name) (view[b] ??= {})[`${k}#this-run`] = { name: r.name, source: r.source, aonId: usedDocs[b]?.[k] ?? r.aonId };
    }
  }
  const skipKeys = new Set(Object.entries(prevArchiveCreated).flatMap(([b, m]) => Object.keys(m ?? {}).flatMap((k) => [`${b}/${k}`, `${b}/${k}#this-run`])));
  for (const page of archivePlan({ pages: archivePages, core: view, desc: shippedDesc, allow, skipKeys })) {
    const bucket = createBucket(page.category, db);
    const map = (db[bucket] ||= {});
    const key = recordKey(page, (k) => !!map[k]);
    const traits = normTraits(page.traits);
    const book = pageBook(page.book);
    const parentPage = parentPageOf(page, pageNameAt);
    map[key] = {
      id: key, name: page.name,
      ...(bucket === REFERENCE ? { kind: page.category } : {}),
      ...(parentPage ? { parentPage } : {}),
      ...(page.pg ? { printedPage: page.pg } : {}),
      ...(traits.length ? { traits } : {}),
      ...(RARITY.has(page.rarity) && page.rarity !== 'common' ? { rarity: page.rarity } : {}),
      ...(bucket === REFERENCE && typeof page.level === 'number' ? { level: page.level } : {}),
      ...(book ? { source: { book } } : {}),
      edition: page.edition,
    };
    (usedDocs[bucket] ??= {})[key] = page.id;
    (archiveCreated[bucket] ??= {})[key] = { doc: page.id };
    /* A link to this page resolved to nothing, or to the record that holds its slug. It moves to the new
     * record only from nothing, or from a record of ANOTHER name that merely shares the slug (High Seas
     * "Attack!" answered Player Core's "Attack" links). A same-named record keeps its links: AoN auto-links
     * "level" to Kingmaker's page and "hit points" to the Core Rulebook's, and the app has always sent
     * them to its current record — moving them repointed 53,797 links (measured 2026-09-25). */
    const was = idMap[page.id];
    const wasName = was ? String(db[was.bucket]?.[was.slug]?.name ?? '').toLowerCase() : '';
    if (!was || (was.bucket === bucket && wasName !== page.name.toLowerCase())) idMap[page.id] = { bucket, slug: key };
  }
  /*
   * …and the records already there. A glossary record ships as {id, name, edition} (deriveReference: no
   * book), so the Search listed it with no detail line — "Hero Points" led with a bare row that opens War
   * of Immortals' alternate mythic rules, not the core rule, and "Scarlet Fever · DISEASE" named no book at
   * all (2,519 bare rows in rules, sidebar, categoryPage and disease, measured 2026-09-25). Every record of
   * LABELLED_BUCKETS carries what a created record carries: its book and the page it is filed under, off
   * its own page. In any other bucket holding a created record, only one whose name another record of
   * that bucket carries, or a created record of any bucket, does. scripts/archive-coverage-check.mjs
   * (UNLABELLED) fails on one without its book.
   */
  const lower = (r) => (r?.name ? String(r.name).toLowerCase() : '');
  const createdNames = new Set(Object.entries(archiveCreated).flatMap(([b, m]) => Object.keys(m).map((k) => lower(db[b][k]))));
  for (const bucket of new Set([...LABELLED_BUCKETS, ...Object.keys(archiveCreated)])) {
    const rows = db[bucket] ?? {};
    const named = new Map();
    for (const r of Object.values(rows)) named.set(lower(r), (named.get(lower(r)) ?? 0) + 1);
    for (const [k, r] of Object.entries(rows)) {
      if (!lower(r) || r.source?.book) continue;
      if (!LABELLED_BUCKETS.has(bucket) && named.get(lower(r)) < 2 && !createdNames.has(lower(r))) continue;
      const page = archivePages.get(String(usedDocs[bucket]?.[k] ?? r.aonId ?? ''));
      if (!page) continue;
      const book = pageBook(page.book);
      const parentPage = parentPageOf(page, pageNameAt);
      rows[k] ={ ...r, ...(parentPage ? { parentPage } : {}), ...(book ? { source: { ...r.source, book } } : {}) };
    }
  }
  const n = Object.values(archiveCreated).reduce((a, m) => a + Object.keys(m).length, 0);
  console.log(`archive pages created: ${n} (${Object.entries(archiveCreated).map(([b, m]) => `${b} ${Object.keys(m).length}`).join(', ') || 'none'})`);
}

// carry the hand-authored buckets over unchanged
for (const bucket of CARRY_WHOLESALE) {
  if (cur[bucket]) { db[bucket] = cur[bucket]; stats[bucket] = { total: Object.keys(cur[bucket]).length, carried: true }; }
}
// MODES had the problem stances already solved, and worse: CARRY_WHOLESALE copies from REF, which is
// the FROZEN Foundry backup, and that predates the modes work entirely — so every regen silently
// emptied the bucket of all 428 item and toggle modes, and they were only ever coming back because
// somebody re-ran an apply script afterwards. The two source files are authoritative and ship in
// DIFFERENT shapes: consumable-modes.json is an ARRAY, toggle-modes.json an id-keyed OBJECT.
{
  const merged = {};
  if (existsSync('scripts/data/consumable-modes.json'))
    for (const m of JSON.parse(readFileSync('scripts/data/consumable-modes.json', 'utf8'))) merged[m.id] = m;
  if (existsSync('scripts/data/toggle-modes.json'))
    for (const [id, m] of Object.entries(JSON.parse(readFileSync('scripts/data/toggle-modes.json', 'utf8')))) merged[id] = { ...m, id };
  if (Object.keys(merged).length) {
    db.modes = { ...(db.modes ?? {}), ...merged };
    stats.modes = { total: Object.keys(db.modes).length, carried: true };
  }
}
// scripts/data/stances.json is the authoritative hand-authored stance/form table — merge it over the
// carried bucket so new stances/forms (Ursine Avenger Form, …) land without hand-editing core.json.
if (existsSync('scripts/data/stances.json')) {
  const st = JSON.parse(readFileSync('scripts/data/stances.json', 'utf8'));
  db.stances = { ...(db.stances ?? {}), ...st };
}
// Stamp every stance/form with id (= its slug) and name (the source feat/action/feature's name, else a
// titleized slug) so the content invariants hold and the UI has a label without a lookup.
if (db.stances) {
  const titleize = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  for (const [id, def] of Object.entries(db.stances)) {
    def.id = id;
    def.name = def.name || db.feats?.[id]?.name || db.actions?.[id]?.name || db.classFeatures?.[id]?.name || titleize(id);
  }
  stats.stances = { total: Object.keys(db.stances).length, carried: true };
}
// any current bucket we didn't touch at all (safety): carry it
for (const bucket in cur) {
  if (!(bucket in db)) { db[bucket] = cur[bucket]; stats[bucket] = { total: Object.keys(cur[bucket] || {}).length, carriedSafety: true }; }
}

// ------------------------------------------------------------------ re-apply HH's curated fixes (win over facets)
// scripts/data/fixes.json corrects inaccurate entries; re-applied AFTER the new-data facets so a deliberate HH
// correction (e.g. Uplifting Winds level 12) survives even where the raw AoN facet disagrees (it says 16).
let fixCount = 0;
if (existsSync('scripts/data/fixes.json')) {
  for (const fix of JSON.parse(readFileSync('scripts/data/fixes.json', 'utf8'))) {
    const map = db[fix.category]; if (!map || !fix.field) continue;
    const entry = map[fix.id] || map[slug(fix.name || '')] || Object.values(map).find((e) => e.name === fix.name);
    if (entry) { entry[fix.field] = fix.value; fixCount++; }
  }
}

// Class features a SUBCLASS hands over (scripts/data/subclass-features.json): an oracle mystery brings
// its oracular curse. A curse is in no class's `features` list and is not a subclass option itself, so
// without this ownedFeatureIds has no route to it and everything on the record renders for nobody.
// Patches an EXISTING option, which class-extras.json cannot do — that one only appends new ones.
if (existsSync('scripts/data/subclass-features.json')) {
  const spec = JSON.parse(readFileSync('scripts/data/subclass-features.json', 'utf8'));
  let attached = 0;
  for (const [classId, byOption] of Object.entries(spec)) {
    if (classId.startsWith('_')) continue; // `_why` / `_source` prose
    const opts = db.classes[classId]?.subclass?.options;
    if (!opts) { console.warn(`[import-v2] subclass-features: no class "${classId}" with subclasses — skipped`); continue; }
    for (const [optionId, featureIds] of Object.entries(byOption)) {
      const opt = opts.find((o) => o.id === optionId);
      if (!opt) { console.warn(`[import-v2] subclass-features: ${classId} has no option "${optionId}" — skipped`); continue; }
      for (const missing of featureIds.filter((id) => !db.classFeatures[id])) {
        console.warn(`[import-v2] subclass-features: ${classId}/${optionId} names "${missing}", which is not a class feature — skipped`);
      }
      const live = featureIds.filter((id) => db.classFeatures[id]);
      if (live.length) { opt.featureIds = [...new Set([...(opt.featureIds ?? []), ...live])]; attached += live.length; }
    }
  }
  console.log(`[import-v2] attached ${attached} subclass-granted class feature(s)`);
}

// Mechanical-effect backfill from the full player-effect audit (scripts/data/effect-backfill.json):
// per-id field patches (senses/speeds/innateSpells/focusSpells/passiveEffects/…) extracted from each
// record's rules text and validated by scripts/audit/apply-patches.ts. Applied LAST so every backfilled
// effect survives regeneration regardless of what the facet transcription produced.
//
// A fix may also carry `path`: the steps from the record down to a NESTED object, so one option
// inside a choice group can be patched without restating the whole group. Array steps address by id
// (`id=apparition`), never by index — regeneration reorders options freely and an index would
// silently land on a different apparition. A path that does not resolve is REPORTED, not skipped
// quietly: a typo there produces a record that looks backfilled and isn't.
let backfillCount = 0;
{
  const { applied, unresolved } = applyBackfill(db);
  backfillCount = applied;
  console.log(`[import-v2] applied ${backfillCount} audit effect backfills`);
  if (unresolved.length) console.warn(`[import-v2] !! ${unresolved.length} backfill paths did not resolve:\n  ` + unresolved.join("\n  "));
  // …and only then a created class option into its class's list: a backfill row may set a whole list.
  const appended = appendSubclassOptions(db, playerCreated);
  if (appended) console.log(`[import-v2] appended ${appended} created class option(s) to their class's option list`);
}

/*
 * EVERY RECORD'S BOOK GOES THROUGH THE TABLE'S PRINTING FOLDS — not only the ones built from a document.
 *
 * mapBook runs where a record is derived or overlaid from the Archives. A kept orphan carries the
 * Foundry-era label (actions/binding-vow, backgrounds/wish-for-riches, classFeatures/psychic-weapon-expertise
 * read "Pathfinder Dark Archive" / "Pathfinder Gatewalkers Player's Guide") and a create row carries what was
 * typed (items/mind-weapon, items/mind-smiths-keepsake), so a legacy spelling the table folds (desk #166: a
 * "(Remastered)" printing folds into its own book) escaped it, and the Sources card drew a second row of one
 * book. Round 6 relabelled four of them by hand; the table now answers for all. A SAME-BOOK fold only, and
 * only through a row: the record's spelling has its row in the table (exactly, or by this importer's normBook
 * lookup), a row that changes the title included, since each of those names the same book by its reason
 * (scripts/data/book-names-reasons.json) — foldBookSpellings, scripts/lib/aon-facets.mjs. The GM Search's
 * page rows (LABELLED_BUCKETS) name the page's own printing on purpose
 * (pageBook / namesBook). Widened 2026-09-29 from "(Remastered)" alone: 15 books still reached the Sources
 * card under a second spelling ("Pathfinder Grand Bazaar", a curly "Player’s Guide", "Season of Ghosts
 * (Hardcover)" …). import-siege-and-gaps re-applies the overlay after this, so it runs the same pass again.
 * scripts/reprint-check.mjs CHECK 4 fails a choosable record that still escapes.
 */
{
  const folded = foldBookSpellings(db, LABELLED_BUCKETS);
  console.log(`[import-v2] ${folded.length} record(s) outside the Archives' own derivation took the table's spelling of their book`);
}

// ------------------------------------------------------------------ per-bucket ast (lazy-loaded, Step 1)
// Resolve link.to (numeric AoN id) -> "bucket:slug" so the runtime renderer resolves against the content DB
// directly; unresolved targets (unshipped categories: rules/traits/sources/skills/…) become ref:null and
// render as ordinary prose (no dead underline).
//
// A large class of AoN links point at the LEGACY id of a record that was superseded (and therefore pruned
// from idMap), even though the surviving remaster/same-slug record ships. Those would go dead for no good
// reason. resolveTo() redirects them to the live record so archive cross-links stay clickable:
//   1. exact id in idMap -> use it;
//   2. superseded target -> follow the superseded_by chain to a live winner (handles renames);
//   3. else if the superseded record's own slug still ships (kept orphan) -> link to that.
function resolveTo(to) {
  const hit = idMap[to];
  if (hit) return hit.bucket + ':' + hit.slug;
  let info = supIdInfo[to], guard = 0;
  while (info && guard++ < 8) {
    const win = idMap[info.by];
    if (win && (db[win.bucket] || {})[win.slug]) return win.bucket + ':' + win.slug;
    info = supIdInfo[info.by];
  }
  // the pruned record's own slug may survive as a kept orphan in its bucket
  const own = supIdInfo[to];
  if (own && (db[own.bucket] || {})[own.slug]) return own.bucket + ':' + own.slug;
  return null;
}
function resolveAst(node) {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') {
      out.ref = resolveTo(node.to); // resolved "bucket:slug", or null = unshipped/unresolvable target
      out.to = node.to;
    } else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
}
mkdirSync('public/ast', { recursive: true });
const astStats = {};
// preference order when a slug has ast in several buckets (a description-opener with only a title
// resolves to the first bucket here that carries it).
const BUCKET_PRIORITY = ['conditions', 'actions', 'feats', 'classFeatures', 'spells', 'items', 'deities',
  'ancestries', 'heritages', 'backgrounds', 'languages', 'familiarAbilities', 'animalCompanions', 'companionSpecializations', 'vehicles', 'siegeWeapons'];
/*
 * …and the other end of the same list: buckets that may claim a slug only when NOBODY else does.
 *
 * Everything not named in either list falls in the middle in export-directory order, which is
 * alphabetical — so a category that arrives late in the alphabet loses every shared slug to one that
 * arrives early, for no reason but its name. The 2026-09-07 export added grim-fascination, whose four
 * pages are Blood / Bone / Flesh / SPIRIT: alphabetically it beats `instinct`, and "spirit" — the
 * barbarian instinct, and the common link target — would have moved to a necromancer's fascination.
 * Its own page is still reachable, by its explicit "grimFascination" key.
 *
 * These three are the right buckets to demote: 12 pages between them, every one a class sub-option
 * that content links to by its full name, never by the bare word.
 */
const BUCKET_LAST = ['grimFascination', 'fatalMethod', 'follower'];
const astIndex = {}; // slug -> preferred bucket
// `reference` holds step 5's records only, so it is in no category's pick — its trees come from the loop below.
for (const bucket of [...AON_BUCKETS, REFERENCE]) {
  const newMap = bestByBucket[bucket] || {};
  const astOut = {};
  for (const s in newMap) {
    if (!(s in (db[bucket] || {}))) continue;
    /* The AST must be the SHIPPED record's OWN page. bestByBucket picks per-slug by edition rank,
     * but the record pipeline ships a DIFFERENT same-name doc whenever the migration map, an
     * archetype match or preferBase() says so — and then the wrong page renders under the right
     * name. Measured on the tracked artefact: items/dragon-pearl is equipment-4011 (Draconic Codex,
     * 9,000 gp, level 16) and shipped the Tian Xia Character Guide page (equipment-3482, 180 gp,
     * level 10); feats/zombie-horde (feat-3654, L20) and feats/death-from-above (feat-7610, L8) are
     * one export refresh away from the same fate.
     *
     * Resolution order, most-authoritative first:
     *   1. the aonId already on the assembled record — only the authored overlay rows
     *      (scripts/data/effect-backfill.json, applied above) can put one there, and an authored row
     *      is a ruling: fix-aonid-collisions.mjs re-applies exactly these at the end of the chain.
     *   2. the aonId on the SHIPPED public/core.json — the provenance the last full chain agreed on.
     *   3. usedDocs — the doc THIS run built the record from. That is mapDocFor() (the verified join,
     *      scripts/migration/out/map.json) after preferBase, pickByArchetype and the hidden-doc guard
     *      have corrected it, recorded a few hundred lines above; build-map.mjs reads the same file
     *      first, so this is what stamp-aonid.mjs will stamp as aonId later in this very run.
     *   4. nothing known -> the old edition-rank pick, unchanged.
     */
    /*
     * …and step 2 above (the SHIPPED aonId) is the provenance of the LAST chain, which is exactly what
     * the newest-printing rule repoints. Hop it, unless the record is pinned by an overlay ruling —
     * only an authored row can put an aonId on an assembled record, and a ruling is not overridden.
     * Step 3 (usedDocs) is already the repointed doc, so hopping it again is a no-op; that is what
     * makes the page, the record and the stamp land on the SAME document in ONE run.
     */
    /*
     * usedDocs BEFORE the shipped aonId, not after.
     *
     * usedDocs is the document THIS run built the record from, and it is what build-map.mjs reads
     * first and stamp-aonid.mjs therefore writes as `aonId` later in this very run. The shipped id is
     * the LAST chain's answer, so putting it first makes the page lag the record by one whole run
     * whenever the record's document changes for any reason other than a reprint — which the repoint
     * below is the only thing that can undo. Measured 2026-09-23: `feats/incredible-familiar-animist`
     * (feat-5004 -> feat-9420, the migration-map guard) and ten Treasure Vault weapons and armours the
     * refresh re-joined all rendered the previous document's page, and scripts/ast-provenance-check.mjs
     * failed on exactly those twelve. The shipped id stays as the fallback for a KEPT ORPHAN, which
     * this run built from no document at all.
     */
    const pinnedId = db[bucket][s]?.aonId;
    const joinedId = pinnedId ?? usedDocs[bucket]?.[s] ?? shippedCore[bucket]?.[s]?.aonId;
    const ownId = pinnedId ? pinnedId
      : (repointDoc(reprints, joinedId && String(joinedId), s, (k) => k in (db[bucket] || {})) ?? joinedId);
    const own = ownId ? docById.get(String(ownId)) : null;
    const rec = (own?.ast ? own : null) ?? newMap[s].rec;
    // PROVENANCE: the archive document this page was built from, so a guard can be exact rather than
    // fuzzy (scripts/ast-provenance-check.mjs). Unknown keys on a tree root are ignored by the
    // renderer (src/sheet/AstRenderer.tsx switches on `t`) and preserved by every resolveAst copy.
    if (rec.ast) { astOut[s] = resolveAst(rec.ast); if (rec.id) astOut[s].aon = rec.id; }
  }
  // Step 4's records: their page is not the per-slug pick (a suffixed key, or a class option built
  // from another category's document), so the loop above never reaches them.
  for (const [s, { doc }] of Object.entries(playerCreated[bucket] ?? {})) {
    const d = docById.get(doc);
    if (d?.ast) { astOut[s] = resolveAst(d.ast); astOut[s].aon = doc; }
  }
  // …and step 5's, the same way (a suffixed key, or a category the load loop never reads).
  for (const [s, { doc }] of Object.entries(archiveCreated[bucket] ?? {})) {
    const d = archivePages.get(doc);
    if (d?.ast) { astOut[s] = resolveAst(d.ast); astOut[s].aon = doc; }
  }
  const json = JSON.stringify(astOut);
  writeFileSync('public/ast/' + bucket + '.json', json);
  // Ship the GZIPPED bucket (the raw JSON is far too large for static-host per-file limits — items is
  // ~36 MB raw). The runtime loader (astStore.ts) fetches + decompresses the .gz; only the .gz is committed.
  const gz = gzipSync(json, { level: 9 });
  writeFileSync('public/ast/' + bucket + '.json.gz', gz);
  astStats[bucket] = { records: Object.keys(astOut).length, mb: (json.length / 1e6).toFixed(1), gzMb: (gz.length / 1e6).toFixed(2) };
}
const INDEX_ORDER = [
  ...BUCKET_PRIORITY,
  ...AON_BUCKETS.filter((b) => !BUCKET_PRIORITY.includes(b) && !BUCKET_LAST.includes(b)),
  ...BUCKET_LAST.filter((b) => AON_BUCKETS.includes(b)),
];
for (const bucket of INDEX_ORDER) {
  const newMap = bestByBucket[bucket] || {};
  for (const s in newMap) {
    if (!(s in astIndex) && newMap[s].rec.ast && (s in (db[bucket] || {}))) astIndex[s] = bucket;
  }
}
for (const [bucket, m] of Object.entries(playerCreated)) for (const s of Object.keys(m)) if (!(s in astIndex)) astIndex[s] = bucket;
// Step 5's records are NOT indexed: they open by key only (scripts/lib/archive-coverage.mjs createdRefs).
writeFileSync('public/ast-index.json', JSON.stringify(astIndex));

// ------------------------------------------------------------------ write + report
if (!existsSync(BACKUP)) copyFileSync(OUT, BACKUP); // preserve the pristine reference exactly once
/*
 * `grantsActions` must name a record that IS an action — the encounter list is built from action
 * records, and a link to a passive one contributes nothing (test/granted-actions.test.ts asserts it).
 * The Archives' `<document level="2" id="action-N" />` embeds are factual, but three of them point at
 * pages Heroes Heaven models as passive records (`call-companion`, `influence-rumor`,
 * `call-follower`). Filtered here, at the end, because the actions bucket does not exist yet while the
 * feats bucket is being built.
 */
{
  const REAL = new Set(['actions', 'reaction', 'free', 'variable']);
  let dropped = 0;
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'backgrounds']) {
    for (const rec of Object.values(db[bucket] ?? {})) {
      if (!Array.isArray(rec.grantsActions)) continue;
      const keep = rec.grantsActions.filter((s) => REAL.has(db.actions?.[s]?.actionCost?.type));
      dropped += rec.grantsActions.length - keep.length;
      if (keep.length) rec.grantsActions = keep;
      else delete rec.grantsActions;
    }
  }
  if (dropped) console.log(`grantsActions: dropped ${dropped} link(s) whose target is not an action record`);
}

/*
 * A WAND IS NOT A CONSUMABLE — applied here, at the end, because most of the mistyped records are KEPT
 * ORPHANS (`Arboreal Wand (Rank 2)` and friends are HH's own per-rank variants with no AoN slug of
 * their own), so overlayContent never runs for them. The migration map still knows their doc.
 * Evidence and consequence are documented in aon-facets.mjs.
 */
{
  let fixed = 0;
  for (const [s, rec] of Object.entries(db.items ?? {})) {
    if (rec?.itemType !== 'consumable') continue;
    const doc = docById.get(mapDocFor('items', s));
    const cat = doc?.data?.item_category ?? doc?.item_category;
    if (cat === 'Wands') { rec.itemType = 'equipment'; fixed++; }
  }
  if (fixed) console.log(`itemType: ${fixed} wand(s) re-typed consumable -> equipment (a consumable is destroyed on use; a wand is not)`);
}

/*
 * AMMUNITION PACKS — `packOf` is "the printed Price and Bulk are for this many pieces". See packOf()
 * in aon-facets.mjs for the evidence; the short version is that Arrows are 1 sp and Bulk L for TEN,
 * and without this the app charged 1 sp and counted L per arrow.
 *
 * Applied here, at the end, for the same reason the wand fix above is: two of the sixteen records are
 * KEPT ORPHANS — `aon-spray-pellet` and `aon-practice-targets` are scrape twins with no new-data slug
 * of their own, so overlayContent never runs for them and a facet would never reach them. The
 * migration map still knows their doc (both resolve, to weapon-353 and equipment-1205).
 *
 * The NAME index is the fallback, not the join: map.json is rebuilt by build-map.mjs LATER in the
 * chain, so a pack item that appears in a fresh export has no map row on the run that first imports
 * it. Only pack documents are indexed by name, so the fallback can only ever assert a pack count that
 * some document with that exact name actually prints. scripts/pack-price-check.mjs is the check.
 */
{
  const packByName = new Map();
  for (const doc of docById.values()) {
    const n = packOf(doc);
    if (n && doc?.name) packByName.set(foldName(doc.name).toLowerCase(), n);
  }
  let stamped = 0;
  for (const [s, rec] of Object.entries(db.items ?? {})) {
    if (!rec?.name) continue;
    const n = packOf(docById.get(mapDocFor('items', s))) || packByName.get(foldName(rec.name).toLowerCase()) || 0;
    if (n) { rec.packOf = n; stamped++; }
  }
  console.log(`packOf: ${stamped} item record(s) carry a pack count (${packByName.size} pack name(s) in the export)`);
}

/*
 * PER-DAY ACTIVATIONS — a printed Frequency must leave something for daily preparations to refill.
 *
 * Rest refills any counter flagged `resetsOnRest` (src/rules/itemUses.ts), and a counter exists only
 * where the record carries `counters` or a legacy `frequency`. 146 item records print a Frequency line
 * on an activation block and carry NEITHER, so "abilities that can be used only a certain number of
 * times per day, including magic item uses, are reset" had nothing to act on for any of them.
 *
 * Why they were missed, in order of size:
 *   • a NEW-ONLY record is built by deriveFreshItem() from the export's FLAT fields (level, price,
 *     bulk, traits) and nothing there reads the activation block — the whole of Impossible Magic
 *     arrived that way;
 *   • a KEPT ORPHAN is never overlaid at all, so no facet ever reaches it (the campsite meals);
 *   • frequencyOf() fills the single `frequency` FIELD only, from the record's own variant scope, so a
 *     second activation with a different limit had nowhere to go even when the overlay did run.
 *
 * Applied here, at the end, for the same reason the wand and packOf passes above are — it is the only
 * point all three paths have met — and AFTER the effect backfill, so a curated row is what it reads.
 *
 * The source is the record's OWN description, which is the same text core-descriptions.json ships and
 * scripts/item-frequency-check.mjs reads: the guard and the importer cannot disagree about what a
 * record prints.
 *
 * ADD-ONLY. An existing counter is never rewritten and never dropped: scripts/data/effect-backfill.json
 * carries 640 curated frequency/counter rows, applied just above, and a "correction" here would quietly
 * undo one. Four records print a limit that disagrees with their curated row; both are kept and the
 * guard reports the pair rather than picking a winner.
 *
 * Ceiling: two activations printing the SAME limit collapse to one counter (printedFrequencies is
 * distinct-by-value) — a page prints its Greater/Major siblings' blocks too, so a repeated "once per
 * day" is far more often one activation restated than two pools. Distinct limits stay separate.
 *
 * ⚠ THIS IS NOT THE LAST WORD, and the pass runs a second time for it. import-siege-and-gaps.mjs, the
 * very next step of `npm run data`, re-applies every effect-backfill.json row over the whole database,
 * and a `counters` row there is an ABSOLUTE assignment: it restored bravery-baldric's curated 2-charge
 * pool and discarded the per-hour counter added here, so the guard went red on a chain that had just
 * run green in isolation. The second call is at the end of that script, after its re-apply.
 */
{
  const { filled, gained } = fillFrequencyCounters(db.items);
  console.log(`item uses: ${filled} item record(s) gained ${gained} counter(s) from a printed Frequency line (rest had nothing to refill on them)`);
}

writeFileSync(OUT, JSON.stringify(db));
writeFileSync(IDMAP_OUT, JSON.stringify(idMap));
// Provenance for the migration: the doc each record was ACTUALLY built from. Not shipped to the app.
try {
  mkdirSync('scripts/migration/out', { recursive: true });
  writeFileSync('scripts/migration/out/used-docs.json', JSON.stringify(usedDocs, null, 1));
  writeFileSync('scripts/migration/out/action-cost-notes.json', JSON.stringify(actionNotes, null, 1));
  // The records step 4 created: import-siege-and-gaps.mjs re-appends their class options after its own
  // backfill re-apply (see appendSubclassOptions).
  writeFileSync('scripts/migration/out/player-created.json', JSON.stringify(playerCreated, null, 1));
  // …and step 5's, which the next run's step 5 does not count as a page's presence.
  writeFileSync(ARCHIVE_CREATED, JSON.stringify(archiveCreated, null, 1));
  const n = Object.values(usedDocs).reduce((a, o) => a + Object.keys(o).length, 0);
  console.log(`recorded the source doc for ${n} records -> scripts/migration/out/used-docs.json`);
} catch (e) {
  console.warn('could not write used-docs.json:', e.message);
}

if (caseOnlyKept) console.log(`names: ${caseOnlyKept} record(s) kept their shipped spelling — the reprint only re-cased the heading (see the rename boundary in overlayContent)`);
const sz = (existsSync(OUT) ? (readFileSync(OUT).length / 1e6).toFixed(1) : '?') + ' MB';
console.log('new data: ' + total + ' docs | pruned superseded: ' + pruned + ' | idMap entries: ' + Object.keys(idMap).length);
console.log('core.json (structured, no ast): ' + sz + '  [backup: public/core.foundry-backup.json]');
console.log('\nbucket'.padEnd(24) + 'total'.padStart(8) + 'overlaid'.padStart(10) + 'added'.padStart(8) + 'deferred'.padStart(10) + 'orphanKept'.padStart(12));
let totalAdded = 0;
for (const b of Object.keys(stats).sort()) {
  const s = stats[b];
  if (s.carried || s.carriedSafety) { console.log(b.padEnd(24) + String(s.total).padStart(8) + '   (carried wholesale)'); continue; }
  totalAdded += s.added || 0;
  console.log(b.padEnd(24) + String(s.total).padStart(8) + String(s.overlaid).padStart(10) + String(s.added).padStart(8) + String(s.deferred).padStart(10) + String(s.orphanKept).padStart(12));
}
console.log('\nadded = new-only records now live (facet-derived); deferred = still held (need mechanics/linkage); +' + totalAdded + ' new records added.');
const astTotal = Object.values(astStats).reduce((a, s) => a + Number(s.mb), 0).toFixed(1);
console.log('\nper-bucket ast written to public/ast/ (lazy-loaded): ' + astTotal + ' MB total');
for (const b of Object.keys(astStats).sort((a, c) => Number(astStats[c].mb) - Number(astStats[a].mb)).slice(0, 6))
  console.log('  ' + b.padEnd(18) + astStats[b].records + ' records, ' + astStats[b].mb + ' MB');
