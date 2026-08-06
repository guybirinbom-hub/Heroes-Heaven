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
 *  regeneration reorders options freely and an index would silently land on a different one. */
function backfillTarget(root, path) {
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

/** Apply every row of scripts/data/effect-backfill.json to `db`. Returns {applied, unresolved}. */
export function applyBackfill(db, file = 'scripts/data/effect-backfill.json') {
  if (!existsSync(file)) return { applied: 0, unresolved: [] };
  const unresolved = [];
  let applied = 0;
  for (const fix of JSON.parse(readFileSync(file, 'utf8'))) {
    // `create` adds a whole record rather than patching a field — needed where a record is filed in
    // the wrong collection upstream, or is hand-authored with no AoN source at all. Never overwrites.
    if (fix.create) {
      db[fix.category] ??= {};
      if (!db[fix.category][fix.id]) {
        db[fix.category][fix.id] = fix.value;
        applied++;
      }
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
