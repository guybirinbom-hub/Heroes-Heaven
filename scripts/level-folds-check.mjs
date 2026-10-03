/*
 * LEVEL FOLDS CHECK — scripts/data/level-folds.json equals its generator's output AND the page trees
 * (docs/card-design.md section 8 check 5; section 9 row 13a).
 *
 * The 'mine' card folds only what this ledger lists, matching each section by the hash of its text
 * (src/sheet/cardScope.ts scopeTree). Two ways it can go stale, each a failure here:
 *   1. the ledger on disk is not what scripts/level-folds.mjs generates from today's trees and core.json
 *      (a hand edit, a regen that moved or added a level-titled section, a page that lost one) —
 *      "regenerate and review the diff": `npx jiti scripts/level-folds.mjs --write`;
 *   2. an entry's hash no longer matches the tree it names (the section at `i` is gone, retitled, or its
 *      words changed), or a pointer / subclass page names a page the ledger does not list.
 * Check 2 reads the trees directly, so a ledger edited to agree with a broken generator still fails it.
 *
 * Runs on any clone: public/ast/*.json.gz, public/core.json and public/core-descriptions.json ship.
 *
 *   npx jiti scripts/level-folds-check.mjs                    # the check (exit 1 on any problem)
 *   npx jiti scripts/level-folds-check.mjs --ledger <file>    # check another copy (a scratch tamper)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, generateLevelFolds, loadCore, loadTrees, serialize } from './level-folds.mjs';
import { isLevelTitle, paragraphHash, sectionHash } from '../src/sheet/cardScope.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every problem with `text` (the ledger file's contents) against the trees and the generator. */
export function levelFoldProblems(text, root = ROOT, loaded = undefined) {
  const problems = [];
  let ledger;
  try {
    ledger = JSON.parse(text);
  } catch (e) {
    return [`${LEDGER} is not JSON: ${e.message}`];
  }
  const trees = loaded?.trees ?? loadTrees(root);
  const core = loaded?.core ?? loadCore(root);
  const treeOf = (key) => {
    const [b, ...rest] = String(key).split(':');
    return trees[b]?.[rest.join(':')];
  };
  // 2. Every entry against the tree it names.
  for (const [key, list] of Object.entries(ledger.pages ?? {})) {
    const top = treeOf(key)?.c;
    if (!top) { problems.push(`pages ${key}: no such page in public/ast`); continue; }
    for (const e of list) {
      if (!isLevelTitle(top[e.i])) problems.push(`pages ${key}#${e.i} "${e.title}": the tree has no level-titled section there`);
      else if (sectionHash(top, e.i) !== e.hash) problems.push(`pages ${key}#${e.i} "${e.title}": hash ${e.hash} does not match the tree (${sectionHash(top, e.i)})`);
    }
  }
  for (const [key, list] of Object.entries(ledger.impulses ?? {})) {
    const top = treeOf(key)?.c;
    if (!top) { problems.push(`impulses ${key}: no such page in public/ast`); continue; }
    for (const e of list) if (!top[e.i] || paragraphHash(top, e.i) !== e.hash) problems.push(`impulses ${key}#${e.i}: hash ${e.hash} does not match the tree`);
  }
  for (const [key, v] of Object.entries(ledger.subclassPages ?? {})) if (!ledger.pages?.[v]) problems.push(`subclassPages ${key}: ${v} is not a ledger page`);
  for (const [key, p] of Object.entries(ledger.pointers ?? {})) {
    const pages = Object.entries(ledger.subclassPages ?? {}).filter(([k]) => k.startsWith(`${p.classId}:`)).map(([, v]) => v);
    if (!pages.some((pk) => (ledger.pages?.[pk] ?? []).some((s) => s.title === p.title))) problems.push(`pointers ${key}: no subclass page of ${p.classId} has a section "${p.title}"`);
  }
  // 1. The whole file against the generator (byte for byte, as --write writes it).
  const fresh = serialize(generateLevelFolds(root, { trees, core }).ledger);
  if (fresh !== text) {
    const want = JSON.parse(fresh);
    const keys = new Set([...Object.keys(want.pages), ...Object.keys(ledger.pages ?? {})]);
    let shown = 0;
    for (const k of [...keys].sort()) {
      if (JSON.stringify(want.pages[k]) === JSON.stringify(ledger.pages?.[k])) continue;
      if (shown++ < 20) problems.push(`pages ${k}: ${!ledger.pages?.[k] ? 'missing from the ledger' : !want.pages[k] ? 'listed but the generator finds no level-titled section' : 'differs from the generator'}`);
    }
    for (const sec of ['impulses', 'pointers', 'subclassPages']) if (JSON.stringify(want[sec]) !== JSON.stringify(ledger[sec] ?? {})) problems.push(`${sec}: differs from the generator`);
    problems.push(`${LEDGER} is not the generator's output — run \`npx jiti scripts/level-folds.mjs --write\` and review the diff`);
  }
  return problems;
}

const IS_MAIN = process.argv.some((a) => /(^|\/)level-folds-check\.mjs$/.test(String(a).replace(/\\/g, '/')));
if (IS_MAIN) {
  const i = process.argv.indexOf('--ledger');
  const file = i >= 0 ? process.argv[i + 1] : join(ROOT, LEDGER);
  const path = isAbsolute(file) ? file : join(process.cwd(), file);
  if (!existsSync(path)) {
    console.log(`level folds check: ${path} does not exist`);
    process.exit(1);
  }
  const problems = levelFoldProblems(readFileSync(path, 'utf8'));
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  const n = Object.values(ledger.pages ?? {}).flat().length;
  if (problems.length) {
    console.log(`level folds check: ${problems.length} problem(s) in ${path}`);
    for (const p of problems.slice(0, 60)) console.log(`   ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`level folds check: green — ${Object.keys(ledger.pages ?? {}).length} pages, ${n} sections, ${Object.values(ledger.impulses ?? {}).flat().length} impulse entries, ${Object.keys(ledger.pointers ?? {}).length} pointers match the trees and the generator.`);
  }
}
