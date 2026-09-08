import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs the applier as a real node child, which boots a runtime and reads the shipped data
 * from cold — fine alone, several times slower under the full suite. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { formatBackfill, writeBackfill } from '../scripts/lib/write-backfill.mjs';

/**
 * scripts/apply-parity-fixes.mjs — the six refusals of docs/wg-batch-pipeline.md section A `apply`,
 * proved to hold on a HAND run (`node scripts/apply-parity-fixes.mjs <spec> --write`), not only when
 * the driver pre-checks a manifest. Batch 29 was applied by hand and every mistake came from a hand step.
 *
 * Every case runs against a THROWAWAY repo root (PARITY_ROOT) and a THROWAWAY three-document mirror
 * (AON_MIRROR). Nothing here reads or writes scripts/data/effect-backfill.json, public/core.json or
 * public/core-descriptions.json — the --write cases would otherwise mutate the real overlay.
 */

const ROOT = path.join(__dirname, '..');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

type Row = Record<string, unknown>;
type Finding = { id: string; backfillRows?: Row[]; codeEdits?: { file: string; find: string; replace: string }[] };

const MIRROR_DOCS: Record<string, Record<string, string>> = {
  equipment: {
    'equipment-1026': 'The flask erupts, dealing 8d6 fire damage to every creature in a 20-foot burst.',
    'equipment-2827': 'The bearer gains a +2 item bonus to Stealth checks.',
  },
  'class-feature': {
    'class-feature-431': 'Your spellstriking blade holds one extra spell slot of your highest rank.',
  },
};

const CORE = {
  items: {
    'phoenix-flask': { name: 'Phoenix Flask', aonId: 'equipment-1026' },
    'spined-shield': { name: 'Spined Shield', aonId: 'equipment-2827' },
  },
  classes: {
    magus: { name: 'Magus', subclass: { name: 'Hybrid Study', options: [{ id: 'sparkling-targe' }] } },
  },
};
const DESCS = {
  items: {
    'phoenix-flask': { d: 'The flask erupts, dealing to every creature in a .' },
    'spined-shield': { d: 'The bearer gains a bonus to Stealth checks.' },
  },
};

