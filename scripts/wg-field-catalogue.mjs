/**
 * THE FIELD CATALOGUE — every authorable field, its shape, and the code that READS it.
 *
 * Built because the parity batches spend most of their tokens re-deriving the same facts. Measured on
 * batch 002: 3.43M tokens for 100 records (34k each) across 1,276 tool calls, and the great majority
 * of those calls were ten compare agents and twenty-seven verify agents independently grepping the
 * same types.ts / build.ts / derive.ts to answer one question — "does anything actually read this
 * field?". That question has one answer. It should be looked up, not re-derived thirty-seven times.
 *
 * It also removes the top rejection cause. A row whose field has no reader is inert, and inert rows
 * were the commonest thing the verify stage killed.
 *
 * ⚠ A CATALOGUE IS A PREDICATE, AND PREDICATES HERE HAVE LIED. Four measuring scripts in this project
 * have reported coverage they did not have, and roughly 500 phantom "missing" records came from
 * predicates that knew ONE storage location. This one is generated from source on every run — never
 * hand-maintained, because a stale catalogue is worse than none: the whole point is that all agents
 * trust it, so one wrong entry propagates to every record in the batch instead of staying local.
 *
 * ⚠ AND IT MUST KNOW BOTH STORAGE LOCATIONS. wg-batch.mjs's own header records that the differ was
 * 19.2% ACCURATE until it learned to look at the id-keyed registries in src/rules/, because a mechanic
 * can live in a registry with no field to show for it. A field-only catalogue would recreate exactly
 * that failure, at batch scale. So registries are enumerated here too.
 *
 * test/field-catalogue.test.ts asserts this against the source, so it cannot rot unnoticed.
 *
 *   node scripts/wg-field-catalogue.mjs                  # human-readable summary
 *   node scripts/wg-field-catalogue.mjs --json out.json  # the artefact the batch ships
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/* Fields that describe the record rather than what it DOES. A parity row never targets one, so
 * listing them would bury the ~190 that matter under identity noise. Mirrors INERT in wg-batch.mjs. */
const IDENTITY = new Set([
  'id', 'name', 'description', 'descRefs', 'traits', 'level', 'category', 'source', 'sourceId',
  'aonId', 'aonOrigin', 'aonParentId', 'aonSection', 'rarity', 'edition', 'prerequisites', 'access',
  'frequency', 'trigger', 'requirements', 'cost', 'special', 'archetype', 'maxTakable', 'onlyAtLevel',
  'subcategory', 'price', 'bulk', 'usage', 'hands', 'group', 'itemType', 'craftReq', 'school',
  'tradition', 'traditions', 'range', 'targets', 'area', 'duration', 'defense', 'heightened',
  'summary', 'text', 'type', 'key', 'slug', 'page', 'pfsLegal', 'legacy', 'remaster', 'url',
  'otherTags', 'actionCost',
]);

/* ---------------------------------------------------------------- source, read once */
const srcFiles = [];
for (const dir of ['src/rules', 'src/sheet', 'src/builder', 'src/data']) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    srcFiles.push({ path: `${dir}/${f}`, text: readFileSync(join(d, f), 'utf8') });
  }
}
const typesSrc = srcFiles.find((f) => f.path === 'src/rules/types.ts')?.text ?? '';

/** The declaration line for a field, with its type — the shape an author has to satisfy. */
function declarationOf(field) {
  const re = new RegExp(`^\\s*${field}\\??:\\s*([^;]+);`, 'm');
  const m = re.exec(typesSrc);
  if (!m) return null;
  const line = typesSrc.slice(0, m.index).split('\n').length;
  return { line, shape: m[1].replace(/\s+/g, ' ').trim().slice(0, 120) };
}

/**
 * Where a field is READ. `types.ts` is excluded — declaring a field is not reading it, and counting
 * the declaration as a reader is precisely how a write-only field passes for a live one.
 */
