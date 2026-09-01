/**
 * DID `npm run data` ACTUALLY FINISH?
 *
 * The data chain is nine `&&`-joined steps. When any one of them exits non-zero the shell stops, npm
 * prints an error nobody reads past, and `public/core.json` is left holding whatever the LAST step to
 * succeed wrote — a half-built file that loads fine, renders fine, and is missing whole subsystems.
 *
 * That happened on 2026-08-19 and had been happening for some time before anyone noticed:
 * `stamp-aonid.mjs` refuses to write while any record lacks a map entry, five categories had just been
 * handed to the importer that produces them (so they appeared one stage EARLIER than the map knew
 * about), and the chain died at step 4 of 9. The damage from one aborted run:
 *
 *     24,879 aonIds  ->  133          every "view on AoN" link, ast lookup and prose top-up
 *     2 classes gone                  necromancer + runesmith, and all 24 of their features
 *     191 records stripped            kingdom structures/events, creature adjustments + themes
 *     27 meals lost their price       a shelf of food with no cost
 *
 * None of the fifteen other guards fired. `aonid-integrity.mjs` asks whether the aonIds that EXIST
 * point at the right page — zero aonIds is zero mismatches, a clean pass. That is the gap this fills:
 * the other guards check correctness, this one checks that the thing is all there.
 *
 * Deliberately shaped as invariants rather than counts, so it does not go stale every time the
 * Archives gain a record. Each check names the step whose absence it detects.
 *
 *     node scripts/regen-durability-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const records = (bucket) => Object.entries(core[bucket] ?? {}).filter(([, r]) => r && typeof r === 'object');

/* ---- 1. stamp-aonid.mjs ------------------------------------------------------------------------
 * The single loudest symptom, and the one that is invisible from every other angle. A floor rather
 * than an exact number: the corpus grows, but it does not shrink by four orders of magnitude. */
{
  let n = 0;
  for (const bucket of Object.keys(core)) for (const [, r] of records(bucket)) if (r.aonId) n++;
  check('aonIds are stamped (stamp-aonid.mjs ran)', n >= 20000, `${n} records carry an aonId`);
}

/* ---- 2. import-new-classes.mjs -----------------------------------------------------------------
 * A class the Archives importer cannot build, merged from work/new-classes/*.json. Left out of the
 * chain entirely until 2026-08-19, so every regen deleted both classes outright. Read from the source
 * directory, so a third authored class is covered the day it is written. */
{
  const dir = join(ROOT, 'work/new-classes');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) {
    console.log('  --    no work/new-classes/*.json — nothing to merge (skipped)');
  } else {
    for (const f of files) {
      const src = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const id = src?.class?.id;
      const featureIds = Object.keys(src?.features ?? {});
      check(`class '${id}' is merged`, !!core.classes?.[id]);
      const missing = featureIds.filter((k) => !core.classFeatures?.[k]);
      check(`class '${id}' kept all ${featureIds.length} features`, missing.length === 0, missing.slice(0, 6).join(', '));
      /*
       * `edition` is written by backfill-ast-edition.mjs into the overlay, and the overlay is applied
       * by import-core-v2 — a stage these records do not exist in yet. Without the re-apply at the end
       * of import-new-classes.mjs the field never lands, AND backfill-ast-edition reads its own row
       * back and reports "0 editions to add", so nothing anywhere says it is missing.
       */
      const noEdition = featureIds.filter((k) => core.classFeatures?.[k] && !core.classFeatures[k].edition);
      check(`class '${id}' features carry an edition`, noEdition.length === 0, noEdition.slice(0, 6).join(', '));
      const noProse = featureIds.filter((k) => !(descs.classFeatures?.[k]?.d ?? '').trim());
      check(`class '${id}' features carry prose`, noProse.length === 0, noProse.slice(0, 6).join(', '));
    }
  }
}

