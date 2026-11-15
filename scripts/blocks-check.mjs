/*
 * BLOCKS guard — the building-block catalog, the block registry and the target registry agree,
 * (item 10) the moved book fields are read only in src/rules/blocks/book.ts, and (item 9, case D) the raw
 * feat stores are named only where src/rules/blocks/feat-readers.json gives a reason
 * (scripts/lib/feat-readers.mjs scans; every other reader asks src/rules/heldFeats.ts), (spec item 4, one
 * reader) a character's `overrides` is named outside the Tweaks home files only where
 * src/rules/blocks/overrides-readers.json gives a reason (the same scanner), (spec item 1) no text a player
 * can read says "override" (scripts/lib/visible-words.mjs scans; VISIBLE_WORDS_SKIP in check.ts), and (item 7, one
 * content path) the raw contentEdits overlay `applyOverrides` is named only inside
 * src/rules/blocks/content.ts, whose one export is `contentFor`.
 *
 * docs/overrides-redesign.md, "Building blocks" items 1, 2, 3, 11 and 12, and decision 24 ("a block that
 * is neither in Tweaks nor on that list makes the check fail"). The rules themselves live in
 * src/rules/blocks/check.ts as one pure function, so test/blocks-check.test.ts can plant every bad case
 * in memory; this script only feeds it the real files and prints the result.
 *
 * Run: npx jiti scripts/blocks-check.mjs [--root <folder>]   (part of `npm run verify`)
 *   --root checks another copy of the repo (used to plant a bad case in a temp copy, never in the tree).
 *
 * jiti, NOT plain node — it imports src/rules/blocks/*.ts, whose imports are extensionless.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const argRoot = process.argv.indexOf('--root');
// Resolved from THIS file, so the guard checks the tree it lives in (a worktree lane included).
const ROOT = argRoot > 0 ? process.argv[argRoot + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => pathToFileURL(join(ROOT, p)).href;
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

const registry = await import(src('src/rules/blocks/registry.ts'));
const targets = await import(src('src/rules/blocks/targets.ts'));
const { checkBlocks, checkBookFieldReaders, checkFeatReaders, checkOverridesReaders, checkSlotCategoryReaders, checkVisibleOverrideWords, VISIBLE_WORDS_SKIP, checkContentPath, BOOK_FIELD_ALLOW } = await import(src('src/rules/blocks/check.ts'));
// The scanner is tooling (it lives beside this script); the tree it scans and the allowlist are ROOT's.
const { readAllow, scanFeatReaders, scanOverridesReaders, scanSlotCategoryReaders, srcFiles: featSrcFiles, FEAT_READERS_ALLOW, OVERRIDES_READERS_ALLOW, SLOT_CATEGORY_ALLOW } = await import('./lib/feat-readers.mjs');

const blockDir = 'src/rules/blocks';
// Every code file under the folder, subfolders included (item 12's import scan must see them all).
const blockFiles = readdirSync(join(ROOT, blockDir), { recursive: true })
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
  .map((f) => ({ path: `${blockDir}/${f}`, text: read(`${blockDir}/${f}`) }));

let catalog;
try {
  catalog = JSON.parse(read(`${blockDir}/catalog.json`) ?? 'null');
} catch (e) {
  console.error(`blocks-check: ${blockDir}/catalog.json is not valid JSON — ${e.message}`);
  process.exit(1);
}

const { errors, info } = checkBlocks({
  registry: registry.BLOCK_KINDS,
  stillToAdd: registry.STILL_TO_ADD,
  editorParts: registry.EDITOR_PARTS,
  sourceKinds: registry.SOURCE_KINDS,
  targets: targets.TARGETS,
  owners: targets.OWNERS,
  catalog,
  designDoc: read('docs/overrides-redesign.md') ?? '',
  lanesDoc: read('docs/mechanic-lanes.md') ?? '',
  blockFiles,
  readFile: read,
});

/* Item 10, "no field has two code paths": every code file under src/ is scanned for a read of a moved
 * book field (the bookFields of the registry's kinds) outside src/rules/blocks/book.ts. */
const srcFiles = readdirSync(join(ROOT, 'src'), { recursive: true })
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ path: `src/${f}`, text: read(`src/${f}`) ?? '' }));
const bookFields = [...new Set(registry.BLOCK_KINDS.flatMap((k) => k.bookFields ?? []))];
const readers = checkBookFieldReaders({ files: srcFiles, bookFields, allow: BOOK_FIELD_ALLOW });
errors.push(...readers.errors);
info.push(...readers.info);

