/*
 * A SPELL CARRIES THE LINES ITS PAGE PRINTS ABOVE THE BODY — cast, duration and Requirements — and
 * its description does not open with the scraped page header.
 *
 * Batch P02 found the same four shapes on one record, spells/conjurers-countermeasure (spell-2876):
 *   - no `cast` although the page prints "Single Action" (218 spells shipped that way),
 *   - no `duration` although the page prints "Duration until the end of your next turn",
 *   - a description opening "Conjurer's Countermeasure \nSource Impossible Magic pg. 179" — the page
 *     header scraped into the prose (217 spells),
 * and on spells/turbulent-tide + four siblings a printed "Requirements" line shown nowhere at all.
 * The rows fixed those records; this holds the class shut. A spell sheet reads `cast` for the action
 * glyph and `duration` for the stat row, so a missing one is silent: the card just shows less.
 *
 * Each check compares the shipped data (public/core.json + public/core-descriptions.json) with the
 * record's own AoN mirror document (its `aonId`). The records in that state when the check went in are
 * the baseline in scripts/data/spell-print-lines-baseline.json: a NEW one fails, and so does a listed
 * one that is now right (remove it — the list only shrinks), the moved-prose-baseline rule of
 * reprint-check.mjs CHECK 8.
 *
 *   node scripts/spell-print-lines-check.mjs                     # the check (npm run verify)
 *   node scripts/spell-print-lines-check.mjs --list              # today's offenders, baseline-shaped
 *   node scripts/spell-print-lines-check.mjs --pending a.json …  # with a batch spec's spell rows
 *                                                                #   applied in memory first
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/spell';
export const BASELINE = 'scripts/data/spell-print-lines-baseline.json';
export const CHECKS = ['header', 'cast', 'duration', 'requirements'];

const text = (v) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.join(' ').trim() : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The offenders per check. `spells` is core.json's spells bucket, `descriptions` the spells bucket of
 * core-descriptions.json ({d}), `docs` the mirror documents keyed by AoN id. A record with no mirror
 * document (rituals live under ritual-N, homebrew has none) is never judged: print is the authority, and
 * there is no print to read.
 */
export function spellPrintLineOffenders({ spells, descriptions, docs }) {
  const found = Object.fromEntries(CHECKS.map((c) => [c, []]));
  for (const [id, rec] of Object.entries(spells ?? {})) {
    if (!rec?.name) continue;
    const doc = rec.aonId ? docs[rec.aonId] : null;
    const d = String(descriptions?.[id]?.d ?? rec.description ?? '');
    // The scraped header: the record's own name, then the page's "Source <book> pg. N" line. Judged
    // with or without a mirror doc — the header is wrong on any record.
    if (new RegExp(`^\\s*${escapeRe(rec.name)}\\s*\\n\\s*Source `).test(d)) found.header.push(id);
    if (!doc || rec.ritual) continue;
    // spell-2876 prints "Single Action" above the body; ours must carry a cast of any shape.
    if (text(doc.actions) && !rec.cast) found.cast.push(id);
    // spell-2876 prints "Duration until the end of your next turn".
    if (text(doc.duration_raw) && !text(rec.duration)) found.duration.push(id);
    // spell-2885 prints "Requirements You're wielding an improvised weapon." The line is shown either
    // inline in the description (the sky-laughs-at-waves shape) or by a record field.
    if (text(doc.requirement) && !text(rec.requirements) && !/\bRequirements?\b/.test(d)) found.requirements.push(id);
  }
  for (const c of CHECKS) found[c].sort();
  return found;
}

/** Compare offenders with the baseline: a new offender fails, and so does a listed one now right. */
export function baselineProblems(found, baseline) {
  const problems = [];
  for (const c of CHECKS) {
    const listed = new Set(baseline?.[c] ?? []);
    const now = new Set(found[c] ?? []);
    for (const id of now) if (!listed.has(id)) problems.push(`${c}: spells/${id} ${WHAT[c]} — fix the record (an effect-backfill row), never the baseline`);
    for (const id of listed) if (!now.has(id)) problems.push(`${c}: spells/${id} is in ${BASELINE} but is right now — remove the entry (the list only shrinks)`);
  }
  return problems;
}

const WHAT = {
  header: 'opens its description with the scraped "<Name>\\nSource …" page header',
  cast: 'has no cast although its page prints an action cost',
  duration: 'has no duration although its page prints one',
  requirements: 'shows no Requirements line although its page prints one',
};

/** Apply a batch spec's spells rows ({category,id,field,value}, top-level only) in memory. */
export function applyPendingSpellRows(spells, descriptions, spec) {
  const rows = (spec?.findings ?? []).flatMap((f) => f.backfillRows ?? f.rows ?? []);
  for (const r of rows) {
    if (r?.category !== 'spells' || r.path || r.create || r.delete) continue;
    if (r.field === 'description') { descriptions[r.id] = { ...(descriptions[r.id] ?? {}), d: r.value }; continue; }
    const rec = spells[r.id];
    if (!rec) continue;
    if (r.value === null) delete rec[r.field];
    else rec[r.field] = r.value;
  }
}

function loadDocs() {
  const docs = {};
  if (!existsSync(MIRROR)) return null;
  for (const f of readdirSync(MIRROR)) {
    const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
    if (j?.id) docs[j.id] = j;
  }
  return docs;
}

const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const args = process.argv.slice(2);
  const docs = loadDocs();
  if (!docs) {
    console.log(`spell print lines: the AoN mirror (${MIRROR}) is not on this machine — skipped.`);
  } else {
    const spells = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8')).spells ?? {};
    const descriptions = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8')).spells ?? {};
    const pi = args.indexOf('--pending');
    if (pi >= 0) {
      for (const f of args.slice(pi + 1).filter((a) => !a.startsWith('--'))) {
        applyPendingSpellRows(spells, descriptions, JSON.parse(readFileSync(resolve(f), 'utf8')));
      }
    }
    const found = spellPrintLineOffenders({ spells, descriptions, docs });
    if (args.includes('--list')) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
      const problems = baselineProblems(found, baseline);
      console.log(`spell print lines: ${CHECKS.map((c) => `${c} ${found[c].length} (baseline ${(baseline[c] ?? []).length})`).join(', ')}.`);
      for (const p of problems) console.log(`   ${p}`);
      if (problems.length) process.exitCode = 1;
    }
  }
}
