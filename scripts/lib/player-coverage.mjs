/*
 * PLAYER COVERAGE — the rule set that decides whether an Archives page a PLAYER can pick has a record
 * in the app. Read by scripts/player-coverage-check.mjs (the guard), scripts/import-core-v2.mjs (which
 * CREATES a record for every page this calls missing) and test/player-coverage.test.ts.
 *
 * Why not by aonId alone: measured 2026-09-24, the aonId-only count called most "missing" items,
 * feats, spells and backgrounds absent while they ship under ANOTHER document id — a grade
 * sub-document (`items/luck-blade` is equipment-390-479, not equipment-390), the newest printing
 * (Flame Tongue ships as Searing Blade, the Disrupting rune as Vitalizing), or a newer printing the
 * Archives do not link. So a page is PRESENT when, in this order:
 *
 *   aonId   a record OF THE PAGE'S KIND carries this page's id;
 *   twin    a page this one is LINKED to is present (by aonId, or by the name rule below). The links
 *           are the ones the documents state — `superseded_by`, `data.remaster_id`, `data.legacy_id`,
 *           plus scripts/lib/reprint.mjs's class hop and name-paired hybrid studies — SAME CATEGORY
 *           ONLY (a class-feature's remaster_id often names its CLASS page, and following that makes
 *           every feature of a class the twin of every other), and the grade family: a summary page
 *           and its sub-documents (`equipment-2852` / `equipment-2852-2683`), a sub-document standing
 *           for its parent only when it bears the parent's own name;
 *   name    a record OF THE SAME KIND has the same normalised name (a `(Qualifier)` suffix, a final
 *           plural "s" and, for a class option, THAT option's own category word — "Dragon Instinct"
 *           answers to the instinct page "Dragon", never to a bloodline page "Dragon" — do not count),
 *           AND either its book is the page's book or that book's remaster, or the two printed texts
 *           share at least TEXT_SAME of their words. The evidence half is what keeps the two
 *           different `Zombie Horde` feats apart (gold-set R12: never a bare name match across books):
 *           measured word overlap of the four known different same-name pairs is 0.10-0.24, of the
 *           known reprints 0.45-0.96. Two archetype feats of one name are two feats whatever their
 *           text shares (the two Stone Blood feats share 0.73), so a feat page and a feat record that
 *           each name an archetype must name the same one. Two specific familiars' abilities of one
 *           name, the same (see familiarOwner) — and a specific familiar's record that prints the
 *           ability inline (`specificFamiliars/house-drake`'s Breath Weapon) is that ability's record.
 *
 *           The text compared includes the RECORD's OWN prose, not only the page its aonId names: a
 *           record whose aonId points at the wrong page (`backgrounds/refugee-fall-of-plaguestone`
 *           carried the Player Core 2 page background-455) could otherwise never match its own page
 *           (0.24 against the wrong page's text, 0.94 against its own), and the importer created a
 *           second copy of it. Every candidate is weighed and the best wins — the exact name first,
 *           then the same book, then the most shared text — so the hand-back names the record that IS
 *           the page, not the first of its name (see byName).
 *
 * Everything else is MISSING — unless it is STRUCTURAL: a class-feature page that is a row of the
 * class table rather than a feature (see `structuralReason`). Structural and deliberate gaps are kept
 * in scripts/data/player-coverage-allow.json by doc id; the guard re-checks a "structural:" row
 * against this rule so the list cannot hide a real record behind the label.
 */

import { canonBookName } from './aon-facets.mjs';

export const slug = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Book identity: the shelf prefixes ("Lost Omens", "Adventure:", "Adventure Path:" — singular or
 * plural), a leading "The" and a "(Remastered)" suffix do not decide. The singular "Adventure:" was
 * missing, so "Pathfinder Adventure: The Fall of Plaguestone" never equalled the Archives' "The Fall of
 * Plaguestone" — 14 standalone adventures, ~187 shipped records.
 */
export const normBook = (s) => String(s || '').toLowerCase()
  .replace(/^pathfinder\s+/, '').replace(/^(?:lost omens|adventure paths?|adventures?)\s*:?\s*/, '').replace(/^the\s+/, '')
  .replace(/\((?:remastered|remaster)\)/g, '').replace(/[^a-z0-9]/g, '');

