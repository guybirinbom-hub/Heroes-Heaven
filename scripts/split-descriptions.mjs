/*
 * Split description text out of core.json.
 *
 * The perf pass measured the app's only real bottleneck: core.json is 22.5 MB and is fetched AND
 * parsed on every load — ~210 ms on a desktop, several times that on a phone, all of it before the
 * first pixel. The engine is not the problem; a full level-20 build is 0.3 ms.
 *
 * 61% of that file (13.7 MB) is `description` and `descRefs` — text nobody reads until they open a
 * description, and which the AST renderer usually supersedes anyway. Moving it to a second file that
 * loads in parallel means the app becomes interactive after parsing ~9 MB instead of 22.5.
 *
 * WHY NOT A LAZY API: 189 places read `record.description` synchronously. Converting them all would
 * be a far larger change with far more regression surface than this is worth. Instead the records
 * arrive without descriptions and the loader fills them in a moment later, re-merging so the database
 * comes back with a new identity — see loadDescriptions() in src/data/index.ts for why a plain
 * in-place mutation is not enough. Every consumer keeps working and simply sees empty text for the
 * first instant.
 *
 * Runs as the last step of `npm run data`, after import-siege-and-gaps.mjs. Safe to run again by
 * hand: see the re-run guard below.
 */
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';

/*
 * What the description file already holds, so a re-run can tell "nothing to do" from "the input is
 * short". Without this the script is DESTRUCTIVE the second time it runs: core.json no longer holds
 * any description, the extraction comes out empty, and 15 MB of text is overwritten with `{}`.
 * `npm run data` has silently deleted authored data once before; this lane does not get to be the
 * next one.
 */
const existing = existsSync(DESC) ? JSON.parse(readFileSync(DESC, 'utf8')) : null;
const existingCount = existing
  ? Object.values(existing).reduce((n, recs) => n + Object.keys(recs).length, 0)
  : 0;

const before = statSync(CORE).size;
const db = JSON.parse(readFileSync(CORE, 'utf8'));

/** bucket → id → { d: description, r: descRefs } — short keys because this file is mostly keys. */
const out = {};
let moved = 0;
for (const [bucket, records] of Object.entries(db)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [id, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    const d = rec.description;
    const r = rec.descRefs;
    if (!d && !r) continue;
    ((out[bucket] ??= {})[id] = {});
    if (d) {
      out[bucket][id].d = d;
      delete rec.description;
      moved++;
    }
    if (r) {
      out[bucket][id].r = r;
      delete rec.descRefs;
    }
  }
}

const extracted = Object.values(out).reduce((n, recs) => n + Object.keys(recs).length, 0);
if (existingCount) {
  if (!extracted) {
    console.log(`core.json is already split — ${existingCount} descriptions are in ${DESC}. Nothing to do.`);
    process.exit(0);
  }
  // A partial extraction means core.json was rebuilt from something incomplete. Writing it would
  // silently drop the difference, so stop and let a human look.
  if (extracted < existingCount * 0.9) {
    console.error(
      `REFUSING TO WRITE: core.json yielded ${extracted} descriptions but ${DESC} already holds ` +
        `${existingCount}. That is a ${Math.round((1 - extracted / existingCount) * 100)}% loss. ` +
        `Regenerate core.json (npm run data) before splitting, or delete the description file if the ` +
        `shrink is intended.`,
    );
    process.exit(1);
  }
}

writeFileSync(CORE, JSON.stringify(db));
const descJson = JSON.stringify(out);
writeFileSync(DESC, descJson);
/*
 * Deliberately NOT pre-gzipped, unlike public/ast/*.json.gz. Those are inflated in the browser
 * because a raw ast bucket is 36 MB — over Cloudflare Pages' 25 MiB per-file limit — so shipping the
 * raw file is impossible. This one is 15 MB, well under, and every static host already serves JSON
 * with Content-Encoding: gzip, so a .gz sibling would cost a client-side inflate for a wire size the
 * host gives away. On desktop (Tauri, local disk) it would be pure loss.
 */

const after = statSync(CORE).size;
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`descriptions moved: ${moved} records across ${Object.keys(out).length} buckets`);
console.log(`core.json            ${mb(before)} -> ${mb(after)}  (${Math.round((1 - after / before) * 100)}% smaller)`);
console.log(`core-descriptions    ${mb(descJson.length)}`);
