/*
 * THE LIVE ARCHIVES PAGE, AS READ — what the export cannot say (house rule: the live page wins).
 *
 * Two facts the export gets wrong and the live page does not, both measured 2026-09-24:
 *   · RARITY of some class options. apparition-16 "Lamentation of Sinister Deals" and hybrid-study-16
 *     "Volatile Spark" print the Uncommon trait on their pages; the export and the Archives' own search
 *     index both say common. The importer created both as common.
 *   · EDITION. The export's `edition` is a vote over books (Archives of GuyB build.py `stage_edition`),
 *     so a pre-remaster book with no reprint links is `neutral`. The live page prints a "Legacy
 *     Content" banner — The Fall of Plaguestone's Refugee (background-40) and Heavy is the Crown's
 *     Stone Blood (feat-4380) are `neutral` in the export and Legacy Content on the page, so "Hide
 *     legacy data" kept them.
 *
 * scripts/read-live-pages.mjs reads pages into scripts/data/live-pages.json; this is its reader, used
 * by the importer's step 4 (scripts/import-core-v2.mjs), scripts/edition-drift-check.mjs and
 * scripts/player-coverage-check.mjs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN, CURRENT } from './edition.mjs';

export const LIVE_PAGES = 'scripts/data/live-pages.json';

/** doc id -> { name, level, rarity, legacy, read } (empty when nothing has been read). */
export function loadLivePages(root = '.') {
  const p = join(root, LIVE_PAGES);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).pages ?? {} : {};
}

/**
 * The edition a record of this page shows. The banner decides the SIDE; the export's value is kept
 * when it is already on that side (so `legacy` stays `legacy`, `remaster` stays `remaster`), else the
 * plain value of the side. No read -> the export's value.
 */
export function liveEdition(exportEdition, live) {
  if (!live || typeof live.legacy !== 'boolean') return exportEdition;
  const e = String(exportEdition ?? '');
  if (live.legacy) return HIDDEN.has(e) ? e : 'legacy-era';
  return CURRENT.has(e) ? e : 'neutral';
}

/** Name comparison that ignores the curly/straight apostrophe and case, nothing else. */
export const sameName = (a, b) => String(a ?? '').replace(/[’‘]/g, "'").trim().toLowerCase()
  === String(b ?? '').replace(/[’‘]/g, "'").trim().toLowerCase();
