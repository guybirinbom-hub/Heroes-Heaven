/*
 * CARD TRUTH — every popup shows its record's own Archives page, every printed line once, nothing of
 * ours dressed as print (docs/card-design.md section 8, check 1; step 4 of section 9, REPORT MODE:
 * built before any fix, so today's offenders are its baseline; it fails only when the measurement
 * leaves that baseline in either direction, and it joins `npm run verify` at step W, when
 * package.json is no longer another lane's dirty file).
 *
 * For every (surface, record) with a page it computes, from the shipped public/ast/*.json.gz and the
 * same functions the popups render with —
 *   - src/sheet/astVisibility.ts (isMetaP, isMetaishBlock, variantSection, withoutItemLists, textOf),
 *   - src/sheet/cardScope.ts (the folds a card draws; none yet — step 13),
 *   - featStatRows / itemStatRows / spellStatRows, the stat panel of FeatDetail / ItemDetail /
 *     SpellDetail, read from their own .tsx files (bundled in memory: jiti cannot parse .tsx),
 *   - RichText's parseBlocks for the description-string lane,
 * one verdict per printed label (OK / MISSING / DIFFERS / DUPLICATED / EXTRA) and these sections:
 *
 *   S1-MISSING       a label line the page prints that no region of the popup shows
 *   S1-UNNAMED       a line of the record's page a 'mine' tree popup leaves out that carries none of
 *                    section 2 rule 5's names (src/sheet/cardScope.ts OMISSION_RULES: S-own, S-items,
 *                    S-furniture, S-printed, S-future, S-pick) and is not a vocabulary label line (those
 *                    are S1-MISSING). Keyed by the line's leading bold word ("Source", "PFS Note",
 *                    "Special" …) or, for a prose line, "¶" + the start of its text. The legacy drop paths
 *                    (meta-line, metaish-block, inline-row, spoiler) are how a line was dropped, never a
 *                    name — so a predicate that starts hiding more page text turns this red.
 *   DIFFERS         a stat row whose value is not the page's (Prerequisites, Range, Area, Targets,
 *                    Duration, Defense — the rest are the record's fields, judged on presence only)
 *   DUPLICATED       a label shown in both the stat rows and the body
 *   EXTRA            a stat row (or a fallback-text line) the page does not print
 *   S2-NOT-OWN       the page is not the record's own (the census rule: identical to a differently named
 *                    record's tree, or lacking the record's own text, or another record's page) plus a
 *                    shared class feature whose page is another class's (CLASS_MISMATCH). Keyed by record.
 *   S3-PLACEMENT     a spell stat label drawn in the prose instead of the stat rows: a bold preamble
 *                    line, or the scraped plain-text Archives header ("Source … pg. N / Cast 1 hour /
 *                    Area …", unbolded, ~214 spells) — lib plainHeaderLabels
 *   S5-IDENTITY      the popup reads another record's tree, or none while the record has one (heritage
 *                    rows, hidden cursed items, pins, ChoiceDetails, the builder's 'origin' popup)
 *   CUT-IN-SENTENCE  a dropped line followed by a shown half-sentence (must stay 0)
 *   FOLDED-UNLISTED  a fold not listed in level-folds.json (0: nothing folds before step 13)
 *   OURS-LEAK        our wording inside page text, or our appended HTML in a body that is not an ours box
 *   STUBS            an embedded page stub whose aon id names no record (or that has no id), in EVERY
 *                    shipped tree of every bucket — archetype, rules, way and sidebar pages included
 *                    (section 2 rule 6 lists all of them). Keyed by page. S2 likewise runs over every
 *                    bucket that has records and pages, and browse rows exist for all of them.
 *
 * Skipped by ruling (section 13, 2026-10-02): S4 field-vs-print against the local mirror, and the
 * engine-page-agree check — mechanics are out of scope; both belong to the rebuild lane.
 *
 * BASELINE: scripts/data/card-truth-baseline.json, two-way like spell-print-lines-check.mjs and
 * reprint-check.mjs CHECK 8 — a NEW offender fails ("fix the record or the surface, never the
 * baseline"), and a listed entry that is now right fails ("remove it, the list only shrinks").
 * ⚠ The baseline was measured on a working tree where another lane's regen output (public/core.json,
 * core-descriptions.json, ast-index.json, effect-backfill.json …) is UNCOMMITTED. Re-stamp it
 * (--write-baseline) when that lane commits, in the same commit as nothing else.
 *
 * BLIND SPOTS: words inside a kept paragraph are not judged (a line is kept or left out whole); matching
 * is by text, so a dropped line whose words appear elsewhere on the popup counts as kept, and a glyph-sized
 * piece ("1") always does; a short lead-less piece right after a dropped header line ("(manipulate)")
 * takes that line's rule; the omission log covers the TREE lane only — the description-string lane
 * (spells, feat actions, fallbacks) is judged on labels, not line by line, because its text is not the
 * page's; the Archives page is taken as true; a record linked to the wrong printing passes.
 * Scope-dependent cases (a pick's note, a character's class) are modelled with no picks and per class
 * row only.
 *
 *   npx jiti scripts/card-truth-check.mjs                    # the check (report mode until step W)
 *   npx jiti scripts/card-truth-check.mjs --list             # today's offenders, baseline-shaped
 *   npx jiti scripts/card-truth-check.mjs --write-baseline   # re-stamp (only on committed data)
 *
 * Needs nothing but the repo: public/core.json, public/core-descriptions.json, public/ast-index.json and
 * public/ast/*.json.gz all ship with every clone (and node_modules' esbuild, a Vite dependency).
 *
 * Measured 2026-10-02 on this tree: 67,377 (surface, record) rows judged in 12.4–14.1 s, 13.8–14.8 s
 * wall clock; 273 unresolved stub occurrences (272 distinct page|stub entries). test/card-parity.test.tsx
 * renders a seeded 540 of them through the real popups, agrees with every one, and checks that those
 * rows' findings equal this baseline's entries for them.
 *
 * Card step 5 (re-stamped 2026-10-02): StatDetailModal's full text is the 'mine' card (CARD_ON.statDetail)
 * and its 2,774 rows are modelled with the card's rules. Their entries fell from S1-MISSING 5,642 →
 * 0, S1-UNNAMED 3,559 → 0 and CUT-IN-SENTENCE 2 → 0; no other surface's entry moved. What the card
 * leaves out on those rows is 878 lines on 677 rows, every one named S-furniture by its own words
 * (461 spoiler banners; 176 "leads to…" headings and their 176 link lists; 43 Class labels; 14 Related
 * Feats lists; 8 "Click here …" lines).
 * The switch turns back in one line (section 9): --write-baseline measures every landed surface
 * (lib SWITCHED_SURFACES) with its switch on for the main sections AND with it off for
 * `legacy[surface]`; the check expects the legacy entries while that switch is off (lib expectedEntries).
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { SECTIONS, SWITCHED_SURFACES, baselineProblems, computeLedger, expectedEntries, surfaceEntries } from './lib/card-scope.mjs';
import { CARD_ON } from '../src/sheet/cardSurfaces.ts';
import { foldsOf } from '../src/sheet/cardScope.ts';
import { ACTIVITIES } from '../src/rules/actions.ts';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses.ts';
import { classFeatureDescription } from '../src/rules/featureText.ts';
import { splitHeightening } from '../src/rules/heightening.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'scripts/data/card-truth-baseline.json';

/** core.json with its split-out descriptions merged back (they ship beside it). */
export function loadContent(root = ROOT) {
  const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
  const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
  for (const [bucket, records] of Object.entries(desc)) {
    const target = core[bucket];
    if (!target) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = target[id];
      if (!rec) continue;
      if (v.d !== undefined) rec.description = v.d;
      if (v.r !== undefined) rec.descRefs = v.r;
    }
  }
  return core;
}

