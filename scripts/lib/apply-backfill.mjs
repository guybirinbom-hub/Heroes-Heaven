/*
 * The effect-backfill applier, shared.
 *
 * It lived only inside import-core-v2.mjs, which runs BEFORE import-siege-and-gaps.mjs adds the
 * import-gap records (the High Seas heritages, the Iblydosi language, a deity). Those records do not
 * exist when the backfill runs, so their rows are skipped — and then the gap importer writes a fresh
 * record without them. Four hand-authored patches were silently inert for exactly that reason.
 *
 * Running this again at the end of the gap import fixes them, and re-application is harmless: every
 * row is an absolute assignment, so applying it twice is applying it once.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Walk to a nested target. Array steps address by id (`id=apparition`), never by index — a
 *  regeneration reorders options freely and an index would silently land on a different one.
 *
 *  EXPORTED because scripts/wg-batch-run.mjs's shipped-artefact post-check has to resolve a row's path
 *  exactly the way the applier did. It kept a private copy of this walk, and a copy that has to "stay in
 *  step with" the original is a copy that eventually does not. */
export function backfillTarget(root, path) {
  let node = root;
  for (const step of path) {
    if (node == null) return null;
    if (Array.isArray(node)) {
      const [k, v] = String(step).split('=');
      node = k === 'id' ? node.find((x) => x?.id === v) : null;
    } else node = node[step];
  }
  return node && typeof node === 'object' ? node : null;
}

/**
 * Apply every row of scripts/data/effect-backfill.json to `db`. Returns {applied, unresolved}.
 *
 * `skipFields` exists for ONE caller: a replay against the already-split public/core.json.
 *
 * In the pipeline this runs BEFORE `split-descriptions.mjs`, so the overlay's 289 `description` rows
 * land in core.json and the split then moves them into core-descriptions.json, which is where the app
 * reads prose from. Replaying the overlay against the FINISHED core.json instead puts all 289 back —
 * measured, the file grew 184 KB and carried prose in two places, the exact state the split removed.
 * The pipeline passes nothing here and is unaffected.
 */
export function applyBackfill(db, file = 'scripts/data/effect-backfill.json', { skipFields = [] } = {}) {
  if (!existsSync(file)) return { applied: 0, unresolved: [] };
  const skip = new Set(skipFields);
  const unresolved = [];
  let applied = 0;
  for (const fix of JSON.parse(readFileSync(file, 'utf8'))) {
    if (fix.field && skip.has(fix.field)) continue;
    // `create` adds a whole record rather than patching a field — needed where a record is filed in
    // the wrong collection upstream, or is hand-authored with no AoN source at all. Never overwrites.
    if (fix.create) {
      db[fix.category] ??= {};
      if (!db[fix.category][fix.id]) {
        /*
         * `skipFields` applies to a CREATE too. Prose is stored split — core.json holds the record,
         * public/core-descriptions.json holds the text — and apply-backfill-now.mjs enforces that by
         * passing skipFields ['description','descRefs'] here and then routing those two fields to the
         * descriptions file by hand. A create row's `value` bypassed that: batch 033 created
         * items/innovation-light-mortar with its description folded in (a workaround for an apply
         * pre-check that has since been fixed), 1,130 characters of prose landed INLINE in core.json,
         * and scripts/regen-durability-check.mjs went red on "descriptions are split out" — the same
         * 184 KB duplication that split-descriptions.mjs exists to prevent. One rule, both paths.
         */
        const record = fix.value && typeof fix.value === 'object' && !Array.isArray(fix.value)
          ? { ...fix.value } : fix.value;
        if (record && typeof record === 'object') for (const f of skip) delete record[f];
        db[fix.category][fix.id] = record;
        applied++;
      }
      continue;
    }
    // `delete` removes a WHOLE RECORD — the mirror of `create`. A `value: null` row with no `field` was a
    // silent no-op (the `!fix.field` guard below), so a dead twin such as classFeatures/nudging-whisper
    // (the same Nudging Whisper that actions/nudging-whisper carries and the heritage grants) could
    // only ever be hidden, never retired. Idempotent: an already-absent record counts as applied.
    if (fix.delete) {
      if (db[fix.category]?.[fix.id]) delete db[fix.category][fix.id];
      applied++;
      continue;
    }
    const entry = db[fix.category]?.[fix.id];
    if (!entry || !fix.field) continue;
    const target = fix.path?.length ? backfillTarget(entry, fix.path) : entry;
    if (!target) {
      unresolved.push(`${fix.category}/${fix.id}/${fix.path.join('/')}`);
      continue;
    }
    // `value: null` means REMOVE the field, not "set it to null" — see the note in import-core-v2.
    if (fix.value === null) delete target[fix.field];
    else target[fix.field] = fix.value;
    applied++;
  }
  return { applied, unresolved };
}