/** A fixture repo + mirror. Returns the root; `files` adds extra source files for code-edit cases. */
function fixture(overlay: Row[], files: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'parity-fix-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts/data'), { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/data/effect-backfill.json'), formatBackfill(overlay));
  writeFileSync(path.join(root, 'public/core.json'), JSON.stringify(CORE));
  writeFileSync(path.join(root, 'public/core-descriptions.json'), JSON.stringify(DESCS));
  for (const [cat, docs] of Object.entries(MIRROR_DOCS)) {
    mkdirSync(path.join(root, 'mirror', cat), { recursive: true });
    for (const [id, text] of Object.entries(docs)) writeFileSync(path.join(root, 'mirror', cat, `${id}.json`), JSON.stringify({ id, text, markdown: '' }));
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function run(root: string, findings: Finding[], args: string[] = []) {
  const spec = path.join(root, 'spec.json');
  writeFileSync(spec, JSON.stringify({ findings }));
  const argv = [path.join(ROOT, 'scripts/apply-parity-fixes.mjs'), spec, ...args];
  try {
    const out = execFileSync(process.execPath, argv, {
      cwd: ROOT,
      env: { ...process.env, PARITY_ROOT: root, AON_MIRROR: path.join(root, 'mirror') },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

const overlayRows = (root: string) => JSON.parse(readFileSync(path.join(root, 'scripts/data/effect-backfill.json'), 'utf8')) as Row[];

/** A row that satisfies every OTHER refusal, so each case tests exactly one thing. */
const clean = (over: Row = {}): Row => ({
  category: 'items',
  id: 'spined-shield',
  field: 'bulk',
  value: 1,
  why: 'AoN equipment-2827 prints Bulk 1 and we shipped nothing.',
  ...over,
});

/* Enough filler rows that write-backfill's 10% shrink guard has something to measure. */
const FILLER: Row[] = Array.from({ length: 20 }, (_, i) => ({ category: 'items', id: 'spined-shield', field: `filler${i}`, value: i }));

describe('apply-parity-fixes refusals', () => {
  it('1 — refuses a row whose key is already in the overlay, printing old→new', () => {
    const root = fixture([{ category: 'items', id: 'spined-shield', field: 'bulk', value: 'L' }]);
    const r = run(root, [{ id: 'f1', backfillRows: [clean()] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('already sits in the overlay at row #0');
    expect(r.out).toContain('old: "L"');
    expect(r.out).toContain('new: 1');
  });

  it('1 — accepts the same row with supersedes:true, and replaces in place', () => {
    const root = fixture([{ category: 'items', id: 'spined-shield', field: 'bulk', value: 'L' }, ...FILLER]);
    const r = run(root, [{ id: 'f1', backfillRows: [clean({ supersedes: true })] }], ['--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('declared supersession');
    const rows = overlayRows(root);
    expect(rows).toHaveLength(21);
    expect(rows[0].value).toBe(1);
    expect(rows[0]).not.toHaveProperty('supersedes'); // spec metadata, never stored
  });

  /* Resume: batch 031's apply refused AFTER writing, so re-running found this spec's own rows on disk
   * and read all 22 of them as undeclared supersessions. A byte-identical row overwrites nothing. */
  // batch 031: wild-winds-initiate#stance
  it('1 — accepts a byte-identical row already on disk (resume after wild-winds-initiate#stance refused mid-write)', () => {
    const root = fixture([clean(), ...FILLER]);
    // batch 031: wild-winds-initiate#stance
    const r = run(root, [{ id: 'f1', backfillRows: [clean()] }], ['--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('already in the overlay byte-identical (resume)');
    expect(overlayRows(root)).toHaveLength(21);
  });

  it('1 — refuses supersedes:true on a key no overlay row holds', () => {
    const r = run(fixture([]), [{ id: 'f1', backfillRows: [clean({ supersedes: true })] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('declares supersedes:true but no overlay row holds that key');
  });

  it('2 — refuses a pathless whole-value row over a field that id= path rows amend', () => {
    const root = fixture([{ category: 'classes', id: 'magus', path: ['subclass', 'options', 'id=sparkling-targe'], field: 'spellSlotBonus', value: 1 }]);
    const row = clean({ category: 'classes', id: 'magus', field: 'subclass', value: { options: [] }, why: 'class-feature-431' });
    const r = run(root, [{ id: 'f2', backfillRows: [row] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('would swallow overlay row #0');
    expect(r.out).toContain('id=sparkling-targe');
  });

  it('2 — refuses a path row with no ancestor to amend, naming the failing step', () => {
    const row = clean({ category: 'classes', id: 'magus', path: ['subclass', 'options', 'id=starlit-span'], field: 'spellSlotBonus', value: 1, why: 'class-feature-431' });
    const r = run(fixture([]), [{ id: 'f2b', backfillRows: [row] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('step "id=starlit-span"');
    expect(r.out).toContain('no whole-value row for "subclass"');
  });

  it('2 — accepts a path row whose ancestor the same spec builds', () => {
    const rows = [
      clean({ category: 'classes', id: 'magus', field: 'subclass', value: { options: [{ id: 'starlit-span' }] }, why: 'class-feature-431' }),
      clean({ category: 'classes', id: 'magus', path: ['subclass', 'options', 'id=starlit-span'], field: 'spellSlotBonus', value: 1, why: 'class-feature-431' }),
    ];
    const r = run(fixture([]), [{ id: 'f2c', backfillRows: rows }]);
    expect(r.code).toBe(0);
  });

  it('3 — refuses a description or descRefs row carrying a path', () => {
    for (const field of ['description', 'descRefs']) {
      const row = clean({ field, path: ['activate'], value: field === 'descRefs' ? [] : 'x' });
      const r = run(fixture([]), [{ id: `f3-${field}`, backfillRows: [row] }]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('prose rows must be pathless');
    }
  });

  it('4 — refuses a `why` that names no AoN doc id', () => {
    const r = run(fixture([]), [{ id: 'f4', backfillRows: [clean({ why: 'restored by scripts/repair-stripped-save-dc.mjs, insertions only' })] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('naming no AoN doc id');
  });

  it('4 — does not accept a hyphen-number that is not a mirror category', () => {
    const r = run(fixture([]), [{ id: 'f4b', backfillRows: [clean({ why: 'see batch-29 and finding spined-shield-2' })] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('naming no AoN doc id');
  });

  it('4 — excuses a record with genuinely no Archives page', () => {
    const r = run(fixture([]), [{ id: 'f4c', backfillRows: [clean({ why: 'hand-authored bridge record, no AoN document exists' })] }]);
    expect(r.code).toBe(0);
  });

  it('4 — accepts a description row whose added words are all in the named doc', () => {
    const row = clean({
      id: 'phoenix-flask',
      field: 'description',
      value: 'The flask erupts, dealing 8d6 fire damage to every creature in a 20-foot burst.',
      why: 'The @Damage cleaner dropped the dice and the area; AoN equipment-1026 prints both.',
    });
    const r = run(fixture([]), [{ id: 'f4d', backfillRows: [row] }]);
    expect(r.code).toBe(0);
  });

  it('4 — refuses a description row that adds a clause the named doc does not print', () => {
    const row = clean({
      id: 'phoenix-flask',
      field: 'description',
      value: 'The flask erupts, dealing 8d6 fire damage and the target is permanently blinded to every creature in a 20-foot burst.',
      why: 'AoN equipment-1026.',
    });
    const r = run(fixture([]), [{ id: 'f4e', backfillRows: [row] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('words no named doc');
    expect(r.out).toContain('permanently blinded');
  });

  it('4 — refuses when the named doc is not in the mirror at all', () => {
    const row = clean({ id: 'phoenix-flask', field: 'description', value: 'The flask erupts, dealing 8d6 fire damage to every creature in a 20-foot burst.', why: 'AoN equipment-9999.' });
    const r = run(fixture([]), [{ id: 'f4f', backfillRows: [row] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not in the mirror');
  });

  it('5 — reports an edit already applied instead of failing preconditions', () => {
    const root = fixture([], { 'src/a.ts': 'const n = 2;\n' });
    const r = run(root, [{ id: 'f5', codeEdits: [{ file: 'src/a.ts', find: 'const n = 1;', replace: 'const n = 2;' }] }], ['--write']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('already applied, skipping');
    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('const n = 2;\n');
  });

  it('5 — still refuses when `find` is gone and `replace` is not there either', () => {
    const root = fixture([], { 'src/a.ts': 'const n = 3;\n' });
    const r = run(root, [{ id: 'f5b', codeEdits: [{ file: 'src/a.ts', find: 'const n = 1;', replace: 'const n = 2;' }] }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('occurs 0x');
  });

  it('6 — --expect-rows rolls the overlay back byte-for-byte on a miscount', () => {
    const root = fixture(FILLER);
    const before = readFileSync(path.join(root, 'scripts/data/effect-backfill.json'));
    const r = run(root, [{ id: 'f6', backfillRows: [clean()] }], ['--write', '--expect-rows', '99']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ROLLED BACK');
    expect(readFileSync(path.join(root, 'scripts/data/effect-backfill.json')).equals(before)).toBe(true);
  });

  it('6 — --expect-rows lets the right count through', () => {
    const root = fixture(FILLER);
    const r = run(root, [{ id: 'f6b', backfillRows: [clean()] }], ['--write', '--expect-rows', '21']);
    expect(r.code).toBe(0);
    expect(overlayRows(root)).toHaveLength(21);
  });

  it('6 — a failed --expect-rows runs no code edit', () => {
    const root = fixture(FILLER, { 'src/a.ts': 'const n = 1;\n' });
    const r = run(root, [{ id: 'f6c', backfillRows: [clean()], codeEdits: [{ file: 'src/a.ts', find: 'const n = 1;', replace: 'const n = 2;' }] }], ['--write', '--expect-rows', '99']);
    expect(r.code).toBe(1);
    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('const n = 1;\n');
  });

  it('keeps the 10% shrink guard on the path a hand run writes through', () => {
    // The applier only appends and replaces, so it cannot shrink the file itself — the guard exists for
    // the caller that builds its array from a PARTIAL read. Proved on the writer the applier calls, on a
    // fixture root, and by the applier never passing the { allowShrink } escape.
    const root = fixture(FILLER);
    expect(() => writeBackfill(root, FILLER.slice(0, 10))).toThrow(/refusing to drop/);
    expect(overlayRows(root)).toHaveLength(20);
    expect(readFileSync(path.join(ROOT, 'scripts/apply-parity-fixes.mjs'), 'utf8')).not.toMatch(/allowShrink\s*:/);
  });
});
