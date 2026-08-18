/**
 * Merge hand-authored CLASS records into core.json.
 *
 * A class is the one record type the Archives importer cannot build. `import-core-v2.mjs` maps the
 * `class` category to the `classes` bucket, but AoN's class document carries only `hp`, `attribute`
 * and `rarity` as structured fields — the proficiencies and the whole level-by-level feature table
 * live in 20,000 characters of markdown. So every one of the 27 shipped classes came from the
 * Foundry-sourced base file, and a class newer than that file can never appear however complete the
 * archive becomes. Necromancer and Runesmith (Impossible Magic) are the first two to hit this.
 *
 * Authored from the printed text under `work/new-classes/<id>.json`:
 *   { "class": {…the class record…}, "features": { "<id>": {…}, … } }
 *
 * ADD-ONLY, like `import-siege-and-gaps.mjs`. Writing over a class that already exists is a hard
 * error, not a silent clobber — saved characters key off these ids.
 *
 * ⚠ THE RECORD IS ONLY HALF THE CLASS. Proficiency advancement lives in
 * `src/rules/advancement.ts` (CLASS_ADVANCEMENT), hand-authored and keyed by class id, because the
 * bumps are not in any data source. Without an entry there, every "expertise" feature this script
 * imports is inert prose and the class stays trained in everything to level 20. This script REFUSES
 * to write a class that has no advancement entry, so the two halves cannot drift apart.
 *
 *   node scripts/import-new-classes.mjs --dry-run
 *   node scripts/import-new-classes.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'work/new-classes');
const CORE = join(ROOT, 'public/core.json');
const DRY = process.argv.includes('--dry-run');
const DESC_ONLY = process.argv.includes('--descriptions-only');

if (!existsSync(SRC)) { console.log('no work/new-classes — nothing to merge.'); process.exit(0); }

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const advancementSrc = readFileSync(join(ROOT, 'src/rules/advancement.ts'), 'utf8');

const files = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
const added = [];
const problems = [];

for (const f of files) {
  let pack;
  try { pack = JSON.parse(readFileSync(join(SRC, f), 'utf8')); } catch (e) { problems.push(`${f}: unreadable — ${e.message}`); continue; }
  const cls = pack.class;
  if (!cls?.id || !cls?.name) { problems.push(`${f}: no class record`); continue; }

  /*
   * `--descriptions-only` exists because the add-only guard is right and should not be weakened: a
   * class already merged must never be silently rewritten. But its DESCRIPTION and display tree are
   * written by the block at the bottom of this file, and a class merged before that block existed has
   * neither — an empty class page. This flag runs that half alone, for classes already present.
   */
  if (core.classes[cls.id]) {
    // Still pass the pack's features through: the record merge below is a no-op for anything that
    // already exists, but the provenance and description stages need to know which features are this
    // class's. Passing {} here is why the already-merged classes' features had no aonId.
    if (DESC_ONLY) { added.push({ file: f, cls, features: pack.features ?? {}, descOnly: true }); continue; }
    problems.push(`${f}: classes/${cls.id} already exists — refusing to overwrite (use --descriptions-only to write just its prose + ast)`);
    continue;
  }

  /* The advancement half must exist BEFORE the class ships, or every expertise feature is inert. */
  if (!new RegExp(`^\\s*${cls.id}:\\s*\\[`, 'm').test(advancementSrc)) {
    problems.push(`${f}: no CLASS_ADVANCEMENT['${cls.id}'] in src/rules/advancement.ts — the class would never gain a proficiency. Author it first.`);
    continue;
  }

  /* Every feature the class table names must exist, either already or in this pack. Universal
   * boilerplate ("skill feat", "general feat") is modelled app-wide and deliberately absent. */
  const missing = (cls.features ?? [])
    .map((x) => x.featureId)
    .filter((id) => !core.classFeatures[id] && !pack.features?.[id]);
  if (missing.length) { problems.push(`${f}: names ${missing.length} feature(s) that exist nowhere: ${missing.slice(0, 6).join(', ')}`); continue; }

  added.push({ file: f, cls, features: pack.features ?? {} });
}