/**
 * One key for an Archives book name AND the name a record carries: the Archives name goes through the
 * importers' own table (scripts/data/book-names.json, via canonBookName) first, so an Adventure Path
 * volume the Archives call "Pathfinder #223: Hell's Destiny" and the record's "Pathfinder Adventure
 * Path: Hell's Destiny" are one book. A record's name is not a table key and passes through unchanged.
 */
export const bookKey = (s) => normBook(canonBookName(s) ?? s);

/** Word overlap at or above which two same-name pages print the same thing — see the header. */
export const TEXT_SAME = 0.3;

/*
 * The subclass-option categories the app MODELS: each has class-feature records carrying its pages'
 * ids (measured over core.json 2026-09-24). A category whose pages exist only as glossary stubs
 * (element, tenet, deviant-ability-classification, draconic-exemplar) is not a player option here.
 */
export const SUBCLASS_CATEGORIES = [
  'apparition', 'arcane-school', 'arcane-thesis', 'bloodline', 'cause', 'conscious-mind', 'doctrine',
  'druidic-order', 'eidolon', 'epithet', 'fatal-method', 'grim-fascination', 'hellknight-order',
  'hunters-edge', 'hybrid-study', 'ikon', 'implement', 'innovation', 'instinct', 'lesson', 'methodology',
  'muse', 'mystery', 'mythic-calling', 'patron', 'practice', 'racket', 'research-field', 'style',
  'subconscious-mind', 'way',
];

/** Archives category -> the kind it is measured as, and the app buckets that hold that kind. */
export const KINDS = {
  background: { kind: 'background', buckets: ['backgrounds'] },
  heritage: { kind: 'heritage', buckets: ['heritages'] },
  // A versatile heritage is an ANCESTRY page on the Archives and a heritage record in the app.
  ancestry: { kind: 'ancestry', buckets: ['ancestries', 'heritages'] },
  feat: { kind: 'feat', buckets: ['feats'] },
  spell: { kind: 'spell', buckets: ['spells'] },
  ritual: { kind: 'spell', buckets: ['spells'] },
  // Property runes live in the hand-authored `runes` bucket as well as `items`.
  equipment: { kind: 'item', buckets: ['items', 'runes'] },
  weapon: { kind: 'item', buckets: ['items', 'runes'] },
  armor: { kind: 'item', buckets: ['items', 'runes'] },
  shield: { kind: 'item', buckets: ['items', 'runes'] },
  'class-feature': { kind: 'classFeature', buckets: ['classFeatures'] },
  archetype: { kind: 'archetype', buckets: ['archetype'] },
  domain: { kind: 'domain', buckets: ['domain'] },
  deity: { kind: 'deity', buckets: ['deities'] },
  'familiar-ability': { kind: 'familiar', buckets: ['familiarAbilities', 'specificFamiliars'] },
  'familiar-specific': { kind: 'familiar', buckets: ['familiarAbilities', 'specificFamiliars'] },
  'animal-companion': { kind: 'companion', buckets: ['animalCompanions', 'companionAdvanced'] },
  'animal-companion-advanced': { kind: 'companion', buckets: ['animalCompanions', 'companionAdvanced'] },
  'animal-companion-unique': { kind: 'companion', buckets: ['animalCompanions', 'companionAdvanced'] },
  'animal-companion-specialization': { kind: 'specialization', buckets: ['companionSpecializations'] },
  'runesmith-rune': { kind: 'runesmithRune', buckets: ['runesmithRune'] },
  tactic: { kind: 'tactic', buckets: ['classFeatures', 'actions'] },
  ...Object.fromEntries(SUBCLASS_CATEGORIES.map((c) => [c, { kind: 'subclass', buckets: ['classFeatures'] }])),
};

/*
 * Buckets whose records are real player data. The camelCase glossary buckets import-core-v2.mjs mints
 * for every other category (`hybridStudy`, `bloodline`, `rules`, …) hold a stub for EVERY page of their
 * category, so an aonId match there says nothing — except for the two kinds whose only record IS that
 * stub (archetype, domain), which name it in KINDS.
 */
