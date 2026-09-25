/*
 * ARCHIVE COVERAGE — the rule that decides whether an Archives page that is NOT a player option (a rules
 * page, a sidebar, an article, a creature family, a class kit, …) has a record the GM can find by name
 * in the tracker's Search. Owner, 2026-09-24: "every record of PF2e needs to be accessible to the GM in
 * the tracker's search". The player-option categories are scripts/lib/player-coverage.mjs's; this file
 * is every other category of the export. Read by scripts/archive-coverage-check.mjs (the guard),
 * scripts/import-core-v2.mjs (which CREATES a record for every page this calls missing) and
 * test/archive-coverage.test.ts.
 *
 * WHAT COUNTS AS PRESENT is what the GM Search can actually reach. In Heroes Heaven the tracker's
 * Search reads two things (tracker/src/components/GlobalSearch.tsx, host mode): every record of every
 * core.json bucket except `modes`, `runes`, `stances` (src/integration/hostSearchRecords.ts), and the
 * bestiary (public/data/index.json — creatures and hazards). It does NOT read the tracker's own
 * reference files (creature-families.json, abilities.json, rules.json, …): standalone Search does, the
 * host mode never did, so a page only those files hold is not present.
 *
 * A page is PRESENT, in this order, when:
 *   aonId     a searchable record carries its id (its own kind's bucket first, then any bucket);
 *   bestiary  (creature / hazard) a bestiary entry carries its id;
 *   twin      a page it is linked to (the documents' own reprint links, same category — the player
 *             rule's reprintEdges/linkGraph) is present by one of the two above;
 *   twin      or its NEWER printing, in ANY category, is present by this same rule. The Archives' own
 *             reprint link — `superseded_by` / `remaster_id` on the page, `legacy_id` on the reprint —
 *             often crosses categories: the Core Rulebook's twelve "Key Terms" sidebars were reprinted
 *             INTO the Player Core class pages (sidebar-1075 -> class-57, classes/barbarian), its
 *             "Character Sheet" sidebars into the Player Core "Step N" rules pages. Gold-set R12 ("the
 *             newest printing wins, whole") makes that page the record; a legacy page whose newer
 *             printing ships is not made again beside it (29 were, measured 2026-09-25). Old -> new
 *             only: an old printing never stands in for its reprint;
 *   name      a record in its kind's bucket(s) has the same normalised name AND its book is the page's
 *             book or that book's remaster, or the two texts share TEXT_SAME of their words (the
 *             player rule's evidence test, gold-set R12: never a bare name across books). An
 *             item-bonus page is the item's own page seen through one bonus (`equipment-257-bonus-103`
 *             is Horn of Blasting), so its kind's bucket is `items` — the item record IS the record.
 * Anything else is MISSING, unless scripts/data/archive-coverage-allow.json names it by doc id.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  KINDS, TEXT_SAME, bookKey, linkGraph, linkedIds, nameForms, reprintEdges, remasterBooks, sameBookOrRemaster, slug, textOverlap,
} from './player-coverage.mjs';

/** Buckets the GM Search skips (src/integration/hostSearchRecords.ts `skip`). */
export const UNSEARCHED = new Set(['modes', 'runes', 'stances']);

/** The new plain bucket for every kind the app has no bucket for. */
export const REFERENCE = 'reference';

/**
 * The buckets whose EVERY record with a page carries its page's book (and the page it is filed under), so
 * each Search row has a detail line (owner, 2026-09-25, ruling e): `reference` and the four glossary
 * buckets the Archives' rules text fills. A glossary record ships as {id, name, edition}, and "Scarlet
 * Fever · DISEASE" or "The First Rule · SIDEBAR" gave the GM no book at all. The Builder's buckets (trait,
 * archetype, bloodline, …) are not here: they feed the pickers and the source filter.
 */
export const LABELLED_BUCKETS = new Set([REFERENCE, 'rules', 'sidebar', 'categoryPage', 'disease']);

const camel = (s) => String(s).replace(/-(\w)/g, (_, c) => c.toUpperCase());

/**
 * First-class buckets a non-player category's records already live in (scripts/import-core-v2.mjs
 * CAT_BUCKET). Every other category's records are the camelCase glossary bucket the importer mints.
 */
const OWN_BUCKETS = {
  action: ['actions'], condition: ['conditions'], language: ['languages'], class: ['classes'],
  'siege-weapon': ['siegeWeapons'], vehicle: ['vehicles'],
  'class-kit': ['items'], relic: ['items'], 'set-relic': ['items'], 'campsite-meal': ['items'],
  'item-bonus': ['items', 'itemBonus'],
};

