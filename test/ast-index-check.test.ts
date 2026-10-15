import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import { createdRefs } from '../scripts/lib/archive-coverage.mjs';
import {
  BUCKET_LAST, BUCKET_PRIORITY, CAT_BUCKET, FIRST_CLASS_BUCKETS, REGEN_DIFFERS, danglingEntries, deriveIndex, exportDocOf, missingFromIndex,
  preferenceOrder, readAstSlugs, readAstTrees, refreshIndexFile,
} from '../scripts/lib/ast-index.mjs';

/**
 * scripts/ast-index-check.mjs (npm run verify) and the rule it shares with scripts/backfill-ast-edition.mjs,
 * scripts/lib/ast-index.mjs.
 *
 * 2026-09-29: a `npm run data` died on a transient Windows lock at backfill-ast-edition's index write,
 * after the trees were on disk. The re-run tail added +0 slugs and public/ast-index.json stayed 1,779
 * slugs short; no check in verify noticed. The guard fails a tree slug the index lacks unless it is a
 * created record (createdRefs — the same function, never a copy) or is indexed under another bucket.
 *
 * Fixtures are throwaway roots: three tiny gzipped bucket trees, an index, and an archive-created.json.
 */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = path.join(__dirname, '..');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

type Trees = Record<string, string[]>;
/** `aon` (the Archives page id a tree carries) only where `pages` names one — as a shipped tree does. */
const tree = (slugs: string[], pages: Record<string, string> = {}) =>
  Object.fromEntries(slugs.map((s) => [s, { t: 'root', c: [{ t: 'p', c: [s] }], ...(pages[s] ? { aon: pages[s] } : {}) }]));

/** A throwaway root: public/ast/<bucket>.json.gz, public/ast-index.json, scripts/migration/out/archive-created.json.
 *  `pages[bucket][slug]` gives that tree an Archives page id. */
function fixture(trees: Trees, index: Record<string, string>, created: Record<string, string[]> = {}, pages: Record<string, Record<string, string>> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ast-index-'));
  roots.push(root);
  mkdirSync(path.join(root, 'public/ast'), { recursive: true });
  mkdirSync(path.join(root, 'scripts/migration/out'), { recursive: true });
  for (const [b, slugs] of Object.entries(trees)) writeFileSync(path.join(root, `public/ast/${b}.json.gz`), gzipSync(JSON.stringify(tree(slugs, pages[b]))));
  writeFileSync(path.join(root, 'public/ast-index.json'), JSON.stringify(index));
  const createdJson = Object.fromEntries(Object.entries(created).map(([b, ks]) => [b, Object.fromEntries(ks.map((k) => [k, { doc: `x-${k}` }]))]));
  writeFileSync(path.join(root, 'scripts/migration/out/archive-created.json'), JSON.stringify(createdJson));
  return root;
}

const TREES: Trees = {
  actions: ['grab-an-edge', 'shared-slug'],
  classFeatures: ['shared-slug', 'arcane-cascade', 'lost-feature'],
  reference: ['fixture-created-page'],
};
const COMPLETE_INDEX = { 'arcane-cascade': 'classFeatures', 'grab-an-edge': 'actions', 'lost-feature': 'classFeatures', 'shared-slug': 'actions' };

