/*
 * THE NEWEST PRINTING WINS — one rule, every reader.
 *
 * Owner's rule, 2026-09-12, verbatim:
 *   "we cant be using old data (not to be confused with pre remaster and after remster data)"
 * and the standing gold-set rule R12 ("The newest printing wins, whole", docs/gold-set-answers.md):
 * where the SAME thing was reprinted in a newer book, the record must come from the NEWEST printing —
 * its page, text, traits, numbers, edition. Legacy content that was never reprinted stays exactly as
 * it is; nothing is deleted or merged; a record's slug never changes (slugs key overlay rows, tests
 * and saved characters).
 *
 * THE LINK IS IN THE DATA, so this never guesses from a name (two different feats are both named
 * `Zombie Horde`, two `Stone Blood`, two `Death from Above`). Archives documents state the pairing
 * themselves, in the export at <category>.json -> .docs[id].data:
 *
 *   data.legacy_id    ARRAY of the document ids this document replaces   (the reprint says so)
 *   data.remaster_id  ARRAY of the documents that replace this one       (the replaced doc says so)
 *
 * Worked example: action-4260 "Spellstrike" (Impossible Magic, 2026-07-30) carries
 * legacy_id ['action-755']; action-755 (Secrets of Magic, 2021) carries no remaster_id at all — which
 * is why BOTH directions are indexed here, and why the export's own derived `superseded_by` (225 of
 * the 231 pairs in action.json) is not enough on its own.
 *
 * Only SAME-CATEGORY links are followed: 1,283 of the links cross categories, and a bucket's allowed
 * categories are already constrained by scripts/lib/aonid-categories.mjs.
 *
 * ONE CROSS-CATEGORY LINK IS FOLLOWED, by the owner's ruling of 2026-09-23. When a book reprints a
 * CLASS, AoN does not link feature-to-feature: every reprinted class feature carries the legacy
 * CLASS as its `legacy_id`. `class-feature-1258` "Magus Spellcasting" (Impossible Magic) says
 * `legacy_id: ["class-17"]`, which is the Secrets of Magic *class* page, not the feature it replaces.
 * The owner: follow that link into the class's features and let the reprint take the slug. That is
 * `classHopPairs()` below, and it is not an Impossible Magic special case — 22 legacy classes are
 * linked this way, Player Core and Player Core 2 included, 458 feature pairs in total.
 *
 * It is deliberately NOT a name guess across the whole corpus. The hop is only offered when the
 * reprint and exactly one feature OF THE LINKED CLASS share a normalised name, and `repointDoc`
 * additionally refuses unless the RECORD's own key is that legacy feature's name (optionally with
 * its class appended). Measured on the shipped artefact before it went in: 30 records sit on the
 * legacy side of a pair, 23 pass the key guard and move, and the 7 it refuses are exactly the ones
 * that would have been wrong — `classFeatures/weapon-expertise-swashbuckler`,
 * `medium-armor-expertise-inventor`, `greater-weapon-specialization-barbarian` and the four
 * `spell-repertoire-<class>` records, each of which carries ANOTHER class's slug while pointing at a
 * magus/summoner document.
 *
 * ONE CATEGORY IS PAIRED BY NAME, for the same ruling and with the same guard: `hybrid-study`. AoN
 * states no link at all there — neither `legacy_id` nor `remaster_id` on any of the 16 documents —
 * so there is nothing to follow. It is a closed per-class option set in which a repeated name is
 * always a reprint (measured: the only repeats are the five Secrets of Magic studies reprinted in
 * Impossible Magic), which is exactly the condition the "never guess from a name" rule above is
 * protecting against and does not hold here. `eidolon` has the same shape and is deliberately NOT
 * listed: core.json has no eidolon record to repoint, so a rule for it would have no reader.
 *
 * TWO EXCEPTIONS, in this order:
 *   1. an overlay `aonId` ruling wins. Not expressed here — the callers own it: import-core-v2 keeps a
 *      record's own `aonId` (only effect-backfill.json can put one there) ahead of every hop, and
 *      stamp-aonid.mjs re-applies the authored aon* rows LAST, after the map has been stamped.
 *   2. a reprint whose own slug ALREADY SHIPS as a separate record is not followed — repointing would
 *      collapse two records onto one page, which is a merge decision for the owner, not a repair.
 *      That is `hasKey` below (measured 2026-09-12: 182 such records, e.g. spells/acid-splash, whose
 *      reprint spell-1461 "Caustic Blast" ships as spells/caustic-blast in its own right).
 *      The owner answered that on the same day (desk #158): both records stay, the old one is marked
 *      `edition: 'legacy'` — hidden by the hide-legacy toggle, NOT always hidden like `superseded` —
 *      and carries `remasteredAs` pointing at the reprint's record. `shippedTwin()` below is that
 *      case named once, for the stamp and the guard to share.
 *
 * Readers: scripts/import-core-v2.mjs (the join + the AST writer), scripts/migration/build-map.mjs
 * (so stamp-aonid stamps R and the regen is a fixed point), scripts/reprint-check.mjs (the guard).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT } from './edition.mjs';

export const EXPORT_DIR = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';

/** The same slug rule import-core-v2.mjs mints record keys with. */
export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Categories AoN gives no reprint link at all, paired by name instead — see the header. */
const NAME_PAIRED = new Set(['hybrid-study']);

