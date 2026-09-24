/*
 * PLAYER RECORD CREATION — which Archives pages the importer turns into NEW records, and the linkage
 * a new record needs to be pickable. Owner, 2026-09-24: "the players' missing data is more important
 * — add it". Read by scripts/import-core-v2.mjs (creates) and scripts/import-siege-and-gaps.mjs
 * (re-appends a class option its backfill re-apply may have replaced).
 *
 * WHY NOT JUST WIDEN FRESH_BUCKETS. Measured 2026-09-24: letting every new slug of backgrounds,
 * heritages, class features, ancestries and deities through would create ~104 records, of which only
 * 28 are missing — the rest are class-table chassis rows ("Ancestry and Background", "Kineticist
 * Feats"), renamed rows of reprinted class tables, versatile heritages the app already ships as
 * heritages, and backgrounds it ships under another key. So creation is gated by the SAME rule the
 * coverage guard applies (scripts/lib/player-coverage.mjs): a page is created exactly when that rule
 * calls it missing, it is not AoN-hidden and scripts/data/player-coverage-allow.json does not name it.
 * The guard and the importer cannot disagree about what is missing.
 *
 * NO INVENTED MECHANICS: a created record carries the page's text, traits, rarity, level,
 * prerequisites, action cost, book and edition (plus aonId and its display tree through the usual
 * chain). Mechanics are the parity batch's job. The only structure added is what makes the record
 * pickable at all — a heritage's ancestry, a class option's place in its class's option list — and
 * each of those is read from the data, never guessed; a page whose linkage cannot be read is
 * REPORTED and not created.
 */
import { KINDS, TEXT_SAME, buildIndex, classify, linkGraph, reprintEdges, remasterBooks, slug, textOverlap } from './player-coverage.mjs';

/** Archives category -> the bucket a NEW page of it is created in. Kinds absent here have no creator. */
export const CREATE_BUCKET = {
  background: 'backgrounds', heritage: 'heritages', feat: 'feats', spell: 'spells', ritual: 'spells',
  equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', 'class-feature': 'classFeatures',
  ...Object.fromEntries(Object.entries(KINDS).filter(([, k]) => k.kind === 'subclass').map(([c]) => [c, 'classFeatures'])),
};

