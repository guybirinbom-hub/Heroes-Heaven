/*
 * STUB NAMES — the computation behind src/data/stub-names.json (card step 14b; docs/card-design.md section 2
 * rule 6: "The 273 that do not resolve become a name link when a record exists, otherwise nothing").
 *
 * An embedded page stub ({t:'document', id:'feat-498', level:2}) carries an aon id and nothing else. 5,583
 * of the 5,856 shipped stubs name a record by that id (src/sheet/astStubs.ts resolveStubs draws its page);
 * the other 273 occurrences (244 distinct ids) name a page no record carries — almost all of them a LEGACY
 * printing the Archives keep beside its remaster (Quick Draw feat-498 → feat-4869), which this app does not
 * ship (records follow the newest printing). The stub alone has no name to print, so the card would draw
 * nothing where the page lists a feat. This file gives each unresolved id
 *  - `name`: the page's own name in the local Archives mirror (by-category/<category>/<id>.json `name`);
 *  - `ref`: the record that page is, when one exists — "bucket:slug", by ID ONLY (docs/card-design.md
 *    section 2 rule 2: "Identity: by {bucket,id}, never by display name"). The id relation is the mirror's
 *    printing link (`remaster_id` → the newer printing, `legacy_id` → the older one), read from EITHER
 *    side: the stub's page may name the shipped record, or the shipped record's page may name the stub.
 *      1. a record whose aonId is one of the stub page's `remaster_id`s (its newer printing, named by the
 *         stub's page; a record in the stub category's own bucket first, then the mirror's order; records
 *         with an ordinary id before `aon-` duplicates);
 *      2. else a record whose page lists the stub id in its `legacy_id` (its newer printing, named by the
 *         shipped page: rules-2300 "Skill Checks" lists rules-330 "Skill Checks and Skill DCs", whose own
 *         remaster_id names rules-2276 "Skills", a page no record carries);
 *      3. else a record whose aonId is one of the stub page's `legacy_id`s, or whose page lists the stub id
 *         in its `remaster_id` (an OLDER printing this app ships in place of the stub's page: feat-6209
 *         "Master Spotter" ↔ feat-1850 "Master Spotter (Investigator)");
 *      within tiers 2 and 3, the stub category's own bucket first, then the LOWEST aon number — the one
 *      choice a split page needs: rules-325 "Spell Attack Rolls" (Core Rulebook) is the legacy of both
 *      rules-2292 "Spell Attack Rolls" and rules-2293 "Spell DC", and links rules-2292;
 *      in every tier the linked record's page is in the stub page's OWN category: the mirror also draws a
 *      printing link across kinds of page (sidebar-47 "Affliction Example", a Core Rulebook sidebar, names
 *      rules-2389 "Afflictions" as its remaster) and that joins a different page, not another printing of
 *      it (measured 2026-10-08: tier 1 never crosses a category; this keeps rules-2389 plain);
 *      4. else null — the card prints the name as plain text. A record that merely shares the page's name
 *         is NOT the page (rules-2757 "Hit Points", GM Core pg. 84, is not rules-2891 "Hit Points", GM Core
 *         pg. 118; neither page names the other by id), so there is no name fallback.
 *    Tiers 2–3 read the shipped records' printing links from the mirror's index/legacy-remaster.json
 *    (`printingLinks`), the same fields the by-category pages carry. Measured 2026-10-08 on the lane's
 *    data: before the own-category rule, the index and a read of every shipped record's page (~14 minutes
 *    on this disk) both gave 172 linked / 72 plain ids, and all 192 links the index gives were found on
 *    their pages. With the rule: 171 linked / 73 plain; tiers 2–3 add rules-330, rules-325 and feat-6209.
 *  - `right` (when the page prints one): the badge of the page's title ("Feat 14", "Action"), drawn after
 *    the name as the embedded page's own heading would draw it.
 * The category's bucket is where the RESOLVED stubs of that category land (action → actions, feat → feats,
 * familiar-ability → familiarAbilities, rules → rules), measured from the data, not a table.
 *
 * Two-way: the file's ids are exactly the shipped unresolved stub ids (no mirror needed for that half), and
 * every ref names a shipped record; with the mirror the whole file is recomputed and must be equal
 * (test/card-stubs.test.tsx, scripts/stub-names.mjs --check). A regen that resolves or adds stubs turns
 * the check red until `npx jiti scripts/stub-names.mjs --write` re-runs on the new data.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STUB_NAMES_FILE = 'src/data/stub-names.json';
export const DEFAULT_MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';

/** Is this node an empty embedded stub below the root (astStubs.ts isEmptyStub, any id)? */
const isStub = (n, d) => (n.t === 'document' || n.t === 'doc') && d > 0 && !(n.c && n.c.length);