/** Name comparison for the two derived rules. Slug equality, so casing and "&"/"and" do not decide. */
const sameName = (a, b) => slugify(a ?? '') !== '' && slugify(a ?? '') === slugify(b ?? '');

/**
 * Map a replaced document id to the document that replaces it (one hop), from any id -> doc iterable.
 * Newest release date wins when a document was replaced more than once in a single hop.
 *
 * Returns `{ docs, next, derived }`. `derived` names the pairs the documents did NOT state outright —
 * the class hop and the name-paired categories — so `repointDoc` can hold them to a stricter test than
 * a link AoN wrote down itself.
 */
export function buildReprintMap(entries) {
  const docs = entries instanceof Map ? entries : new Map(entries);
  const next = new Map();
  const derived = new Map();
  const catOf = (d) => d?.category ?? d?.cat;
  const offer = (oldId, newId) => {
    if (oldId === newId) return false;
    const o = docs.get(oldId); const n = docs.get(newId);
    if (!o || !n || catOf(o) !== catOf(n)) return false;
    const cur = next.get(oldId);
    if (cur) {
      const c = docs.get(cur);
      const a = String(c?.release_date ?? ''); const b = String(n.release_date ?? '');
      if (a > b || (a === b && cur <= newId)) return false;
    }
    next.set(oldId, newId);
    return true;
  };
  for (const [id, d] of docs) {
    for (const l of d?.data?.legacy_id ?? []) offer(String(l), id);      // the reprint names what it replaces
    for (const r of d?.data?.remaster_id ?? []) offer(id, String(r));    // the replaced doc names its reprint
  }

  /*
   * THE CLASS HOP (owner, 2026-09-23). A class-feature reprint whose `legacy_id` names a CLASS
   * document is resolved into that class's own features. The class page's `url` is the join key:
   * every class-feature document carries the url of the class it belongs to (`/Classes.aspx?ID=17`),
   * which is how "the features of class-17" is expressed in this data.
   *
   * Refused rather than guessed when the name does not identify exactly one feature of that class:
   * those are the genuine RENAMES (Alertness -> Perception Expertise, Ability Boosts -> Attribute
   * Boosts), and a rename is a class-TABLE change, not a record repoint — the legacy slug there is
   * shared by a dozen other classes and moving it would rewrite all of them.
   */
  const featuresByClassUrl = new Map();
  for (const [id, d] of docs) {
    if (catOf(d) !== 'class-feature' || !d?.url) continue;
    const u = String(d.url);
    (featuresByClassUrl.get(u) ?? featuresByClassUrl.set(u, []).get(u)).push(id);
  }
  for (const [rid, R] of docs) {
    if (catOf(R) !== 'class-feature') continue;
    for (const l of R?.data?.legacy_id ?? []) {
      const L = docs.get(String(l));
      if (!L || catOf(L) !== 'class' || !L.url) continue;
      const hits = (featuresByClassUrl.get(String(L.url)) ?? [])
        .filter((id) => id !== rid && sameName(docs.get(id)?.name, R.name));
      if (hits.length !== 1) continue;
      const D = docs.get(hits[0]);
      // Same guard as `offer`: only ever forward in time.
      if (String(D?.release_date ?? '') >= String(R.release_date ?? '')) continue;
      if (offer(hits[0], rid)) derived.set(hits[0], { name: D.name, class: D?.data?.class ?? R?.data?.class ?? '' });
    }
  }

  /*
   * NAME-PAIRED CATEGORIES. Same ruling, no link to follow at all — see the header for why the
   * "never guess from a name" rule does not reach these. Ambiguity is refused, not resolved.
   */
  const byCatName = new Map();
  for (const [id, d] of docs) {
    if (!NAME_PAIRED.has(String(catOf(d)))) continue;
    const k = `${catOf(d)}|${slugify(d?.name ?? '')}`;
    (byCatName.get(k) ?? byCatName.set(k, []).get(k)).push(id);
  }
  for (const ids of byCatName.values()) {
    if (ids.length < 2) continue;
    const sorted = ids.slice().sort((a, b) =>
      String(docs.get(a)?.release_date ?? '').localeCompare(String(docs.get(b)?.release_date ?? '')) || a.localeCompare(b));
    const newest = sorted[sorted.length - 1];
    const secondDate = String(docs.get(sorted[sorted.length - 2])?.release_date ?? '');
    if (secondDate === String(docs.get(newest)?.release_date ?? '')) continue;   // a tie is not an answer
    for (const id of sorted.slice(0, -1)) {
      if (offer(id, newest)) derived.set(id, { name: docs.get(id)?.name ?? '', class: '' });
    }
  }

  return { docs, next, derived };
}

