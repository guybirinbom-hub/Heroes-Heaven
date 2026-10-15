/**
 * A class sub-pick's EMBEDDED description is its classFeatures record's description — one text, two places.
 *
 * WHAT. Every `classes.<id>.subclass.options[]` and `classes.<id>.extraChoices[].options[]` entry carries a
 * `description` of its own (the Builder's option list, and — through buildCharacter — the sheet's
 * `classChoices[].description`, src/rules/build.ts). 250 of those options have a classFeatures record under the
 * same id (src/rules/sources.ts classOptionRecords), and that record's description is the text its popup shows.
 *
 * WHY THIS FILE EXISTS (2026-09-30). The two had drifted in 46 options, measured over public/core.json and
 * public/core-descriptions.json at a787fb0 — the School of Battle Magic's 6th-rank line read "Chain Lightning,"
 * (892 chars) where its record reads "Chain Lightning, Disintegrate" (905). The embedded copies are written by:
 *   · scripts/import-core-v2.mjs, which carries each class — options included — from the Foundry-era reference
 *     (public/core.foundry-backup.json). Its option texts are the ones the Foundry @-link cleaner left with the
 *     linked words deleted ("6th: ;", "in a centered on", "a  save"): the "1,206 records shipped with numbers
 *     deleted" class. The classFeatures RECORDS were repaired since (overlay `description` rows, re-applied every
 *     regen); the embedded copies never were, because nothing derived them from the record;
 *   · whole-list overlay rows (scripts/data/effect-backfill.json `options` rows with path ["subclass"] or
 *     ["extraChoices","id=…"], and whole `subclass` / `extraChoices` rows — wizard, magus, thaumaturge, animist,
 *     champion …), applied by import-core-v2 and re-applied by import-siege-and-gaps, which restate every option
 *     WITH the text it had when the row was written (the same stale copy, or a hand paraphrase: the animist's
 *     Lamentation of Sinister Deals);
 *   · scripts/import-new-classes.mjs, which merges the authored classes (work/new-classes/*.json) with their own
 *     option texts.
 * None of them is wrong to write an option list; the defect was that the copy was never taken from the record.
 * So `syncOptionDescriptions` takes it, as the last thing each of those three steps does before it writes
 * core.json, and scripts/embedded-description-check.mjs (npm run verify) fails any option whose copy differs.
 * The comparison is exact: the chain applies no normalisation between the record's text and the copy — the
 * copy IS the record's string.
 *
 * ...AND THE LINKS WITH THE TEXT (2026-09-30, the lane's refuter). A description's clickable words are its
 * `descRefs` ({ key, label }), so a text taken without its links shows the restored words as plain text — the
 * animist's Lamentation of Sinister Deals took its record's 1,595-character text with 11 of the record's 15
 * links. So the sync also gives the option every link its record has that the option lacks (`mergeRefs`). It
 * never REMOVES one: 12 options carry links their record does not (wizard/school-of-protean-form's
 * Metamorphosis, which overlay row 13330 added, is one), and the copy is no place to lose them. Where neither
 * carries a link for a word (Disintegrate on the Battle Magic school), the gap is the record's.
 *
 * THE OVERLAY'S COPY MUST BE THE RECORD'S TEXT — NEVER SILENTLY OVERWRITTEN. A whole-list overlay row restates
 * each option's text and links, and the sync runs after the overlay. So a row whose option text differed from
 * the record's would be overwritten on every regen with no check failing — an overlay edit that did nothing.
 * scripts/embedded-description-check.mjs (its OVERLAY half) fails every such row option — record with text, not
 * baselined (2026-09-30, the lane's second refuter): a text
 * change is made on the RECORD, and the whole-list rows are superseded with the record's text beside it. What
 * the sync may still add to a row's option is a record link the row lacks — additive only; a row's own links
 * are never removed or changed. scripts/regen-durability-check.mjs compares such a row with the shipped list
 * THROUGH this same sync (`syncOverlayValue`), which, with the guard green, excuses exactly those added links.
 *
 * THE BASELINE (scripts/data/embedded-description-baseline.json, "classId/optionId" -> reason): an option whose
 * RECORD is the damaged or shorter text, or whose shorter text a batch ruling pinned, so taking the record's
 * would put a worse or an overruled text in the Builder. The sync leaves those options — text and links — as the
 * writers made them and the guard accepts them — only while they still differ, so a line whose record is
 * repaired fails until it is removed, and the guard's BASELINE_CEILING (pinned by
 * test/embedded-descriptions.test.ts) stops a line being ADDED without a visible edit to both.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BASELINE_FILE = 'scripts/data/embedded-description-baseline.json';

/** "classId/optionId" -> reason, from the baseline file under `root` (absent = none); `file` overrides the path. */
export function loadBaseline(root, file = join(root, BASELINE_FILE)) {
  if (!existsSync(file)) return new Map();
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return new Map(Object.entries(raw).filter(([k]) => k !== '_'));
}

/**
 * The record reader every caller shares: id -> { text, refs } for a classFeatures record, or null where no record
 * has that id. `descs` is core-descriptions.json once split-descriptions.mjs has run (`d` / `r`), absent before it
 * (the record's own `description` / `descRefs`).
 */