function readersOf(field) {
  const out = [];
  const pats = [`.${field}`, `'${field}'`, `"${field}"`, `${field}:`];
  for (const f of srcFiles) {
    if (f.path === 'src/rules/types.ts') continue;
    if (!pats.some((p) => f.text.includes(p))) continue;
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`.${field}`) || lines[i].includes(`['${field}']`)) { out.push(`${f.path}:${i + 1}`); break; }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- fields actually in use */
const usage = new Map(); // field -> { buckets:Set, count, examples:[] }
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [id, rec] of Object.entries(recs)) {
    if (!rec || typeof rec !== 'object') continue;
    for (const k of Object.keys(rec)) {
      if (IDENTITY.has(k)) continue;
      const e = usage.get(k) ?? { buckets: new Set(), count: 0, examples: [] };
      e.buckets.add(bucket); e.count++;
      if (e.examples.length < 3) e.examples.push(`${bucket}/${id}`);
      usage.set(k, e);
    }
  }
}

const fields = [];
for (const [field, u] of usage) {
  const decl = declarationOf(field);
  const readers = readersOf(field);
  fields.push({
    field,
    records: u.count,
    buckets: [...u.buckets].sort(),
    shape: decl?.shape ?? null,
    declaredAt: decl ? `src/rules/types.ts:${decl.line}` : null,
    readers: readers.slice(0, 4),
    hasReader: readers.length > 0,
    examples: u.examples,
  });
}
fields.sort((a, b) => b.records - a.records);

/* ---------------------------------------------------------------- the id-keyed registries */
/* The OTHER storage location. A mechanic living here shows on no field; a catalogue blind to them
 * would repeat the mistake that held the differ at 19.2% accuracy. */
const registries = [];
for (const f of srcFiles) {
  if (!f.path.startsWith('src/rules/')) continue;
  for (const m of f.text.matchAll(/^export const ([A-Z][A-Z0-9_]+)\s*:\s*Record<string,([^>]*)>\s*=\s*\{/gm)) {
    const line = f.text.slice(0, m.index).split('\n').length;
    const body = f.text.slice(m.index);
    const end = body.indexOf('\n};');
    const keys = [...body.slice(0, end > 0 ? end : 4000).matchAll(/^\s{2}["']?([a-z0-9:_-]+)["']?\s*:/gm)].map((x) => x[1]);
    registries.push({ name: m[1], at: `${f.path}:${line}`, holds: m[2].trim().slice(0, 60), keys: keys.length, sample: keys.slice(0, 3) });
  }
}
registries.sort((a, b) => b.keys - a.keys);

const inert = fields.filter((f) => !f.hasReader);
const out = {
  generated: 'scripts/wg-field-catalogue.mjs — regenerate, never edit by hand',
  fields,
  registries,
  note:
    'A field with hasReader:false is INERT — authoring it changes nothing a player sees. Do not write '
    + 'a parity row against one; report it as needs-new-lane instead. A mechanic may also live in a '
    + 'REGISTRY rather than a field: check `registries` before concluding we do not encode something.',
};

const json = arg('--json', null);
if (json) { writeFileSync(json, JSON.stringify(out)); console.log(`wrote ${json} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`); }

console.log(`${fields.length} authorable fields in use across ${Object.keys(core).length} buckets`);
console.log(`  with a reader in src/ : ${fields.length - inert.length}`);
console.log(`  INERT (no reader)     : ${inert.length}`);
console.log(`${registries.length} id-keyed registries in src/rules/, ${registries.reduce((n, r) => n + r.keys, 0)} keys total\n`);
console.log('most-used fields:');
for (const f of fields.slice(0, 12)) {
  console.log(`  ${f.field.padEnd(24)} ${String(f.records).padStart(5)} records  ${f.hasReader ? f.readers[0] : '** NO READER **'}`);
}
if (inert.length) {
  console.log(`\ninert fields (authoring one changes nothing):`);
  for (const f of inert.slice(0, 20)) console.log(`  ${f.field.padEnd(28)} ${String(f.records).padStart(5)} records   e.g. ${f.examples[0]}`);
  if (inert.length > 20) console.log(`  … ${inert.length - 20} more`);
}
console.log('\nlargest registries:');
for (const r of registries.slice(0, 6)) console.log(`  ${r.name.padEnd(26)} ${String(r.keys).padStart(5)} keys   ${r.at}`);