/** Build the index by reading the export directly (for scripts that do not already hold the docs). */
export function loadReprintIndex(exportDir = EXPORT_DIR) {
  const docs = new Map();
  for (const f of readdirSync(exportDir).filter((x) => x.endsWith('.json'))) {
    const cat = f.replace(/\.json$/, '');
    let bag;
    try { bag = JSON.parse(readFileSync(join(exportDir, f), 'utf8')).docs; } catch { continue; }
    // Slim copies only: the whole export is ~45,500 documents and their `ast` trees dwarf everything
    // else, so keeping the parsed blob alive would cost hundreds of MB for four fields.
    for (const [id, d] of Object.entries(bag ?? {})) {
      if (docs.has(id)) continue;
      docs.set(id, {
        id,
        category: d?.category ?? cat,
        name: String(d?.name ?? d?.data?.name ?? '').trim(),
        // The class hop joins a class-feature to its class through the class page's url, so `url` has
        // to survive the slimming too. One short string per document.
        url: d?.url ?? d?.data?.url,
        book: d?.book ?? (Array.isArray(d?.data?.source) ? d.data.source[0] : undefined),
        // EVERY book this document is printed in — `book` is only the first, and a document reprinted
        // into two books names both. scripts/reprint-check.mjs compares a record's source.book against
        // this list, so taking the first would report a correct record as stale.
        books: [...new Set([d?.book, ...(d?.data?.source ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))],
        release_date: d?.release_date ?? d?.data?.release_date ?? '',
        // shippedTwin() below refuses to call a CURRENT printing "the old page", so the edition has to
        // survive the slimming — it is one short string per document.
        edition: d?.edition ?? d?.data?.edition ?? '',
        data: { legacy_id: d?.data?.legacy_id, remaster_id: d?.data?.remaster_id, class: d?.data?.class },
      });
    }
  }
  return buildReprintMap(docs);
}

/**
 * Follow the reprint chain (D -> R1 -> R2 …) to the newest document that exists.
 * Cycle-guarded and hop-capped. Returns `null` when `id` is already the newest printing.
 */
export function newestPrinting({ next }, id) {
  let cur = String(id);
  const seen = new Set([cur]);
  let last = null;
  for (let hop = 0; hop < 8; hop++) {
    const nxt = next.get(cur);
    if (!nxt || seen.has(nxt)) break;
    seen.add(nxt);
    cur = nxt;
    last = nxt;
  }
  return last;
}

/**
 * THE RULE. The document a record keyed `key` should be built from, or `null` to leave it where it is.
 * `hasKey(slug)` answers "does this bucket already ship a record under that slug?" — exception 2.
 * Exception 1 (an overlay aonId ruling) is the caller's, because only the caller knows about the pin.
 */
export function repointDoc(index, docId, key, hasKey) {
  if (!docId) return null;
  const R = newestPrinting(index, docId);
  if (!R) return null;
  /*
   * A DERIVED pair (the class hop, or a name-paired category) is held to a stricter test than a link
   * AoN wrote down itself, because the document only said "this class was reprinted" — it never said
   * which record of OURS that reprint belongs to.
   *
   *   • The record has to BE that legacy feature: its key must be the legacy name, or the legacy name
   *     with the class appended (`arcane-spellcasting-magus`, `spell-repertoire-summoner` — the shape
   *     this database already uses to separate one class's copy from another's). That is what stops
   *     `classFeatures/weapon-expertise-swashbuckler`, which sits on a MAGUS document, from following
   *     the magus into Impossible Magic and coming back reading "Weapon Expertise, Impossible Magic".
   *
   *   • The `hasKey` exception is NOT applied. That exception exists to stop two records collapsing
   *     onto ONE page, and a derived pair is one-to-one inside a single class, so nothing collapses:
   *     `classFeatures/unlimited-signature-spells` moving onto the summoner's class-feature-1346 does
   *     not touch `classFeatures/signature-spells`, which is the Dark Archive psychic's own document.
   *     Applying it there would have marked the summoner's level-3 feature legacy and pointed its
   *     "remastered as" at another class's feature.
   */
  const derived = index.derived?.get(String(docId));
  if (derived) {
    const own = slugify(derived.name);
    const withClass = derived.class ? slugify(`${derived.name} ${derived.class}`) : '';
    return key === own || (withClass && key === withClass) ? R : null;
  }
  const s = slugify(index.docs.get(R)?.name ?? '');
  if (s && s !== key && hasKey?.(s)) return null;
  return R;
}

/**
 * EXCEPTION 2, NAMED: the record IS the old page, and its reprint ships beside it as its own record.
 *
 * Owner ruling, desk #158 (2026-09-12): "keep both, mark the old one legacy, add a 'remastered as …'
 * link". Both halves need the same answer — the stamp that writes the link
 * (scripts/migration/build-map.mjs -> stamp-aonid.mjs) and the guard that insists on it
 * (scripts/reprint-check.mjs) — so the predicate lives here once instead of being spelled twice.
 *
 * Returns `{ id, name, docId }` for the reprint's record, or null when this is not that case.
 *
 * ⚠ A RECORD ON A CURRENT PRINTING IS NEVER MARKED. Measured 2026-09-12 over the shipped artefact:
 * 182 records take exception 2, and 181 of them sit on a legacy/legacy-era document. The one that does
 * not is items/rounds-dragon-mouth-pistol, whose own document (weapon-200) is itself `remaster` and
 * merely carries an Archives link to the pistol's page. Stamping that one legacy would HIDE current
 * content from a player who hides legacy — which is the exact harm scripts/edition-drift-check.mjs
 * exists to prevent — so the edition of the record's OWN document decides.
 */
export function shippedTwin(index, docId, key, hasKey) {
  if (!docId || repointDoc(index, docId, key, hasKey)) return null;
  const R = repointDoc(index, docId, key, () => false);
  if (!R) return null;
  const doc = index.docs.get(R);
  const id = slugify(doc?.name ?? '');
  if (!id || id === key || !hasKey?.(id)) return null;
  if (CURRENT.has(String(index.docs.get(String(docId))?.edition ?? ''))) return null;
  return { id, name: String(doc.name ?? ''), docId: R };
}