/** aonId → its records "bucket:slug", ordinary ids before `aon-` duplicates, then content order. */
export function aonRecords(db) {
  const out = new Map();
  for (const [b, recs] of Object.entries(db)) {
    if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
    for (const [s, r] of Object.entries(recs)) {
      if (!r || typeof r !== 'object' || typeof r.aonId !== 'string') continue;
      const l = out.get(r.aonId) ?? [];
      l.push(`${b}:${s}`);
      out.set(r.aonId, l);
    }
  }
  for (const l of out.values()) l.sort((x, y) => Number(x.split(':')[1].startsWith('aon-')) - Number(y.split(':')[1].startsWith('aon-')));
  return out;
}

/** The category of an aon id: "feat-498" → "feat", "familiar-ability-12" → "familiar-ability". */
export const categoryOf = (id) => String(id).replace(/-\d+$/, '');

/**
 * Every empty stub of every shipped tree: { unresolved: Map<id, occurrences>, categoryBucket: {category →
 * bucket} } — the bucket the RESOLVED stubs of each category land in most often.
 */
export function stubCensus(db, trees) {
  const recs = aonRecords(db);
  const unresolved = new Map();
  const landing = {};
  for (const ts of Object.values(trees)) {
    for (const t of Object.values(ts ?? {})) {
      (function walk(n, d) {
        if (isStub(n, d)) {
          const id = n.id ? String(n.id) : '';
          const hit = id ? recs.get(id) : undefined;
          if (!hit) unresolved.set(id || '(no id)', (unresolved.get(id || '(no id)') ?? 0) + 1);
          else {
            const cat = categoryOf(id);
            const b = hit[0].slice(0, hit[0].indexOf(':'));
            ((landing[cat] ??= {})[b] = (landing[cat][b] ?? 0) + 1);
          }
        }
        for (const c of n.c ?? []) walk(c, d + 1);
      })(t, 0);
    }
  }
  const categoryBucket = {};
  for (const [cat, by] of Object.entries(landing)) categoryBucket[cat] = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { unresolved, categoryBucket };
}