/** A document as the coverage rule reads it (the export's full doc carries everything but `books`). */
const asPage = (d) => ({
  ...d,
  books: [...new Set([d.book, ...(d.data?.source ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))],
  exclude_from_search: d.exclude_from_search === 1 || d.exclude_from_search === true,
});

/**
 * The pages to create: missing by the coverage rule, not AoN-hidden, not allow-listed. `docs` = id ->
 * export doc (full), `reprint` = buildReprintMap(docs), `prevCreated` = the last run's
 * player-created.json, whose records the rule must not count as presence (see classify's skipKeys).
 * Returns { create: [{ doc, bucket }], noCreator: [doc] }.
 */
export function creationPlan({ docs, reprint, shippedCore, shippedDesc, allow, prevCreated = {} }) {
  const pages = new Map();
  for (const [id, d] of docs) if (KINDS[d?.category] && d.name) pages.set(id, asPage(d));
  const edges = reprintEdges(pages, reprint);
  const ctx = {
    index: buildIndex(shippedCore, shippedDesc), adj: linkGraph(pages, edges), pairs: remasterBooks(pages, edges),
    docs: pages, textOf: (id) => pages.get(String(id))?.data?.text,
  };
  const skipKeys = new Set(Object.entries(prevCreated).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}/${k}`)));
  const missing = [];
  for (const page of pages.values()) {
    if (page.exclude_from_search || allow[page.id] !== undefined) continue;
    if (classify(page, ctx, { skipKeys }).status === 'missing') missing.push(page);
  }
  /*
   * ONE RECORD PER REPRINTED PAGE, THE NEWEST (gold-set R12). When a page and its own reprint are BOTH
   * missing — the Bounty Hunter's Keep Pace, Advanced Player's Guide feat-1917 and its Player Core 2
   * reprint feat-6284 — the rule calls both missing only because neither has a record yet. Creating the
   * reprint makes the older page present as its twin, so the older page is not created (the first run
   * made `keep-pace-advanced-players-guide` beside `keep-pace-player-core-2`).
   */
  const missingIds = new Set(missing.map((p) => p.id));
  const hasNewer = new Set(edges.filter(([oldId, newId]) => missingIds.has(newId)).map(([oldId]) => oldId));
  const create = [];
  const noCreator = [];
  for (const page of missing) {
    if (hasNewer.has(page.id)) continue;
    const bucket = CREATE_BUCKET[page.category];
    if (bucket) create.push({ doc: docs.get(page.id), bucket });
    else noCreator.push(page);
  }
  return { create, noCreator };
}

/**
 * The ancestry a heritage belongs to, from its NAME: "Defensive Automaton" -> automaton. The Archives
 * give heritages no ancestry field. Measured over the 279 shipped heritages whose name ends in an
 * ancestry's name: 257 of 257 carry exactly that ancestry, none another. No match (or two) -> null.
 */
export function ancestryOf(name, ancestries) {
  const n = slug(name);
  const hits = Object.values(ancestries ?? {}).filter((a) => { const s = slug(a.name); return n === s || n.endsWith(`-${s}`); });
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * A class option's linkage, read from its SIBLINGS — the shipped class-feature records of the same
 * Archives category (and, when the page states a level, the same level: a level-7 epithet is a
 * dominion epithet, a level-3 one a root epithet). They must agree on traits, level, action cost and
 * otherTags or nothing is copied. The class option list is the one holding most siblings; an option
 * of this name already in it lends its id, so the record and the option stay one pick.
 */
export function subclassLink(doc, shippedCore) {
  const prefix = `${doc.category}-`;
  let sibs = Object.values(shippedCore.classFeatures ?? {}).filter((r) => String(r?.aonId ?? '').startsWith(prefix)
    && /^\d+$/.test(String(r.aonId).slice(prefix.length)));
  if (typeof doc.level === 'number') sibs = sibs.filter((r) => r.level === doc.level);
  if (!sibs.length) return { error: `no shipped ${doc.category} record to take its linkage from` };
  const shape = (r) => JSON.stringify([r.traits ?? [], r.level, r.actionCost ?? null, r.otherTags ?? []]);
  if (new Set(sibs.map(shape)).size !== 1) return { error: `its ${sibs.length} siblings disagree on traits/level/actionCost/otherTags` };
  const [traits, level, actionCost, otherTags] = JSON.parse(shape(sibs[0]));
  const sibIds = new Set(sibs.map((r) => r.id));
  let best = null;
  for (const [classId, cl] of Object.entries(shippedCore.classes ?? {})) {
    for (const g of [cl.subclass ? { ...cl.subclass, id: '(subclass)' } : null, ...(cl.extraChoices ?? [])]) {
      const n = (g?.options ?? []).filter((o) => sibIds.has(o.id)).length;
      if (n && (!best || n > best.n)) best = { n, classId, groupId: g.id, options: g.options };
    }
  }
  /* The option of this name — or of this name bar a trailing letter or word ("Restless as the Tide",
   * the option, for the page "Restless as the Tides") when its text says it is the same option. */
  const n = slug(doc.name);
  const option = best?.options.find((o) => slug(o.name) === n)
    ?? best?.options.find((o) => { const s = slug(o.name); return (n.startsWith(s) || s.startsWith(n)) && textOverlap(o.description, doc.data?.text) >= TEXT_SAME; });
  return {
    traits, level, actionCost, otherTags,
    classId: best?.classId ?? null, groupId: best?.groupId ?? null, optionId: option?.id ?? null,
  };
}

/**
 * Append each created class option to its class's option list when the list does not hold it yet.
 * Runs AFTER an effect-backfill application, because a backfill row may set a whole options array.
 * `created` = scripts/migration/out/player-created.json. Returns how many options were appended.
 */
export function appendSubclassOptions(db, created) {
  let appended = 0;
  for (const [id, meta] of Object.entries(created?.classFeatures ?? {})) {
    if (!meta?.classId || !meta.groupId) continue;
    const cl = db.classes?.[meta.classId];
    const g = meta.groupId === '(subclass)' ? cl?.subclass : (cl?.extraChoices ?? []).find((x) => x.id === meta.groupId);
    const rec = db.classFeatures?.[id];
    if (!g || !rec || (g.options ?? []).some((o) => o.id === id)) continue;
    (g.options ??= []).push({ id, name: rec.name, ...(rec.description ? { description: rec.description } : {}) });
    appended++;
  }
  return appended;
}