export function recordReader(db, descs) {
  return (id) => {
    const rec = db?.classFeatures?.[id];
    if (!rec) return null;
    const entry = descs?.classFeatures?.[id];
    return { text: entry?.d ?? rec.description, refs: entry?.r ?? rec.descRefs };
  };
}

const refKey = (r) => `${r?.key}\u001f${r?.label}`;

/** The record's links the option lacks (same key AND label), in the record's order. */
export function missingRefs(option, recordRefs) {
  if (!Array.isArray(recordRefs) || !recordRefs.length) return [];
  const have = new Set((option?.descRefs ?? []).map(refKey));
  return recordRefs.filter((r) => !have.has(refKey(r)));
}

/**
 * Give `option` every link its record has and it lacks, after its own and in the record's order; never removes
 * one. Mutates `option`; true when it added any.
 */
export function mergeRefs(option, record) {
  const add = missingRefs(option, record?.refs);
  if (!add.length) return false;
  option.descRefs = [...(option.descRefs ?? []), ...add];
  return true;
}

/** One option: the record's text, then its missing links. Returns { text, refs } — whether each changed. */
function syncOne(option, record) {
  const out = { text: false, refs: false };
  if (option.description !== record.text) { option.description = record.text; out.text = true; }
  out.refs = mergeRefs(option, record);
  return out;
}

/**
 * Sync one option list of class `classId`: every option with a classFeatures record takes the record's text and
 * links (`recordOf` from recordReader), except the baseline's "classId/optionId" keys in `keep`. Accumulates into
 * `acc` = { synced, linked, kept, noText } (arrays of "classId/optionId").
 */
export function syncOptionList(classId, options, recordOf, keep, acc) {
  for (const option of options ?? []) {
    if (!option?.id) continue;
    const record = recordOf(option.id);
    if (!record) continue;
    const key = `${classId}/${option.id}`;
    if (typeof record.text !== 'string' || !record.text) { acc.noText.push(key); continue; }
    if (option.description === record.text && !missingRefs(option, record.refs).length) continue;
    if (keep.has(key)) { acc.kept.push(key); continue; }
    const did = syncOne(option, record);
    if (did.text) acc.synced.push(key);
    if (did.refs) acc.linked.push(key);
  }
  return acc;
}

/** Every option list of a class record: [group, options] — "subclass" or "extraChoices:<group id>". */
function optionLists(c) {
  return [['subclass', c?.subclass?.options ?? []], ...(c?.extraChoices ?? []).map((g) => [`extraChoices:${g?.id ?? ''}`, g?.options ?? []])];
}

/**
 * Every class option that has a classFeatures record: [{ classId, group, option }] — `group` is "subclass" or
 * "extraChoices:<group id>", `option` the live object inside `classes` (so a caller may write to it).
 */
export function optionsWithRecords(db) {
  const out = [];
  const features = db?.classFeatures ?? {};
  for (const [classId, c] of Object.entries(db?.classes ?? {})) {
    for (const [group, opts] of optionLists(c)) {
      for (const option of opts) if (option?.id && features[option.id]) out.push({ classId, group, option });
    }
  }
  return out;
}

/**
 * Over every class of `db`: see syncOptionList. `recordOf` is recordReader(db, descs). Returns
 * { synced: text taken, linked: links added, kept: baselined and different, noText: record without text }.
 */
export function syncOptionDescriptions(db, recordOf, keep = new Set()) {
  const acc = { synced: [], linked: [], kept: [], noText: [] };
  for (const [classId, c] of Object.entries(db?.classes ?? {})) {
    for (const [, opts] of optionLists(c)) syncOptionList(classId, opts, recordOf, keep, acc);
  }
  return acc;
}

/**
 * The option lists inside one effect-backfill row's value, for a `classes` row: an `options` row pathed into
 * ["subclass"] or ["extraChoices","id=…"], a whole `subclass`, or a whole `extraChoices`. [] for any other row.
 */
export function optionListsInRow(row, value) {
  if (row?.category !== 'classes' || value == null) return [];
  const path = row.path ?? [];
  if (row.field === 'options' && Array.isArray(value) && (path[0] === 'subclass' || path[0] === 'extraChoices')) return [value];
  if (!path.length && row.field === 'subclass' && Array.isArray(value.options)) return [value.options];
  if (!path.length && row.field === 'extraChoices' && Array.isArray(value)) return value.map((g) => g?.options ?? []);
  return [];
}

/**
 * What an overlay row's value becomes once the chain has run the sync over it: a deep copy of the value with
 * every option list inside synced exactly as syncOptionList does. The same value back (uncopied) for a row that
 * writes no class option list.
 */
export function syncOverlayValue(row, recordOf, keep = new Set()) {
  if (!optionListsInRow(row, row?.value).length) return row?.value;
  const copy = JSON.parse(JSON.stringify(row.value));
  const acc = { synced: [], linked: [], kept: [], noText: [] };
  for (const list of optionListsInRow(row, copy)) syncOptionList(row.id, list, recordOf, keep, acc);
  return copy;
}

/** The first differing run of two texts, with a little context either side: { at, a, b }. */
export function differingRun(a, b, ctx = 24) {
  const x = String(a ?? ''), y = String(b ?? '');
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return { at: i, a: x.slice(Math.max(0, i - ctx), x.length - j + ctx), b: y.slice(Math.max(0, i - ctx), y.length - j + ctx) };
}
