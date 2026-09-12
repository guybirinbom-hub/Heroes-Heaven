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
 * TWO EXCEPTIONS, in this order:
 *   1. an overlay `aonId` ruling wins. Not expressed here — the callers own it: import-core-v2 keeps a
 *      record's own `aonId` (only effect-backfill.json can put one there) ahead of every hop, and
 *      stamp-aonid.mjs re-applies the authored aon* rows LAST, after the map has been stamped.
 *   2. a reprint whose own slug ALREADY SHIPS as a separate record is not followed — repointing would
 *      collapse two records onto one page, which is a merge decision for the owner, not a repair.
 *      That is `hasKey` below (measured 2026-09-12: 182 such records, e.g. spells/acid-splash, whose
 *      reprint spell-1461 "Caustic Blast" ships as spells/caustic-blast in its own right).
 *
 * Readers: scripts/import-core-v2.mjs (the join + the AST writer), scripts/migration/build-map.mjs
 * (so stamp-aonid stamps R and the regen is a fixed point), scripts/reprint-check.mjs (the guard).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const EXPORT_DIR = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';

/** The same slug rule import-core-v2.mjs mints record keys with. */
export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Map a replaced document id to the document that replaces it (one hop), from any id -> doc iterable.
 * Newest release date wins when a document was replaced more than once in a single hop.
 */
export function buildReprintMap(entries) {
  const docs = entries instanceof Map ? entries : new Map(entries);
  const next = new Map();
  const catOf = (d) => d?.category ?? d?.cat;
  const offer = (oldId, newId) => {
    if (oldId === newId) return;
    const o = docs.get(oldId); const n = docs.get(newId);
    if (!o || !n || catOf(o) !== catOf(n)) return;
    const cur = next.get(oldId);
    if (cur) {
      const c = docs.get(cur);
      const a = String(c?.release_date ?? ''); const b = String(n.release_date ?? '');
      if (a > b || (a === b && cur <= newId)) return;
    }
    next.set(oldId, newId);
  };
  for (const [id, d] of docs) {
    for (const l of d?.data?.legacy_id ?? []) offer(String(l), id);      // the reprint names what it replaces
    for (const r of d?.data?.remaster_id ?? []) offer(id, String(r));    // the replaced doc names its reprint
  }
  return { docs, next };
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
        book: d?.book ?? (Array.isArray(d?.data?.source) ? d.data.source[0] : undefined),
        // EVERY book this document is printed in — `book` is only the first, and a document reprinted
        // into two books names both. scripts/reprint-check.mjs compares a record's source.book against
        // this list, so taking the first would report a correct record as stale.
        books: [...new Set([d?.book, ...(d?.data?.source ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))],
        release_date: d?.release_date ?? d?.data?.release_date ?? '',
        data: { legacy_id: d?.data?.legacy_id, remaster_id: d?.data?.remaster_id },
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
  const s = slugify(index.docs.get(R)?.name ?? '');
  if (s && s !== key && hasKey?.(s)) return null;
  return R;
}
