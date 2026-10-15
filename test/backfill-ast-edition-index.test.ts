import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { makeDocOf, nativeBucket, REGEN_DIFFERS, refreshIndexFile } from '../scripts/lib/ast-index.mjs';

/**
 * scripts/backfill-ast-edition.mjs's index step — a real fixed point.
 *
 * 2026-09-29: the step added to public/ast-index.json only the slugs of buckets whose trees it had added
 * IN THAT RUN, after writing the trees. A regen died at the index write; the trees were on disk, so the
 * re-run added +0 slugs and the index stayed 1,779 short. The step now calls refreshIndexFile
 * (scripts/lib/ast-index.mjs), which derives the index from every tree on disk.
 *
 * A slug with trees in several buckets takes the lib's rule 4: never a superseded printing (gold-set R12 —
 * the first cut of this rule sent the owner's lost `pistoleros-retort` to the 2021 "Pistolero's Retort",
 * action-3681, which action-912 supersedes), then the document's own bucket, then the importer's order.
 * `docOf` stands in for the export facts backfill-ast-edition.mjs reads; the ids and facts below are the
 * real export's.
 *
 * backfill-ast-edition.mjs runs at import (it reads the whole export and rewrites core.json), so it is
 * never imported here: its source is read to prove it calls the function these cases exercise.
 */
const ROOT = path.join(__dirname, '..');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

type Trees = Record<string, Record<string, string>>; // bucket -> slug -> the tree's `aon`

function disk(trees: Trees, index: Record<string, string> | null) {
  const root = mkdtempSync(path.join(tmpdir(), 'backfill-index-'));
  roots.push(root);
  const astDir = path.join(root, 'ast');
  mkdirSync(astDir);
  for (const [b, m] of Object.entries(trees)) {
    writeFileSync(path.join(astDir, `${b}.json.gz`), gzipSync(JSON.stringify(Object.fromEntries(Object.entries(m).map(([s, aon]) => [s, { t: 'root', aon }])))));
  }
  const indexPath = path.join(root, 'ast-index.json');
  if (index) writeFileSync(indexPath, JSON.stringify(index));
  return { astDir, indexPath };
}

/** The export facts rule 4 reads: category (-> the document's own bucket) and superseded_by. */
const DOCS: Record<string, { category: string; supersededBy: string | null }> = {
  'equipment-1': { category: 'equipment', supersededBy: null },
  'equipment-2': { category: 'equipment', supersededBy: null },
  'equipment-3': { category: 'equipment', supersededBy: null },
  'equipment-3-bonus-9': { category: 'item-bonus', supersededBy: null },
  'feat-1': { category: 'feat', supersededBy: null },
  'feat-2': { category: 'feat', supersededBy: null },
  'spell-2': { category: 'spell', supersededBy: null },
  'spell-3': { category: 'spell', supersededBy: null },
  'action-3681': { category: 'action', supersededBy: 'action-912' }, // "Pistolero's Retort", Guns & Gears (2021), legacy
  'action-912': { category: 'action', supersededBy: null }, // "Pistoler's Retort", Guns & Gears (Remastered)
  'action-1': { category: 'action', supersededBy: null },
  'class-feature-1': { category: 'class-feature', supersededBy: null },
  'tactic-15': { category: 'tactic', supersededBy: null }, // Alley-oop: its tree is also copied into actions
  'sidebar-1126': { category: 'sidebar', supersededBy: 'ancestry-85' }, // Strigoi, APG sidebar, legacy
  'trait-854': { category: 'trait', supersededBy: null }, // Strigoi trait
  'rules-1': { category: 'rules', supersededBy: null },
};
const docOf = (id: string) => DOCS[id] ?? null;

const TREES: Trees = {
  items: { 'aeon-stone': 'equipment-1', 'bag-of-holding': 'equipment-2', 'endless-grimoire-greater': 'equipment-3' },
  itemBonus: { 'endless-grimoire-greater': 'equipment-3-bonus-9' },
  feats: { 'power-attack': 'feat-1', 'litany-of-depravity': 'feat-2' },
  spells: { 'litany-of-depravity': 'spell-2', fireball: 'spell-3' },
  actions: { 'pistoleros-retort': 'action-3681', stride: 'action-1', 'alley-oop': 'tactic-15' },
  classFeatures: { 'pistoleros-retort': 'action-912', 'arcane-cascade': 'class-feature-1' },
  tactic: { 'alley-oop': 'tactic-15' },
  sidebar: { strigoi: 'sidebar-1126' },
  trait: { strigoi: 'trait-854' },
  reference: { hustle: 'rules-1' },
};
/** What a full chain gives (the committed index agrees on pistoleros-retort and alley-oop). */
const FULL = {
  'aeon-stone': 'items', 'alley-oop': 'tactic', 'arcane-cascade': 'classFeatures', 'bag-of-holding': 'items', 'endless-grimoire-greater': 'items',
  fireball: 'spells', 'litany-of-depravity': 'feats', 'pistoleros-retort': 'classFeatures', 'power-attack': 'feats', stride: 'actions', strigoi: 'trait',
};
const CREATED = new Set(['reference:hustle']);

