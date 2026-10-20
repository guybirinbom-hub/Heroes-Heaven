/*
 * BLOCKS guard — the building-block catalog, the block registry and the target registry agree,
 * (item 10) the moved book fields are read only in src/rules/blocks/book.ts, and (item 9, case D) the raw
 * feat stores are named only where src/rules/blocks/feat-readers.json gives a reason
 * (scripts/lib/feat-readers.mjs scans; every other reader asks src/rules/heldFeats.ts).
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
const { checkBlocks, checkBookFieldReaders, checkFeatReaders, BOOK_FIELD_ALLOW } = await import(src('src/rules/blocks/check.ts'));
// The scanner is tooling (it lives beside this script); the tree it scans and the allowlist are ROOT's.
const { readAllow, scanFeatReaders, srcFiles: featSrcFiles, FEAT_READERS_ALLOW } = await import('./lib/feat-readers.mjs');

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

for (const line of info) console.log(`blocks-check: ${line}`);
if (errors.length) {
  console.error(`\nblocks-check FAILED — ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`blocks-check: OK — ${registry.BLOCK_KINDS.length} registered kinds, ${targets.TARGETS.length} targets`);
