/*
 * WHERE A BATCH'S FILES LIVE — the one rule every reader and writer of a batch's derived files follows.
 *
 * A WG-lane batch is work/wg-batch-<TAG>.json with -parity / -residual beside it; a print-lane batch is
 * its packet work/print-batch-<TAG>.json with the same files beside THAT (scripts/wg-batch-run.mjs,
 * stagePrintCut). The cut record work/.b<TAG>-cut.json says which lane cut the batch. With no cut
 * record (a batch cut before the driver existed, or a fresh clone: the cut record is untracked while
 * the parity file is committed) the lane is print when a print packet or print parity file for that tag
 * is on disk, and WG otherwise.
 *
 * WHY ONE HELPER (2026-09-25): record-parity-verdict.mjs, record-parity-batch.mjs and
 * parse-parity-out.mjs each hard-coded work/wg-batch-${batch}-parity.json, so a verdict for print batch
 * P02 went to a new work/wg-batch-P02-parity.json that no gate reads, and rule-owner-questions.mjs
 * --reverdict never looked at a print parity file at all.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Numeric batches are zero-padded to three digits (029); print batches keep their P01-style id. */
export const batchTag = (raw) => {
  const s = String(raw ?? '').trim();
  return /^\d+$/.test(s) ? String(Number(s)).padStart(3, '0') : s.toUpperCase();
};

/** The value a parity/residual file's `batch` field carries: 30 for batch 030, "P02" for P02. */
export const batchValue = (raw) => {
  const tag = batchTag(raw);
  return /^\d+$/.test(tag) ? Number(tag) : tag;
};

/** Repo-relative paths of a batch's packet and the files derived beside it. */
export function batchFiles(root, raw) {
  const tag = batchTag(raw);
  let print;
  try {
    print = !!JSON.parse(readFileSync(join(root, `work/.b${tag}-cut.json`), 'utf8')).print;
  } catch {
    print = existsSync(join(root, `work/print-batch-${tag}.json`)) || existsSync(join(root, `work/print-batch-${tag}-parity.json`));
  }
  const base = `work/${print ? 'print' : 'wg'}-batch-${tag}`;
  return { tag, batch: batchValue(tag), print, packet: `${base}.json`, parity: `${base}-parity.json`, residual: `${base}-residual.json` };
}