/** The buckets whose records answer for a page of this category (plus `reference`, always). */
export const bucketsOf = (category) => [...(OWN_BUCKETS[category] ?? [camel(category)]), REFERENCE];

/**
 * Where a MISSING page's new record goes. A glossary bucket (a pure link target no picker lists) takes
 * its own kind's pages. A first-class bucket does not: `actions`, `conditions`, `languages` and `items`
 * are read by Builder and sheet pickers and `actions`/`items` by the trust ledger, so a page created
 * there would be offered to a player. Those, and every kind with no bucket, go to `reference`.
 */
export function createBucket(category, core) {
  if (OWN_BUCKETS[category]) return REFERENCE;
  const b = camel(category);
  return core[b] && typeof core[b] === 'object' && !Array.isArray(core[b]) ? b : REFERENCE;
}

/** Every category of the export that is not a player option. */
export function nonPlayerCategories(exportDir) {
  return readdirSync(exportDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((c) => !KINDS[c]);
}

/** A document as this rule reads it. `ast` is kept only when asked (the importer needs the tree). */
export function asPage(d, keepAst = false) {
  return {
    id: String(d.id), category: d.category, name: String(d.name ?? '').trim(), book: d.book ?? '',
    books: [...new Set([d.book, ...(d.data?.source ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))],
    level: typeof d.level === 'number' ? d.level : undefined, rarity: d.rarity, edition: d.edition ?? '',
    traits: Array.isArray(d.traits) ? d.traits : [],
    exclude_from_search: d.exclude_from_search === 1 || d.exclude_from_search === true,
    superseded_by: d.superseded_by, release_date: d.release_date ?? '', text: String(d.data?.text ?? ''),
    data: { legacy_id: d.data?.legacy_id, remaster_id: d.data?.remaster_id },
    url: String(d.url ?? d.data?.url ?? ''),
    crumb: [].concat(d.data?.breadcrumbs ?? []).map(String).pop() ?? '', sampleOf: String(d.data?.class ?? ''),
    pg: Number(/pg\.\s*(\d+)/.exec(String(d.data?.primary_source_raw ?? ''))?.[1]) || undefined,
    ...(keepAst && d.ast ? { ast: d.ast } : {}),
  };
}

/**
 * Where a page sits on the Archives — the Search's way to tell same-named pages of one book apart
 * (twelve Core Rulebook "Key Terms" sidebars are one per class; three Secrets of Magic "Example" rules
 * pages are one per step of making a staff). In order: the page's last breadcrumb (rules), the class a
 * sample build is for, or the page it is printed on — a sidebar's url is that page's, and `nameAt(url)`
 * names the document that owns the url. A page that only names itself has none.
 */
export function parentPageOf(page, nameAt) {
  const p = page.crumb || page.sampleOf || nameAt(page.url) || '';
  return p && p.toLowerCase() !== page.name.toLowerCase() ? p : undefined;
}

/**
 * Whether a record's book `label` names `pageBook`, the book on its page's own Source line — the same book
 * and the same printing, however it is spelt. The Search's detail line is the GM's only way to tell which
 * page a row opens, and scripts/data/book-names.json (the source filter's spelling) folds some books into
 * ANOTHER: "Bestiary 3" -> "Pathfinder Monster Core 2", "Treasure Vault" -> its Remastered printing,
 * "Guns & Gears (Remastered)" -> the legacy one, the volume "#222: Hellbreakers" -> its whole Adventure
 * Path (56 of the rows step 5 wrote read so, measured 2026-09-25). The page's title must stand in the
 * label as a run of whole words (punctuation, a plural "s" and "Pathfinder" aside — "Lost Omens Gods &
 * Magic" names "Gods & Magic"), with no number the title lacks ("Monster Core 2" names neither
 * "Bestiary 3" nor "Monster Core"), and "Remastered" in both or neither.
 */
export function namesBook(label, pageBook) {
  const words = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w && w !== 'pathfinder').map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));
  const page = words(pageBook), rec = words(label);
  return page.length > 0 && ` ${rec.join(' ')} `.includes(` ${page.join(' ')} `)
    && rec.every((w) => !/\d/.test(w) || page.includes(w)) && page.includes('remastered') === rec.includes('remastered');
}

/** Every page of the given categories, slimmed. */
export function loadPages(exportDir, categories, keepAst = false) {
  const pages = new Map();
  for (const cat of categories) {
    const f = join(exportDir, `${cat}.json`);
    if (!existsSync(f)) continue;
    for (const d of Object.values(JSON.parse(readFileSync(f, 'utf8')).docs ?? {})) {
      if (d?.id) pages.set(String(d.id), asPage({ category: cat, ...d }, keepAst));
    }
  }
  return pages;
}

