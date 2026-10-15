import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveFirst, readAstTrees } from '../scripts/lib/ast-index.mjs';
import { supersededOverLive } from '../scripts/ast-index-live-first-check.mjs';

/**
 * 2026-09-30, the strigoi fix (desk: Guy's "yes"; gold-set R12, "the newest printing wins, whole" — the join
 * follows the Archives' own links). scripts/import-core-v2.mjs's INDEX_ORDER pass wrote "strigoi" -> sidebar,
 * the Advanced Player's Guide sidebar-1126, which the Archives mark superseded_by ancestry-85, although the
 * live trait page trait-854 holds a tree for the same slug: a title-only "Strigoi" opened replaced text.
 *
 * The rule is scripts/lib/ast-index.mjs `liveFirst` (rule 4a), ONE definition: backfill-ast-edition.mjs's
 * derivation (deriveIndex) and the importer's pass both call it. These pin the rule, that the importer calls it
 * rather than a copy, and the shipped result.
 */
const ROOT = path.join(__dirname, '..');

const DOCS: Record<string, { supersededBy: string | null }> = {
  'sidebar-1126': { supersededBy: 'ancestry-85' }, // Strigoi, APG sidebar; ancestry-85 is Dhampir (Player Core 2)
  'trait-854': { supersededBy: null },
  'action-3681': { supersededBy: 'action-912' }, // "Pistolero's Retort", Guns & Gears 2021
  'action-912': { supersededBy: null },
  'rules-1': { supersededBy: null },
  'rules-2': { supersededBy: 'rules-3' },
  'rules-3': { supersededBy: 'rules-4' },
};
const docOf = (id: string) => DOCS[id] ?? null;
const buckets = (cs: { bucket: string }[]) => cs.map((c) => c.bucket);

describe('liveFirst — rule 4a', () => {
  it('strigoi: the superseded sidebar never wins while the live trait page is a candidate', () => {
    // INDEX_ORDER reaches sidebar (sidebar.json) before trait (trait.json)
    const cs = [{ bucket: 'sidebar', aon: 'sidebar-1126' }, { bucket: 'trait', aon: 'trait-854' }];
    expect(buckets(liveFirst(cs, docOf))).toEqual(['trait', 'sidebar']);
    // mutation: without the Archives' facts the caller's order stands (the tier is what moves it)
    expect(buckets(liveFirst(cs, null))).toEqual(['sidebar', 'trait']);
  });

  it('the slug follows the page `superseded_by` names when a live candidate IS that page, before another live one', () => {
    const cs = [
      { bucket: 'actions', aon: 'action-3681' },
      { bucket: 'rules', aon: 'rules-1' },
      { bucket: 'classFeatures', aon: 'action-912' },
    ];
    expect(buckets(liveFirst(cs, docOf))).toEqual(['classFeatures', 'rules', 'actions']);
  });

  it('a live first candidate is never moved, and with no live candidate the order is unchanged', () => {
    const live = [{ bucket: 'rules', aon: 'rules-1' }, { bucket: 'classFeatures', aon: 'action-912' }, { bucket: 'actions', aon: 'action-3681' }];
    expect(buckets(liveFirst(live, docOf))).toEqual(['rules', 'classFeatures', 'actions']);
    const dead = [{ bucket: 'a', aon: 'rules-2' }, { bucket: 'b', aon: 'rules-3' }];
    expect(buckets(liveFirst(dead, docOf))).toEqual(['a', 'b']);
  });
});

describe('scripts/import-core-v2.mjs indexes through liveFirst, never a copy of the rule', () => {
  const src = readFileSync(path.join(ROOT, 'scripts/import-core-v2.mjs'), 'utf8');
  it('imports liveFirst from scripts/lib/ast-index.mjs and picks every index entry with it', () => {
    expect(src).toMatch(/import \{ liveFirst \} from '\.\/lib\/ast-index\.mjs';/);
    expect(src).toContain('for (const [s, cs] of indexCands) astIndex[s] = liveFirst(cs, docOfTree)[0].bucket;');
    // the pass that walks INDEX_ORDER collects candidates only; it no longer assigns first-come
    expect(src).not.toContain("if (!(s in astIndex) && newMap[s].rec.ast && (s in (db[bucket] || {}))) astIndex[s] = bucket;");
  });
});

/*
 * 2026-09-30, the lane's refuter: taking strigoi out of REGEN_DIFFERS took it out of scripts/ast-index-check.mjs,
 * so the pre-lane index (strigoi -> sidebar-1126) passed `npm run verify`. scripts/ast-index-live-first-check.mjs
 * guards the RULE for every slug; measured: it fails the pre-lane index on strigoi alone and passes the shipped one.
 */
describe('scripts/ast-index-live-first-check.mjs — the rule, for every slug, in npm run verify', () => {
  const trees = { sidebar: { strigoi: 'sidebar-1126' }, trait: { strigoi: 'trait-854' } };
  it('fails an entry on a superseded page while a live page holds the slug (the pre-lane strigoi)', () => {
    const hits = supersededOverLive({ strigoi: 'sidebar' }, trees, docOf);
    expect(hits).toEqual([{ slug: 'strigoi', bucket: 'sidebar', aon: 'sidebar-1126', supersededBy: 'ancestry-85', live: [{ bucket: 'trait', aon: 'trait-854' }] }]);
  });
  it('passes the live entry, a superseded page with no live alternative, and a single-bucket slug', () => {
    expect(supersededOverLive({ strigoi: 'trait' }, trees, docOf)).toEqual([]);
    expect(supersededOverLive({ x: 'a' }, { a: { x: 'rules-2' }, b: { x: 'rules-3' } }, docOf)).toEqual([]);
    expect(supersededOverLive({ y: 'a' }, { a: { y: 'rules-2' } }, docOf)).toEqual([]);
  });
  it('runs in npm run verify, right after ast-index-check', () => {
    const verify = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.verify as string;
    expect(verify).toContain('node scripts/ast-index-check.mjs && node scripts/ast-index-live-first-check.mjs &&');
  });
});

describe('the committed artefacts', () => {
  it('strigoi opens the live trait page (trait-854), not the superseded sidebar-1126', () => {
    const index = JSON.parse(readFileSync(path.join(ROOT, 'public/ast-index.json'), 'utf8')) as Record<string, string>;
    const trees = readAstTrees(path.join(ROOT, 'public/ast'));
    expect(index.strigoi, 'public/ast-index.json').toBe('trait');
    expect(trees.trait?.strigoi, 'the trait tree for strigoi').toBe('trait-854');
    expect(trees.sidebar?.strigoi, 'the sidebar tree stays (the tier orders; it removes nothing)').toBe('sidebar-1126');
    // gunzips and parses every public/ast tree (76 buckets, ~26k slugs): over vitest's 5 s default under load (timed out 2026-09-30)
  }, 60_000);
});
