/*
 * THE PRINTED TEXT OF A CONDITION, read off the Archives mirror. One transform, three readers:
 *
 *   scripts/backfill-condition-prose.mjs   writes it into Heroes Heaven's prose overlay
 *   scripts/condition-text-check.mjs       fails `npm run verify` when a shipped record is shorter
 *   test/bug-tracker-data.test.ts          the same rule, as a test
 *
 * Shared for the reason scripts/lib/aon-plain.mjs states about its own transform: a checker that
 * re-derives the text with a SECOND copy of this function passes on exactly the prose the writer just
 * got wrong. One function, or the guard is decoration.
 *
 * TWO SHAPES the raw markdown has that a naive strip gets wrong:
 *
 *   A. the level-1 <title> is the PAGE HEADING — the record's own name. Both apps print the name in
 *      the popup header already, so keeping it in the body prints it twice. Dropped here, and only
 *      here: the "Source <book> pg. N" line that follows it is part of the printed entry and stays.
 *
 *   B. a level-2 <title> inside an <aside> is a RUN-IN HEADING, closed with no separator at all:
 *      `…</title>You can take steps…`. Stripping tags alone welds the heading to the next word
 *      ("Assisted RecoveryYou can take steps"), which reads as a typo in shipped rules text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plain } from './aon-plain.mjs';
import { buildDocIndex } from './aonid-categories.mjs';

export const EXPORT_DIR = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';

const PAGE_HEADING = /<title\b[^>]*\blevel="1"[^>]*>[\s\S]*?<\/title>\s*/;

/** AoN markdown -> the printed body, in the plain form Heroes Heaven stores. */
export function conditionProse(markdown) {
  const md = String(markdown ?? '').replace(PAGE_HEADING, '').replace(/<\/title>(?=\S)/g, '</title>\n\n');
  return plain(md);
}

/**
 * Compare-ready form. Both apps store the SAME words in different markup — Heroes Heaven unwraps its
 * links (the ast carries them), the tracker keeps `{@condition off-guard}` for its TagRenderer — so a
 * comparison that does not flatten the tags reports every tracker record as wrong.
 */
export const compareForm = (s) => String(s ?? '')
  .replace(/\{@(?:as|a)\s*\d\}/gi, ' ')
  .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014\u2212]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * The DISTINCTIVE SENTENCE for a record: its last full sentence.
 *
 * Derived rather than listed, because every shortening found in this data cut from the END — the
 * Foundry import dropped `Persistent Damage`'s whole "Persistent Damage Rules" sidebar and the tail
 * clause of six more. A hand-picked opening sentence would have passed on all of them.
 */
export function distinctiveSentence(body) {
  const parts = compareForm(body).split(/(?<=[.!?])\s+/).filter((s) => s.length > 25);
  return parts.length ? parts[parts.length - 1] : compareForm(body);
}

/** A reader over the archive export: by aonId (Heroes Heaven) and by name (the tracker). */
export function openMirror(exportDir = EXPORT_DIR) {
  const docIndex = buildDocIndex(exportDir, { readFileSync, readdirSync, join });
  const cache = new Map();
  const categoryDocs = (cat) => {
    if (!cache.has(cat)) {
      try { cache.set(cat, JSON.parse(readFileSync(join(exportDir, cat + '.json'), 'utf8')).docs ?? {}); }
      catch { cache.set(cat, {}); }
    }
    return cache.get(cat);
  };

  /** aonId -> its printed markdown. Heroes Heaven's aonIds are already stamped to the newest
   *  printing (scripts/reprint-check.mjs guards that), so this honours the newest-printing rule
   *  without re-deciding it here. */
  const markdownOf = (aonId) => {
    const hit = docIndex.get(String(aonId));
    if (!hit) return null;
    const d = categoryDocs(hit.cat)[String(aonId)];
    return d ? String(d?.data?.markdown ?? d?.markdown ?? '') : null;
  };

  /** name (lowercased) -> the newest printing's markdown, over condition.json. */
  const byName = new Map();
  for (const [id, d] of Object.entries(categoryDocs('condition'))) {
    const key = String(d?.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || (d.edition === 'remaster' && prev.edition !== 'remaster')) {
      byName.set(key, { id, edition: d.edition, markdown: String(d?.data?.markdown ?? d?.markdown ?? '') });
    }
  }

  /**
   * A Heroes Heaven condition record -> its printed markdown.
   *
   * NAME FIRST, aonId second. Measured 2026-09-15: `conditions/concealed` and
   * `conditions/aon-concealed-army` BOTH carry aonId `condition-62`, so resolving the army condition
   * by its stamp hands back the Player Core "Concealed" page — a 476-character entry about fog in
   * place of a 264-character entry about armies. The aonId stays the fallback because it is the only
   * route for a condition whose page is not in condition.json at all: `cursebound` is documented on
   * its TRAIT page (trait-800), which aonid-categories.mjs already lists as expected.
   */
  const markdownForRecord = (rec) => {
    const byNameHit = byName.get(String(rec?.name ?? '').trim().toLowerCase());
    if (byNameHit) return byNameHit.markdown;
    return rec?.aonId ? markdownOf(rec.aonId) : null;
  };

  return { markdownOf, markdownForRecord, byName };
}
