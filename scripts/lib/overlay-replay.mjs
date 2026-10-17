/**
 * Replaying scripts/data/effect-backfill.json onto the FINISHED artefacts — losslessly, and proved so.
 *
 * WHAT. `npm run data` applies the overlay inside its import steps and then keeps building on top of it.
 * scripts/apply-backfill-now.mjs is the fast path a parity batch uses instead: it replays the overlay onto
 * the shipped public/core.json + public/core-descriptions.json. For that to be safe, a replay must leave
 * the artefacts as a full rebuild would, so the steps the chain runs over overlay-written values run here
 * too, in the chain's order (import-siege-and-gaps.mjs, the last overlay application before the split):
 *   1. the rows (applyBackfill), prose routed to the descriptions file (the split moved it there), a
 *      created record's prose with it, a deleted record's prose removed with it;
 *   2. appendSubclassOptions — the created class options a whole-list row leaves out are put back
 *      (scripts/migration/out/player-created.json: magus twofold-tine / volatile-spark, animist
 *      lamentation-of-sinister-deals);
 *   3. foldBookSpellings — a book spelt another way takes the table's key;
 *   4. fillFrequencyCounters — a `counters` row replaces the array, and the printed-Frequency counter
 *      the chain keeps beside it is added back (the bravery-baldric case);
 *   5. syncOptionDescriptions — every class option takes its classFeatures record's text and links.
 * NOT replayed, on purpose (each changes nothing on today's data; a NEW row in its area ships the raw
 * value until `npm run data`): import-core-v2's grantsActions filter and wand re-type, stamp-aonid's
 * `edition: 'legacy'` on a remasteredAs twin (scripts/reprint-check.mjs catches that pair), and
 * import-archive-buckets' itemType / trait / book normalising of its five buckets.
 *
 * WHY THIS FILE EXISTS (package C, 2026-10-17). The replay was not lossless. Measured on 585544e
 * (2026-10-15) and again on e5bedf6: a whole replay dropped the `descRefs` inside classes/champion (Blessed
 * Armament, Blessed Shield) and classes/animist (Lamentation of Sinister Deals: 15 links -> 11), because it
 * ran step 1 and nothing after it — the rows' own shorter link lists went back. The parity-batch driver
 * (scripts/wg-batch-run.mjs) replays the WHOLE overlay after every spec, so every batch silently lost those
 * links. With steps 2-5, a whole replay of e5bedf6's artefacts changes nothing (0 differences, measured).
 *
 * AND THE PROOF. `replayChanges` compares the artefacts before and after a replay. A change is allowed
 * only where an overlay row that is NOT already in the shipped data (`unbakedRows`, the rule
 * scripts/regen-durability-check.mjs check 9 uses for "not baked") writes: that row's own field or path,
 * its record's prose key, a class option whose record's prose is pending, or the whole record for a
 * pending create / delete row. Any other change is the replay undoing something the chain built, and
 * apply-backfill-now.mjs refuses to write it; scripts/replay-lossless-check.mjs (npm run verify) fails on
 * it. The first draft excused a WHOLE record once any of its rows was pending, which hid a loss in
 * classes/champion during any batch that touched the champion (the package C refuters, 2026-10-17).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBackfill, backfillTarget } from './apply-backfill.mjs';
import { fillFrequencyCounters, foldBookSpellings } from './aon-facets.mjs';
import { LABELLED_BUCKETS } from './archive-coverage.mjs';
import { optionListsInRow, recordReader, syncOptionDescriptions, syncOptionList } from './embedded-descriptions.mjs';
import { appendSubclassOptions } from './player-create.mjs';

/** The two prose fields and the keys split-descriptions.mjs gives them in core-descriptions.json. */
export const PROSE_KEY = { description: 'd', descRefs: 'r' };

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const keyOf = (row) => `${row.category}/${row.id}`;

/** scripts/migration/out/player-created.json under `root` — the records import-core-v2 created on the last
 *  `npm run data` — or null when there is none (then the append step is skipped, as import-siege-and-gaps does). */