export const REAL_BUCKETS = new Set([
  'spells', 'items', 'classes', 'classFeatures', 'feats', 'ancestries', 'heritages', 'backgrounds', 'deities',
  'actions', 'animalCompanions', 'companionSpecializations', 'familiarAbilities', 'specificFamiliars',
  'companionAdvanced', 'runesmithRune', 'runes', 'vehicles', 'siegeWeapons',
]);

/**
 * CHASSIS rows: a class-table line that grants a SLOT or a proficiency block, which the app models
 * structurally (the Builder's level plan), never as a record. `<Class> Feats` is the class-feat slot.
 */
const CHASSIS = new Set([
  'ancestry-and-background', 'attribute-boosts', 'ability-boosts', 'initial-proficiencies', 'skill-feats',
  'general-feats', 'skill-increases', 'ancestry-feats', 'ancestry-feat', 'class-feats',
]);

/** A trailing "(Qualifier)" that separates two records of one name — never a grade of one item. */
const GRADE = /^(?:lesser|minor|moderate|greater|major|true|supreme|standard|basic|expert|master|legendary|rank \d+|type [ivx]+|\d+(?:st|nd|rd|th)[- ](?:rank|level))$/i;
/** The names a record or page answers to for the name rule: its slug, minus a `(Qualifier)`, minus a
 *  final plural "s". */
export function nameForms(name) {
  const out = new Set([slug(name)]);
  const q = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(name ?? ''));
  if (q && !GRADE.test(q[2].trim())) out.add(slug(q[1]));
  // A plural the other printing spells singular: the War of Immortals epithet page "Restless as the
  // Tides" ships as classFeatures/restless-as-the-tide, "Restless as the Tide". Still needs the book or
  // text evidence every name match needs.
  for (const s of [...out]) if (s.length > 4 && s.endsWith('s') && !s.endsWith('ss')) out.add(s.slice(0, -1));
  return out;
}

/**
 * A class option's name without ITS category's words, keyed by that category: "Bloodline: Fey" is
 * `bloodline:fey`, "Dragon Instinct" `instinct:dragon`, "Anger Phantom Eidolon" `eidolon:anger-phantom`.
 * An instinct page asks only under `instinct:` — stripping every category's words from every record
 * (the first cut) let the barbarian's Elemental instinct page match the sorcerer's "Bloodline:
 * Elemental". A name holding none of a category's words gets no key under it; its bare forms stand.
 */
const SUBCLASS_WORDS = SUBCLASS_CATEGORIES.map((c) => [c, new Set(c.split('-'))]);
function categoryForms(name, only) {
  const out = [];
  for (const [c, words] of SUBCLASS_WORDS) {
    if (only && c !== only) continue;
    for (const s of nameForms(name)) {
      const parts = s.split('-');
      if (!parts.some((w) => words.has(w))) continue;
      const kept = parts.filter((w) => !words.has(w)).join('-');
      if (kept) out.push(`${c}:${kept}`);
    }
  }
  return out;
}

