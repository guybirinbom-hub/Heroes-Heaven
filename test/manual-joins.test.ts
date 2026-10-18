import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { EXPORT_DIR, loadReprintIndex } from '../scripts/lib/reprint.mjs';
import { linkIsPlausible } from '../scripts/lib/aonid-categories.mjs';

/**
 * Package I, I7d (2026-10-18): A RECORD THE MATCHER FILED ON ANOTHER RECORD'S PAGE BY NAME IS JOINED TO ITS OWN.
 *
 * The stage-1 matcher stamped four records by their bare name (map.json how "slug-noparen"):
 * feats/roll-with-it-kingmaker on feat-1009 (the goblin "Roll with It (Goblin)"), conditions/aon-concealed-army on
 * condition-62 (Player Core "Concealed"), feats/quick-recovery on feat-3923 (the Kingmaker kingdom feat) and
 * feats/the-harder-they-fall on feat-3901 (the Kingmaker ranger feat) — each a page another record already carries.
 * scripts/data/manual-joins.json joins each, by key, to its own page (feat-3903, condition-44, feat-7004,
 * feat-4938); scripts/migration/build-map.mjs reads it ahead of the name joins and the importer's used-docs, and
 * refuses an entry it cannot make true. The shipped half is reprint-check CHECK 6: once npm run data has stamped
 * the pages, a record that falls back to its old page names a book that page is not printed in and fails.
 *
 * MUTATION LINES (measured red on a scratch copy, 2026-10-18):
 *  - build-map.mjs: drop the `MANUAL_BY_KEY.has(id)` branch → the order case goes red, and build-map maps the
 *    four records back to feat-1009 / condition-62 / feat-3923 / feat-3901 (scratch run, map.json diff).
 *  - manual-joins.json: a key core.json does not hold → build-map exits 1 (scratch run) and the first case goes red.
 */
const FILE = 'scripts/data/manual-joins.json';
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { joins: Record<string, { docId: string; why: string }> };
const joins = Object.entries(raw.joins);
const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, unknown>>;
const overlay = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { category?: string; id?: string; field?: string; path?: unknown[] }[];

describe('key-exact joins (scripts/data/manual-joins.json)', () => {
  it('names the four records, each a record core.json holds, with a page id its why cites', () => {
    expect(joins.map(([k]) => k).sort()).toEqual([
      'conditions/aon-concealed-army', 'feats/quick-recovery', 'feats/roll-with-it-kingmaker', 'feats/the-harder-they-fall',
    ]);
    for (const [where, j] of joins) {
      const [bucket, key] = where.split('/');
      expect(core[bucket]?.[key], `${where} is not a shipped record`).toBeTruthy();
      expect(j.docId, where).toMatch(/^[a-z][a-z-]*[a-z]-\d+(?:-\d+)*$/);
      expect(j.why, where).toContain(j.docId);
    }
  });

  it('is a JOIN, not a pin: no overlay aonId row also names these records (a pin keeps the old page as joinDocId)', () => {
    const pinned = overlay.filter((r) => !r.path?.length && r.field === 'aonId').map((r) => `${r.category}/${r.id}`);
    expect(joins.map(([k]) => k).filter((k) => pinned.includes(k))).toEqual([]);
  });

  it('build-map.mjs reads the joins ahead of the name joins and the importer\'s used-docs', () => {
    const src = readFileSync('scripts/migration/build-map.mjs', 'utf8');
    const byKey = src.indexOf('else if (MANUAL_BY_KEY.has(id))');
    expect(src).toContain("const MANUAL_JOINS_FILE = 'scripts/data/manual-joins.json';");
    expect(byKey).toBeGreaterThan(0);
    expect(src.indexOf('else if (MANUAL[byName])')).toBeGreaterThan(byKey);
    expect(src.indexOf('else if (usedDocs[bucket]?.[key])')).toBeGreaterThan(byKey);
  });

  it.skipIf(!existsSync(EXPORT_DIR))('each joined page is a document of the export that stamp-aonid.mjs accepts for the bucket', () => {
    const index = loadReprintIndex(EXPORT_DIR);
    for (const [where, j] of joins) {
      const [bucket, key] = where.split('/');
      const d = index.docs.get(j.docId);
      expect(d, `${where}: ${j.docId} is not in the export`).toBeTruthy();
      expect(linkIsPlausible(bucket, d.category, key), `${where}: a ${d.category} page in ${bucket}`).toBe(true);
    }
    // the whole export is read (~45,500 documents): past vitest's 5 s default under a full-suite load
  }, 120_000);
});