/* ---- 3. import-archive-buckets.mjs -------------------------------------------------------------
 * Four buckets no other step produces, plus the enrichment it fills in. import-core-v2 now emits a
 * LIGHTWEIGHT copy of the same records ({id, name, edition} + ast) one stage earlier, so "the bucket
 * exists" is no longer proof the step ran — the fields are. */
for (const bucket of ['kingdomStructure', 'kingdomEvent', 'creatureAdjustment', 'creatureThemeTemplate']) {
  const recs = records(bucket);
  check(`${bucket} is populated`, recs.length > 0, `${recs.length} records`);
  if (!recs.length) continue;
  const bare = recs.filter(([, r]) => !r.source?.book).map(([k]) => k);
  check(`${bucket} records carry their source`, bare.length === 0, `${bare.length} bare, e.g. ${bare.slice(0, 4).join(', ')}`);
}

/* Campsite meals land in `items` rather than a bucket of their own (the owner's ruling: buyable, with
 * no encoded effect), so they are found by their archive category, not by where they live. */
{
  const meals = records('items').filter(([, r]) => String(r.aonId ?? '').startsWith('campsite-meal-'));
  check('campsite meals are shipped', meals.length > 0, `${meals.length} meals`);
  if (meals.length) {
    /*
     * `itemType` and `note` are the two fields the item path writes UNCONDITIONALLY, so they are what
     * proves it ran. Price is not: Hearty Meal has no price on its archive page (verified against
     * campsite-meal.json), and asserting on it would fail forever on a record that is correct.
     */
    const bare = meals.filter(([, r]) => r.itemType !== 'consumable' || !r.note).map(([k]) => k);
    check('campsite meals are buyable consumables', bare.length === 0, `${bare.length} bare, e.g. ${bare.slice(0, 4).join(', ')}`);
    const priced = meals.filter(([, r]) => r.value != null).length;
    check('campsite meals keep their prices', priced >= meals.length - 1, `${priced}/${meals.length} priced`);
  }
}

/* ---- 4. split-descriptions.mjs -----------------------------------------------------------------
 * core.json is stored SPLIT: the prose lives in core-descriptions.json. An inline `description` left
 * on a record means the split did not run over it, which is how the file grew back to 22 MB before. */
{
  let inline = 0;
  const examples = [];
  for (const bucket of Object.keys(core)) {
    for (const [id, r] of records(bucket)) {
      if (typeof r.description === 'string' && r.description.length > 200) {
        inline++;
        if (examples.length < 5) examples.push(`${bucket}|${id}`);
      }
    }
  }
  check('descriptions are split out', inline === 0, `${inline} records still hold inline prose${examples.length ? `, e.g. ${examples.join(', ')}` : ''}`);
}

/* ---- 5. a skill key that is a SENTENCE ---------------------------------------------------------
 * The importer reads a background's printed clause into `trainedSkill`/`trainedLore`, and where the
 * clause names no subject it slugified the phrase instead: `trainedSkill:
 * "lore-associated-with-the-deity-who-blessed-you"`. The character was then trained in a Lore skill
 * literally named after the sentence, and the question the text asks was never asked. Seventeen
 * backgrounds carried one — seven found earlier, ten on 2026-08-19 — so it recurs on every re-import
 * of a book with this wording, which is exactly what a guard is for.
 *
 * Shape, not a list of ids: four or more hyphenated words is a phrase, never a Lore subject
 * (`dwarven-pantheon`, `plane-of-earth` are the longest real ones). */
{
  const SKILLS = new Set(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
    'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
    'survival', 'thievery']);
  const phrases = [];
  for (const bucket of Object.keys(core)) {
    for (const [id, r] of records(bucket)) {
      for (const field of ['trainedSkill', 'trainedLore']) {
        for (const v of [r[field] ?? []].flat()) {
          if (typeof v !== 'string' || !v) continue;
          const bare = v.replace(/^lore:/, '');
          if (SKILLS.has(bare) || bare.split('-').length < 4) continue;
          phrases.push(`${bucket}|${id}.${field}="${v}"`);
        }
      }
    }
  }
  check('no skill key is a slugified sentence', phrases.length === 0,
    `${phrases.length}${phrases.length ? `, e.g. ${phrases.slice(0, 3).join('  ')}` : ''}`);
}