export function loadTrees(root = ROOT) {
  const trees = {};
  const dir = join(root, 'public/ast');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json.gz'))) {
    trees[f.replace(/\.json\.gz$/, '')] = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8'));
  }
  return trees;
}

/**
 * The popups' own stat-row functions and RichText's block parser, from their .tsx files. jiti cannot
 * parse .tsx, so they are bundled in memory with the repo's esbuild (stylesheets as empty modules) and
 * imported from a temp file that is deleted straight after.
 */
export async function loadTsxFunctions(root = ROOT) {
  const { build } = createRequire(join(root, 'package.json'))('esbuild');
  const r = await build({
    stdin: {
      contents: [
        "export { featStatRows } from './src/sheet/FeatDetail.tsx';",
        "export { itemStatRows } from './src/sheet/ItemDetail.tsx';",
        "export { spellStatRows } from './src/sheet/SpellsTab.tsx';",
        "export { parseBlocks, cleanRun } from './src/sheet/RichText.tsx';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
      sourcefile: 'card-truth-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty', '.woff': 'empty' },
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
    logLevel: 'error',
  });
  const dir = mkdtempSync(join(tmpdir(), 'card-truth-'));
  const file = join(dir, 'stat-rows.mjs');
  try {
    writeFileSync(file, r.outputFiles[0].text);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The ledger's inputs, loaded once (runLedger measures them under one set of switches each call). */
export async function loadDeps(root = ROOT) {
  const content = loadContent(root);
  const trees = loadTrees(root);
  const astIndex = existsSync(join(root, 'public/ast-index.json')) ? JSON.parse(readFileSync(join(root, 'public/ast-index.json'), 'utf8')) : {};
  const fns = await loadTsxFunctions(root);
  return {
    content,
    trees,
    astIndex,
    statRows: { featStatRows: fns.featStatRows, itemStatRows: fns.itemStatRows, spellStatRows: fns.spellStatRows },
    parseBlocks: fns.parseBlocks,
    cleanRun: fns.cleanRun,
    activities: ACTIVITIES,
    situationalIds: Object.keys(FEAT_SITUATIONAL).filter((id) => !id.startsWith('trait:')),
    classFeatureDescription,
    splitHeightening,
    foldsOf,
  };
}

/** The ledger under `cardOn` (default: the switches as they are in src/sheet/cardSurfaces.ts). */
export async function runLedger(root = ROOT, cardOn = CARD_ON, deps = undefined) {
  return computeLedger({ ...(deps ?? (await loadDeps(root))), cardOn });
}

const argv = process.argv.slice(2);
// Under `npx jiti` the script's path is one of argv's entries, not always argv[1].
const IS_MAIN = process.argv.some((a) => /(^|\/)card-truth-check\.mjs$/.test(String(a).replace(/\\/g, '/')));
if (IS_MAIN) {
  const t0 = Date.now();
  const deps = await loadDeps();
  const writing = argv.includes('--write-baseline');
  // The baseline's main sections hold every landed surface with its switch ON (the card), whatever the
  // switch says right now; the check itself always measures the switches as they are.
  const mainOn = writing ? { ...CARD_ON, ...Object.fromEntries(SWITCHED_SURFACES.map((s) => [s, true])) } : CARD_ON;
  const { found, counts, stubOccurrences } = await runLedger(ROOT, mainOn, deps);
  const ms = Date.now() - t0;
  console.error(`card truth: ${stubOccurrences} unresolved stub occurrences across every shipped tree (${found.STUBS.length} distinct page|stub entries).`);
  if (argv.includes('--list')) {
    console.log(JSON.stringify(found, null, 2));
  } else if (writing) {
    // Each landed surface measured with its switch OFF: what the check expects while it is turned back.
    const legacy = {};
    for (const s of SWITCHED_SURFACES) legacy[s] = surfaceEntries((await runLedger(ROOT, { ...mainOn, [s]: false }, deps)).found, s);
    const out = {
      _measured: `card-truth-check --write-baseline, ${new Date().toISOString().slice(0, 10)}; on a working tree with another lane's regen output uncommitted — re-stamp when it commits`,
      ...found,
      legacy,
    };
    writeFileSync(join(ROOT, BASELINE), JSON.stringify(out, null, 1) + '\n');
    console.log(`card truth: baseline written (${SECTIONS.map((s) => `${s} ${found[s].length}`).join(', ')}) in ${Date.now() - t0} ms.`);
    for (const s of SWITCHED_SURFACES) console.log(`card truth: legacy ${s} (switch off): ${Object.entries(legacy[s]).map(([k, v]) => `${k} ${v.length}`).join(', ') || 'none'}.`);
  } else {
    const baseline = existsSync(join(ROOT, BASELINE)) ? JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) : {};
    const problems = baselineProblems(found, baseline, BASELINE);
    console.log(`card truth: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(', ')} rows judged in ${ms} ms.`);
    const expected = expectedEntries(baseline);
    console.log(`card truth: ${SECTIONS.map((s) => `${s} ${found[s].length} (baseline ${expected[s].length})`).join(', ')}.`);
    for (const p of problems.slice(0, 200)) console.log(`   ${p}`);
    if (problems.length > 200) console.log(`   … and ${problems.length - 200} more`);
    if (problems.length) process.exitCode = 1;
  }
}