/** An unnamed sub-action stub: AoN's "(…)" pages that only exist inside a parent page. */
export const isStub = (page) => !page.name || /^\(/.test(page.name);

/**
 * The bestiary the GM Search reads: every creature file under public/data/bestiary plus hazards.json,
 * as { ids: Set<doc id>, byName: Map<name slug, [{ book }]> }.
 */
export function loadBestiary(root) {
  const ids = new Set();
  const byName = new Map();
  const add = (x) => {
    const id = x?._aon?.id ?? (typeof x?._aon === 'string' ? x._aon : null);
    if (id) ids.add(String(id));
    const k = slug(x?.name);
    if (k) (byName.get(k) ?? byName.set(k, []).get(k)).push({ book: String(x?.source ?? '') });
  };
  const dir = join(root, 'public/data/bestiary');
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (f.endsWith('.json')) for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8')).creature ?? []) add(c);
  }
  const hz = join(root, 'public/data/hazards.json');
  if (existsSync(hz)) for (const h of JSON.parse(readFileSync(hz, 'utf8')).hazard ?? []) add(h);
  return { ids, byName };
}

/**
 * `bucket:key` of every record step 5 of scripts/import-core-v2.mjs created (the list it writes to
 * scripts/migration/out/archive-created.json). They open by key only — the Search and the description
 * links carry bucket and key — and never by title: public/ast-index.json (the title-only lookup) must
 * not name one, because a created page's slug is often a word another bucket's record answers to
 * ("Ram" the creature family vs the Battering Ram siege weapon, "Hyena" vs the animal companion).
 */
