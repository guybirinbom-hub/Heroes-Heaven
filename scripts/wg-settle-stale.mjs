/*
 * A SETTLE THAT SILENCES NOTHING IS A TRAP WAITING TO SPRING.
 *
 * Each registry entry silences one named difference on one record, in every batch, for good. That is
 * safe while the difference is real and adjudicated. It stops being safe the moment the difference goes
 * away — because the entry does not: it sits there, matching nothing, until the day the comparer
 * reports a DIFFERENT difference of the same kind on that record and the entry silences that one too,
 * unread and unadjudicated.
 *
 * This became a live hazard rather than a theoretical one when the comparers were taught to read fields
 * they had been blind to (a class's own saves and skills, a background's trained skill and ability
 * boosts, an item's `passiveEffects.speeds` and `heldSpells`). Every settle written while they were
 * blind was written against a difference that may no longer exist.
 *
 * So: for every settled record, run the comparers and check that the settled kind actually appears.
 * A settle that answers nothing is reported for DELETION, not silently kept.
 *
 *   node scripts/wg-settle-stale.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse `'record-id': ['kind', …],` entries out of a registry, keeping the source line for context. */
const parseSettles = (file, constName) => {
  const src = readFileSync(join(ROOT, 'scripts', file), 'utf8');
  const start = src.indexOf(`${constName} = {`);
  if (start < 0) return [];
  const body = src.slice(start);
  const out = [];
  for (const m of body.matchAll(/^\s*'?([a-z0-9][a-z0-9-]*)'?\s*:\s*\[([^\]]*)\]/gim)) {
    const kinds = [...m[2].matchAll(/'([^']+)'/g)].map((k) => k[1]);
    if (kinds.length) out.push({ id: m[1], kinds, registry: constName, file });
  }
  return out;
};

const settles = [
  ...parseSettles('wg-diff.mjs', 'VERIFIED_EQUIVALENT'),
  ...parseSettles('wg-values.mjs', 'SETTLED_VALUES'),
  ...parseSettles('wg-identity.mjs', 'SETTLED_IDENTITIES'),
];

/*
 * The comparers report per BATCH, so the cheapest complete answer is to run each batch once and
 * collect every difference reported anywhere — with settles SUPPRESSED, which is what `--raw` is for.
 * A settle whose record+kind never appears in that union answers nothing.
 */
const batches = readdirSync(join(ROOT, 'work')).filter((f) => /^wg-batch-\d+\.json$/.test(f)).sort();
if (!batches.length) { console.log('wg-settle-stale: SKIPPED — no batch files'); process.exit(0); }

const seen = new Set(); // `${id}|${kind}`
let ran = 0;

/*
 * ⚠ wg-diff IS CORPUS-WIDE AND PRINTS A SUMMARY, not per-record lines — it has no `--batch` at all,
 * and reports through `--out <file>` as structured JSON. Parsing its stdout the way the other two are
 * parsed found nothing for any wg-diff settle and called all 60 of them stale, including two written
 * minutes earlier against differences the gate was reporting at that moment. The gate has always used
 * `--out`; this uses the same door.
 */
{
  const out = 'work/.stale-diff.json';
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/wg-diff.mjs'), '--out', out, '--raw'], {
      cwd: ROOT, stdio: 'ignore', maxBuffer: 1 << 28,
    });
    ran++;
  } catch { /* it reports on stdout and may exit non-zero; the file is what matters */ }
  if (!existsSync(join(ROOT, out))) {
    console.error('wg-diff produced no output — cannot judge its settles; refusing to call them stale.');
    process.exit(2);
  }
  for (const r of JSON.parse(readFileSync(join(ROOT, out), 'utf8')).theyOnly ?? []) {
    for (const k of r.missing ?? []) seen.add(`${r.id}|${k}`);
  }
}

/* wg-values and wg-identity DO report per record, per batch: a `--- <id>  (Name)` header followed by
 * rows naming the key. Both are run per batch because neither is corpus-wide. */
for (const b of batches) {
  for (const script of ['wg-values.mjs', 'wg-identity.mjs']) {
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'scripts', script), '--batch', `work/${b}`, '--raw'], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
      ran++;
    } catch (e) {
      out = String(e.stdout ?? '');
    }
    let current = null;
    for (const line of out.split(/\r?\n/)) {
      const head = /^---\s+([a-z0-9][a-z0-9-]*)\s/.exec(line);
      if (head) { current = head[1]; continue; }
      if (!current) continue;
      const s = settles.filter((x) => x.id === current);
      for (const entry of s) for (const k of entry.kinds) if (line.includes(k)) seen.add(`${current}|${k}`);
    }
  }
}

/*
 * ⚠ wg-values and wg-identity only ever report on records that are IN A BATCH, so a settle for a record
 * no batch has cut cannot be judged by them — it would read as stale for the sole reason that nothing
 * looked. Those are held out and counted rather than reported. (wg-diff is corpus-wide, so its settles
 * are always judgeable.)
 */
const batched = new Set();
for (const f of batches) {
  for (const r of Object.values(JSON.parse(readFileSync(join(ROOT, 'work', f), 'utf8')))) batched.add(r.id);
}
const unjudgeable = settles.filter((s) => s.file !== 'wg-diff.mjs' && !batched.has(s.id));
const judgeable = settles.filter((s) => !unjudgeable.includes(s));

const stale = judgeable.filter((s) => s.kinds.every((k) => !seen.has(`${s.id}|${k}`)));
console.log(`${settles.length} settle(s) across three registries, checked against ${ran} comparer run(s).`);
if (unjudgeable.length) console.log(`${unjudgeable.length} not judged — their record is in no batch, and the per-batch comparers only report on batched records.`);
if (!stale.length) {
  console.log('wg-settle-stale: ok — every settle answers a difference that is actually reported.');
  process.exit(0);
}
console.log(`\n${stale.length} settle(s) answer NOTHING — the difference they were written for is gone:\n`);
for (const s of stale) console.log(`   ${s.file.padEnd(18)} ${s.id.padEnd(34)} [${s.kinds.join(', ')}]`);
console.log(`\nEach should be DELETED, not kept: an entry that matches nothing today will silence the next`);
console.log(`difference of that kind on that record, unread. Deleting one is safe — if the difference`);
console.log(`comes back, the gate reports it again and it gets adjudicated again.`);
/* Reported, not fatal: a stale settle breaks nothing today, and failing the build on one would make
 * the instrument-improvement work that CREATES them feel like a regression. */
process.exit(0);
