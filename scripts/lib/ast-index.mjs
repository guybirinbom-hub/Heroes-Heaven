/**
 * public/ast-index.json — the slug -> preferred-bucket index — derived from the ast trees ON DISK.
 *
 * WHAT IT IS. A description opener that has only a title (no bucket) looks its slug up here to find which
 * `public/ast/<bucket>.json.gz` holds its tree (src/sheet/astStore.ts `bucketOf`, useAst.ts). A slug with
 * a tree that the index lacks renders its plain-text fallback wherever it is opened by title.
 *
 * WHY THIS FILE EXISTS (2026-09-29). scripts/backfill-ast-edition.mjs used to add to the index only the
 * slugs of the buckets whose trees it had added IN THAT RUN, and it writes the trees before the index. A
 * `npm run data` died on a transient Windows lock (errno -4094) at the index write: the trees were on
 * disk, so the re-run tail found 0 trees to add, added +0 slugs, and the index stayed 1,779 slugs short
 * (23,042 -> 21,263; items 1,009, classFeatures 212, feats 189, actions 114 ...) until a full regen. The
 * index is now a function of the files on disk and of nothing a run remembers, so a resumed tail is a
 * real fixed point: it adds exactly what is missing, and a second run adds nothing.
 *
 * THE RULE — one place; scripts/backfill-ast-edition.mjs derives with it, scripts/ast-index-check.mjs
 * (in `npm run verify`) demands it.
 *
 *  1. A SLUG is a top-level key of a bucket tree `public/ast/<bucket>.json.gz` — the gzipped file is the
 *     one that ships and the one astStore.ts fetches; the plain `<bucket>.json` beside it is a gitignored
 *     by-product. Every tree root carries `aon`, the archive document it was built from (provenance —
 *     scripts/ast-provenance-check.mjs); rule 4 reads it.
 *  2. ADDITIVE ONLY. An entry the index already has is never re-pointed, whatever bucket it names:
 *     "re-pointing an existing slug would move an unrelated record's popup to a different bucket"
 *     (scripts/backfill-ast-edition.mjs), "additive: never re-point an existing slug"
 *     (scripts/import-siege-and-gaps.mjs). So a slug already indexed under ANOTHER bucket is not missing.
 *     (An entry naming a bucket whose tree lacks the slug is a different defect: the guard fails it, see
 *     `danglingEntries`; it is not re-pointed here either.)
 *  3. CREATED RECORDS ARE NEVER INDEXED: "Step 5's records are NOT indexed: they open by key only
 *     (scripts/lib/archive-coverage.mjs createdRefs)" (scripts/import-core-v2.mjs). The caller passes
 *     createdRefs(root) as `exclude` — the same function scripts/archive-coverage-check.mjs uses to fail
 *     an index that names one.
 *  4. PREFERENCE, for a missing slug whose tree sits in more than one bucket. Three tiers, in order:
 *     a. NEVER A SUPERSEDED PRINTING while another candidate is not one. A tree whose `aon` document
 *        carries `superseded_by` loses. Gold-set R12 ("the newest printing wins, whole"), and the
 *        importer's own "Editions: prune every `superseded_by` record" (scripts/import-core-v2.mjs
 *        header). This tier only ORDERS candidates; it does not keep a superseded page out of the index.
 *        A full chain's index DOES open superseded pages. Measured 2026-09-30
 *        (scripts/ast-index-superseded-split.mjs, report-only: each committed entry's tree `aon` looked up
 *        in the export): 365 of the 23,042 entries open a page carrying `superseded_by` — 85 written by the steps before
 *        backfill-ast-edition.mjs (e.g. abandoned-by-faith -> sidebar, sidebar-1151), 280 by backfill
 *        itself (e.g. acid-arrow -> spells, spell-2; adept-benefit-amulet -> classFeatures, implement-1).
 *        For 364 of the 365 no other bucket holds a live (not superseded) tree for the slug, so there is
 *        nothing for this tier to prefer. The one with a live tree in another bucket was strigoi (sidebar-1126 over trait-854),
 *        written by the chain before backfill, and so pinned in REGEN_DIFFERS until 2026-09-30. Since that day
 *        import-core-v2's INDEX_ORDER pass applies this same tier (`liveFirst` below, imported there — one
 *        definition), so the chain itself writes strigoi -> trait and the pin is gone (9 -> 8). What the
 *        tier does measurably decide: without it the owner's lost `pistoleros-retort` came back under
 *        `actions` — "Pistolero's Retort", action-3681, Guns & Gears 2021, superseded_by action-912 —
 *        where the full regen had `classFeatures`, the remastered "Pistoler's Retort" (action-912).
 *     b. THE DOCUMENT'S OWN BUCKET before a copy. The importer buckets a document by its export category
 *        — "CAT_BUCKET[raw.category]", else "camel(raw.category)" for a reference category
 *        (scripts/import-core-v2.mjs) — and indexes those trees first; a tree some later step copied into
 *        another bucket (backfill-ast-edition.mjs: "the 30 commander tactics -> core.actions", their
 *        page is the `tactic` bucket's; step 4's class options built from another category's page) is
 *        indexed after, additively. So the bucket the tree's document natively belongs to wins.
 *     c. then scripts/import-core-v2.mjs's INDEX_ORDER — "BUCKET_PRIORITY, then AON_BUCKETS, then
 *        BUCKET_LAST" ("buckets that may claim a slug only when NOBODY else does"). AON_BUCKETS there is
 *        the values of its CAT_BUCKET literal in order (the first-class buckets), then one reference
 *        bucket per export category in the export directory's order: `<category>.json` file names,
 *        sorted. So the middle here is FIRST_CLASS_BUCKETS in order, then every other bucket sorted by
 *        the file name of the category it was camel-cased from (`skillGeneralAction` <-
 *        skill-general-action.json sorts before `skill` <- skill.json, as it does in the directory).
 *     Tiers a and b need the archive export (`docOf` — `makeDocOf` below; backfill-ast-edition.mjs feeds
 *     it the export it already reads); without it only tier c applies. The lists are copied below because
 *     import-core-v2.mjs runs at import; test/ast-index-check.test.ts reads that file as text and fails
 *     if any of them drifts from it.
 *
 * WHAT RULE 4 REPRODUCES, AND WHAT NO RULE OVER THESE FILES CAN (measured 2026-09-29). A full chain's
 * index has two authors, each additive over the one before.
 *   - The import steps BEFORE backfill-ast-edition.mjs — import-core-v2's INDEX_ORDER pass, then its
 *     step-4 records, then import-siege-and-gaps, import-new-classes and import-archive-buckets — wrote
 *     21,263 of the 23,042 entries: exactly the index the 2026-09-29 run left on disk when it died at
 *     backfill's index write. import-core-v2 indexes a slug under a bucket only when ITS OWN in-memory
 *     per-slug edition pick has an ast (`newMap[s].rec.ast` in its INDEX_ORDER loop) — which document that
 *     pick was is written nowhere, so those choices cannot be re-derived from the files on disk.
 *   - backfill-ast-edition.mjs wrote the other 1,779. Its OLD loop walked `perBucket` after the report
 *     above it had sorted that array IN PLACE by trees added IN THE RUN, descending (Array.sort mutates;
 *     ties keep public/core.json key order) — run-dependent too. Replayed from the 21,263-entry index in the
 *     order the last full chain printed that report (items +1028, classFeatures +580, feats +191, actions
 *     +173, ...), it gives the committed index exactly. Rule 4 from the same start gives it exactly too:
 *     all 1,779, including all 15 of them that had trees in several buckets (7 litany / judgment feats over
 *     spells, 7 items over itemBonus, pistoleros-retort to classFeatures over actions). Tier c alone misses
 *     one of the 15, pistoleros-retort; tiers a + c already get all 15.
 *   So everything THIS step writes is re-derived exactly: a resumed tail — which can only have lost this
 *   step's entries, because the earlier steps' index was on disk before this step began — comes back
 *   byte-identical, and a full chain with rule 4 writes the index the old loop wrote.
 *   What rule 4 cannot restore is an entry the EARLIER steps wrote, if the index loses it (a deleted or
 *   hand-cut index; never a tail abort). Deriving the whole index from an empty one differed from the
 *   committed 23,042 entries in exactly 9 (2026-09-29), committed -> re-derived, with each tree's `aon`:
 *       anchored-incorporeality  sidebar (sidebar-1786)                        -> familiarAbilities (familiar-ability-81)
 *       clockwork                trait (trait-874)                             -> familiarAbilities (familiar-ability-56)
 *       undead                   bloodline (bloodline-28)                      -> familiarAbilities (familiar-ability-79)
 *       runes                    categoryPage (equipment-category-23)          -> classFeatures (class-feature-1312)
 *       wrecker                  companionSpecializations (animal-companion-specialization-18) -> items (weapon-348)
 *       light-mortar             innovation (innovation-4)                     -> siegeWeapons (siege-weapon-36)
 *       runic-skullcap           items (equipment-5208-bonus-1715)             -> itemBonus (equipment-5208-bonus-1714)
 *       dream-hunters-lodge      items (equipment-5205-bonus-1713)             -> itemBonus (equipment-5205-bonus-1713)
 *       strigoi                  sidebar (sidebar-1126, superseded_by ancestry-85) -> trait (trait-854)
 *     All 9 are among the 21,263 the earlier steps wrote, with exactly these committed buckets. Only
 *     dream-hunters-lodge re-derives to the SAME document; the other 8 would open a different page until
 *     the next full `npm run data` (strigoi's re-derived page is the right one under R12). Over the 1,859
 *     slugs with a non-created tree in more than one bucket, whole-index picks agreeing with the committed
 *     index: tier c alone 1,562, a + c 1,564, this rule 1,850 — tier b is what keeps a loss of the earlier
 *     steps' entries to these 9 rather than 295. Picks are per slug, so every loss is bounded by them.
 *   2026-09-30 (the strigoi fix, measured after that day's full `npm run data`): import-core-v2's INDEX_ORDER
 *   pass now applies rule 4a too (`liveFirst`, imported from this file), so the chain writes strigoi -> trait
 *   (trait-854) itself, the committed index agrees with the rule on it, and it left the list: 8 slugs differ,
 *   the other eight rows above, unchanged; whole-index picks agreeing over the 1,859 multi-bucket slugs: 1,851.
 *   THE LIMIT, AND THE PIN THAT GUARDS IT. Measured 2026-09-29 (9) and 2026-09-30 (8, strigoi gone — above):
 *   the whole index rebuilt from EMPTY over the shipped trees — 23,042 slugs — differs from the committed
 *   index in exactly these 8 and in nothing else. An index the chain produces never needs that: a tail
 *   resume loses only this step's entries, which come back byte-identical. An ARBITRARY loss (a hand-cut or
 *   damaged index) that hits one of the 8 does come back in the other bucket, because which step indexed it
 *   first is written in no file.
 *   So the 8 are pinned in `REGEN_DIFFERS` below — each slug's committed bucket (`pinned`), the bucket
 *   this rule would pick (`derived`) and why the committed one wins (`why`) — and
 *   scripts/ast-index-check.mjs (npm run verify) FAILS when a pinned slug is indexed under any bucket but
 *   its pin, or is missing, naming both buckets. The pin never decides a pick: no function below reads
 *   it; backfill-ast-edition.mjs names a pinned slug it re-derived elsewhere, and the guard then fails.
 *   A full `npm run data` may legitimately move a pin (a new printing, a new tree, a changed importer).
 *   Then the pin is updated here with the reason in its `why`, never silently: test/ast-index-check.test.ts
 *   fails until every `pinned` equals public/ast-index.json and the rule's divergence from empty over the
 *   shipped trees is exactly these slugs, each to its `derived` bucket.
 *   If public/ast-index.json is ABSENT the derivation starts from nothing and these 8 come back re-derived
 *   (and the guard fails on them).
 *
 * The index is written with its keys sorted (Object.keys(...).sort(), as backfill-ast-edition.mjs and
 * import-siege-and-gaps.mjs have always written it), minified.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { buildDocIndex, resolveDoc } from './aonid-categories.mjs';

/** scripts/import-core-v2.mjs BUCKET_PRIORITY, verbatim (pinned by test/ast-index-check.test.ts). */
export const BUCKET_PRIORITY = ['conditions', 'actions', 'feats', 'classFeatures', 'spells', 'items', 'deities',
  'ancestries', 'heritages', 'backgrounds', 'languages', 'familiarAbilities', 'animalCompanions', 'companionSpecializations', 'vehicles', 'siegeWeapons'];