const words = (t) => new Set(String(t ?? '').toLowerCase().replace(/source [^.]*? pg\. \d+/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/** Share of distinct words two texts have in common (Jaccard). */
export function textOverlap(a, b) {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}

/**
 * The app's records, indexed for the three presence tests. `desc` (optional) is
 * public/core-descriptions.json, the text of a record that carries no aonId.
 */
export function buildIndex(core, desc = {}) {
  const byAon = new Map(); // aonId -> [{ key, bucket }]
  const byName = new Map(); // `bucket|form` -> [{ key, book, aonId, text }]
  for (const [bucket, rows] of Object.entries(core)) {
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    for (const [id, r] of Object.entries(rows)) {
      if (!r || typeof r !== 'object') continue;
      const key = `${bucket}/${id}`;
      const aonId = r.aonId ? String(r.aonId) : '';
      if (aonId && (REAL_BUCKETS.has(bucket) || bucket === 'archetype' || bucket === 'domain')) {
        (byAon.get(aonId) ?? byAon.set(aonId, []).get(aonId)).push({ key, bucket });
      }
      const entry = {
        key, name: slug(r.name ?? id), book: r.source?.book ?? '', aonId, text: desc[bucket]?.[id]?.d ?? r.description ?? '',
        archetype: typeof r.archetype === 'string' ? r.archetype : '',
        // A specific familiar prints its own abilities inline (see familiarOwner).
        ...(bucket === 'specificFamiliars' && Array.isArray(r.specials) ? { specials: r.specials.map((s) => slug(s?.name)) } : {}),
      };
      const forms = [...nameForms(r.name ?? id), ...(bucket === 'classFeatures' ? categoryForms(r.name ?? id) : [])];
      for (const f of new Set(forms)) {
        const k = `${bucket}|${f}`;
        (byName.get(k) ?? byName.set(k, []).get(k)).push(entry);
      }
    }
  }
  // Class tables: class slug -> the record ids its table names (for the per-class-copy rule).
  const classRows = new Map();
  for (const [cid, cl] of Object.entries(core.classes ?? {})) {
    classRows.set(cid, new Set((cl.features ?? []).map((f) => f.featureId)));
  }
  return { byAon, byName, classRows, classFeatures: core.classFeatures ?? {} };
}

/**
 * Which books are each other's remaster, READ FROM THE DATA: every reprint link the documents state
 * (old page -> new page) votes for (old book -> new book). A pair needs `min` votes so one stray
 * cross-book reprint does not make two unrelated books "the same".
 */
export function remasterBooks(docs, links, min = 3) {
  const votes = new Map();
  for (const [oldId, newId] of links) {
    const a = bookKey(docs.get(oldId)?.book); const b = bookKey(docs.get(newId)?.book);
    if (!a || !b || a === b) continue;
    const k = `${a}>${b}`;
    votes.set(k, (votes.get(k) ?? 0) + 1);
  }
  const pairs = new Set();
  for (const [k, n] of votes) if (n >= min) { const [a, b] = k.split('>'); pairs.add(`${a}>${b}`); pairs.add(`${b}>${a}`); }
  return pairs;
}

/**
 * Every reprint edge the documents state, old -> new, between two pages of the same KIND (a spell
 * reprinted as a ritual — Glyph of Warding, spell-138 -> ritual-124 — is one spell; a class feature
 * whose `remaster_id` names its CLASS page is not an edge, see the header).
 */
export function reprintEdges(docs, reprint) {
  const edges = [];
  const kindOf = (d) => KINDS[d.category]?.kind ?? `cat:${d.category}`;
  const push = (a, b) => {
    const A = docs.get(String(a)); const B = docs.get(String(b));
    if (A && B && A !== B && kindOf(A) === kindOf(B)) edges.push([String(a), String(b)]);
  };
  for (const [id, d] of docs) {
    if (d.superseded_by) push(id, d.superseded_by);
    for (const r of d.data?.remaster_id ?? []) push(id, r);
    for (const l of d.data?.legacy_id ?? []) push(l, id);
  }
  for (const [a, b] of reprint?.next ?? []) push(a, b);
  return edges;
}

/** The grade family: `equipment-2852-2683` -> parent `equipment-2852`. */
const parentOf = (id) => /^(.*-\d+)-\d+$/.exec(id)?.[1] ?? null;

/** Undirected adjacency over the reprint edges plus the grade family, built once. */
export function linkGraph(docs, edges) {
  const adj = new Map();
  const add = (a, b) => { if (a === b) return; (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b); };
  for (const [a, b] of edges) { add(a, b); add(b, a); }
  for (const id of docs.keys()) {
    const p = parentOf(id);
    if (!p || !docs.has(p)) continue;
    add(p, id); // a summary page is covered by any of its grades
    if (slug(docs.get(id)?.name) === slug(docs.get(p)?.name)) add(id, p); // a grade stands for its parent only under the parent's name
  }
  return adj;
}

export function linkedIds(id, adj, maxHops = 4) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < maxHops && frontier.length; h++) {
    const next = [];
    for (const x of frontier) for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); next.push(y); }
    frontier = next;
  }
  seen.delete(id);
  return seen;
}