/* ---- 9. THE SHIPPED ARTEFACT REFLECTS THE OVERLAY ----------------------------------------------
 *
 * Every check above asks whether the chain FINISHED. This one asks whether it was ever RUN.
 *
 * `scripts/data/effect-backfill.json` is the only overlay that survives a regen, and it is where all
 * hand-authored mechanics live. Editing it changes nothing a player sees until `npm run data` bakes it
 * into `public/core.json` — and a committed core.json that predates the last few edits looks exactly
 * like a current one. Nothing loads wrong, nothing renders wrong, no other guard fires: the authored
 * rows are simply not there.
 *
 * MEASURED 2026-08-20: the committed core.json was missing **733 rows**, including all 122
 * `attackItemBonus` rows from parity batch 11 — a whole batch's work, authored, gated, and inert. It
 * also masked three test failures that appeared the moment the artefact caught up.
 *
 * Prose is checked against core-descriptions.json, not core.json: the overlay is applied BEFORE
 * `split-descriptions.mjs`, which moves `description` -> `.d` and `descRefs` -> `.r` into that file.
 * Checking both artefacts is what makes this cover 100% of the rows rather than 97%.
 */
{
  const OVERLAY = 'scripts/data/effect-backfill.json';
  const rows = existsSync(join(ROOT, OVERLAY)) ? read(OVERLAY) : [];
  const PROSE = { description: 'd', descRefs: 'r' };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* Array steps address by id (`id=apparition`), never by index — the same walk applyBackfill uses. */
  const walk = (root, path) => {
    let node = root;
    for (const step of path) {
      if (node == null) return null;
      if (Array.isArray(node)) {
        const [k, v] = String(step).split('=');
        node = k === 'id' ? node.find((x) => x?.id === v) : null;
      } else node = node[step];
    }
    return node && typeof node === 'object' ? node : null;
  };

  const stale = [];
  let missingRecord = 0;
  for (const fix of rows) {
    if (fix.create) {
      if (!core[fix.category]?.[fix.id]) stale.push(`${fix.category}/${fix.id} (created record absent)`);
      continue;
    }
    if (!fix.field) continue;
    const proseKey = PROSE[fix.field];
    const db = proseKey ? descs : core;
    const entry = db[fix.category]?.[fix.id];
    /* A row whose record does not exist is a different defect (authored data reaching nothing) and is
     * counted separately — it is not evidence that the bake is stale. */
    if (!entry) { missingRecord++; continue; }
    const target = fix.path?.length ? walk(entry, fix.path) : entry;
    if (!target) { missingRecord++; continue; }
    const key = proseKey ?? fix.field;
    const got = target[key];
    const agrees = fix.value === null ? got === undefined : eq(got, fix.value);
    if (!agrees) stale.push(`${fix.category}/${fix.id}.${fix.field}`);
  }

  check(
    'public/core.json reflects every row of the effect-backfill overlay',
    stale.length === 0,
    `${rows.length} rows${stale.length ? ` — ${stale.length} NOT baked, e.g. ${stale.slice(0, 4).join(', ')}` : ' all present'}${missingRecord ? ` (${missingRecord} row(s) address a record that does not exist — separate issue)` : ''}`,
  );
  if (stale.length) {
    console.log('        The overlay has been edited since the last bake. Run `npm run data` — until you do,');
    console.log('        every one of those rows is authored and inert, and no other guard will say so.');
  }
}

console.log(
  failures.length
    ? `\n${failures.length} CHECK(S) FAILED — re-run \`npm run data\` and read its output from the TOP; the first non-zero exit is the real error.\n` +
      `If ONLY the overlay check failed, the chain is fine and simply has not been run since the last edit to\n` +
      `scripts/data/effect-backfill.json — the bake is part of finishing a change, not a separate chore.`
    : '\nregen durability: all checks passed',
);
process.exit(failures.length ? 1 : 0);