/** scripts/import-core-v2.mjs BUCKET_LAST, verbatim (pinned by test/ast-index-check.test.ts). */
export const BUCKET_LAST = ['grimFascination', 'fatalMethod', 'follower'];
/** scripts/import-core-v2.mjs's CAT_BUCKET literal — export category -> first-class bucket — verbatim, in order (pinned by the same test). */
export const CAT_BUCKET = {
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
/**
 * THE PIN (the header's "THE LIMIT"): the 8 multi-bucket slugs whose committed bucket rule 4 does not
 * re-derive, measured by rebuilding the whole index from empty (23,042 slugs): exactly 9 differed on
 * 2026-09-29; on 2026-09-30 strigoi left the list — import-core-v2's index pass applies rule 4a (liveFirst)
 * since that day, so the chain writes it under trait, the bucket the rule picks — and exactly 8 differ.
 *   pinned  — the committed bucket: what the chain writes and public/ast-index.json holds.
 *   derived — the bucket rule 4 picks for it from an empty index.
 *   why     — why the committed bucket wins. MEASURED: all 8 were indexed by the import steps BEFORE
 *             backfill-ast-edition.mjs — the 21,263-entry index the 2026-09-29 run left when it died at
 *             backfill's index write holds each one under `pinned`. Every step after the first to index a
 *             slug only adds, so the first step's bucket is the chain's. The pin rests on that alone.
 *             NOT MEASURED: which step wrote the `derived` bucket's tree. import-core-v2 can write a tree
 *             into a bucket without indexing the slug there — its tree loop takes the record's own document
 *             when that has an ast (`(own?.ast ? own : null) ?? newMap[s].rec`), while its INDEX_ORDER loop
 *             indexes only `newMap[s].rec.ast && (s in (db[bucket] || {}))` — and later steps
 *             (import-siege-and-gaps, backfill-ast-edition.mjs ...) write trees too. Naming the author
 *             would take a chain run.
 * scripts/ast-index-check.mjs fails an index that holds a pinned slug anywhere else, or lacks it.
 * backfill-ast-edition.mjs reads it for its output line. Nothing reads it to choose a bucket.
 * A change to a pin states its reason in `why` (the header: never silently).
 */
export const REGEN_DIFFERS = {
  'anchored-incorporeality': { pinned: 'sidebar', derived: 'familiarAbilities',
    why: 'Measured: the pre-backfill index holds it under sidebar (sidebar-1786). Not measured: which step wrote the familiarAbilities tree (familiar-ability-81) without indexing it there (import-core-v2 itself can, or a later step). Rule 4c ranks familiarAbilities (BUCKET_PRIORITY) first.' },
  clockwork: { pinned: 'trait', derived: 'familiarAbilities',
    why: 'Measured: the pre-backfill index holds it under trait (trait-874). Not measured: which step wrote the familiarAbilities tree (familiar-ability-56) without indexing it there (import-core-v2 itself can, or a later step). Rule 4c ranks familiarAbilities (BUCKET_PRIORITY) first.' },
  'dream-hunters-lodge': { pinned: 'items', derived: 'itemBonus',
    why: 'Measured: the pre-backfill index holds it under items. import-core-v2\'s INDEX_ORDER pass reaches items (BUCKET_PRIORITY) before itemBonus, so it is the likely author (not measured). Rule 4b prefers itemBonus because the page, equipment-5205-bonus-1713, is an item-bonus document. Both buckets hold that same page, so a re-derived entry opens the same text.' },
  'light-mortar': { pinned: 'innovation', derived: 'siegeWeapons',
    why: 'Measured: the pre-backfill index holds it under innovation (innovation-4). Not measured: which step wrote the siegeWeapons tree (siege-weapon-36) without indexing it there (import-core-v2 itself can; import-siege-and-gaps also writes that bucket). Rule 4c ranks siegeWeapons (BUCKET_PRIORITY) first.' },
  runes: { pinned: 'categoryPage', derived: 'classFeatures',
    why: 'Measured: the pre-backfill index holds it under categoryPage (equipment-category-23). Not measured: which step wrote the classFeatures tree (class-feature-1312) without indexing it there (import-core-v2 itself can, or a later step). Rule 4c ranks classFeatures (BUCKET_PRIORITY) first.' },
  'runic-skullcap': { pinned: 'items', derived: 'itemBonus',
    why: 'Measured: the pre-backfill index holds it under items (equipment-5208-bonus-1715). import-core-v2\'s INDEX_ORDER pass reaches items (BUCKET_PRIORITY) before itemBonus, so it is the likely author (not measured). Rule 4b prefers itemBonus (equipment-5208-bonus-1714): the items tree\'s page is an item-bonus document, not native to items. The two buckets hold different pages.' },
  undead: { pinned: 'bloodline', derived: 'familiarAbilities',
    why: 'Measured: the pre-backfill index holds it under bloodline (bloodline-28). Not measured: which step wrote the familiarAbilities tree (familiar-ability-79) without indexing it there (import-core-v2 itself can, or a later step). Rule 4c ranks familiarAbilities (BUCKET_PRIORITY) first.' },
  wrecker: { pinned: 'companionSpecializations', derived: 'items',
    why: 'Measured: the pre-backfill index holds it under companionSpecializations (animal-companion-specialization-18). Not measured: which step wrote the items tree (weapon-348) without indexing it there (import-core-v2 itself can, or a later step). Rule 4c ranks items (BUCKET_PRIORITY) first.' },
};
/** The distinct values of CAT_BUCKET, in order: the first-class buckets. */
export const FIRST_CLASS_BUCKETS = [...new Set(Object.values(CAT_BUCKET))];

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** `skillGeneralAction` -> `skill-general-action.json`: the export file a reference bucket was named from. */
const categoryFile = (bucket) => bucket.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '.json';
/** scripts/import-core-v2.mjs `camel`. */
const camel = (s) => String(s).replace(/-(\w)/g, (_, c) => c.toUpperCase());
/** The bucket the importer puts a document of this export category in (rule 4b). */
export const nativeBucket = (category) => (hasOwn(CAT_BUCKET, category) ? CAT_BUCKET[category] : camel(category));
/** A bucket's slugs, whether it was read as a list (readAstSlugs) or as slug -> aon (readAstTrees). */
const slugsOf = (v) => (Array.isArray(v) ? v : Object.keys(v ?? {}));

/**
 * Rule 4's export facts for a tree's `aon`: { category, supersededBy } | null. `docIndex` is
 * aonid-categories.mjs buildDocIndex's map; `fullDoc(category, id)` returns the export document. One
 * definition, used by backfill-ast-edition.mjs (with its own document cache) and by `exportDocOf`.
 */
export function makeDocOf({ docIndex, fullDoc }) {
  return (aonId) => {
    const { doc, via } = resolveDoc(docIndex, aonId);
    if (!doc) return null;
    return { category: doc.cat, supersededBy: fullDoc(doc.cat, via)?.superseded_by ?? null };
  };
}

/** `makeDocOf` over an export directory (`<category>.json` files holding `docs`), read on demand. */
export function exportDocOf(exportDir) {
  const docIndex = buildDocIndex(exportDir, { readFileSync, readdirSync, join });
  const cache = new Map();
  const fullDoc = (cat, id) => {
    if (!cache.has(cat)) {
      let docs = {};
      try { docs = JSON.parse(readFileSync(join(exportDir, cat + '.json'), 'utf8')).docs ?? {}; } catch { /* leave empty */ }
      cache.set(cat, docs);
    }
    return cache.get(cat)[id];
  };
  return makeDocOf({ docIndex, fullDoc });
}

/** The buckets, most-preferred first (rule 4c). */
export function preferenceOrder(buckets) {
  const set = new Set(buckets);
  const edge = new Set([...BUCKET_PRIORITY, ...BUCKET_LAST]);
  const firstClass = FIRST_CLASS_BUCKETS.filter((b) => set.has(b) && !edge.has(b));
  const rest = [...set].filter((b) => !edge.has(b) && !FIRST_CLASS_BUCKETS.includes(b))
    .sort((a, b) => { const x = categoryFile(a), y = categoryFile(b); return x < y ? -1 : x > y ? 1 : 0; });
  return [...BUCKET_PRIORITY.filter((b) => set.has(b)), ...firstClass, ...rest, ...BUCKET_LAST.filter((b) => set.has(b))];
}

/** { bucket: { slug: aonId | null } } for every `<bucket>.json.gz` in `astDir` (rule 1). */
export function readAstTrees(astDir) {
  const trees = {};
  for (const f of readdirSync(astDir).filter((n) => n.endsWith('.json.gz')).sort()) {
    const tree = JSON.parse(gunzipSync(readFileSync(join(astDir, f))).toString('utf8')) ?? {};
    const out = {};
    for (const [s, node] of Object.entries(tree)) out[s] = node && typeof node === 'object' && node.aon ? String(node.aon) : null;
    trees[f.slice(0, -'.json.gz'.length)] = out;
  }
  return trees;
}

/** { bucket: [slug, ...] } for every `<bucket>.json.gz` in `astDir` (rule 1). */
export function readAstSlugs(astDir) {
  return Object.fromEntries(Object.entries(readAstTrees(astDir)).map(([b, m]) => [b, Object.keys(m)]));
}

/**
 * Every tree slug the index is missing: not indexed under any bucket (rule 2) and not a created record
 * of its bucket (rule 3, `exclude` holds "bucket:slug"). A slug with trees in two buckets appears once
 * per bucket. Sorted by bucket, then slug. `trees` is readAstSlugs' or readAstTrees' shape.
 */
export function missingFromIndex(index, trees, exclude = new Set()) {
  const out = [];
  for (const bucket of Object.keys(trees).sort()) {
    for (const slug of [...slugsOf(trees[bucket])].sort()) {
      if (hasOwn(index, slug)) continue;
      if (exclude.has(`${bucket}:${slug}`)) continue;
      out.push({ bucket, slug });
    }
  }
  return out;
}

/**
 * Index entries that name a bucket with no tree for that slug: a title-only popup of each finds no tree
 * (astStore.ts `bucketOf` has no fallback) and renders plain text, and rule 2 never repairs it. Sorted by
 * slug.
 */
export function danglingEntries(index, trees) {
  const sets = Object.fromEntries(Object.entries(trees).map(([b, v]) => [b, new Set(slugsOf(v))]));
  return Object.keys(index).sort().filter((s) => !sets[index[s]]?.has(s)).map((slug) => ({ slug, bucket: index[slug] }));
}

/**
 * RULE 4a — one definition, used by deriveIndex below and by scripts/import-core-v2.mjs's INDEX_ORDER pass
 * (2026-09-30, the strigoi fix): `cands` are one slug's trees, [{ bucket, aon }], in the caller's order of
 * preference for everything but supersession (tiers 4b + 4c here; INDEX_ORDER in the importer). Returns them
 * reordered, the page the index opens first:
 *   · a page the Archives mark superseded (`superseded_by` on its `aon` document) never wins while a live
 *     page is a candidate (gold-set R12, "the newest printing wins, whole");
 *   · where the candidate that would have won is superseded and the Archives name its replacement page, the
 *     slug follows that page when a live candidate tree IS that page (R12: the join follows the Archives'
 *     own links), else the first live candidate;
 *   · with no live candidate, the order is unchanged (the tier only ORDERS; it keeps nothing out).
 * Live candidates keep the caller's order, then the superseded ones. `docOf(aon)` -> { supersededBy } | null;
 * without it (or without an `aon`) a candidate counts as live. Pure.
 */
export function liveFirst(cands, docOf = null) {
  const sup = (c) => (docOf && c.aon ? docOf(String(c.aon))?.supersededBy ?? null : null);
  const live = cands.filter((c) => !sup(c));
  const dead = cands.filter((c) => sup(c));
  const by = cands.length ? sup(cands[0]) : null;
  const heir = by ? live.find((c) => String(c.aon) === String(by)) : null;
  return heir ? [heir, ...live.filter((c) => c !== heir), ...dead] : [...live, ...dead];
}

/**
 * The complete index: `index` plus one entry per missing slug, in the bucket rule 4 prefers; keys sorted.
 * `docOf(aonId)` -> { category, supersededBy } | null feeds tiers 4a and 4b (it needs `trees` in
 * readAstTrees' shape, which carries each tree's `aon`); without it only 4c applies.
 * Returns { index, added: [{ slug, bucket }], ambiguous: [{ slug, bucket, candidates }] } — both sorted
 * by slug; `ambiguous` is the part of `added` that rule 4 chose among more than one bucket (`candidates`,
 * most-preferred first), where a full chain may have chosen another (see the header). Pure: reads and
 * writes nothing.
 */
export function deriveIndex(index, trees, exclude = new Set(), { docOf = null } = {}) {
  const rank = new Map(preferenceOrder(Object.keys(trees)).map((b, i) => [b, i]));
  const aonOf = (bucket, slug) => (Array.isArray(trees[bucket]) ? null : trees[bucket]?.[slug] ?? null);
  const key = (bucket, slug) => {
    const aon = aonOf(bucket, slug);
    const doc = docOf && aon ? docOf(aon) : null;
    return [
      doc && nativeBucket(doc.category) === bucket ? 0 : 1, // 4b
      rank.get(bucket), // 4c
    ];
  };
  const better = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  const cands = new Map(); // slug -> [{ bucket, aon, k }]
  for (const { bucket, slug } of missingFromIndex(index, trees, exclude)) {
    (cands.get(slug) ?? cands.set(slug, []).get(slug)).push({ bucket, aon: aonOf(bucket, slug), k: key(bucket, slug) });
  }
  const pick = new Map();
  for (const [slug, cs] of cands) {
    cs.sort((x, y) => (better(x.k, y.k) ? -1 : better(y.k, x.k) ? 1 : 0));
    const ordered = liveFirst(cs, docOf); // 4a, over the 4b + 4c order
    cs.splice(0, cs.length, ...ordered);
    pick.set(slug, cs[0].bucket);
  }
  const merged = { ...index };
  for (const [slug, bucket] of pick) merged[slug] = bucket;
  const out = {};
  for (const s of Object.keys(merged).sort()) out[s] = merged[s];
  const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const added = [...pick].map(([slug, bucket]) => ({ slug, bucket })).sort(bySlug);
  const ambiguous = [...cands].filter(([, cs]) => cs.length > 1)
    .map(([slug, cs]) => ({ slug, bucket: pick.get(slug), candidates: cs.map((c) => c.bucket) })).sort(bySlug);
  return { index: out, added, ambiguous };
}

/**
 * Read `indexPath` (absent = empty) and the trees in `astDir`, derive, and — with `write` — write the
 * file only when its bytes change. Returns { added, ambiguous, total, wrote }.
 */
export function refreshIndexFile({ indexPath, astDir, exclude = new Set(), write = false, docOf = null }) {
  const before = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
  const { index, added, ambiguous } = deriveIndex(before == null ? {} : JSON.parse(before), readAstTrees(astDir), exclude, { docOf });
  const json = JSON.stringify(index);
  const wrote = write && json !== before;
  if (wrote) writeFileSync(indexPath, json);
  return { added, ambiguous, total: Object.keys(index).length, wrote };
}