export function createdRefs(root) {
  const f = join(root, 'scripts/migration/out/archive-created.json');
  const created = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  return new Set(Object.entries(created).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}:${k}`)));
}

/**
 * The searchable records, indexed for the presence tests. `desc` is public/core-descriptions.json;
 * `pageOf(id)` returns the page a record's aonId names (its book and text are the record's evidence
 * when the record itself carries neither — a glossary record is {id, name, edition}).
 * `skipKeys` (the importer's view): records the importer created on its last run, which count for
 * nothing, so the importer keeps making them.
 */
export function buildIndex(core, desc = {}, pageOf = () => null, skipKeys = null) {
  const byAon = new Map(); // aonId -> [{ key, bucket }]
  const byHead = new Map(); // family head of a grade sub-document id (`equipment-3094-2771` -> `equipment-3094`) -> key
  const byName = new Map(); // `bucket|form` -> [{ key, book, text }]
  for (const [bucket, rows] of Object.entries(core)) {
    if (UNSEARCHED.has(bucket) || !rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    for (const [id, r] of Object.entries(rows)) {
      if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name) continue;
      const key = `${bucket}/${id}`;
      if (skipKeys?.has(key)) continue;
      const aonId = r.aonId ? String(r.aonId) : '';
      if (aonId) (byAon.get(aonId) ?? byAon.set(aonId, []).get(aonId)).push({ key, bucket });
      const head = /^([a-z-]+-\d+)-\d+$/.exec(aonId)?.[1];
      if (head && !byHead.has(head)) byHead.set(head, key);
      const page = aonId ? pageOf(aonId) : null;
      const entry = {
        key, name: slug(r.name), aonId,
        book: r.source?.book ?? page?.book ?? '',
        text: desc[bucket]?.[id]?.d ?? r.description ?? page?.text ?? '',
      };
      for (const f of nameForms(r.name)) {
        const k = `${bucket}|${f}`;
        (byName.get(k) ?? byName.set(k, []).get(k)).push(entry);
      }
    }
  }
  return { byAon, byHead, byName };
}

/**
 * The reprint links between these pages (same category only), and the books they pair — PER CATEGORY —
 * plus `newer`, each page's newer printings in ANY category.
 * One pool over every category let the creature pages' links vote "Core Rulebook is Dark Archives's
 * remaster", and twelve different Core Rulebook "Key Terms" sidebars then answered to Dark Archives's
 * one by name (measured 2026-09-25).
 */
export function linkContext(pages) {
  const edges = reprintEdges(pages, null);
  const byCat = new Map();
  for (const e of edges) {
    const c = pages.get(e[0])?.category;
    (byCat.get(c) ?? byCat.set(c, []).get(c)).push(e);
  }
  const pairs = new Map([...byCat].map(([c, es]) => [c, remasterBooks(pages, es)]));
  // Old -> new, ANY category (the header's second `twin`): the page's own links, and every reprint that
  // names it as what it replaces.
  const newer = new Map();
  const link = (a, b) => { if (a && b && String(a) !== String(b)) (newer.get(String(a)) ?? newer.set(String(a), new Set()).get(String(a))).add(String(b)); };
  for (const p of pages.values()) {
    link(p.id, p.superseded_by);
    for (const r of p.data?.remaster_id ?? []) link(p.id, r);
    for (const l of p.data?.legacy_id ?? []) link(l, p.id);
  }
  return { adj: linkGraph(pages, edges), pairsOf: (c) => pairs.get(c) ?? new Set(), newer };
}

/**
 * Classify one page. `ctx` = { index, adj, pairs, newer, pages, bestiary }. Returns { status, via },
 * status 'aonId' | 'bestiary' | 'item' | 'twin' | 'name' | 'missing'. `seen` is the newer-printing walk's
 * cycle guard.
 */
export function classify(page, ctx, seen = new Set()) {
  const own = bucketsOf(page.category);
  const bestiaryKind = page.category === 'creature' || page.category === 'hazard';
  const hit = (id) => {
    const hits = ctx.index.byAon.get(String(id)) ?? [];
    return hits.find((h) => own.includes(h.bucket)) ?? hits[0] ?? null;
  };
  const direct = (id) => {
    const h = hit(id);
    if (h) return { status: 'aonId', via: h.key };
    if (bestiaryKind && ctx.bestiary?.ids.has(String(id))) return { status: 'bestiary', via: 'public/data bestiary' };
    return null;
  };
  const mine = direct(page.id);
  if (mine) return mine;
  // An item-bonus page is one bonus of an item's page: that item (its own page, the family head, or the
  // reprint its `superseded_by` names — always an equipment page, or any grade of it) is the record.
  if (page.category === 'item-bonus') {
    const item = /^(.*?)-bonus-\d+$/.exec(page.id)?.[1] ?? '';
    const head = /^([a-z]+-\d+)-\d+$/.exec(item)?.[1];
    for (const id of [item, head, page.superseded_by, ...(page.data?.remaster_id ?? [])].filter(Boolean)) {
      const d = direct(id);
      if (d) return { status: 'item', via: `${d.via} (${id})` };
      const g = ctx.index.byHead?.get(String(id));
      if (g) return { status: 'item', via: `${g} (a grade of ${id})` };
    }
  }
  const linked = [...linkedIds(page.id, ctx.adj)];
  for (const other of linked) {
    const d = direct(other);
    if (d) return { status: 'twin', via: `${d.via} (${other})` };
  }
  for (const other of linked) {
    const o = ctx.pages?.get(other);
    const d = o ? byName(o, ctx, bucketsOf(o.category), bestiaryKind, linked) : null;
    if (d) return { status: 'twin', via: `${d.via} (${other} by name)` };
  }
  // The Archives' own link before the name heuristic: it names WHICH page (a Core Rulebook "Key Terms" is
  // its Player Core class, never whichever other "Key Terms" prints the most of the same words).
  return viaNewerPrinting(page, ctx, seen) ?? byName(page, ctx, own, bestiaryKind, linked) ?? { status: 'missing' };
}

/**
 * The header's second `twin`: a newer printing of this page, in any category, that is present — a page
 * of these categories by classify(), any other (a class, a spell) by carrying its own record. Returns
 * { status: 'twin', via } or null. scripts/archive-coverage-check.mjs asks it of every CREATED record too:
 * a yes there is a legacy page made beside the reprint that already answers for it.
 */
export function viaNewerPrinting(page, ctx, seen = new Set()) {
  const walked = new Set([...seen, page.id]);
  for (const other of ctx.newer?.get(page.id) ?? []) {
    if (walked.has(other)) continue;
    const o = ctx.pages?.get(other);
    let v = o ? classify(o, ctx, walked) : null;
    if (!o) {
      const hits = ctx.index.byAon.get(other) ?? [];
      if (hits.length) v = { status: 'aonId', via: hits[0].key };
    }
    if (v && v.status !== 'missing') return { status: 'twin', via: `${v.via} (${other}, its newer printing)` };
  }
  return null;
}

/*
 * The name rule. A record whose aonId is ANOTHER page of this page's own category — not the page, not a
 * printing linked to it — is first of all that other page's record, so the book is no evidence for it: a
 * book holds three different "Example" rules pages and eight "Key Terms" sidebars, one per class, and a
 * glossary record is exactly the page its aonId names (it carries no prose of its own). Only the TEXT can
 * say it is also this page — a reprint the Archives never linked (the Gamemastery Guide's Bog Rot and GM
 * Core's, Guns & Gears' Ballista and its Remastered one) prints the same words.
 */
function byName(page, ctx, buckets, bestiaryKind, linked = []) {
  const books = page.books?.length ? page.books : [page.book].filter(Boolean);
  const exact = slug(page.name);
  const pairs = ctx.pairsOf?.(page.category) ?? ctx.pairs;
  const mine = new Set([page.id, ...linked]);
  let best = null;
  const seen = new Set();
  for (const bucket of buckets) {
    for (const f of nameForms(page.name)) {
      for (const r of ctx.index.byName.get(`${bucket}|${f}`) ?? []) {
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        const another = !!r.aonId && !mine.has(r.aonId) && ctx.pages?.get(r.aonId)?.category === page.category;
        const ov = textOverlap(page.text, r.text);
        const same = !another && sameBookOrRemaster(books, r.book, pairs);
        if (!same && ov < TEXT_SAME) continue;
        const score = (r.name === exact ? 4 : 0) + (same ? 2 : 0) + ov;
        if (!best || score > best.score) best = { score, via: same ? r.key : `${r.key} (text ${ov.toFixed(2)})` };
      }
    }
  }
  if (best) return { status: 'name', via: best.via };
  if (bestiaryKind) {
    for (const r of ctx.bestiary?.byName.get(exact) ?? []) {
      if (sameBookOrRemaster(books, r.book.replace(/\s+pg\.\s*\d+.*$/, ''), pairs)) return { status: 'name', via: `bestiary "${page.name}" (${r.book})` };
    }
  }
  return null;
}

/** Categories whose home is the bestiary (public/data, the tracker's pipeline), never a core.json record. */
export const BESTIARY_CATEGORIES = new Set(['creature', 'hazard']);

/**
 * The pages the importer turns into records: missing by the rule above, not AoN-hidden, not a stub, not
 * allow-listed, not a bestiary kind — and ONE per reprinted page, the newest (gold-set R12): a missing
 * page that another missing page replaces (any category, as the rule's newer printing) is left out, and
 * becomes present as that record's twin. `pages` = id -> page (asPage), `core` = the records the Search reaches, `skipKeys` =
 * `bucket/key` of the records the importer created on its last run (they count for nothing, so a
 * regeneration makes them again). Sorted by doc id, so record keys are chosen in a stable order.
 */
export function creationPlan({ pages, core, desc = {}, allow = {}, skipKeys = null }) {
  const ctx = { index: buildIndex(core, desc, (id) => pages.get(id), skipKeys), ...linkContext(pages), pages };
  const missing = [];
  for (const p of pages.values()) {
    if (p.exclude_from_search || isStub(p) || BESTIARY_CATEGORIES.has(p.category) || allow[p.id] !== undefined) continue;
    if (classify(p, ctx).status === 'missing') missing.push(p);
  }
  const ids = new Set(missing.map((p) => p.id));
  const newest = (p) => ![...(ctx.newer.get(p.id) ?? [])].some((n) => ids.has(n));
  return missing.filter(newest).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A new record's key: the page's slug; if the bucket holds it, `<slug>-<book slug>` (the player
 * importer's rule); if that is taken too — eight Player Core "Key Terms" sidebars — `<slug>-<doc id>`.
 */
export function recordKey(page, taken) {
  for (const k of [slug(page.name), `${slug(page.name)}-${slug(page.book)}`]) if (k && !taken(k)) return k;
  return `${slug(page.name)}-${page.id}`;
}

/**
 * The allow rows the guard can re-check against the page itself, by their reason's first word:
 *   hidden:  the page is AoN exclude_from_search;
 *   stub:    the page is an unnamed "(…)" sub-action stub.
 * Their whole text is allowReason()'s, read off the page, so it cannot say what the page is not: a
 * hand-typed "a fragment of rules-2194" named the page's REPRINT as its parent, and "— " ended 64 rows
 * whose page has no name.
 * Any other reason is a stated deliberate gap, checked only for staleness (a present page fails it).
 */
export function allowReason(page) {
  const where = `${page.book}, ${page.url}`;
  if (page.exclude_from_search) return `hidden: AoN exclude_from_search — ${page.name || `no name, ${where}`}`;
  if (isStub(page)) return `stub: an AoN page with no name — ${page.name || where}`;
  return null;
}
export function allowRowHolds(reason, page) {
  const r = String(reason);
  return /^(?:hidden|stub):/.test(r) ? r === allowReason(page) : true;
}

export { bookKey };