describe('missingFromIndex — what the guard demands', () => {
  const root = fixture(TREES, COMPLETE_INDEX, { reference: ['fixture-created-page'] });
  const trees = readAstSlugs(path.join(root, 'public/ast'));
  const created = createdRefs(root);

  it('reads every slug of every gzipped tree', () => {
    expect(trees).toEqual({ actions: ['grab-an-edge', 'shared-slug'], classFeatures: ['shared-slug', 'arcane-cascade', 'lost-feature'], reference: ['fixture-created-page'] });
  });

  it('a complete index is missing nothing: the created reference/fixture-created-page is not demanded, and classFeatures/shared-slug is indexed under actions', () => {
    const missing = missingFromIndex(COMPLETE_INDEX, trees, created);
    expect(missing, `the guard demanded ${missing.map((m) => `${m.bucket}/${m.slug}`).join(', ')}`).toEqual([]);
  });

  it('a created record IS demanded once it is not created (so the exclusion is what spares reference/fixture-created-page)', () => {
    const missing = missingFromIndex(COMPLETE_INDEX, trees, new Set());
    expect(missing, 'reference/fixture-created-page should be reported when createdRefs does not name it').toEqual([{ bucket: 'reference', slug: 'fixture-created-page' }]);
  });

  it('a missing ordinary slug IS reported — classFeatures/lost-feature', () => {
    const { 'lost-feature': _gone, ...short } = COMPLETE_INDEX;
    const missing = missingFromIndex(short, trees, created);
    expect(missing, 'classFeatures/lost-feature is deleted from the index and must be named').toEqual([{ bucket: 'classFeatures', slug: 'lost-feature' }]);
  });

  it('the derived index adds it, and a second derivation adds nothing and changes no byte', () => {
    const { 'lost-feature': _gone, ...short } = COMPLETE_INDEX;
    const once = deriveIndex(short, trees, created);
    expect(once.added, 'lost-feature should come back under classFeatures').toEqual([{ slug: 'lost-feature', bucket: 'classFeatures' }]);
    expect(JSON.stringify(once.index), 'the repaired index should equal the complete one, key order included').toBe(JSON.stringify(COMPLETE_INDEX));
    const twice = deriveIndex(once.index, trees, created);
    expect(twice.added, `a second derivation added ${twice.added.map((a) => a.slug).join(', ')}`).toEqual([]);
    expect(JSON.stringify(twice.index), 'a second derivation changed the index repaired with lost-feature').toBe(JSON.stringify(once.index));
  });

  it('a slug with trees in two buckets comes back under the preferred one (actions before classFeatures), never the other', () => {
    const { 'shared-slug': _gone, ...short } = COMPLETE_INDEX;
    const { added } = deriveIndex(short, trees, created);
    expect(added, 'shared-slug should be re-derived under actions').toEqual([{ slug: 'shared-slug', bucket: 'actions' }]);
  });

  it('danglingEntries names an entry whose bucket has no tree for it (grab-an-edge -> conditions), and nothing in a complete index', () => {
    expect(danglingEntries(COMPLETE_INDEX, trees), 'a complete index has no dangling entry').toEqual([]);
    const odd = { ...COMPLETE_INDEX, 'grab-an-edge': 'conditions', ghost: 'actions' };
    expect(danglingEntries(odd, trees), 'grab-an-edge -> conditions and ghost -> actions point at no tree')
      .toEqual([{ slug: 'ghost', bucket: 'actions' }, { slug: 'grab-an-edge', bucket: 'conditions' }]);
  });
});

