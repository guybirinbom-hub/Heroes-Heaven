import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * PACKAGE M, ROUND 3 (a) — scripts/rebuild-ast-entries.mjs stamps the page's provenance the importer's way.
 *
 * Every writer of public/ast stamps the tree root with `aon`, the archive document it was copied from
 * (scripts/import-core-v2.mjs: `astOut[s] = resolveAst(rec.ast); astOut[s].aon = rec.id`), and
 * scripts/ast-provenance-check.mjs fails an unstamped page in a stamped bucket. The export's `doc.ast` carries
 * no `aon`, and this script wrote it as-is — so the round-2 lane could not move Perception Expertise onto
 * class-feature-1075 without failing `npm run verify`, and scripts/stamp-ast-urls.mjs (which only addresses
 * stamped trees) skipped the page. Second defect, same file: it read the gitignored raw <bucket>.json as the
 * base and wrote it over the tracked .gz, so a stale raw file would have replaced every OTHER page.
 *
 * Third, found by npm run verify on the rebuilt page (scripts/archive-coverage-check.mjs): it resolved links
 * by aonId alone, so the page's "Perception" (rules-2040) opened the importer-CREATED rules/perception-player-core
 * instead of rules/perception, the app's record of that name.
 *
 * Runs the real script against a scratch fixture (REBUILD_ROOT, AON_EXPORT); never the tree. Each defect is
 * planted back into a scratch COPY of the script, and the same assertions catch it.
 */
const SCRIPT = 'scripts/rebuild-ast-entries.mjs';
const STAMP_LINE = 'tree.aon = String(doc.id ?? rec.aonId);';
const GZ_BASE_LINE = "if (existsSync(gz)) return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));";
const HOLDER_LINE = "    if (!holderOf.has(nk) || slug === slugOf(r.name)) holderOf.set(nk, slug);\n";

let dir = '';
let exportDir = '';
type Tree = { t: string; c?: Tree[]; aon?: string; url?: string; ref?: string | null; to?: string; v?: string };
const OLD_A: Tree = { t: 'doc', c: [{ t: 'text', v: 'the old page' }], aon: 'class-feature-1', url: '/Classes.aspx?ID=1' };
const B: Tree = { t: 'doc', c: [{ t: 'text', v: 'B, as shipped' }], aon: 'class-feature-10', url: '/Classes.aspx?ID=5' };
const STALE_B: Tree = { t: 'doc', c: [{ t: 'text', v: 'B, a stale raw copy' }], aon: 'class-feature-10' };

function fixture(): string {
  const root = mkdtempSync(join(dir, 'root-'));
  mkdirSync(join(root, 'public/ast'), { recursive: true });
  writeFileSync(join(root, 'public/core.json'), JSON.stringify({
    classFeatures: { a: { id: 'a', aonId: 'class-feature-9' }, b: { id: 'b', aonId: 'class-feature-10' } },
    classes: { k: { id: 'k', aonId: 'class-5' } },
    // The live case: rules/perception is the app's record of "Perception" (rules-3303); the importer's step 5
    // created rules/perception-player-core for Player Core's Step 9 page (rules-2040), and rules/lone-page for a
    // page no other record names.
    rules: {
      perception: { id: 'perception', name: 'Perception', aonId: 'rules-3303' },
      'perception-player-core': { id: 'perception-player-core', name: 'Perception', aonId: 'rules-2040' },
      'lone-page': { id: 'lone-page', name: 'Lone Page', aonId: 'rules-77' },
    },
  }));
  mkdirSync(join(root, 'scripts/migration/out'), { recursive: true });
  writeFileSync(join(root, 'scripts/migration/out/archive-created.json'), JSON.stringify({
    rules: { 'perception-player-core': { doc: 'rules-2040' }, 'lone-page': { doc: 'rules-77' } },
  }));
  writeFileSync(join(root, 'public/ast/classFeatures.json.gz'), gzipSync(JSON.stringify({ a: OLD_A, b: B })));
  // The gitignored dev copy beside it, out of date.
  writeFileSync(join(root, 'public/ast/classFeatures.json'), JSON.stringify({ a: OLD_A, b: STALE_B }));
  return root;
}
const run = (script: string, root: string, target = 'classFeatures/a', exp = exportDir) =>
  execFileSync(process.execPath, [script, target], { env: { ...process.env, REBUILD_ROOT: root, AON_EXPORT: exp }, encoding: 'utf8' });
