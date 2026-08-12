/*
 * The ONE writer for `scripts/data/effect-backfill.json`.
 *
 * That file is the only overlay that survives `npm run data`, and it is stored with **1-space indent,
 * CRLF line endings and no trailing newline**. Forty-four of the forty-five scripts that write it used
 * `JSON.stringify(rows, null, 2) + '\n'` instead — so re-running ANY of them rewrote all 6,841 rows and
 * turned a two-line change into a 276 KB diff nobody could review. A load-bearing data file whose diffs
 * are unreadable is a data file nobody checks.
 *
 * The format is not a preference: `JSON.stringify(rows, null, 1).replace(/\n/g, '\r\n')` round-trips
 * the committed file byte-for-byte, which is the property worth preserving. Verified, not assumed.
 *
 * Import this rather than calling writeFileSync yourself:
 *   import { writeBackfill } from './lib/write-backfill.mjs';
 *   writeBackfill(root, rows);
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BACKFILL_PATH = 'scripts/data/effect-backfill.json';

/** Serialise in the stored format. Exported so a test can assert the round-trip without touching disk. */
export function formatBackfill(rows) {
  return Buffer.from(JSON.stringify(rows, null, 1).replace(/\n/g, '\r\n'));
}

/** Read the overlay as rows. */
export function readBackfill(root) {
  return JSON.parse(readFileSync(join(root, BACKFILL_PATH), 'utf8'));
}

/**
 * Write the overlay in the stored format.
 *
 * Refuses to shrink the file by more than a tenth unless `allowShrink` is set: every real edit here
 * appends rows or changes a handful, so a sudden large loss means the caller built its array from a
 * partial read — which would silently drop authored data that only exists in this file.
 */
export function writeBackfill(root, rows, { allowShrink = false } = {}) {
  const path = join(root, BACKFILL_PATH);
  if (!allowShrink) {
    const before = readBackfill(root).length;
    if (rows.length < before * 0.9) {
      throw new Error(
        `writeBackfill: refusing to drop ${before - rows.length} of ${before} rows. ` +
          'Pass { allowShrink: true } if the removal is deliberate.',
      );
    }
  }
  writeFileSync(path, formatBackfill(rows));
}