describe('the preference order is scripts/import-core-v2.mjs INDEX_ORDER', () => {
  const src = readFileSync(path.join(ROOT, 'scripts/import-core-v2.mjs'), 'utf8');
  const list = (name: string) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(src);
    expect(m, `scripts/import-core-v2.mjs no longer declares ${name}`).not.toBeNull();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('BUCKET_PRIORITY and BUCKET_LAST are the importer\'s, verbatim', () => {
    expect(BUCKET_PRIORITY, 'scripts/lib/ast-index.mjs BUCKET_PRIORITY drifted from import-core-v2.mjs').toEqual(list('BUCKET_PRIORITY'));
    expect(BUCKET_LAST, 'scripts/lib/ast-index.mjs BUCKET_LAST drifted from import-core-v2.mjs').toEqual(list('BUCKET_LAST'));
  });

  it('CAT_BUCKET is the importer\'s literal, verbatim and in order; FIRST_CLASS_BUCKETS is its distinct values', () => {
    const m = /const CAT_BUCKET = \{([\s\S]*?)\n\};/.exec(src);
    expect(m, 'scripts/import-core-v2.mjs no longer declares the CAT_BUCKET literal').not.toBeNull();
    const pairs = [...m![1].matchAll(/(?:'([^']+)'|([A-Za-z]+))\s*:\s*'([^']+)'/g)].map((x) => [x[1] ?? x[2], x[3]]);
    expect(pairs.length, 'the CAT_BUCKET literal parsed to nothing').toBeGreaterThan(20);
    expect(Object.entries(CAT_BUCKET), 'scripts/lib/ast-index.mjs CAT_BUCKET drifted from import-core-v2.mjs').toEqual(pairs);
    const values = [...new Set(pairs.map((p) => p[1]))];
    expect(FIRST_CLASS_BUCKETS, 'scripts/lib/ast-index.mjs FIRST_CLASS_BUCKETS drifted from CAT_BUCKET').toEqual(values);
  });

  it('priority first, then first-class, then the rest by category file name, then the last three', () => {
    expect(preferenceOrder(['follower', 'skill', 'trait', 'skillGeneralAction', 'classes', 'archetype', 'classFeatures', 'actions']))
      .toEqual(['actions', 'classFeatures', 'classes', 'archetype', 'skillGeneralAction', 'skill', 'trait', 'follower']);
  });
});

describe('scripts/ast-index-check.mjs on a scratch copy (AST_INDEX / AST_DIR)', () => {
  /* The guard reads createdRefs from the REAL repo, so the created case uses a real created record. */
  const realCreated = JSON.parse(readFileSync(path.join(ROOT, 'scripts/migration/out/archive-created.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const [cBucket, cMap] = Object.entries(realCreated).find(([, m]) => m && Object.keys(m).length)!;
  const cSlug = Object.keys(cMap)[0];
  const { reference: _fixtureCreated, ...ordinary } = TREES;
  const trees: Trees = { ...ordinary, [cBucket]: [...(ordinary[cBucket] ?? []), cSlug] };

  const run = (root: string) => {
    try {
      const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/ast-index-check.mjs')], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AST_INDEX: path.join(root, 'public/ast-index.json'), AST_DIR: path.join(root, 'public/ast') },
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: err.stdout + err.stderr };
    }
  };

  it(`fails naming classFeatures/lost-feature and its per-bucket count; the created ${cBucket}/${cSlug} is not demanded`, () => {
    const { 'lost-feature': _gone, ...short } = COMPLETE_INDEX;
    const root = fixture(trees, short);
    const r = run(root);
    expect(r.code, `the guard passed an index missing classFeatures/lost-feature:\n${r.out}`).toBe(1);
    expect(r.out, `the guard did not name classFeatures/lost-feature:\n${r.out}`).toContain('MISSING classFeatures/lost-feature');
    expect(r.out, `the per-bucket count for the missing classFeatures/lost-feature is wrong:\n${r.out}`).toContain('per bucket: classFeatures 1');
    expect(r.out, `the created ${cBucket}/${cSlug} was demanded`).not.toContain(`MISSING ${cBucket}/${cSlug}`);
    expect(r.out.match(/MISSING /g)?.length, `the guard named more than lost-feature:\n${r.out}`).toBe(1);
  });

  it('passes once the index is derived from the same files, and prints the counts', () => {
    const { 'lost-feature': _gone, ...short } = COMPLETE_INDEX;
    const root = fixture(trees, short);
    const fixed = refreshIndexFile({ indexPath: path.join(root, 'public/ast-index.json'), astDir: path.join(root, 'public/ast'), exclude: createdRefs(ROOT), write: true });
    expect(fixed.added, `the repair should add classFeatures/lost-feature only, never the created ${cBucket}/${cSlug}`)
      .toEqual([{ slug: 'lost-feature', bucket: 'classFeatures' }]);
    const r = run(root);
    expect(r.code, `the guard failed a derived index:\n${r.out}`).toBe(0);
    expect(r.out, `the total should count 4 slugs, lost-feature back among them:\n${r.out}`).toMatch(/ast-index: 4 slugs;/);
    expect(r.out, `the per-bucket counts should be grab-an-edge + shared-slug under actions, arcane-cascade + lost-feature under classFeatures:\n${r.out}`)
      .toContain('ast-index per bucket: actions 2, classFeatures 2');
  });

  it('fails an entry that names a bucket whose tree lacks the slug (grab-an-edge -> conditions), though nothing is missing', () => {
    const root = fixture(trees, { ...COMPLETE_INDEX, 'grab-an-edge': 'conditions' });
    const r = run(root);
    expect(r.code, `the guard passed an index sending grab-an-edge to conditions, which has no tree for it:\n${r.out}`).toBe(1);
    expect(r.out, `the guard did not name grab-an-edge -> conditions:\n${r.out}`).toContain('DANGLING grab-an-edge -> conditions');
    expect(r.out, `the dangling count should be 1 (grab-an-edge):\n${r.out}`).toContain('dangling entries: 1');
    expect(r.out, 'nothing is missing here').not.toContain('MISSING ');
  });

  it('a copy that holds none of the 8 pinned slugs passes and names them as skipped, not as in place', () => {
    const r = run(fixture(trees, COMPLETE_INDEX));
    expect(r.code, `the guard failed a complete index with no pinned slug in the copy:\n${r.out}`).toBe(0);
    expect(r.out, `the skipped pins were not named:\n${r.out}`).toContain('0 of the 8 pinned multi-bucket slugs are in this copy, all in place (no tree or entry here: anchored-incorporeality');
  });

  /* THE PIN (scripts/lib/ast-index.mjs REGEN_DIFFERS): the 8 slugs (9 until 2026-09-30, when strigoi left: the
   * importer's index pass applies rule 4a since then) whose committed bucket the derivation
   * cannot re-derive. A fixture copy holds a tree for each of them in BOTH its pinned and its derived
   * bucket, so a re-pointed entry is neither missing nor dangling: only the pin check can fail it. */
  const pinTrees: Trees = { ...trees };
  for (const [slug, { pinned, derived }] of Object.entries(REGEN_DIFFERS)) {
    for (const b of [pinned, derived]) pinTrees[b] = [...(pinTrees[b] ?? []), slug];
  }
  const pinIndex: Record<string, string> = { ...COMPLETE_INDEX, ...Object.fromEntries(Object.entries(REGEN_DIFFERS).map(([s, p]) => [s, p.pinned])) };

  it('every pinned slug under its pin: passes and prints "8 multi-bucket slugs pinned, all in place"', () => {
    const r = run(fixture(pinTrees, pinIndex));
    expect(r.code, `the guard failed an index with all 8 pins in place:\n${r.out}`).toBe(0);
    expect(r.out, `the pin line is missing:\n${r.out}`).toContain('8 multi-bucket slugs pinned, all in place');
    expect(r.out, 'no pin should be reported').not.toContain('PINNED ');
  });

  it('mutation: light-mortar re-pointed to siegeWeapons (the bucket the derivation picks) fails naming the slug, its bucket and its pin', () => {
    const r = run(fixture(pinTrees, { ...pinIndex, 'light-mortar': 'siegeWeapons' }));
    expect(r.code, `the guard passed light-mortar under siegeWeapons, pinned to innovation:\n${r.out}`).toBe(1);
    expect(r.out, `the guard did not name light-mortar's bucket and pin:\n${r.out}`)
      .toContain('PINNED light-mortar: indexed under siegeWeapons, pinned to innovation (siegeWeapons is the bucket the derivation picks; the chain writes innovation)');
    expect(r.out.match(/PINNED /g)?.length, `the guard named more than light-mortar:\n${r.out}`).toBe(1);
    expect(r.out, 'light-mortar under siegeWeapons is neither missing nor dangling — only the pin catches it').not.toMatch(/MISSING |DANGLING /);
  });

  it('mutation: runes deleted from the index fails as missing AND off its pin', () => {
    const { runes: _gone, ...short } = pinIndex;
    const r = run(fixture(pinTrees, short));
    expect(r.code, `the guard passed an index without runes:\n${r.out}`).toBe(1);
    expect(r.out, `the guard did not name runes as off its pin:\n${r.out}`)
      .toContain('PINNED runes: missing from the index, pinned to categoryPage (trees in categoryPage, classFeatures)');
    expect(r.out, `the guard did not name runes as missing:\n${r.out}`).toContain('MISSING categoryPage/runes');
  });

  /* regen lane 2026-09-30: the "a different page for N of the 8" count was half typed (a hard-coded same-page
   * list). It is read from the trees' Archives page ids now; these fixtures make TWO pins same-page, which a
   * typed list naming only dream-hunters-lodge could not print. */
  it('the different-page count is read from the trees\' page ids, never typed: two same-page pins print 6 of the 8', () => {
    const same = new Set(['dream-hunters-lodge', 'runes']);
    const pages: Record<string, Record<string, string>> = {};
    for (const [slug, { pinned, derived }] of Object.entries(REGEN_DIFFERS)) {
      (pages[pinned] ??= {})[slug] = `page-${slug}`;
      (pages[derived] ??= {})[slug] = same.has(slug) ? `page-${slug}` : `other-page-${slug}`;
    }
    const r = run(fixture(pinTrees, { ...pinIndex, 'light-mortar': 'siegeWeapons' }, {}, pages));
    expect(r.code, `the guard passed light-mortar under siegeWeapons:\n${r.out}`).toBe(1);
    expect(r.out, `the different-page count is not the trees' (6: every pin but the two same-page ones):\n${r.out}`)
      .toContain('a different page for 6 of the 8. Repair:');
  });

  it('pins whose trees carry no page id are counted as not measurable, never as a different page', () => {
    const r = run(fixture(pinTrees, { ...pinIndex, 'light-mortar': 'siegeWeapons' }));
    expect(r.code, `the guard passed light-mortar under siegeWeapons:\n${r.out}`).toBe(1);
    expect(r.out, `a pin without page ids was counted as a different page:\n${r.out}`)
      .toContain('a different page for 0 of the 8 (8 not measurable in this copy: a tree or its page id is absent). Repair:');
  });
});

describe('the committed artefacts', () => {
  const trees = readAstSlugs(path.join(ROOT, 'public/ast'));
  const indexText = readFileSync(path.join(ROOT, 'public/ast-index.json'), 'utf8');
  const index = JSON.parse(indexText) as Record<string, string>;
  const created = createdRefs(ROOT);

  it('public/ast-index.json is missing no record that has an ast tree', () => {
    const missing = missingFromIndex(index, trees, created);
    expect(missing.length, `missing: ${missing.slice(0, 20).map((m) => `${m.bucket}/${m.slug}`).join(', ')}`).toBe(0);
  });

  it('no entry of public/ast-index.json names a bucket whose tree lacks the slug', () => {
    const dangling = danglingEntries(index, trees);
    expect(dangling.length, `dangling: ${dangling.slice(0, 20).map((d) => `${d.slug} -> ${d.bucket}`).join(', ')}`).toBe(0);
  });

  it('mutation: every 13th single-tree entry deleted is named, and the derivation restores the file byte for byte', () => {
    const owners = new Map<string, number>();
    for (const [b, slugs] of Object.entries(trees)) for (const s of slugs) if (!created.has(`${b}:${s}`)) owners.set(s, (owners.get(s) ?? 0) + 1);
    const single = Object.keys(index).filter((s) => owners.get(s) === 1);
    const gone = single.filter((_, i) => i % 13 === 0);
    const short = { ...index };
    for (const s of gone) delete short[s];
    const missing = missingFromIndex(short, trees, created).map((m) => m.slug).sort();
    expect(missing.length, 'the guard should name every deleted slug').toBe(gone.length);
    expect(missing, 'the guard named a different set').toEqual([...gone].sort());
    const { index: back, added } = deriveIndex(short, trees, created);
    const back1 = new Set(added.map((a) => a.slug));
    expect(gone.filter((s) => !back1.has(s)), 'deleted slugs the derivation did not add back').toEqual([]);
    expect(added.length, `the derivation added slugs that were never deleted: ${added.filter((a) => !gone.includes(a.slug)).map((a) => a.slug).slice(0, 20).join(', ')}`).toBe(gone.length);
    const wrong = added.filter((a) => index[a.slug] !== a.bucket).map((a) => `${a.slug}: ${a.bucket}, committed ${index[a.slug]}`);
    expect(wrong, 'a re-derived slug landed in another bucket').toEqual([]);
    expect(JSON.stringify(back) === indexText, 'the re-derived index is not byte-identical to public/ast-index.json').toBe(true);
  });

  /* REGEN_DIFFERS is the pin scripts/ast-index-check.mjs enforces (and backfill-ast-edition.mjs's output line
   * names). It is a measurement, so it is pinned here to what it measures: a regen that moves one of the 8,
   * or adds a 9th, fails the suite until the pin is updated with its reason — never silently. 2026-09-30: 9 -> 8,
   * strigoi left (the importer's index pass applies rule 4a, so the chain writes it under trait, as the rule does). */
  it('REGEN_DIFFERS pins each of its 8 slugs to the bucket public/ast-index.json gives it', () => {
    expect(Object.keys(REGEN_DIFFERS), 'REGEN_DIFFERS is no longer the 8 measured slugs').toHaveLength(8);
    expect(REGEN_DIFFERS, 'strigoi is written under trait by the chain since 2026-09-30, so it is no pin').not.toHaveProperty('strigoi');
    for (const [slug, { pinned, derived, why }] of Object.entries(REGEN_DIFFERS)) {
      expect(index[slug], `REGEN_DIFFERS pins ${slug} to ${pinned}; public/ast-index.json says ${index[slug] ?? '(absent)'}`).toBe(pinned);
      expect(derived, `${slug}: the derived bucket must differ from the pin, or it is not a pin`).not.toBe(pinned);
      expect(why.length, `${slug}: the pin states no reason`).toBeGreaterThan(40);
    }
  });

  it('scripts/ast-index-check.mjs on the shipped files passes and says all 8 pins are in place', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/ast-index-check.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, AST_INDEX: '', AST_DIR: '' } });
    expect(out, `the guard did not report the 8 pins in place:\n${out}`).toContain('8 multi-bucket slugs pinned, all in place');
    // a child process: no third argument, so it keeps this file's CHILD_TIMEOUT (90 s, vi.setConfig above)
  });

  /* regen lane 2026-09-30: pins the measured "7 of the 8" (dream-hunters-lodge's two shipped trees carry the
   * same page id, the other seven do not) by running the guard over the shipped trees with one pin moved. */
  it('scripts/ast-index-check.mjs over the shipped trees, runes moved off its pin, says a different page for 7 of the 8', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ast-index-shipped-'));
    roots.push(dir);
    const moved = path.join(dir, 'ast-index.json');
    writeFileSync(moved, JSON.stringify({ ...index, runes: REGEN_DIFFERS.runes.derived }));
    let code = 0, out = '';
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/ast-index-check.mjs')], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AST_INDEX: moved, AST_DIR: path.join(ROOT, 'public/ast') },
      });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      code = err.status; out = err.stdout + err.stderr;
    }
    expect(code, `the guard passed runes moved to ${REGEN_DIFFERS.runes.derived}:\n${out}`).toBe(1);
    expect(out, `the shipped trees no longer give 7 different-page pins of 8:\n${out}`).toContain('a different page for 7 of the 8. Repair:');
    // a child process: keeps this file's CHILD_TIMEOUT (90 s)
  });

  const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
  it.skipIf(!existsSync(EXPORT))('rule 4 over the shipped trees, from an empty index, differs from public/ast-index.json in exactly REGEN_DIFFERS\'s slugs, each to its `derived` bucket', () => {
    const { index: all } = deriveIndex({}, readAstTrees(path.join(ROOT, 'public/ast')), created, { docOf: exportDocOf(EXPORT) });
    const extra = Object.keys(all).filter((s) => !(s in index));
    expect(extra, 'slugs the rule indexes that public/ast-index.json lacks').toEqual([]);
    const differ = Object.keys(index).filter((s) => all[s] !== index[s]).sort();
    const say = (ss: string[]) => ss.map((s) => `${s}: committed ${index[s]}, rule ${all[s] ?? '(none)'}`);
    expect(say(differ), 'the rule\'s divergence from the committed index is no longer REGEN_DIFFERS — re-measure the lib header\'s table and the pins')
      .toEqual(Object.entries(REGEN_DIFFERS).sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, p]) => `${s}: committed ${p.pinned}, rule ${p.derived}`));
    // reads every public/ast tree and the whole AoN export (8.2 s alone, 2026-10-01): keeps this file's CHILD_TIMEOUT (90 s)
  });
});