/** Same book, or a book the data shows is its remaster (either direction). */
export function sameBookOrRemaster(pageBooks, recBook, pairs) {
  const b = bookKey(recBook);
  if (!b) return false;
  return pageBooks.some((p) => { const a = bookKey(p); return a === b || pairs?.has(`${a}>${b}`); });
}

/**
 * STRUCTURAL, for a class-feature page only. Returns the rule that excludes it, or null.
 *   chassis       the row is a slot or proficiency block (CHASSIS above, or "<Class> Feats");
 *   legacy-class  a row of a LEGACY class printing the Archives say was reprinted — its own
 *                 `superseded_by` / `remaster_id` names the new CLASS page, not a feature. The app
 *                 ships the reprinted class whole (gold-set R12), so the old table's rows (Lightning
 *                 Reflexes where the remaster prints Reflex Expertise) are not records;
 *   shared        the class's own table in the app names a record of this name (bare or `-<class>`)
 *                 that is NOT this page — one record the app shares across classes.
 */
export function structuralReason(page, index, docs) {
  if (page.category !== 'class-feature') return null;
  const n = slug(page.name);
  const cls = slug(page.data?.class ?? '');
  if (CHASSIS.has(n) || (cls && n === `${cls}-feats`)) return 'chassis';
  const to = [page.superseded_by, ...(page.data?.remaster_id ?? [])].filter(Boolean).map(String);
  if (to.some((id) => docs?.get(id)?.category === 'class' || /^class-\d+$/.test(id))) return 'legacy-class';
  const rows = index.classRows.get(cls);
  if (!rows) return null;
  for (const id of [n, `${n}-${cls}`]) {
    if (rows.has(id) && index.classFeatures[id]) return `shared:classFeatures/${id}`;
  }
  // …or the table names a record whose NAME is this page's (a renamed id such as `alertness`).
  for (const id of rows) if (slug(index.classFeatures[id]?.name) === n) return `shared:classFeatures/${id}`;
  return null;
}

/** The archetype(s) a feat page names, as slugs (the export's `data.archetype`). */
const pageArchetypes = (page) => [].concat(page.data?.archetype ?? []).map(slug).filter(Boolean);

/**
 * The specific familiar a familiar-ability page belongs to (`data.ability_type` "Specific Familiar -
 * House Drake" -> `house-drake`), or ''. Two abilities of one name on two specific familiars are two
 * abilities, like two archetypes' feats: the House Drake's Breath Weapon (1 action, Will) and the
 * Faerie Dragon's (2 actions, Fortitude) share 0.59 of their words, over TEXT_SAME, and the House
 * Drake's page counted as present through `familiarAbilities/breath-weapon`, the Faerie Dragon's.
 */
export const familiarOwner = (page) => slug(/^Specific Familiar - (.+)$/.exec(String(page?.data?.ability_type ?? ''))?.[1]);

/**
 * The name rule for one page: a same-kind record with a matching name form and book-or-text evidence.
 * `skip(entry)` lets the importer ignore the record it created for this very page.
 *
 * Every candidate is scored and the best returned (see the header): the record whose name IS the
 * page's first (over one that matches only without its qualifier: the page "Aeon Stone (Western Star)"
 * is the record of that name, not the same book's "Aeon Stone (Eastern Star)"), then the same book,
 * then the most shared text. The text is the better of
 * the record's OWN prose and its aonId page's: its own is what survives a wrong aonId (the refugee
 * case), its page's is what survives a Foundry-era rewording of a correctly linked record.
 */
