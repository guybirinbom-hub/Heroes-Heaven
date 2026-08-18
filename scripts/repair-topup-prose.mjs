/**
 * Repair the two artefacts the top-up's plain-text transform wrote into stored prose.
 *
 * `topUpCarried` in import-siege-and-gaps.mjs gave prose to records that arrived with an identity and
 * nothing to display. Its transform (scripts/lib/aon-plain.mjs) had two defects, both surfaced by the
 * damage ratchet in test/authoring-guards.test.ts going 888 -> 928:
 *
 *   A. " ()"     `<actions string="" />` — the glyph tag with an EMPTY string, which AoN emits on every
 *                entry that has no action cost. It was substituted unconditionally, so the prose opened
 *                "Resonance ()", "Porter ()", "Can't Walk ()" on 37 familiar abilities.
 *   B. "x\n, y"  a link label with a newline INSIDE the brackets. Polong's granted-abilities line reads
 *                `[Skilled (Society)\r\n](/Familiars.aspx?ID=33), [Speech](…)`, and keeping the label
 *                verbatim left a newline before the comma — indistinguishable from a dropped word.
 *
 * Both are fixed in aon-plain.mjs so they cannot recur. This repairs the text already written.
 *
 * ⚠ TWO APPROACHES WERE WRONG BEFORE THIS ONE, and the reasons are the point:
 *
 *   Matching on " ()" alone caught 13 innocent records. `staff-of-the-magi` and `offensive-odor` have a
 *   parenthesis elsewhere in their prose, and a passive item's title legitimately carries an empty glyph
 *   tag, so "document contains an empty glyph" cannot tell the two cases apart.
 *
 *   Re-deriving the whole description with the fixed transform and diffing looked rigorous and was
 *   destructive: it wanted to change 193 records, replacing `absorb-familiar`'s full text with the bare
 *   words "Absorb Familiar". Most prose in these buckets came from the FULL importer's `ast ->
 *   plainDesc` path, not from `plain()`; only the ~98 records the top-up ADDED went through this
 *   transform, and that set is computed at runtime and never persisted. So "same bucket" is not the same
 *   as "written by this code", and a whole-text rewrite cannot assume it is.
 *
 * What IS safe is a repair anchored to the artefact's own shape, applied to the stored text and nothing
 * else. Artefact A only ever appears as the record's NAME followed by " ()", because the glyph sits in
 * the page title; requiring that anchor makes it unambiguous. Artefact B is a newline before a comma,
 * and it is checked against the source markdown having a newline inside a link label.
 *
 * ⚠ WRITES BOTH FILES, for the reason apply-import-damaged-text.mjs documents: an overlay row alone never
 * materialises a `description` (split-descriptions.mjs refuses to write when it sees a handful of
 * descriptions against 19k already split out), and core-descriptions.json alone does not survive
 * `npm run data`. Both, or the fix is either invisible or temporary.
 *
 *   node scripts/repair-topup-prose.mjs            # report only
 *   node scripts/repair-topup-prose.mjs --write
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { buildDocIndex } from './lib/aonid-categories.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

/* The buckets topUpCarried writes prose for. Necessary but not sufficient — see the header. */
const TOPPED_UP_BUCKETS = ['familiarAbilities', 'animalCompanions'];

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const DESC = join(ROOT, 'public/core-descriptions.json');
const descs = JSON.parse(readFileSync(DESC, 'utf8'));

const docIndex = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });
const cache = new Map();
const markdownOf = (aonId) => {
  const hit = docIndex.get(aonId);
  if (!hit) return null;
  if (!cache.has(hit.cat)) {
    try { cache.set(hit.cat, JSON.parse(readFileSync(join(EXPORT, hit.cat + '.json'), 'utf8')).docs ?? {}); }
    catch { cache.set(hit.cat, {}); }
  }
  const d = cache.get(hit.cat)[aonId];
  return d ? String(d?.data?.markdown ?? d?.markdown ?? '') : null;
};

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A link label whose text runs across a line break — the source shape behind artefact B. */
const WRAPPED_LABEL = /\[[^\]]*\r?\n[^\]]*\]\(/;

const changes = [];
for (const bucket of TOPPED_UP_BUCKETS) {
  for (const [id, entry] of Object.entries(descs[bucket] ?? {})) {
    const stored = typeof entry === 'string' ? entry : entry?.d;
    if (!stored) continue;
    const rec = core[bucket]?.[id];
    const name = rec?.name;
    if (!name) continue;
    const md = rec.aonId ? markdownOf(rec.aonId) : null;

    let text = stored;
    const applied = [];

    // A: the record's own NAME followed by " ()" — the empty title glyph, and nothing else.
    const nameParens = new RegExp(`(^|\\n)(${esc(name)})[ \\t]*\\(\\)`, 'g');
    if (nameParens.test(text)) {
      text = text.replace(new RegExp(`(^|\\n)(${esc(name)})[ \\t]*\\(\\)`, 'g'), '$1$2');
      applied.push('empty title glyph');
    }

    // B: a newline before a comma, only where the source really does wrap inside a link label.
    if (md && WRAPPED_LABEL.test(md) && /\n\s*,/.test(text)) {
      text = text.replace(/[ \t]*\n\s*,/g, ',');
      applied.push('newline inside a link label');
    }

    if (text !== stored) changes.push({ bucket, id, before: stored, after: text, applied });
  }
}

console.log(`${changes.length} description(s) to repair in ${TOPPED_UP_BUCKETS.join(' + ')}\n`);
const byKind = {};
for (const c of changes) for (const a of c.applied) byKind[a] = (byKind[a] ?? 0) + 1;
for (const [k, n] of Object.entries(byKind)) console.log(`  ${k.padEnd(30)} ${n}`);
console.log('\nfirst differing line of each:');
for (const c of changes.slice(0, 45)) {
  const la = c.before.split('\n'), lb = c.after.split('\n');
  let i = 0; while (i < la.length && la[i] === lb[i]) i++;
  console.log(`  ${(c.bucket + '/' + c.id).padEnd(40)} "${(la[i] ?? '').trim()}"  ->  "${(lb[i] ?? '').trim()}"`);
}
if (changes.length > 45) console.log(`  … ${changes.length - 45} more`);

if (!WRITE) { console.log('\nreport only — pass --write to apply.'); process.exit(0); }
if (!changes.length) { console.log('\nnothing to write.'); process.exit(0); }

const rows = readBackfill(ROOT);
for (const c of changes) {
  const entry = descs[c.bucket][c.id];
  if (typeof entry === 'string') descs[c.bucket][c.id] = c.after;
  else entry.d = c.after;
  const i = rows.findIndex((r) => r.category === c.bucket && r.id === c.id && r.field === 'description');
  const row = { category: c.bucket, id: c.id, field: 'description', value: c.after };
  if (i >= 0) rows[i] = row; else rows.push(row);
}
writeFileSync(DESC, JSON.stringify(descs));
writeBackfill(ROOT, rows);
console.log(`\nwrote public/core-descriptions.json and scripts/data/effect-backfill.json (${changes.length} repairs, overlay ${rows.length} rows)`);