if (problems.length) {
  console.error('REFUSING TO WRITE:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

let newFeatures = 0;
for (const { cls, features, descOnly } of added) {
  if (!descOnly) core.classes[cls.id] = cls;
  for (const [id, rec] of Object.entries(features)) {
    if (core.classFeatures[id]) continue; // never overwrite an existing feature
    core.classFeatures[id] = rec;
    newFeatures++;
  }
}

console.log(`${added.length} class(es), ${newFeatures} new class feature(s):`);
for (const { cls, features } of added) {
  console.log(`  ${cls.id.padEnd(16)} ${String(cls.keyAbility)}  hp ${cls.hpPerLevel}  ${(cls.features ?? []).length} table rows, ${Object.keys(features).length} authored features`);
}

/* ------------------------------------------------------------------ archive provenance (aonId)
 *
 * The class record carries an `aonId`; its FEATURES did not, and that omission breaks the last stage of
 * `npm run data`.
 *
 * `stamp-aonid.mjs` writes provenance from `migration/out/map.json` and REFUSES to write at all when
 * any record is missing from that map — a deliberate all-or-nothing guard, because a partial stamp
 * silently drops every other aonId. `build-map.mjs` covers a targeted merge like this one through its
 * last-resort branch, "record carries its own aonId". A class feature with no aonId reaches neither: it
 * lands in `open`, and the whole stamping stage stops.
 *
 * Measured before this existed: 26 records unmapped (2 classes + 24 features), so `npm run data` would
 * have failed on its final command.
 *
 * Every one of these features has a real `class-feature-N` document, so matching by name gives genuine
 * provenance rather than marking them `authored`. A name that matches nothing is left alone and
 * reported — better no provenance than a wrong one, which is the same rule stamp-aonid.mjs applies to
 * its own unverified parents.
 */
{
  const EXPORT_DIR = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
  const cfDocs = JSON.parse(readFileSync(join(EXPORT_DIR, 'class-feature.json'), 'utf8')).docs ?? {};
  const byName = new Map();
  for (const [docId, doc] of Object.entries(cfDocs)) {
    const n = String(doc?.name ?? doc?.data?.name ?? '').trim().toLowerCase();
    if (n && !byName.has(n)) byName.set(n, docId);
  }
  let stamped = 0;
  const unmatched = [];
  for (const { features } of added) {
    for (const id of Object.keys(features)) {
      const rec = core.classFeatures[id];
      if (!rec || rec.aonId || rec.aonParentId) continue;
      const docId = byName.get(String(rec.name ?? '').trim().toLowerCase());
      if (!docId) { unmatched.push(`${id} ("${rec.name}")`); continue; }
      rec.aonId = docId;
      stamped++;
    }
  }
  console.log(`  provenance: stamped aonId on ${stamped} feature(s)` + (unmatched.length ? `, ${unmatched.length} unmatched` : ''));
  for (const u of unmatched) console.log(`    no class-feature document for ${u} — left without provenance`);
}
/* ------------------------------------------------------------------ description + display tree
 *
 * A class record alone renders an EMPTY PAGE. The prose lives in public/core-descriptions.json and
 * the parsed display tree in public/ast/classes.json — both keyed by slug, and both produced by the
 * full importer, which never sees these classes. Measured by scripts/process-parity.mjs: the two
 * authored classes came out at 50% description / 50% ast against 100% for the other 27, which is
 * exactly the "present but second-class" shape that check exists to find.
 *
 * Taken from the same export the rest of public/ast is built from, so the trees are identical in
 * kind to every other class's — not a hand-rolled substitute.
 */
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
/** AoN page -> the bucket a link resolves against. Same table as import-siege-and-gaps.mjs. */
const LINK_BUCKET = {
  'actions.aspx': 'actions', 'conditions.aspx': 'conditions', 'spells.aspx': 'spells',
  'equipment.aspx': 'items', 'weapons.aspx': 'items', 'armor.aspx': 'items', 'feats.aspx': 'feats',
  'traits.aspx': 'trait', 'skills.aspx': 'skill', 'rules.aspx': 'rules', 'archetypes.aspx': 'archetype',
  'deities.aspx': 'deities', 'ancestries.aspx': 'ancestries', 'classes.aspx': 'classes',
  'heritages.aspx': 'heritages', 'domains.aspx': 'domain', 'siegeweapons.aspx': 'siegeWeapons',
};
const strip = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/<%[^>]*?>/g, '')
  /* Markdown emphasis, which AoN wraps around trait names inside link labels. Without this the
   * cross-reference labels came out as "**Spellshape**" and "**Thrall**" — the marker rendered
   * literally on the popup control. */
  .replace(/\*\*/g, '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

function writeDescriptionsAndAst(list) {
  const classFile = join(EXPORT, 'class.json');
  if (!existsSync(classFile)) { console.log('no class export — descriptions/ast SKIPPED'); return; }
  const docs = JSON.parse(readFileSync(classFile, 'utf8')).docs ?? {};
  const idMap = existsSync(join(ROOT, 'public/idmap.json')) ? JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8')) : {};
  const resolveTo = (to) => {
    const hit = idMap[to];
    return hit && core[hit.bucket]?.[hit.slug] ? `${hit.bucket}:${hit.slug}` : null;
  };
  /* Same shape the full importer emits: `ref` resolved beside the raw `to`, so a link that cannot be
   * resolved renders as prose rather than as a dead control. */
  const resolveAst = (node) => {
    if (!node || typeof node !== 'object') return node;
    const out = Array.isArray(node) ? [] : {};
    for (const k in node) {
      if (k === 'to') { out.ref = resolveTo(node.to); out.to = node.to; }
      else if (k === 'c') out.c = node.c.map(resolveAst);
      else out[k] = node[k];
    }
    return out;
  };

  const descPath = join(ROOT, 'public/core-descriptions.json');
  const descs = JSON.parse(readFileSync(descPath, 'utf8'));
  descs.classes ??= {};
  const astPath = join(ROOT, 'public/ast/classes.json');
  const ast = existsSync(astPath) ? JSON.parse(readFileSync(astPath, 'utf8')) : {};
  const indexPath = join(ROOT, 'public/ast-index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};

  let wroteDesc = 0, wroteAst = 0;
  for (const { cls } of list) {
    const doc = docs[String(cls.aonId)];
    if (!doc) { console.log(`  !! no export doc for ${cls.id} (${cls.aonId}) — page will be empty`); continue; }
    /* The export keeps the raw AoN record under `data`; only the facet columns and `ast` are hoisted
     * to the top level. Reading `doc.markdown` finds nothing and writes no description at all. */
    const text = strip(doc.data?.markdown ?? doc.data?.text ?? doc.markdown ?? doc.text ?? '');
    /* Cross-references, so a link in the prose opens a popup instead of reading as dead text. Emitted
     * ONLY where the target actually resolves in core.json — an unresolvable ref renders as a dead
     * control, which is worse than plain prose. Same rule as `descRefsOf` in import-siege-and-gaps. */
    const refs = [];
    const seen = new Set();
    for (const m of String(doc.data?.markdown ?? '').matchAll(/\[([\s\S]*?)\]\(\/([A-Za-z]+\.aspx)[^)]*\)/g)) {
      const label = strip(m[1]).replace(/\s+/g, ' ').trim();
      const bucket = LINK_BUCKET[m[2].toLowerCase()];
      if (!bucket || !label || seen.has(label.toLowerCase())) continue;
      if (!text.includes(label)) continue; // the link text must survive into the plain description
      const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const byName = Object.values(core[bucket] ?? {}).some((r) => String(r?.name).toLowerCase() === label.toLowerCase());
      if (!core[bucket]?.[s] && !byName) continue;
      seen.add(label.toLowerCase());
      refs.push({ label, key: bucket });
    }
    if (text) { descs.classes[cls.id] = refs.length ? { d: text, r: refs } : { d: text }; wroteDesc++; }
    if (doc.ast) { ast[cls.id] = resolveAst(doc.ast); index[cls.id] = 'classes'; wroteAst++; }
  }

  const orderedAst = {};
  for (const k of Object.keys(ast).sort()) orderedAst[k] = ast[k];
  const json = JSON.stringify(orderedAst);
  writeFileSync(astPath, json);
  writeFileSync(`${astPath}.gz`, gzipSync(json, { level: 9 }));
  const orderedIndex = {};
  for (const k of Object.keys(index).sort()) orderedIndex[k] = index[k];
  writeFileSync(indexPath, JSON.stringify(orderedIndex));
  writeFileSync(descPath, JSON.stringify(descs));
  console.log(`  descriptions written: ${wroteDesc}   ast written: ${wroteAst}`);
}

if (DRY) { console.log('\n--dry-run: core.json NOT written.'); process.exit(0); }
writeFileSync(CORE, JSON.stringify(core));
writeDescriptionsAndAst(added);
console.log(`\nwrote public/core.json — classes ${Object.keys(core.classes).length}, classFeatures ${Object.keys(core.classFeatures).length}`);
