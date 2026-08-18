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
import { aonFacets } from './lib/aon-facets.mjs';

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
  mapDocFor = (bucket, s) => {
    const m = mig[bucket]?.[s];
    return m && (m.status === 'doc' || m.status === 'scraped') ? m.docId : null;
  };
  console.log(`migration map loaded: ${Object.keys(mig).length} buckets`);
} catch {
  console.warn('WARNING: scripts/migration/out/map.json not found — falling back to slug dedup, which');
  console.warn('         picks the wrong twin when two different records share a name.');
}

const baseItemIndex = new Map();
const BASE_CATS = ['weapon', 'armor', 'shield'];
function indexBaseItem(rec) {
  if (!rec?.name) return;
  const k = String(rec.name).toLowerCase();
  const prev = baseItemIndex.get(k);
  const better = BASE_CATS.includes(rec.category) && !(prev && BASE_CATS.includes(prev.category));
  if (!prev || better) baseItemIndex.set(k, rec);
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

function overlayContent(rec, old = {}, bucket = null) {
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
  return { name: rec.name, ...facets };
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
    if (rec.superseded_by) { pruned++; supersededRecs.push({ id: numericId, bucket, slug: slug(rec.name), by: rec.superseded_by }); continue; }
    const s = slug(rec.name);
    // A record AoN flags `exclude_from_search` is a hidden/older printing, and deriveFresh /
    // deriveReference drop it outright — so letting it WIN the per-slug pick silently deletes the
    // visible twin. That is exactly how the Jalmeri Heavenseeker and Bright Lion archetype reference
    // entries went missing: each book ships a hidden earlier printing at the SAME edition rank, and
    // it happened to be seen first. Rank hidden records strictly below every visible one.
    const rk = (EDITION_RANK[rec.edition] ?? 5) + (rec.exclude_from_search === 1 ? 10 : 0);
    // Keep EVERY candidate too, not just the winner: two different feats can share a name, and the
    // archetype is what tells them apart. See pickByArchetype below.
    ((allByBucket[bucket] ||= {})[s] ||= []).push(rec);
    (bestByBucket[bucket] ||= {});
    const prev = bestByBucket[bucket][s];
    if (!prev || rk < prev.rank) bestByBucket[bucket][s] = { rec, rank: rk, numericId };
    idMap[numericId] = { bucket, slug: s };
  }
}


// ------------------------------------------------------------------ fresh-record derivation (new-only corpus)
// New-only records (no old baseline) that Foundry never had. Added with facet-derived fields so they're
// selectable + described. Advanced grants aren't modeled yet (inert like today's un-mechanized content),
// but nothing crashes. Only low-risk buckets are enabled here (no NaN / ancestry-linkage requirements).
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
  if (bucket === 'feats') { const f = { ...base, level: clamp(num(rec.level, 1), 1, 20), category: featCategory(traits) }; if (ac && ac.type !== 'passive') f.actionCost = ac; return f; }
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

// ------------------------------------------------------------------ assemble the new ContentDatabase
const db = {};
const stats = {};
const AON_BUCKETS = [...new Set(Object.values(CAT_BUCKET))];

for (const bucket of AON_BUCKETS) {
  const oldMap = cur[bucket] || {};
  const newMap = bestByBucket[bucket] || {};
  const out = {};
  const supers = supersededMap[bucket] || {};
  let overlaid = 0, deferred = 0, orphanKept = 0, added = 0, superseded = 0, mapCorrected = 0;

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
    const mapped = mappedDoc && !(mappedDoc.exclude_from_search === 1 && fallback.exclude_from_search !== 1)
      ? mappedDoc
      : null;
    const rec = mapped ?? fallback;
    if (mapped && mapped !== fallback) mapCorrected++;
    if (rec?.id) (usedDocs[bucket] ??= {})[s] = rec.id;
    const old = oldMap[s];
    if (old) { out[s] = { ...old, ...overlayContent(rec, old, bucket), id: s, edition: rec.edition }; overlaid++; }
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
    if (replacement && replacement in out) { out[s] = { ...oldMap[s], edition: 'superseded' }; superseded++; }
    /*
     * A KEPT ORPHAN is left exactly as it is. Overlaying Archives facets onto orphans was tried and
     * REVERTED: it brought 1,897 more records under Archives sourcing but broke four tests, because an
     * orphan is usually an orphan on purpose — a curated near-duplicate, an `aon-` scrape twin, or a
     * deliberate rename that the app hides or reshapes. `test/aon-dedupe.test.ts`,
     * `test/grade-spelling-duplicates.test.ts` and `test/granted-actions.test.ts` all encode that
     * curation. If this is revisited, it needs to respect those, not bulldoze them.
     */
    else { out[s] = oldMap[s]; orphanKept++; }
  }
  db[bucket] = out;
  stats[bucket] = { total: Object.keys(out).length, overlaid, added, deferred, orphanKept, superseded, mapCorrected };
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
const astIndex = {}; // slug -> preferred bucket
for (const bucket of AON_BUCKETS) {
  const newMap = bestByBucket[bucket] || {};
  const astOut = {};
  for (const s in newMap) {
    const rec = newMap[s].rec;
    if (rec.ast && (s in (db[bucket] || {}))) astOut[s] = resolveAst(rec.ast);
  }
  const json = JSON.stringify(astOut);
  writeFileSync('public/ast/' + bucket + '.json', json);
  // Ship the GZIPPED bucket (the raw JSON is far too large for static-host per-file limits — items is
  // ~36 MB raw). The runtime loader (astStore.ts) fetches + decompresses the .gz; only the .gz is committed.
  const gz = gzipSync(json, { level: 9 });
  writeFileSync('public/ast/' + bucket + '.json.gz', gz);
  astStats[bucket] = { records: Object.keys(astOut).length, mb: (json.length / 1e6).toFixed(1), gzMb: (gz.length / 1e6).toFixed(2) };
}
for (const bucket of [...BUCKET_PRIORITY, ...AON_BUCKETS.filter((b) => !BUCKET_PRIORITY.includes(b))]) {
  const newMap = bestByBucket[bucket] || {};
  for (const s in newMap) {
    if (!(s in astIndex) && newMap[s].rec.ast && (s in (db[bucket] || {}))) astIndex[s] = bucket;
  }
}
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

writeFileSync(OUT, JSON.stringify(db));
writeFileSync(IDMAP_OUT, JSON.stringify(idMap));
// Provenance for the migration: the doc each record was ACTUALLY built from. Not shipped to the app.
try {
  mkdirSync('scripts/migration/out', { recursive: true });
  writeFileSync('scripts/migration/out/used-docs.json', JSON.stringify(usedDocs, null, 1));
  writeFileSync('scripts/migration/out/action-cost-notes.json', JSON.stringify(actionNotes, null, 1));
  const n = Object.values(usedDocs).reduce((a, o) => a + Object.keys(o).length, 0);
  console.log(`recorded the source doc for ${n} records -> scripts/migration/out/used-docs.json`);
} catch (e) {
  console.warn('could not write used-docs.json:', e.message);
}

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
