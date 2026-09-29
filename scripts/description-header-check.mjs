/*
 * NO DESCRIPTION OPENS WITH THE SCRAPED PAGE HEADER — every bucket except spells.
 *
 * Batch P02 found three Impossible Magic feats (exploding-bullet, recharging-flurry, running-recharge,
 * AoN feat-9055/9056/9057) whose plain description began with the Archives page chrome:
 *
 *     "Exploding Bullet\nSource Impossible Magic pg. N\nPrerequisites …"
 *
 * The record's own name / source / prerequisites fields already carry those lines, so the popup and the
 * search text printed them twice, and the rules text started three lines down. The rows fixed those three
 * records; this holds the class shut. Measured when it went in: 1,764 shipped records across nine buckets
 * open this way, from more than seventy books — it is not one importer quirk, and repairing them is its
 * own lane (it needs the importer to strip the header the way pageProse() in
 * scripts/import-siege-and-gaps.mjs does, and then `npm run data`).
 *
 * SPELLS ARE NOT JUDGED HERE: scripts/spell-print-lines-check.mjs (same batch) already holds the spell
 * half of this class, with the same test, beside its cast/duration/requirements checks. One owner per
 * record keeps a fix from having to be recorded in two baselines.
 *
 * The records in that state are the baseline in scripts/data/description-header-baseline.json, measured
 * AFTER batch P02's own description rows (--pending). A NEW offender fails; so does a listed one that is
 * now right (remove its entry — the list only shrinks), the moved-prose-baseline rule of reprint-check.mjs
 * CHECK 8.
 *
 *   node scripts/description-header-check.mjs                     # the check (npm run verify)
 *   node scripts/description-header-check.mjs --list              # today's offenders, baseline-shaped
 *   node scripts/description-header-check.mjs --pending a.json …  # a batch spec's description rows
 *                                                                 #   applied in memory first
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'scripts/data/description-header-baseline.json';
/** Held by scripts/spell-print-lines-check.mjs `header` instead. */
export const SKIP_BUCKETS = new Set(['spells']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this prose open with "<name>\nSource "? The same test spell-print-lines-check.mjs applies. */
export const opensWithHeader = (name, d) => new RegExp(`^\\s*${escapeRe(String(name))}\\s*\\n\\s*Source `).test(String(d ?? ''));

/**
 * The offenders, as sorted "<bucket>/<id>" keys. `core` is public/core.json (records carry `name`),
 * `descriptions` is public/core-descriptions.json ({bucket: {id: {d}}}).
 */
export function headerOffenders({ core, descriptions }) {
  const out = [];
  for (const [bucket, recs] of Object.entries(descriptions ?? {})) {
    if (SKIP_BUCKETS.has(bucket) || !recs || typeof recs !== 'object') continue;
    for (const [id, v] of Object.entries(recs)) {
      const rec = core?.[bucket]?.[id];
      if (!rec?.name) continue;
      if (opensWithHeader(rec.name, v?.d)) out.push(`${bucket}/${id}`);
    }
  }
  return out.sort();
}

/** A new offender fails, and so does a listed one that is now right. */
export function baselineProblems(found, baseline) {
  const problems = [];
  const listed = new Set(baseline?.records ?? []);
  const now = new Set(found);
  for (const k of now) if (!listed.has(k)) problems.push(`${k} opens its description with the scraped "<Name>\\nSource …" page header — fix the record (an effect-backfill description row), never the baseline`);
  for (const k of listed) if (!now.has(k)) problems.push(`${k} is in ${BASELINE} but no longer opens with the header — remove the entry (the list only shrinks)`);
  return problems;
}

/** Apply a batch spec's top-level description rows ({category,id,field:'description',value}) in memory. */
export function applyPendingDescriptionRows(descriptions, spec) {
  const findings = Array.isArray(spec) ? spec : (spec?.applicable ?? spec?.findings ?? []);
  const rows = findings.flatMap((f) => (f?.verification?.correctedBackfillRows?.length ? f.verification.correctedBackfillRows : f?.backfillRows) ?? []);
  for (const r of rows) {
    if (r?.field !== 'description' || r.path?.length || typeof r.value !== 'string') continue;
    const b = (descriptions[r.category] ??= {});
    b[r.id] = { ...(b[r.id] ?? {}), d: r.value };
  }
}

const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const args = process.argv.slice(2);
  const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
  const core = read('public/core.json');
  const descriptions = read('public/core-descriptions.json');
  const pi = args.indexOf('--pending');
  if (pi >= 0) {
    for (const f of args.slice(pi + 1).filter((a) => !a.startsWith('--'))) {
      applyPendingDescriptionRows(descriptions, JSON.parse(readFileSync(resolve(f), 'utf8')));
    }
  }
  const found = headerOffenders({ core, descriptions });
  if (args.includes('--list')) {
    console.log(JSON.stringify({ records: found }, null, 2));
  } else {
    const baseline = read(BASELINE);
    const problems = baselineProblems(found, baseline);
    console.log(`description header: ${found.length} record(s) outside spells open with the scraped page header (baseline ${(baseline.records ?? []).length}).`);
    for (const p of problems) console.log(`   ${p}`);
    if (problems.length) process.exitCode = 1;
  }
}