describe('refreshIndexFile — the index step of backfill-ast-edition.mjs', () => {
  it('the owner\'s scenario: trees on disk, index short by whole buckets — one run adds exactly what is missing, a second adds nothing', () => {
    const short = Object.fromEntries(Object.entries(FULL).filter(([, b]) => !['items', 'feats', 'actions', 'classFeatures'].includes(b)));
    const { astDir, indexPath } = disk(TREES, short);
    const first = refreshIndexFile({ indexPath, astDir, exclude: CREATED, write: true, docOf });
    expect(first.added.map((a) => `${a.bucket}/${a.slug}`), 'the resumed tail should add every slug the index lacks')
      .toEqual(['items/aeon-stone', 'classFeatures/arcane-cascade', 'items/bag-of-holding', 'items/endless-grimoire-greater',
        'feats/litany-of-depravity', 'classFeatures/pistoleros-retort', 'feats/power-attack', 'actions/stride']);
    expect(first.wrote, 'the index lacking items/aeon-stone ... actions/stride was not rewritten').toBe(true);
    expect(first.ambiguous.map((a) => `${a.slug}: ${a.bucket} of ${a.candidates.join('|')}`),
      'only the added slugs with trees in several buckets are reported as chosen by rule 4, most-preferred bucket first').toEqual([
      'endless-grimoire-greater: items of items|itemBonus',
      'litany-of-depravity: feats of feats|spells',
      'pistoleros-retort: classFeatures of classFeatures|actions',
    ]);
    const bytes = readFileSync(indexPath, 'utf8');
    expect(bytes, 'the repaired index should be the complete one, keys sorted, minified').toBe(JSON.stringify(FULL));
    const second = refreshIndexFile({ indexPath, astDir, exclude: CREATED, write: true, docOf });
    expect(second.added.map((a) => a.slug), 'a second run must add nothing').toEqual([]);
    expect(second.wrote, `a second run rewrote the index though it added nothing (${second.added.map((a) => a.slug).join(', ')})`).toBe(false);
    expect(second.ambiguous.map((a) => a.slug), 'a second run reports a rule-4 choice for a slug it did not add').toEqual([]);
    expect(readFileSync(indexPath, 'utf8'), 'a second run changed a byte of the repaired index (pistoleros-retort, endless-grimoire-greater, litany-of-depravity ...)').toBe(bytes);
  });

  it('the created reference/hustle is never indexed', () => {
    const { astDir, indexPath } = disk(TREES, {});
    const { added } = refreshIndexFile({ indexPath, astDir, exclude: CREATED, write: true, docOf });
    expect(added.map((a) => a.slug), 'hustle is a created record and opens by key only').not.toContain('hustle');
    expect(JSON.parse(readFileSync(indexPath, 'utf8')), 'the index derived from nothing is not the full one (is reference/hustle in it?)').toEqual(FULL);
  });

  it('additive only: an entry that names another bucket (or no tree at all) is never re-pointed', () => {
    const odd = { ...FULL, 'power-attack': 'spells', 'pistoleros-retort': 'actions', ghost: 'nowhere' };
    const { astDir, indexPath } = disk(TREES, odd);
    const r = refreshIndexFile({ indexPath, astDir, exclude: CREATED, write: true, docOf });
    expect(r.added, `re-pointed or added ${r.added.map((a) => a.slug).join(', ')}`).toEqual([]);
    const after = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(after['power-attack'], 'power-attack was re-pointed').toBe('spells');
    expect(after['pistoleros-retort'], 'an existing pistoleros-retort entry was re-pointed').toBe('actions');
    expect(after.ghost, 'ghost was dropped').toBe('nowhere');
  });
});

