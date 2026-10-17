/*
 * NO SHIPPED TEXT TELLS THE PLAYER TO USE FOUNDRY'S EDITOR — package I, item I6f (2026-10-17).
 *
 * The 19 Foundry-era "Scroll of Nth-rank Spell" and "Magic Wand (Nth-rank Spell)" records shipped with
 * Foundry VTT's own editor instruction at the end of their description:
 *
 *     *Note: To create a scroll or wand of a specific spell, drag the spell from the compendium or
 *     compendium browser into the inventory of a PC, NPC, or loot actor.*
 *
 * Heroes Heaven has no compendium and no loot actor, and the Archives page (GM Core pg. 262 / 282) prints
 * nothing of the kind. The note came in with public/core.foundry-backup.json, and import-core-v2 keeps that
 * description for every overlaid record and kept orphan, so every regeneration copied it back. Overlay
 * description rows now carry the text without it; THIS holds the class shut.
 *
 * WHAT COUNTS. Every string at ANY depth of public/core.json, public/core-descriptions.json and of the `value`
 * (or `create` record) of every row of scripts/data/effect-backfill.json — so a future overlay row cannot bring
 * a phrase back, and a nested note (an effectChoices[].note, a mode note) is read as well as a description.
 * An overlay row's `why` is NOT read: a `why` quotes the phrase it removes.
 *
 * WHAT DOES NOT. The phrase list is deliberately narrow. It does not match a bare "compendium" (the Undead
 * Compendium, the Fulu Compendium and "a compendium of journals" are real names and real prose), nor "not
 * automated" (our own core.modes.scouring-spark.note says that, about our app). Measured on 2026-10-17 with
 * zero false positives.
 *
 * THE BASELINE. Ten more records carry Foundry-UI phrases that are a different cleanup (each needs its own
 * reading of the print and, for several, a rewrite of the effect it describes). They are listed in
 * scripts/data/foundry-ui-text-baseline.json; a NEW offender fails, and so does a listed one that is now
 * clean (remove its entry — the list only shrinks), the moved-prose-baseline rule of reprint-check.mjs CHECK 8.
 *
 *   node scripts/foundry-ui-text-check.mjs                  # the check (npm run verify)
 *   node scripts/foundry-ui-text-check.mjs --list           # today's offenders, baseline-shaped
 *   node scripts/foundry-ui-text-check.mjs --root DIR       # read DIR's copies of the three files and the baseline
 *                                                           #   (the test plants an offender in a temp copy)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'scripts/data/foundry-ui-text-baseline.json';

/**
 * Phrases only Foundry's editor or its automation uses. Each is a whole-phrase test with word boundaries; none
 * is a bare common word.
 */
export const FOUNDRY_UI_PHRASES = [
  /compendium browser/i,
  /\bloot actor\b/i,
  /drag (?:the|a) spell from the compendium/i,
  /\bthe button above\b/i,
  /\bthe effect linked here\b/i,
  /\bFoundry automation\b/i,
  /cannot reference data from another actor/i,
  /\bthe included effect is only needed\b/i,
  /\bthe automation for\b/i,
];

/** The first phrase this text carries, or null. */
export const foundryUiPhrase = (text) => {
  for (const re of FOUNDRY_UI_PHRASES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
};

/** True when any string at any depth of `v` carries a Foundry-UI phrase. */
export function carriesFoundryUi(v) {
  if (typeof v === 'string') return foundryUiPhrase(v) !== null;
  if (Array.isArray(v)) return v.some(carriesFoundryUi);
  if (v && typeof v === 'object') return Object.values(v).some(carriesFoundryUi);
  return false;
}

/** The phrase found in `v`, with the path it was found at, or null. Used to tell the author WHERE. */
export function findFoundryUi(v, at = '') {
  if (typeof v === 'string') {
    const p = foundryUiPhrase(v);
    return p ? { phrase: p, at } : null;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findFoundryUi(v[i], `${at}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const r = findFoundryUi(x, at ? `${at}.${k}` : k);
      if (r) return r;
    }
  }
  return null;
}

/**
 * The offenders as { "<bucket>/<id>": { phrase, where } }. `core` is public/core.json ({bucket: {id: record}}),
 * `descriptions` is public/core-descriptions.json ({bucket: {id: {d}}}), `overlay` is the effect-backfill rows.
 */
export function foundryUiOffenders({ core, descriptions, overlay }) {
  const out = {};
  const note = (key, hit, where) => {
    if (hit && !out[key]) out[key] = { phrase: hit.phrase, where: `${where}${hit.at ? ` ${hit.at}` : ''}` };
  };
  for (const [bucket, recs] of Object.entries(core ?? {})) {
    if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
    for (const [id, rec] of Object.entries(recs)) note(`${bucket}/${id}`, findFoundryUi(rec), 'core.json');
  }
  for (const [bucket, recs] of Object.entries(descriptions ?? {})) {
    if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
    for (const [id, rec] of Object.entries(recs)) note(`${bucket}/${id}`, findFoundryUi(rec), 'core-descriptions.json');
  }
  for (const row of overlay ?? []) {
    if (!row?.category || !row?.id) continue;
    // `why` quotes what a row removes, so only the row's payload is read.
    note(`${row.category}/${row.id}`, findFoundryUi({ value: row.value, create: row.create }), 'effect-backfill.json row');
  }
  return out;
}

/** A new offender fails, and so does a listed one that is now clean. */
export function baselineProblems(found, baseline) {
  const problems = [];
  const listed = new Set(baseline?.records ?? []);
  for (const [k, hit] of Object.entries(found)) {
    if (!listed.has(k)) {
      problems.push(
        `${k} carries Foundry editor text ("${hit.phrase}", ${hit.where}) — remove it with an effect-backfill row (the print has no such line); never add the record to ${BASELINE}`,
      );
    }
  }
  for (const k of listed) {
    if (!(k in found)) problems.push(`${k} is in ${BASELINE} but no longer carries Foundry editor text — remove the entry (the list only shrinks)`);
  }
  return problems;
}

const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--root');
  const ROOT = ri >= 0 ? resolve(args[ri + 1] ?? '') : HERE;
  const read = (p) => {
    const f = join(ROOT, p);
    if (!existsSync(f)) {
      console.error(`foundry-ui-text: ${f} is missing — nothing was checked.`);
      process.exit(2);
    }
    return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
  };
  const found = foundryUiOffenders({
    core: read('public/core.json'),
    descriptions: read('public/core-descriptions.json'),
    overlay: read('scripts/data/effect-backfill.json'),
  });
  const keys = Object.keys(found).sort();
  if (args.includes('--list')) {
    console.log(JSON.stringify({ records: keys }, null, 2));
  } else {
    const baseline = read(BASELINE);
    const problems = baselineProblems(found, baseline);
    console.log(`foundry-ui-text: ${keys.length} record(s) carry Foundry editor text (baseline ${(baseline.records ?? []).length}).`);
    for (const p of problems) console.log(`   ${p}`);
    if (problems.length) process.exitCode = 1;
  }
}