export function loadCreated(root) {
  const file = join(root, 'scripts/migration/out/player-created.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** The created class options of player-created.json: [{ id, classId, groupId }] (groupId '(subclass)' = the subclass list). */
function createdOptions(created) {
  return Object.entries(created?.classFeatures ?? {})
    .filter(([, m]) => m?.classId && m.groupId)
    .map(([id, m]) => ({ id, classId: m.classId, groupId: m.groupId }));
}

/** Give each record of `bucket` its descriptions-file text for the duration of `fn`, then take back exactly what
 *  was lent. The chain runs the append and the frequency fill BEFORE the split, so both read `description` off
 *  the record (an appended option carries its record's text; the fill reads the printed Frequency line). */
function withText(db, descs, bucket, fn) {
  const lent = [];
  for (const [id, rec] of Object.entries(db[bucket] ?? {})) {
    const d = descs[bucket]?.[id]?.d;
    if (rec && typeof rec === 'object' && rec.description === undefined && typeof d === 'string') { rec.description = d; lent.push(rec); }
  }
  try { return fn(); } finally { for (const rec of lent) delete rec.description; }
}

/**
 * Replay `rows` onto the finished artefacts `db` (core.json) and `descs` (core-descriptions.json), in place,
 * the way the chain leaves them (steps 1-5 above). `only` (a Set of "category/id") limits step 1 to those
 * records; steps 2-5 always run over everything, as in the chain (on settled data they change nothing).
 * `keep` is the embedded-description baseline; `created` is scripts/migration/out/player-created.json.
 */
export function replayOverlay(db, descs, rows, { only = null, keep = new Set(), created = null } = {}) {
  /* A COPY of the rows. The applier assigns a row's value object itself into `db`, and the sync then adds
   * links to it — so replaying the caller's rows changed THEM, and the loss check that reads the same rows
   * next (replayChanges) judged "already shipped" against values the replay had just edited. Measured on
   * the first draft of this file: the planted lossy replay passed the check after a correct one had run. */
  const own = clone(rows);
  const mine = (fix) => !only || only.has(keyOf(fix));
  /* A create row writes only a record that is absent; note which ones this replay will create, so their
   * prose can follow them (in the chain the record lands with its text and the split moves it out). */
  const createdNow = own.filter((f) => f.create && mine(f) && !db[f.category]?.[f.id]);

  const { applied, unresolved } = applyBackfill(db, own, { skipFields: Object.keys(PROSE_KEY), only });

  let prose = 0;
  const proseMissing = [];
  const setProse = (category, id, key, value) => {
    const entry = ((descs[category] ??= {})[id] ??= {});
    if (eq(entry[key], value)) return;
    entry[key] = value;
    prose++;
  };
  for (const fix of createdNow) {
    const v = fix.value;
    if (!v || typeof v !== 'object' || descs[fix.category]?.[fix.id]) continue;
    if (typeof v.description === 'string' && v.description) setProse(fix.category, fix.id, 'd', v.description);
    if (Array.isArray(v.descRefs) && v.descRefs.length) setProse(fix.category, fix.id, 'r', v.descRefs);
  }
  for (const fix of own) {
    if (!mine(fix)) continue;
    if (fix.delete) {
      if (!db[fix.category]?.[fix.id] && descs[fix.category]?.[fix.id]) { delete descs[fix.category][fix.id]; prose++; }
      continue;
    }
    const key = PROSE_KEY[fix.field];
    if (!key || fix.path?.length || fix.create) continue;
    if (!db[fix.category]?.[fix.id]) { proseMissing.push(keyOf(fix)); continue; }
    if (fix.value === null) {
      const entry = descs[fix.category]?.[fix.id];
      if (entry && key in entry) { delete entry[key]; prose++; }
      continue;
    }
    if (key === 'd' ? typeof fix.value !== 'string' : !Array.isArray(fix.value)) continue;
    setProse(fix.category, fix.id, key, fix.value);
  }

  const appended = created ? withText(db, descs, 'classFeatures', () => appendSubclassOptions(db, created)) : 0;
  const folded = foldBookSpellings(db, LABELLED_BUCKETS);
  const counters = withText(db, descs, 'items', () => fillFrequencyCounters(db.items));
  const sync = syncOptionDescriptions(db, recordReader(db, descs), keep);
  return { applied, unresolved, prose, proseMissing, appended, folded, counters, sync };
}

/**
 * What the chain makes of row `rows[index]`'s value: the value with every LATER row that writes inside it
 * applied (a whole-value row followed by `path` rows into that field is one intended multi-step write — the
 * haunting-memories `choice` case), then a class option list through the append and the sync, and an item's
 * `counters` through the frequency fill. `core` and `descs` are the shipped artefacts.
 */
export function chainValue(rows, index, { core, descs, recordOf = recordReader(core, descs), keep = new Set(), created = null }) {
  const fix = rows[index];
  const base = fix.path ?? [];
  let value = clone(fix.value);
  if (value !== null && value !== undefined) {
    const shell = { [fix.field]: value };
    for (let j = index + 1; j < rows.length; j++) {
      const q = rows[j];
      if (q.category !== fix.category || q.id !== fix.id || !q.field || q.create || q.delete) continue;
      const qp = q.path ?? [];
      if (qp.length <= base.length || qp[base.length] !== fix.field || base.some((s, k) => qp[k] !== s)) continue;
      const t = backfillTarget(shell, qp.slice(base.length));
      if (!t) continue;
      if (q.value === null) delete t[q.field];
      else t[q.field] = clone(q.value);
    }
    value = shell[fix.field];
  }
  if (fix.category === 'classes' && optionListsInRow(fix, value).length) {
    if (created) {
      /* appendSubclassOptions, on the list this row writes: the created options of this class it leaves out. */
      const listFor = (groupId) => {
        if (fix.field === 'options' && base[0] === 'subclass') return groupId === '(subclass)' ? value : null;
        if (fix.field === 'options' && base[0] === 'extraChoices') return groupId === String(base[1] ?? '').replace(/^id=/, '') ? value : null;
        if (!base.length && fix.field === 'subclass') return groupId === '(subclass)' ? (value.options ??= []) : null;
        if (!base.length && fix.field === 'extraChoices') return value.find((g) => g?.id === groupId)?.options ?? null;
        return null;
      };
      for (const o of createdOptions(created)) {
        if (o.classId !== fix.id) continue;
        const list = listFor(o.groupId);
        const rec = core?.classFeatures?.[o.id];
        if (!Array.isArray(list) || !rec || list.some((x) => x?.id === o.id)) continue;
        const text = recordOf(o.id)?.text;
        list.push({ id: o.id, name: rec.name, ...(text ? { description: text } : {}) });
      }
    }
    const acc = { synced: [], linked: [], kept: [], noText: [] };
    for (const list of optionListsInRow(fix, value)) syncOptionList(fix.id, list, recordOf, keep, acc);
  }
  if (fix.category === 'items' && fix.field === 'counters' && !base.length && Array.isArray(value)) {
    const rec = { ...(core?.items?.[fix.id] ?? {}), counters: value };
    const d = descs?.items?.[fix.id]?.d;
    if (rec.description === undefined && typeof d === 'string') rec.description = d;
    fillFrequencyCounters({ [fix.id]: rec });
    value = rec.counters;
  }
  return value;
}

/**
 * The overlay rows the shipped artefacts do NOT reflect yet: [{ index, row, label }], plus how many rows
 * address a record that does not exist (a different defect — authored data reaching nothing — counted apart).
 *
 * One rule for "baked", shared with scripts/regen-durability-check.mjs (its check 9) and the replay's loss
 * check. A row is compared with what the chain makes of it (`chainValue`); a prose row with
 * core-descriptions.json (an absent entry reads as "no text yet", so a description row for a record that
 * has none is pending, not missing); a path that does not resolve on an existing record is unbaked; a create
 * row is unbaked while its record is absent, its AoN join keys differ, or its text never reached the
 * descriptions file; a delete row while either file still holds the record.
 */
export function unbakedRows(core, descs, rows, { keep = new Set(), created = null, recordOf = recordReader(core, descs) } = {}) {
  const stale = [];
  let missingRecord = 0;
  for (const [index, fix] of rows.entries()) {
    if (fix.create) {
      const rec = core[fix.category]?.[fix.id];
      if (!rec) { stale.push({ index, row: fix, label: `${keyOf(fix)} (created record absent)` }); continue; }
      for (const f of ['aonId', 'aonParentId', 'aonSection']) {
        if (fix.value?.[f] !== undefined && rec[f] !== fix.value[f]) {
          stale.push({ index, row: fix, label: `${keyOf(fix)}.${f} (created as ${JSON.stringify(fix.value[f])}, artefact has ${JSON.stringify(rec[f])})` });
        }
      }
      if (typeof fix.value?.description === 'string' && fix.value.description && descs[fix.category]?.[fix.id]?.d === undefined) {
        stale.push({ index, row: fix, label: `${keyOf(fix)} (created record's text not in core-descriptions.json)` });
      }
      continue;
    }
    if (fix.delete) {
      if (core[fix.category]?.[fix.id] || descs[fix.category]?.[fix.id]) stale.push({ index, row: fix, label: `${keyOf(fix)} (deleted record present)` });
      continue;
    }
    if (!fix.field) continue;
    const record = core[fix.category]?.[fix.id];
    if (!record) { missingRecord++; continue; }
    const proseKey = PROSE_KEY[fix.field];
    if (proseKey) {
      const got = descs[fix.category]?.[fix.id]?.[proseKey];
      const agrees = fix.value === null ? got === undefined : eq(got, fix.value);
      if (!agrees) stale.push({ index, row: fix, label: `${keyOf(fix)}.${fix.field}` });
      continue;
    }
    const target = fix.path?.length ? backfillTarget(record, fix.path) : record;
    if (!target) { stale.push({ index, row: fix, label: `${keyOf(fix)}.${fix.field} (path ${JSON.stringify(fix.path)} does not resolve)` }); continue; }
    const got = target[fix.field];
    const agrees = fix.value === null
      ? got === undefined
      : eq(got, chainValue(rows, index, { core, descs, recordOf, keep, created }));
    if (!agrees) stale.push({ index, row: fix, label: `${keyOf(fix)}.${fix.field}` });
  }
  return { stale, missingRecord };
}

/** Up to `limit` differing locations of a and b: [{ at, kind, before?, after? }]. Array items with an id are
 *  named `id=<id>`, the way overlay paths name them. */
export function diffPaths(a, b, at = '', out = [], limit = 5) {
  if (out.length >= limit || eq(a, b)) return out;
  const clip = (v) => (v === undefined ? undefined : String(JSON.stringify(v)).slice(0, 120));
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      if (a.length !== b.length) { out.push({ at, kind: `list ${a.length} -> ${b.length} item(s)`, before: clip(a), after: clip(b) }); return out; }
      a.forEach((x, i) => diffPaths(x, b[i], `${at}/${x?.id ? `id=${x.id}` : i}`, out, limit));
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (out.length >= limit) break;
      if (!(k in b)) out.push({ at: `${at}/${k}`, kind: 'removed', before: clip(a[k]) });
      else if (!(k in a)) out.push({ at: `${at}/${k}`, kind: 'added', after: clip(b[k]) });
      else diffPaths(a[k], b[k], `${at}/${k}`, out, limit);
    }
    return out;
  }
  out.push({ at, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', before: clip(a), after: clip(b) });
  return out;
}

/** What each pending row may change: per "category/id", { whole, fields: [{ path, field }], prose: Set('d'|'r') },
 *  plus the classFeatures ids whose class options may change (pending prose: text and links; pending create
 *  or delete: the option itself). */
function allowances(stale) {
  const per = new Map();
  const optionText = new Set();
  const optionWhole = new Set();
  const of = (k) => { if (!per.has(k)) per.set(k, { whole: false, fields: [], prose: new Set() }); return per.get(k); };
  for (const { row } of stale) {
    const a = of(keyOf(row));
    if (row.create || row.delete) {
      a.whole = true;
      if (row.category === 'classFeatures') optionWhole.add(row.id);
      continue;
    }
    /* An item's counters are the chain's frequency fill of its text and fields (step 4), so ANY pending row on
     * an item may add one: new text printing "**Frequency** once per day" gets its counter, as in the chain.
     * The fill only adds, and a `counters` row of its own is pending anyway (the package C final checker). */
    if (row.category === 'items') a.fields.push({ path: [], field: 'counters' });
    const proseKey = PROSE_KEY[row.field];
    if (proseKey) {
      a.prose.add(proseKey);
      if (row.category === 'classFeatures') optionText.add(row.id);
      continue;
    }
    a.fields.push({ path: row.path ?? [], field: row.field });
  }
  return { per, optionText, optionWhole };
}

/** A copy of core.json record `rec` (of `bucket`) with what the pending rows may change taken out. */
function maskCore(bucket, rec, allow, optionText, optionWhole) {
  if (!rec || typeof rec !== 'object') return rec;
  const copy = clone(rec);
  for (const { path, field } of allow?.fields ?? []) {
    const t = path.length ? backfillTarget(copy, path) : copy;
    if (t) delete t[field];
  }
  if (bucket === 'classes') {
    const holders = [copy.subclass, ...(copy.extraChoices ?? [])].filter((h) => h && Array.isArray(h.options));
    for (const h of holders) {
      h.options = h.options.filter((o) => !optionWhole.has(o?.id));
      for (const o of h.options) if (o?.id && optionText.has(o.id)) { delete o.description; delete o.descRefs; }
    }
  }
  return copy;
}

/** A copy of descriptions entry `entry` with the pending prose keys taken out; an emptied entry reads as absent. */
function maskDescs(entry, allow) {
  if (!entry || typeof entry !== 'object') return entry;
  const copy = { ...entry };
  for (const k of allow?.prose ?? []) delete copy[k];
  return Object.keys(copy).length ? copy : undefined;
}

/**
 * Every record a replay changed beyond what its pending rows write: [{ file, key, diffs }]. Empty = the replay
 * was lossless. `pending` lists the "category/id" of every record with an unbaked row and `stale` those rows,
 * both judged on the BEFORE artefacts.
 */
export function replayChanges({ coreBefore, descsBefore, coreAfter, descsAfter, rows, keep = new Set(), created = null }) {
  const { stale } = unbakedRows(coreBefore, descsBefore, rows, { keep, created });
  const { per, optionText, optionWhole } = allowances(stale);
  const changes = [];
  const compare = (file, before, after, mask) => {
    for (const bucket of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
      const a = before?.[bucket] ?? {};
      const b = after?.[bucket] ?? {};
      if (eq(a, b)) continue;
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (eq(a[id], b[id])) continue;
        const allow = per.get(`${bucket}/${id}`);
        if (allow?.whole) continue;
        if (eq(mask(bucket, a[id], allow), mask(bucket, b[id], allow))) continue;
        changes.push({ file, key: `${bucket}/${id}`, diffs: diffPaths(mask(bucket, a[id], allow), mask(bucket, b[id], allow)) });
      }
    }
  };
  compare('public/core.json', coreBefore, coreAfter, (bucket, rec, allow) => maskCore(bucket, rec, allow, optionText, optionWhole));
  compare('public/core-descriptions.json', descsBefore, descsAfter, (_bucket, entry, allow) => maskDescs(entry, allow));
  return { pending: [...per.keys()], stale, changes };
}

/** The lines a caller prints for `changes` (at most `max` records). */
export function describeChanges(changes, max = 12) {
  const lines = [];
  for (const c of changes.slice(0, max)) {
    lines.push(`    ${c.file} ${c.key}`);
    for (const d of c.diffs) lines.push(`        ${d.at || '(whole record)'}: ${d.kind}${d.before !== undefined ? `  before ${d.before}` : ''}${d.after !== undefined ? `  after ${d.after}` : ''}`);
  }
  if (changes.length > max) lines.push(`    …and ${changes.length - max} more record(s)`);
  return lines;
}