describe('rule 4 — which bucket a slug in several trees comes back under', () => {
  const derive = (withDocs: boolean) => {
    const { astDir, indexPath } = disk(TREES, null);
    const { added } = refreshIndexFile({ indexPath, astDir, exclude: CREATED, write: false, docOf: withDocs ? docOf : null });
    expect(existsSync(indexPath), 'write:false wrote the index').toBe(false);
    return Object.fromEntries(added.map((a) => [a.slug, a.bucket])) as Record<string, string>;
  };
  const at = derive(true);

  it('4a: pistoleros-retort goes to classFeatures (action-912, the remaster), never to actions (action-3681, which action-912 supersedes)', () => {
    expect(at['pistoleros-retort'], 'pistoleros-retort landed on the superseded 2021 printing').toBe('classFeatures');
  });

  it('4a before 4b: strigoi goes to the live trait page, not the superseded APG sidebar — though each is in its own bucket', () => {
    expect(nativeBucket('sidebar'), 'strigoi\'s sidebar-1126 is not native to sidebar').toBe('sidebar');
    expect(nativeBucket('trait'), 'strigoi\'s trait-854 is not native to trait').toBe('trait');
    expect(at.strigoi, 'strigoi landed on the superseded sidebar-1126').toBe('trait');
  });

  it('4b: alley-oop goes to tactic, its document\'s own bucket, not the copy backfill put in actions', () => {
    expect(nativeBucket('tactic'), 'a reference category is camel-cased, as import-core-v2 does').toBe('tactic');
    expect(at['alley-oop'], 'alley-oop landed on the actions copy').toBe('tactic');
  });

  it('4c: between two live pages in their own buckets, the importer\'s order — items over itemBonus, feats over spells', () => {
    expect(nativeBucket('item-bonus'), 'endless-grimoire-greater\'s item-bonus page is not native to itemBonus').toBe('itemBonus');
    expect(at['endless-grimoire-greater'], 'endless-grimoire-greater').toBe('items');
    expect(at['litany-of-depravity'], 'litany-of-depravity').toBe('feats');
  });

  it('without the export facts only 4c applies (what the rule falls back to)', () => {
    const bare = derive(false);
    expect(bare['pistoleros-retort'], 'pistoleros-retort without docOf').toBe('actions');
    expect(bare['alley-oop'], 'alley-oop without docOf').toBe('actions');
  });

  it('no index file yet: it is created from the trees', () => {
    const { astDir, indexPath } = disk({ feats: { b: 'feat-1', a: 'feat-2' } }, null);
    const r = refreshIndexFile({ indexPath, astDir, write: true, docOf });
    expect(r.added.map((a) => a.slug), 'feats/a and feats/b should both be added to a new index').toEqual(['a', 'b']);
    expect(readFileSync(indexPath, 'utf8'), 'the new index should hold a and b under feats, keys sorted').toBe('{"a":"feats","b":"feats"}');
  });
});

describe('makeDocOf — rule 4\'s export facts, one definition for backfill-ast-edition.mjs and the pin below', () => {
  const docIndex = new Map([['action-3681', { cat: 'action', name: 'Pistolero\'s Retort' }], ['equipment-5205', { cat: 'equipment', name: 'Dream Hunter\'s Lodge' }]]);
  const fullDoc = (cat: string, id: string) => (cat === 'action' && id === 'action-3681' ? { superseded_by: 'action-912' } : cat === 'equipment' ? {} : undefined);
  const of = makeDocOf({ docIndex, fullDoc });

  it('pistoleros-retort\'s action-3681 is an action superseded by action-912; a bonus id resolves to its base page; an unknown id is null', () => {
    expect(of('action-3681'), 'pistoleros-retort action-3681').toEqual({ category: 'action', supersededBy: 'action-912' });
    expect(of('equipment-5205-bonus-1713'), 'dream-hunters-lodge equipment-5205-bonus-1713 -> equipment-5205').toEqual({ category: 'equipment', supersededBy: null });
    expect(of('feat-0'), 'an id the export lacks').toBeNull();
  });
});