/* Item 9 / case D: every reader of the feats a build holds asks src/rules/heldFeats.ts; the places that
 * still name the raw stores (`featPicks`, `addedFeats`) are only the ones the allowlist gives a reason for. */
let featAllow;
try {
  featAllow = readAllow(ROOT);
} catch (e) {
  errors.push(`${FEAT_READERS_ALLOW} is not valid JSON — ${e.message}`);
}
if (featAllow !== undefined) {
  const feats = checkFeatReaders(scanFeatReaders(featSrcFiles(ROOT)), featAllow);
  errors.push(...feats.errors);
  info.push(...feats.info);
}

/* Spec item 4, one reader (plan B WP2, section 7.1): every read of a character's tweaks goes through
 * src/rules/blocks/active.ts (switch, on/off, start level); the places outside the home files that still
 * name `overrides` are only the ones src/rules/blocks/overrides-readers.json gives a reason for. */
let overridesAllow;
try {
  overridesAllow = readAllow(ROOT, OVERRIDES_READERS_ALLOW);
} catch (e) {
  errors.push(`${OVERRIDES_READERS_ALLOW} is not valid JSON — ${e.message}`);
}
if (overridesAllow !== undefined) {
  const tweaks = checkOverridesReaders(scanOverridesReaders(featSrcFiles(ROOT)), overridesAllow);
  errors.push(...tweaks.errors);
  info.push(...tweaks.info);
}

/* Tweaks phase 2, WP7 (C10): an extra feat place's key is `<level>:extra<category>:<n>`, so a slot key's
 * category is read through slotCategoryOf / slotRefOf; the places that still read it raw are only the ones
 * src/rules/blocks/slot-category-readers.json gives a reason for. */
let slotCatAllow;
try {
  slotCatAllow = readAllow(ROOT, SLOT_CATEGORY_ALLOW);
} catch (e) {
  errors.push(`${SLOT_CATEGORY_ALLOW} is not valid JSON — ${e.message}`);
}
if (slotCatAllow !== undefined) {
  const cats = checkSlotCategoryReaders(scanSlotCategoryReaders(featSrcFiles(ROOT)), slotCatAllow);
  errors.push(...cats.errors);
  info.push(...cats.info);
}

/* Item 7, one content path: the raw overlay `applyOverrides` is named only inside
 * src/rules/blocks/content.ts, which exports `contentFor` alone. Scanned: every code file of the app (src/),
 * its tests (test/), the tooling (scripts/) and the tracker (tracker/), plus the root config files; a
 * dependency, build-output or graph folder is skipped. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'target', 'graphify-out', '.git']);
const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
function codeFilesUnder(rel) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(join(ROOT, dir))) return;
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (dir !== '' && !SKIP_DIRS.has(e.name)) walk(p);
      } else if (CODE_EXT.test(e.name)) out.push({ path: p, text: read(p) ?? '' });
    }
  };
  walk(rel);
  return out;
}
/* Spec item 1 (plan B WP9b, section 7.2): "Overrides" is now Tweaks, so no text a player can read under src/
 * says "override" — outside VISIBLE_WORDS_SKIP (each file with its reason) and the `// tweaks-ok: <reason>`
 * markers. The scanner (scripts/lib/visible-words.mjs) is tooling beside this script; the tree is ROOT's. */
{
  const { scanVisibleWordFiles } = await import('./lib/visible-words.mjs');
  const { hits, markers } = scanVisibleWordFiles(featSrcFiles(ROOT));
  const words = checkVisibleOverrideWords(hits, VISIBLE_WORDS_SKIP, markers);
  errors.push(...words.errors);
  info.push(...words.info);
}

const contentPath = checkContentPath(['', 'src', 'test', 'scripts', 'tracker'].flatMap(codeFilesUnder));
errors.push(...contentPath.errors);
info.push(...contentPath.info);

for (const line of info) console.log(`blocks-check: ${line}`);
if (errors.length) {
  console.error(`\nblocks-check FAILED — ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`blocks-check: OK — ${registry.BLOCK_KINDS.length} registered kinds, ${targets.TARGETS.length} targets`);
