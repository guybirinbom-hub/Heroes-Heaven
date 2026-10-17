import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { formatBackfill } from '../scripts/lib/write-backfill.mjs';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { RIDER_KEYS, riderFaults } from '../scripts/lib/rider-shape.mjs';

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

/** A fixture repo root holding just the three files the guard reads (plus any `extra` data file, by repo-relative path). */
function fixture(rows: Row[], core: unknown = {}, descs: unknown = {}, extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'overlay-shape-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts/data'), { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/data/effect-backfill.json'), formatBackfill(rows));
  writeFileSync(path.join(root, 'public/core.json'), JSON.stringify(core));
  writeFileSync(path.join(root, 'public/core-descriptions.json'), JSON.stringify(descs));
  for (const [rel, body] of Object.entries(extra)) writeFileSync(path.join(root, rel), JSON.stringify(body));
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

/*
 * RIDER SHAPE — package I item I11 (the acid flasks).
 *
 * Four overlay rows stored `StrikeDamageRider.dice` as a bare number beside a stray top-level `die`, so
 * derive.ts printed "undefinedundefined" on the Strikes tab. The TS type could not see it (JSON is
 * untyped) and the test that pinned the flask pinned the same wrong shape. These cases are the
 * mutation-proof: each BAD rider below must make the guard exit 1 and name where it sits; each GOOD one
 * must pass. Put the bad shape back into scripts/data/effect-backfill.json and `npm run verify` stops.
 */
describe('overlay-shape-check — strikeDamage rider shape (I11)', () => {
  // The exact shape that shipped on items/acid-flask-{lesser..major}.
  const BAD_FLASK = [{ dice: 2, die: 'd6', type: 'acid', persistent: true, note: 'Acid flask' }];
  const GOOD_FLASK = [
    { type: 'acid', dice: { n: 2, die: 'd6' }, persistent: true, note: 'Acid flask' },
    { type: 'acid', dice: { n: 2, die: '' }, splash: true, note: 'Acid flask splash' },
  ];
  const flaskRow = (value: unknown): Row => ({ category: 'items', id: 'acid-flask-moderate', field: 'strikeDamage', value });
  const featWith = (strikeDamage: unknown) => ({
    feats: { 'potent-test': { effectChoices: [{ options: [{ grant: { strikeDamage } }] }] } },
  });

  it('fails an overlay row whose rider stores dice as a bare number (the acid flask shape), naming the row', () => {
    const r = run(fixture([flaskRow(BAD_FLASK)]));
    expect(r.code).toBe(1);
    expect(r.out).toContain('overlay row #0 items/acid-flask-moderate.strikeDamage[0]');
    expect(r.out).toContain('undefinedundefined');
    expect(r.out).toContain('stray top-level "die"');
  });

  it('fails a shipped record carrying the bad shape nested in effectChoices[].options[].grant', () => {
    const r = run(fixture([], featWith(BAD_FLASK)));
    expect(r.code).toBe(1);
    expect(r.out).toContain('core.json feats/potent-test.effectChoices[0].options[0].grant.strikeDamage[0]');
  });

  it('fails a bad rider nested inside an overlay row of ANOTHER field (not just field strikeDamage)', () => {
    const r = run(fixture([{ category: 'feats', id: 'potent-test', field: 'effectChoices', value: [{ options: [{ grant: { strikeDamage: BAD_FLASK } }] }] }]));
    expect(r.code).toBe(1);
    expect(r.out).toContain('overlay row #0 feats/potent-test.effectChoices[0].options[0].grant.strikeDamage[0]');
  });

  it('fails a bad rider in a mode data file', () => {
    const modes = { fire: { name: 'Fire', strikeDamage: BAD_FLASK } };
    const r = run(fixture([], {}, {}, { 'scripts/data/toggle-modes.json': modes }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('scripts/data/toggle-modes.json.fire.strikeDamage[0]');
  });

  it.each([
    ['dice that is not an object', [{ type: 'acid', dice: '2d6' }], 'dice is "2d6"'],
    ['dice.n that is a string', [{ type: 'acid', dice: { n: '2', die: 'd6' } }], 'dice.n is "2"'],
    ['dice.die that is missing', [{ type: 'acid', dice: { n: 2 } }], 'dice.die is undefined'],
    ['a stray top-level n', [{ type: 'acid', n: 2, flat: 1 }], 'stray top-level "n"'],
    ['no amount at all', [{ type: 'acid', persistent: true }], 'carries no amount'],
    ['no damage type', [{ flat: 2 }], 'type is undefined'],
    ['a key nothing reads', [{ type: 'fire', flat: 2, extraDice: 1 }], 'unknown key "extraDice"'],
    ['a flat that is a string', [{ type: 'fire', flat: '2' }], 'flat is "2"'],
    ['an appliesTo outside the four scopes', [{ type: 'fire', flat: 2, appliesTo: 'thrown' }], 'appliesTo is "thrown"'],
    ['a persistent that is the string "yes"', [{ type: 'fire', dice: { n: 1, die: 'd4' }, persistent: 'yes' }], 'persistent is "yes"'],
  ])('fails %s', (_label, value, fragment) => {
    const r = run(fixture([flaskRow(value)]));
    expect(r.code).toBe(1);
    expect(r.out).toContain(fragment);
  });

  it('fails a strikeDamage that is a single object instead of an array', () => {
    const r = run(fixture([flaskRow({ type: 'acid', flat: 1 })]));
    expect(r.code).toBe(1);
    expect(r.out).toContain('not an array of riders');
  });

  it('passes the re-shaped flask (a persistent rider and a splash rider with die "")', () => {
    const r = run(fixture([flaskRow(GOOD_FLASK)], featWith(GOOD_FLASK)));
    expect(r.code).toBe(0);
    expect(r.out).toContain('all 4 strikeDamage rider(s)');
  });

  it('passes every other legitimate rider kind: flat, per-proficiency, per-specialization, strikeName, choice flag', () => {
    const good = [
      { type: 'spirit', flat: 2, appliesTo: 'unarmed' },
      { type: 'spirit', byStrikeProficiency: { expert: 2, master: 3, legendary: 4 } },
      { type: 'force', byWeaponSpecialization: { spec: 2, greater: 3 }, appliesTo: 'melee' },
      { type: 'acid', dice: { n: 1, die: 'd4' }, persistent: true, strikeName: 'Caustic Nectar' },
      { type: 'spirit', dice: { n: 1, die: 'd6' }, fromChoiceFlag: 'favored-weapon', note: 'Gird Champion' },
    ];
    const r = run(fixture([flaskRow(good)]));
    expect(r.code).toBe(0);
  });

  it('ignores a value:null row (it removes the field, so there is no rider to hold to a shape)', () => {
    expect(run(fixture([flaskRow(null)])).code).toBe(0);
  });

  it('finds the same faults through the lib the guard shares with the test', () => {
    expect(riderFaults(BAD_FLASK[0]).join(' ')).toContain('undefinedundefined');
    expect(riderFaults(GOOD_FLASK[0])).toEqual([]);
    expect(riderFaults(GOOD_FLASK[1])).toEqual([]);
  });

  it('keeps the guard in step with StrikeDamageRider in src/rules/types.ts (a new field must be taught to the guard)', () => {
    const src = readFileSync(path.join(ROOT, 'src/rules/types.ts'), 'utf8');
    const start = src.indexOf('export interface StrikeDamageRider {');
    expect(start, 'the interface moved or was renamed').toBeGreaterThan(-1);
    const end = src.slice(start).search(/\r?\n\}/);
    const body = src.slice(start, start + end);
    const declared = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
    expect([...RIDER_KEYS].sort()).toEqual(declared);
  });
});