describe('scripts/backfill-ast-edition.mjs derives its index from the trees on disk', () => {
  const src = readFileSync(path.join(ROOT, 'scripts/backfill-ast-edition.mjs'), 'utf8');

  it('imports refreshIndexFile from scripts/lib/ast-index.mjs and writes the index through it, over public/ast, with the export facts', () => {
    expect(src, 'backfill no longer imports the index step from the lib').toMatch(/import \{ REGEN_DIFFERS, makeDocOf, refreshIndexFile \} from '\.\/lib\/ast-index\.mjs';/);
    expect(src, 'the index step no longer reads public/ast with createdRefs and docOf').toMatch(/astDir: join\(ROOT, 'public\/ast'\), exclude: createdRefs\(ROOT\), docOf \}/);
    expect(src, 'the --write no longer writes the index through refreshIndexFile').toMatch(/refreshIndexFile\(\{ \.\.\.indexStep, write: true \}\)/);
    expect(src, 'backfill\'s docOf is no longer the lib\'s makeDocOf — a copy could drift from the pin test\'s').toMatch(/const docOf = makeDocOf\(\{ docIndex, fullDoc \}\);/);
    const lib = readFileSync(path.join(ROOT, 'scripts/lib/ast-index.mjs'), 'utf8');
    expect(lib, 'makeDocOf no longer reports superseded_by — rule 4a would be blind (pistoleros-retort)').toMatch(/supersededBy: fullDoc\(doc\.cat, via\)\?\.superseded_by/);
  });

  it('no longer builds the index from this run\'s perBucket additions, and writes ast-index.json nowhere else', () => {
    expect(src, 'the index loop over perBucket is back').not.toMatch(/for \(const \{ bucket \} of perBucket\)/);
    const writes = src.split('\n').filter((l) => /writeFileSync\(/.test(l) && !/^import /.test(l)).map((l) => l.trim());
    expect(writes, 'backfill-ast-edition.mjs writes a file other than the trees and core.json — the index again, beside refreshIndexFile?').toEqual([
      'writeFileSync(join(ROOT, `public/ast/${bucket}.json`), json);',
      'writeFileSync(join(ROOT, `public/ast/${bucket}.json.gz`), gzipSync(json, { level: 9 }));',
      'writeFileSync(CORE, JSON.stringify(core));',
    ]);
    expect(src, 'the --write output no longer says "+N slugs"').toMatch(/\+\$\{idx\.added\.length\} slugs/);
    expect(src, 'the --write output no longer counts the slugs rule 4 chose among several buckets').toMatch(/\nsayAmbiguous\(idx\);/);
    expect(src, 'the output no longer names a repaired slug that a full npm run data places elsewhere')
      .toMatch(/REGEN_DIFFERS\[a\.slug\] && REGEN_DIFFERS\[a\.slug\]\.pinned !== a\.bucket/);
  });

  it('REGEN_DIFFERS is the header\'s measured table, and is never read to choose a bucket', () => {
    const lib = readFileSync(path.join(ROOT, 'scripts/lib/ast-index.mjs'), 'utf8');
    for (const [slug, { pinned, derived }] of Object.entries(REGEN_DIFFERS)) {
      expect(lib, `${slug} is in REGEN_DIFFERS but not in the header's table as "${slug}  ${pinned} (...) -> ${derived} ("`)
        .toMatch(new RegExp(`\\*\\s+${slug}\\s+${pinned} \\([^)]*\\)\\s+->\\s+${derived} \\(`));
    }
    // 2026-09-30: 9 -> 8, strigoi left the pins (import-core-v2's index pass applies rule 4a, scripts/lib/ast-index.mjs liveFirst)
    expect(Object.keys(REGEN_DIFFERS), 'REGEN_DIFFERS is no longer the 8 measured slugs (anchored-incorporeality ... wrecker)').toHaveLength(8);
    const code = lib.slice(lib.indexOf('export function '));
    expect(code.length, 'the lib has no exported function to scan').toBeGreaterThan(1000);
    expect(code, 'REGEN_DIFFERS is read by the lib\'s functions — is it deciding picks? (a design change: ask the orchestrator)').not.toMatch(/REGEN_DIFFERS/);
  });

  it('reads each tree from the shipped .json.gz before the plain .json, so a .gz write that died is redone on the next run', () => {
    const body = /const readAst = \(bucket\) => \{([\s\S]*?)\n\};/.exec(src);
    expect(body, 'readAst is gone').not.toBeNull();
    const gz = body![1].indexOf('public/ast/${bucket}.json.gz');
    const plain = body![1].indexOf('public/ast/${bucket}.json`');
    expect(gz, 'readAst no longer reads the .gz').toBeGreaterThanOrEqual(0);
    expect(plain, 'readAst no longer falls back to the plain .json').toBeGreaterThanOrEqual(0);
    expect(gz < plain, 'readAst reads the plain .json first again: a plain file with the tree hides a .gz without it').toBe(true);
    expect(src, 'an unreadable .gz is no longer rewritten').toMatch(/if \(WRITE && \(bAst \|\| stale\)\)/);
  });
});
