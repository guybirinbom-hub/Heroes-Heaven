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
const CARRY_WHOLESALE = [
  'modes', 'stances', 'runes', 'services', 'followers', 'pets',
  'animalCompanions', 'familiarAbilities', 'companionSpecializations', 'vehicles', 'siegeWeapons',
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
const REF_SKIP = new Set([
  'creature', 'npc', 'hazard', 'weather-hazard', 'creature-ability', 'creature-family',
  'creature-adjustment', 'creature-theme-template', 'eidolon', 'article', 'class-sample',
  'warfare-army', 'warfare-tactic', 'kingdom-event', 'kingdom-structure', 'campsite-meal', 'cult-activity',
]);
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
function overlayContent(rec) {
  // Only the new canonical NAME is sourced here. The diff harness (scripts/migrate-diff.mjs) showed the
  // classification facets (level/rarity/traits) are 99%+ identical to the old Foundry data, and the ~1% of
  // diffs are AMBIGUOUS: sometimes the new AoN value is a genuine remaster change, sometimes it's an AoN
  // error the old Foundry value gets right (e.g. Uplifting Winds: Foundry=12, AoN=16, no fixes.json arbiter,
  // HH's tests assert 12). There is no automated way to pick the winner, so the vetted OLD facets are kept.
  // The migration's player-visible payoff is the DESCRIPTIONS (new ast, done) + the fuller new-only corpus
  // (added with facet-derived fields later in Step 2) — not re-flipping already-correct facets.
  return { name: rec.name };
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
    if (rec.superseded_by) { pruned++; supersededRecs.push({ id: numericId, bucket, slug: slug(rec.name), by: rec.superseded_by }); continue; }
    const s = slug(rec.name);
    const rk = EDITION_RANK[rec.edition] ?? 5;
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
const classSlugs = new Set(Object.keys(cur.classes || {}));
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
function mapBook(book) {
  const b = String(book || '').trim();
  if (!b) return undefined;
  const canon = foundryBookByNorm[normBook(b)]; // align to the Foundry name when the book is already known
  if (canon) return canon;
  return /^Pathfinder /i.test(b) ? b : 'Pathfinder ' + b; // fallback: new-only book AoN has but Foundry lacked
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
  let overlaid = 0, deferred = 0, orphanKept = 0, added = 0, superseded = 0;

  // 1. every new record that MATCHES an old slug: adopt the new name, keep old content+mechanics.
  //    New-only records are DEFERRED to Step 2 (they need real mechanics before they can ship).
  for (const s in newMap) {
    const rec = newMap[s].rec;
    const old = oldMap[s];
    if (old) { out[s] = { ...old, ...overlayContent(rec), id: s, edition: rec.edition }; overlaid++; }
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
    else { out[s] = oldMap[s]; orphanKept++; }
  }
  db[bucket] = out;
  stats[bucket] = { total: Object.keys(out).length, overlaid, added, deferred, orphanKept, superseded };
}

// carry the hand-authored buckets over unchanged
for (const bucket of CARRY_WHOLESALE) {
  if (cur[bucket]) { db[bucket] = cur[bucket]; stats[bucket] = { total: Object.keys(cur[bucket]).length, carried: true }; }
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

// Mechanical-effect backfill from the full player-effect audit (scripts/data/effect-backfill.json):
// per-id field patches (senses/speeds/innateSpells/focusSpells/passiveEffects/…) extracted from each
// record's rules text and validated by scripts/audit/apply-patches.ts. Applied LAST so every backfilled
// effect survives regeneration regardless of what the facet transcription produced.
let backfillCount = 0;
if (existsSync('scripts/data/effect-backfill.json')) {
  for (const fix of JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8'))) {
    const entry = db[fix.category]?.[fix.id];
    if (entry && fix.field) { entry[fix.field] = fix.value; backfillCount++; }
  }
  console.log(`[import-v2] applied ${backfillCount} audit effect backfills`);
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
writeFileSync(OUT, JSON.stringify(db));
writeFileSync(IDMAP_OUT, JSON.stringify(idMap));

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