const shipped = (root: string) => JSON.parse(gunzipSync(readFileSync(join(root, 'public/ast/classFeatures.json.gz'))).toString('utf8')) as Record<string, Tree>;
/** A scratch copy of the script with one line taken out — the planted defect. */
function mutant(line: string): string {
  const src = readFileSync(SCRIPT, 'utf8');
  expect(src.split(line).length - 1, `the line the mutant removes occurs exactly once: ${line}`).toBe(1);
  const p = join(mkdtempSync(join(dir, 'mut-')), 'rebuild-ast-entries.mjs');
  writeFileSync(p, src.replace(line, ''));
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm3-rebuild-'));
  exportDir = join(dir, 'export');
  mkdirSync(exportDir);
  writeFileSync(join(exportDir, 'class-feature.json'), JSON.stringify({
    docs: {
      'class-feature-9': {
        id: 'class-feature-9',
        name: 'A',
        url: '/Classes.aspx?ID=5',
        ast: {
          t: 'doc',
          c: [
            { t: 'link', to: 'class-5', c: [{ t: 'text', v: 'A' }] },
            { t: 'link', to: 'class-feature-10', c: [] },
            { t: 'link', to: 'class-99', c: [] },
            { t: 'link', to: 'rules-2040', c: [{ t: 'text', v: 'Perception' }] },
            { t: 'link', to: 'rules-77', c: [{ t: 'text', v: 'Lone Page' }] },
          ],
        },
      },
    },
  }));
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('rebuild-ast-entries: the rebuilt page', () => {
  it('is the record\'s own export document, stamped with its id the importer\'s way (and no url until stamp-ast-urls)', () => {
    const root = fixture();
    expect(run(SCRIPT, root)).toMatch(/rebuilt from class-feature-9/);
    const a = shipped(root).a;
    expect(a.aon).toBe('class-feature-9');
    expect(a.url).toBeUndefined();
    // Links resolve against the shipped corpus; an unshipped target stays plain text (ref null); a link to a
    // CREATED record's page goes to the same-named record the importer did not create (scripts/import-core-v2.mjs:
    // "A same-named record keeps its links"), and to the created record only when no other record has its name.
    expect(a.c!.map((n) => n.ref)).toEqual(['classes:k', 'classFeatures:b', null, 'rules:perception', 'rules:lone-page']);
  });

  it('planted: resolving by aonId alone sends "Perception" to the created record (what archive-coverage-check fails)', () => {
    const root = fixture();
    run(mutant(HOLDER_LINE), root);
    expect(shipped(root).a.c!.map((n) => n.ref)).toEqual(['classes:k', 'classFeatures:b', null, 'rules:perception-player-core', 'rules:lone-page']);
  });

  it('leaves every other page of the bucket exactly as the tracked .gz had it, and the raw copy equals the .gz', () => {
    const root = fixture();
    run(SCRIPT, root);
    expect(shipped(root).b).toEqual(B);
    expect(readFileSync(join(root, 'public/ast/classFeatures.json'), 'utf8')).toBe(gunzipSync(readFileSync(join(root, 'public/ast/classFeatures.json.gz'))).toString('utf8'));
  });

  it('planted: without the stamp the rebuilt page carries no provenance (what ast-provenance-check fails)', () => {
    const root = fixture();
    run(mutant(STAMP_LINE), root);
    expect(shipped(root).a.aon).toBeUndefined();
  });

  it('planted: reading the raw dev copy as the base ships its stale pages into the .gz', () => {
    const root = fixture();
    run(mutant(GZ_BASE_LINE), root);
    expect(shipped(root).b).toEqual(STALE_B);
    expect(shipped(root).b).not.toEqual(B);
  });
});

/**
 * On the SHIPPED data: rebuilding the shipped Perception Expertise page from its record's own export document
 * gives back exactly the page the importer wrote (all but `url`, which scripts/stamp-ast-urls.mjs adds after).
 * Measured 2026-10-17 on the held round-3 tree: rebuild + stamp-ast-urls left public/ast/classFeatures.json.gz
 * byte-identical to 79d3d3e. The page links "Perception" (rules-2040), the created-record case, so the mutant
 * without the same-name rule is caught on real data too. Scratch copies of core.json, the bucket and
 * archive-created.json; an export holding the one document. Skipped where the export is not on disk.
 */
const REAL_EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
describe.skipIf(!existsSync(join(REAL_EXPORT, 'class-feature.json')))('rebuild-ast-entries on the shipped data', () => {
  const TARGET = 'classFeatures/perception-expertise';
  let realExport = '';
  const realRoot = () => {
    const root = mkdtempSync(join(dir, 'real-'));
    mkdirSync(join(root, 'public/ast'), { recursive: true });
    mkdirSync(join(root, 'scripts/migration/out'), { recursive: true });
    for (const f of ['public/core.json', 'public/ast/classFeatures.json.gz', 'scripts/migration/out/archive-created.json']) copyFileSync(f, join(root, f));
    return root;
  };
  const shippedPage = () => JSON.parse(gunzipSync(readFileSync('public/ast/classFeatures.json.gz')).toString('utf8'))['perception-expertise'] as Tree;

  beforeAll(() => {
    const aon = (JSON.parse(readFileSync('public/core.json', 'utf8')) as { classFeatures: Record<string, { aonId: string }> }).classFeatures['perception-expertise'].aonId;
    const docs = (JSON.parse(readFileSync(join(REAL_EXPORT, 'class-feature.json'), 'utf8')) as { docs: Record<string, unknown> }).docs;
    realExport = mkdtempSync(join(dir, 'real-export-'));
    writeFileSync(join(realExport, 'class-feature.json'), JSON.stringify({ docs: { [aon]: docs[aon] } }));
  });

  it('the rebuilt page is the shipped page, key for key (the shipped `url` aside)', () => {
    const root = realRoot();
    run(SCRIPT, root, TARGET, realExport);
    const { url, ...importer } = shippedPage();
    expect(url, 'the shipped page carries its Archives address').toBeTruthy();
    const rebuilt = shipped(root)['perception-expertise'];
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(importer));
  });

  it('planted: without the same-name rule the real page\'s "Perception" opens the created record', () => {
    const root = realRoot();
    run(mutant(HOLDER_LINE), root, TARGET, realExport);
    const refs: Record<string, string | null | undefined> = {};
    const walk = (n: Tree) => { if (n.to) refs[n.to] = n.ref; for (const k of n.c ?? []) walk(k); };
    walk(shipped(root)['perception-expertise']);
    expect(refs['rules-2040']).toBe('rules:perception-player-core');
    const { url: _url, ...importer } = shippedPage();
    expect(JSON.stringify(shipped(root)['perception-expertise'])).not.toBe(JSON.stringify(importer));
  });
});