/** The mirror page of an aon id, or undefined. */
export function mirrorDoc(id, mirror = DEFAULT_MIRROR) {
  const p = join(mirror, categoryOf(id), `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
}

/** A mirror id field as a list of strings (the mirror writes a list; a bare string is read as one). */
const idList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);

/**
 * The mirror's printing-link index (<mirror>/../index/legacy-remaster.json: every page's legacy_id and
 * remaster_id, the same fields its by-category page carries), or undefined when the mirror has none.
 */
export function printingIndex(mirror = DEFAULT_MIRROR) {
  const p = join(mirror, '..', 'index', 'legacy-remaster.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
}

/**
 * The printing links shipped records' own pages draw to the given ids: Map<id, {newer, older}>, each a list
 * of shipped aonIds — `newer` the records whose page lists the id in its legacy_id, `older` those whose page
 * lists it in its remaster_id (header, tiers 2–3). Read from the mirror's index in one file; without it,
 * from the page of every shipped aonId (the same fields, many minutes on this disk).
 */
export function printingLinks(recs, ids, mirror = DEFAULT_MIRROR) {
  const want = new Set(ids);
  const index = printingIndex(mirror);
  const out = new Map();
  const add = (id, k, aon) => { const e = out.get(id) ?? { newer: [], older: [] }; if (!e[k].includes(aon)) e[k].push(aon); out.set(id, e); };
  for (const aon of recs.keys()) {
    const doc = index ? index[aon] : mirrorDoc(aon, mirror);
    if (!doc) continue;
    for (const x of idList(doc.legacy_id)) if (want.has(x)) add(x, 'newer', aon);
    for (const x of idList(doc.remaster_id)) if (want.has(x)) add(x, 'older', aon);
  }
  return out;
}

const aonNumber = (aon) => Number(/-(\d+)$/.exec(aon)?.[1] ?? Infinity);

/**
 * The record a name-only stub links to (tiers 1–4 of the header: by id only, never by name), or null.
 * `links` is printingLinks' entry for this id (the shipped side of the relation), when any.
 */
export function stubRef(id, doc, recs, categoryBucket, links) {
  const home = categoryBucket[categoryOf(id)];
  const own = (aons) => aons.filter((a) => categoryOf(a) === categoryOf(id));
  const remaster = own(idList(doc?.remaster_id)).flatMap((x) => recs.get(x) ?? []);
  if (remaster.length) return remaster.find((r) => r.startsWith(`${home}:`)) ?? remaster[0];
  const pick = (aons) => {
    const rs = [...new Set(own(aons))].sort((a, b) => aonNumber(a) - aonNumber(b) || a.localeCompare(b)).flatMap((a) => recs.get(a) ?? []);
    return rs.find((r) => r.startsWith(`${home}:`)) ?? rs[0] ?? null;
  };
  return pick(links?.newer ?? []) ?? pick([...idList(doc?.legacy_id), ...(links?.older ?? [])]);
}

/** The file's `names` map, recomputed (needs the mirror for the names). */
export function computeStubNames(db, trees, mirror = DEFAULT_MIRROR) {
  const { unresolved, categoryBucket } = stubCensus(db, trees);
  const recs = aonRecords(db);
  const links = printingLinks(recs, unresolved.keys(), mirror);
  const names = {};
  const missing = [];
  for (const id of [...unresolved.keys()].sort()) {
    const doc = mirrorDoc(id, mirror);
    if (!doc || typeof doc.name !== 'string') { missing.push(id); continue; }
    const right = /<title\b[^>]*?\bright="([^"]*)"/.exec(String(doc.markdown ?? ''))?.[1]?.trim();
    names[id] = { name: doc.name, ref: stubRef(id, doc, recs, categoryBucket, links.get(id)), ...(right ? { right } : {}) };
  }
  return { names, missing, unresolved };
}

/**
 * Known mirror-data defects, written into the file's `_notes` for people to read; the rules never
 * special-case them (orchestrator ruling, card step 14b round 3). stubNamesProblems checks the file's
 * `_notes` against this both ways (a note dropped, added or reworded is drift).
 */
export const STUB_NAME_NOTES = {
  'action-902': 'Mirror-data defect: "Explode" (action-902) carries legacy_id action-3666 "Interact", and action-3666 carries remaster_id action-902 - the printing link joins two different actions. No record is action-3666, so the stub draws a plain name; not special-cased.',
};

/** Problems with a file against the shipped data alone (no mirror): ids two ways, refs that ship, the
 *  `_notes` equal to STUB_NAME_NOTES. */
export function stubNamesProblems(file, db, trees, notes = STUB_NAME_NOTES) {
  const { unresolved } = stubCensus(db, trees);
  const names = file?.names ?? {};
  const out = [];
  const fileNotes = file?._notes ?? {};
  for (const id of new Set([...Object.keys(notes), ...Object.keys(fileNotes)])) {
    if (fileNotes[id] !== notes[id]) out.push(`STUB-NAMES-NOTES|${id}`);
  }
  for (const id of unresolved.keys()) if (!(id in names)) out.push(`STUB-NAME-UNLISTED|${id}`);
  for (const [id, v] of Object.entries(names)) {
    if (!unresolved.has(id)) out.push(`STUB-NAME-STALE|${id}`);
    if (v?.ref) {
      const [b, s] = String(v.ref).split(':');
      if (!db[b]?.[s]) out.push(`STUB-NAME-DEAD-REF|${id}|${v.ref}`);
    }
  }
  return out.sort();
}
