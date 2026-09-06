import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { formatBackfill } from '../scripts/lib/write-backfill.mjs';

/**
 * scripts/overlay-shape-check.mjs — the guard from docs/wg-batch-pipeline.md section B: "no whole-field
 * assignment row may sit at a later index than a `path:[…,'id=…']` row into the same category/id/field."
 *
 * Every case runs against a THROWAWAY overlay in the temp dir (PARITY_ROOT). The real overlay is never
 * read here: it holds a live shadowed pair (classes/gunslinger.subclass) whose shape would make the
 * "clean" cases untestable, and a guard proved only against today's data proves nothing about tomorrow's.
 */

const ROOT = path.join(__dirname, '..');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

type Row = Record<string, unknown>;

/** A fixture repo root holding just the three files the guard reads. */
function fixture(rows: Row[], core: unknown = {}, descs: unknown = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'overlay-shape-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts/data'), { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/data/effect-backfill.json'), formatBackfill(rows));
  writeFileSync(path.join(root, 'public/core.json'), JSON.stringify(core));
  writeFileSync(path.join(root, 'public/core-descriptions.json'), JSON.stringify(descs));
  return root;
}

function run(root: string) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/overlay-shape-check.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PARITY_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

/** The magus/gunslinger shape: a path row amending one option, then a whole-field row over the lot. */
const pathRow = (value: unknown) => ({
  category: 'classes',
  id: 'magus',
  path: ['subclass', 'options', 'id=sparkling-targe'],
  field: 'spellSlotBonus',
  value,
});
const wholeRow = (bonus: unknown) => ({
  category: 'classes',
  id: 'magus',
  field: 'subclass',
  value: { name: 'Hybrid Study', options: [{ id: 'sparkling-targe', ...(bonus === undefined ? {} : { spellSlotBonus: bonus }) }] },
});
const CORE = { classes: { magus: { subclass: { name: 'Hybrid Study', options: [{ id: 'sparkling-targe' }] } } } };

describe('overlay-shape-check', () => {
  it('fails when a later whole-field row drops the path row it sits behind', () => {
    const r = run(fixture([pathRow(2), wholeRow(undefined)], CORE));
    expect(r.code).toBe(1);
    expect(r.out).toContain('classes/magus.subclass');
    expect(r.out).toContain('does NOT carry its value');
  });

  it('fails when the later whole-field row carries a DIFFERENT value at that path', () => {
    const r = run(fixture([pathRow(2), wholeRow(1)], CORE));
    expect(r.code).toBe(1);
    expect(r.out).toContain('the amendment is dead');
  });

  it('passes, reporting the pair as shadowed, when the whole-field row already carries the value', () => {
    const r = run(fixture([pathRow(2), wholeRow(2)], CORE));
    expect(r.code).toBe(0);
    expect(r.out).toContain('shadowed');
    expect(r.out).toContain('must be edited together');
  });

  it('passes when the whole-field row sits FIRST — the path row then amends it', () => {
    const r = run(fixture([wholeRow(undefined), pathRow(2)], CORE));
    expect(r.code).toBe(0);
    expect(r.out).toContain('(0 shadowed');
  });

  it('ignores a whole-field row on a DIFFERENT field of the same record', () => {
    const r = run(fixture([pathRow(2), { category: 'classes', id: 'magus', field: 'keyAbility', value: 'int' }], CORE));
    expect(r.code).toBe(0);
  });

  it('reports a prose row whose record is in neither shipped artefact', () => {
    const r = run(fixture([{ category: 'items', id: 'ghost-item', field: 'description', value: 'x' }]));
    expect(r.code).toBe(0);
    expect(r.out).toContain('nowhere');
    expect(r.out).toContain('items/ghost-item.description');
  });

  it('reports a nested prose row — prose is never nested, so the walk reaches nothing', () => {
    const rows = [{ category: 'classes', id: 'magus', path: ['subclass', 'options', 'id=sparkling-targe'], field: 'descRefs', value: [] }];
    const r = run(fixture(rows, CORE));
    expect(r.code).toBe(0);
    expect(r.out).toContain('prose is never nested');
  });

  it('accepts a prose row that reaches core-descriptions.json only (the post-split home)', () => {
    const r = run(fixture([{ category: 'items', id: 'phoenix-flask', field: 'description', value: 'x' }], {}, { items: { 'phoenix-flask': { d: 'x' } } }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 prose row(s) routing nowhere');
  });
});