function byName(page, ctx, skip) {
  const spec = KINDS[page.category];
  const books = page.books?.length ? page.books : [page.book].filter(Boolean);
  const keys = [...nameForms(page.name), ...(spec.kind === 'subclass' ? categoryForms(page.name, page.category) : [])];
  // A bare page name ("Elemental") also asks under its own category ("instinct:elemental").
  if (spec.kind === 'subclass') for (const f of nameForms(page.name)) keys.push(`${page.category}:${f}`);
  const pageText = ctx.textOf?.(page.id) ?? page.text;
  const exact = slug(page.name);
  const arch = page.category === 'feat' ? pageArchetypes(page) : [];
  const owner = page.category === 'familiar-ability' ? familiarOwner(page) : '';
  if (owner) {
    // The specific familiar's own record printing this ability inline IS the page's record.
    for (const f of nameForms(page.data.ability_type.replace(/^Specific Familiar - /, ''))) {
      const fam = (ctx.index.byName.get(`specificFamiliars|${f}`) ?? []).find((r) => !skip?.(r) && r.specials?.includes(exact));
      if (fam) return { status: 'name', via: `${fam.key} (inline ability)` };
    }
  }
  let best = null;
  const seen = new Set();
  for (const bucket of spec.buckets) {
    for (const f of new Set(keys)) {
      for (const r of ctx.index.byName.get(`${bucket}|${f}`) ?? []) {
        if (seen.has(r.key) || skip?.(r)) continue;
        seen.add(r.key);
        if (arch.length && r.archetype && !arch.includes(r.archetype)) continue;
        if (owner && r.aonId) {
          const theirs = familiarOwner(ctx.docs?.get(r.aonId));
          if (theirs && theirs !== owner) continue;
        }
        // The hand-authored `runes` carry no book and are one kind only: a same-name rune IS this rune
        // (scored as a same-book match, so an `items` record of the page's own book still wins).
        const rune = bucket === 'runes';
        const ov = rune ? 0 : Math.max(
          textOverlap(pageText, r.text),
          r.aonId && ctx.textOf ? textOverlap(pageText, ctx.textOf(r.aonId)) : 0,
        );
        const same = rune || sameBookOrRemaster(books, r.book, ctx.pairs);
        if (!same && ov < TEXT_SAME) continue;
        const score = (r.name === exact ? 4 : 0) + (same ? 2 : 0) + ov;
        if (!best || score > best.score) best = { score, via: same ? r.key : `${r.key} (text ${ov.toFixed(2)})` };
      }
    }
  }
  return best ? { status: 'name', via: best.via } : null;
}

/**
 * Classify one page. `ctx` = { index, adj, pairs, docs, textOf? }. Returns { status, via } where
 * status is 'aonId' | 'twin' | 'name' | 'structural' | 'missing'.
 *
 * `opts.skipKeys` — the importer's view: a Set of `bucket/key` records the importer CREATED on its
 * last run (scripts/migration/out/player-created.json). They count neither as a page's presence nor as
 * a same-name match; without that the rule would call its own output "present" and stop re-creating it
 * on the next regeneration.
 */
export function classify(page, ctx, opts = {}) {
  const spec = KINDS[page.category];
  if (!spec) return { status: 'n/a' };
  const { index, adj } = ctx;
  const skipKeys = opts.skipKeys?.size ? opts.skipKeys : null;
  /* A record OF THIS KIND carrying the id. Any real bucket used to do, and 75 pages were handed back as
   * present through a record of another kind that carries their id by mistake — feat-3852 Borrow Time
   * through `items/aon-borrow-time`, archetype-257 Medic through `familiarAbilities/medic`. Each of the
   * 75 has a record of its own kind too (measured 2026-09-24), so the hand-back now names that one. */
  const hit = (id) => index.byAon.get(String(id))?.find((h) => spec.buckets.includes(h.bucket) && !skipKeys?.has(h.key));
  const skip = skipKeys ? (r) => skipKeys.has(r.key) : null;
  const mine = hit(page.id);
  if (mine) return { status: 'aonId', via: mine.key };
  // A linked page's own record first, over any linked page matched only by name.
  const linked = [...linkedIds(page.id, adj)];
  for (const other of linked) {
    const h = hit(other);
    if (h) return { status: 'twin', via: `${h.key} (${other})` };
  }
  for (const other of linked) {
    const o = ctx.docs?.get(other);
    const n = o && KINDS[o.category] ? byName(o, ctx, skip) : null;
    if (n) return { status: 'twin', via: `${n.via} (${other} by name)` };
  }
  const n = byName(page, ctx, skip);
  if (n) return n;
  const why = structuralReason(page, index, ctx.docs);
  if (why) return { status: 'structural', via: why };
  return { status: 'missing' };
}
