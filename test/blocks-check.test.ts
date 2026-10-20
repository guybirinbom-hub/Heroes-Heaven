import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOK_FIELD_ALLOW, CONTENT_PATH_HOME, checkBlocks, checkBookFieldReaders, checkContentPath, codeOnly, featureNumbers, laneKeys, type BlocksCheckInput, type BookReaderAllow } from '../src/rules/blocks/check';
import { BLOCK_KINDS, EDITOR_PARTS, SOURCE_KINDS, STILL_TO_ADD, blockKind } from '../src/rules/blocks/registry';
import { OWNERS, TARGETS } from '../src/rules/blocks/targets';

/**
 * The blocks guard (scripts/blocks-check.mjs, in `npm run verify`). docs/overrides-redesign.md, Building
 * blocks item 11: each guard is made to fail once on a planted bad case. The bad cases are planted HERE,
 * in memory, on a small valid input — never in the repo's files. The last test runs the guard on the
 * real files.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

const DESIGN =
  '# x\n\n## Feature list\n\n### A. Numbers\n\n1. **One**\n2. ⭐ **Two**\n   more text\n3. ~~Three~~: dropped (decision 3).\n\n## Dropped ideas\n\n4. **Not a feature**\n';
const LANES = [
  '## A. Proficiency',
  '',
  '| lane | the text says | satisfied by |',
  '|---|---|---|',
  '| `laneOne` | "x" | `fieldX` |',
  '| `laneTwo` / `laneThree` | "y" | `fieldY` |',
  '',
  '| `laneCont` | a row after a blank line still belongs to the table above | `fieldZ` |',
  '',
  '### `laneOne` — a sub-table that is not a lane table',
  '',
  '| shape | means |',
  '|---|---|',
  '| `notALane` | z |',
  '',
  '## ⚠ Lanes this app does NOT have',
  '',
  '| lane | the text says | status |',
  '|---|---|---|',
  '| `laneMissing` | "w" | no field |',
  '',
  '## ⚠⚠ DECIDED SCOPE — rulings',
  '',
  '| ruling | means |',
  '|---|---|',
  '| `scopeThing` | not a lane table |',
  '',
  '### `laneLate` — a later section adds a lane',
  '',
  '| lane | the text says | satisfied by |',
  '|---|---|---|',
  '| `laneLate` | "v" | `fieldV` |',
].join('\n');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'number.add',
  family: 'number',
  title: 'Bonus or penalty',
  phase: 1,
  place: 'main',
  status: 'built',
  registry: true,
  features: [1],
  lanes: ['laneOne'],
  bookFields: [...(blockKind('number.add')!.bookFields ?? [])],
  bookOnly: false,
  note: 'x',
  ...over,
});

function good(): BlocksCheckInput {
  return {
    registry: [{ ...blockKind('number.add')!, test: 'test/fake.test.ts' }],
    stillToAdd: [{ id: 'number.add', why: 'part B builds the screen' }],
    editorParts: EDITOR_PARTS,
    sourceKinds: SOURCE_KINDS,
    targets: TARGETS,
    owners: OWNERS,
    catalog: {
      families: ['number', 'grant'],
      rows: [
        row(),
        row({ id: 'grant.action', family: 'grant', title: 'Give an action', phase: 3, place: 'advanced', status: 'to-add', registry: undefined, features: [2], lanes: ['laneTwo', 'laneThree', 'laneCont', 'laneLate'] }),
      ],
      notBlocks: [
        { lanes: ['laneMissing'], why: 'no field exists' },
        { features: [3], why: 'dropped (decision 3)' },
      ],
    },
    designDoc: DESIGN,
    lanesDoc: LANES,
    blockFiles: [{ path: 'src/rules/blocks/a.ts', text: "import { x } from './targets';\nimport type { T } from '../types';" }],
    readFile: (p) => (p === 'test/fake.test.ts' ? "it('number.add', () => {})" : null),
  };
}

const errorsOf = (mutate: (i: BlocksCheckInput) => void) => {
  const input = good();
  mutate(input);
  return checkBlocks(input).errors.join('\n');
};
const cat = (i: BlocksCheckInput) => i.catalog as { rows: Record<string, unknown>[]; notBlocks: Record<string, unknown>[]; families: string[] };

describe('the doc readers', () => {
  it('reads the Feature list numbers, dropped ones included (not the Dropped ideas section)', () => {
    expect(featureNumbers(DESIGN)).toEqual([1, 2, 3]);
  });
  it('reads lane keys from "lane" tables only, rows after a blank line included', () => {
    expect(laneKeys(LANES).sort()).toEqual(['laneCont', 'laneLate', 'laneMissing', 'laneOne', 'laneThree', 'laneTwo']);
  });
});

describe('blocks guard: the planted small input passes', () => {
  it('has no errors', () => {
    expect(checkBlocks(good()).errors).toEqual([]);
  });
});

describe('blocks guard: each bad case fails once', () => {
  it('a catalog row with no status', () => {
    expect(errorsOf((i) => delete cat(i).rows[1].status)).toMatch(/grant\.action: no status/);
  });
  it('a "ruled" row with no ruling', () => {
    expect(errorsOf((i) => (cat(i).rows[1].status = 'ruled'))).toMatch(/grant\.action: status "ruled" names no ruling/);
  });
  it('an id twice, a family not on the list, a bad phase or place', () => {
    expect(errorsOf((i) => cat(i).rows.push(row()))).toMatch(/number\.add: id appears twice/);
    expect(errorsOf((i) => (cat(i).rows[1].family = 'magic'))).toMatch(/family "magic" is not in "families"/);
    expect(errorsOf((i) => (cat(i).rows[1].phase = 9))).toMatch(/phase must be 1–6/);
    expect(errorsOf((i) => (cat(i).rows[1].place = 'hidden'))).toMatch(/place must be "main" or "advanced"/);
  });
  it('a feature of the Feature list that no row covers', () => {
    expect(errorsOf((i) => (cat(i).rows[1].features = []))).toMatch(/feature 2 of the design's Feature list is in no catalog row/);
  });
  it('a lane of the manual that no row covers, and a lane the manual does not have', () => {
    expect(errorsOf((i) => (cat(i).notBlocks = []))).toMatch(/lane "laneMissing" .* is in no catalog row/);
    expect(errorsOf((i) => (cat(i).rows[0].lanes = ['laneOne', 'laneTypo']))).toMatch(/names lane "laneTypo", which docs\/mechanic-lanes\.md does not have/);
  });
  it('a dropped feature that no entry covers', () => {
    expect(errorsOf((i) => cat(i).notBlocks.pop())).toMatch(/feature 3 of the design's Feature list is in no catalog row/);
  });
  it('a notBlocks entry with no reason', () => {
    expect(errorsOf((i) => (cat(i).notBlocks[0].why = ''))).toMatch(/notBlocks #0: no "why"/);
  });
  it('a registry entry with no built catalog row', () => {
    expect(errorsOf((i) => (cat(i).rows[0].status = 'to-add'))).toMatch(/registry number\.add: no catalog row with status "built"/);
  });
  it('a built catalog row with no registry entry', () => {
    expect(errorsOf((i) => (i.registry = []))).toMatch(/catalog row number\.add: status "built" but the registry has no entry/);
  });
  it('a registry entry whose Tweaks place differs from the catalog', () => {
    expect(errorsOf((i) => (cat(i).rows[0].place = 'advanced'))).toMatch(/editor place "main" but the catalog says "advanced"/);
  });
  it('a registry entry not in Tweaks yet and not on the still-to-add list (decision 24)', () => {
    // An editor that is only planned (built: false) is "not in Tweaks yet" exactly like no editor.
    expect(errorsOf((i) => (i.stillToAdd = []))).toMatch(/not in Tweaks yet and not on STILL_TO_ADD/);
    expect(errorsOf((i) => (i.stillToAdd = [{ id: 'number.add', why: ' ' }]))).toMatch(/not in Tweaks yet and not on STILL_TO_ADD/);
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], editor: null }]))).toBe('');
    expect(
      errorsOf((i) => {
        i.registry = [{ ...i.registry[0], editor: null }];
        i.stillToAdd = [];
      }),
    ).toMatch(/not in Tweaks yet and not on STILL_TO_ADD/);
  });
  it('a built editor still on the still-to-add list', () => {
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], editor: { ...i.registry[0].editor!, built: true } }]))).toMatch(/its editor is built, but STILL_TO_ADD still lists it/);
  });
  it('a built catalog row whose bookFields differ from the registry entry', () => {
    expect(errorsOf((i) => (cat(i).rows[0].bookFields = ['saveBonuses']))).toMatch(/registry number\.add: bookFields \[.*\] but the catalog says \[saveBonuses\]/);
  });
  it('an editor part that does not exist', () => {
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], editor: { ...i.registry[0].editor!, parts: ['target', 'colour' as never] } }]))).toMatch(/editor part "colour" is not in EDITOR_PARTS/);
  });
  it('a target kind the target registry does not have', () => {
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], accepts: { aspect: 'number', kinds: ['ac', 'luck' as never] } }]))).toMatch(/accepts target "luck" \(number\), which the target registry does not have/);
  });
  it('an old Overrides key that does not exist', () => {
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], storage: { in: 'legacy', key: 'favouriteColour' as never } }]))).toMatch(/"favouriteColour" is not one of today's Overrides keys/);
  });
  it('a missing test file, and a test file with no test titled with the id', () => {
    expect(errorsOf((i) => (i.registry = [{ ...i.registry[0], test: 'test/nowhere.test.ts' }]))).toMatch(/test file test\/nowhere\.test\.ts does not exist/);
    expect(errorsOf((i) => (i.readFile = () => "it('something else', () => {})"))).toMatch(/no it\(\)\/describe\(\) title .* names 'number\.add'/);
    // The id in a list of ids, but in no test's title, is not a test of the kind.
    expect(errorsOf((i) => (i.readFile = () => "const ids = ['number.add'];\nit('lists the ids', () => {})"))).toMatch(/no it\(\)\/describe\(\) title/);
    expect(errorsOf((i) => (i.readFile = () => 'describe("the \'number.add\' kind", () => {})'))).toBe('');
    // A longer name that starts with the id is not the id.
    expect(errorsOf((i) => (i.readFile = () => "it('number.addLater works', () => {})"))).toMatch(/no it\(\)\/describe\(\) title/);
  });
  it('a target whose owner is not built while the target is', () => {
    expect(errorsOf((i) => (i.targets = [...TARGETS, { ...TARGETS[0], kind: 'damage', owner: 'companion', built: true }]))).toMatch(/built, but its owner "companion" is not/);
  });
  it('a blocks file that imports from scripts/, work/ or the batch tools (item 12)', () => {
    expect(errorsOf((i) => i.blockFiles.push({ path: 'src/rules/blocks/b.ts', text: "import { x } from '../../../scripts/wg-batch-run.mjs';" }))).toMatch(/b\.ts: imports .* must not depend on/);
    expect(errorsOf((i) => i.blockFiles.push({ path: 'src/rules/blocks/c.ts', text: "const m = await import('../../../work/x.json');" }))).toMatch(/c\.ts: imports/);
    expect(errorsOf((i) => i.blockFiles.push({ path: 'src/rules/blocks/sub/d.ts', text: "import '../../../../scripts/trust-ledger.mjs';" }))).toMatch(/sub\/d\.ts: imports/);
  });
});

describe('blocks guard on the real files', () => {
  it('passes, and prints the not-in-Tweaks-yet list', () => {
    const dir = 'src/rules/blocks';
    const { errors, info } = checkBlocks({
      registry: BLOCK_KINDS,
      stillToAdd: STILL_TO_ADD,
      editorParts: EDITOR_PARTS,
      sourceKinds: SOURCE_KINDS,
      targets: TARGETS,
      owners: OWNERS,
      catalog: JSON.parse(read(`${dir}/catalog.json`) ?? 'null'),
      designDoc: read('docs/overrides-redesign.md') ?? '',
      lanesDoc: read('docs/mechanic-lanes.md') ?? '',
      blockFiles: readdirSync(join(ROOT, dir), { recursive: true })
        .map((f) => String(f).replace(/\\/g, '/'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => ({ path: `${dir}/${f}`, text: read(`${dir}/${f}`)! })),
      readFile: read,
    });
    expect(errors).toEqual([]);
    expect(info.join('\n')).toMatch(/not in Tweaks yet/);
  });
});

/*
 * Item 10's guard, "no field has two code paths": a moved book field (the registry's `bookFields`) is
 * read only in src/rules/blocks/book.ts. Every bad case is planted HERE, in memory.
 */
describe('item 10: book fields are read only in blocks/book.ts (checkBookFieldReaders)', () => {
  const BOOK_FIELDS = [...new Set(BLOCK_KINDS.flatMap((k) => k.bookFields ?? []))];
  const scan = (text: string, allow: BookReaderAllow[] = [], path = 'src/rules/x.ts') =>
    checkBookFieldReaders({ files: [{ path, text }], bookFields: BOOK_FIELDS, allow });
  const errorsIn = (text: string) => scan(text).errors.join('\n');

  it('the registry names every moved field, the whileActive copies and speedBonusAllSpeeds included', () => {
    for (const f of ['saveBonuses', 'landSpeedBonus', 'speedBonusType', 'speedBonusAllSpeeds', 'maxHpBonus', 'passiveEffects.skills', 'whileActive.landSpeedBonus', 'whileActive.speedBonusType', 'whileActive.speedBonusAllSpeeds', 'effectChoices.grant.passive.skills', 'trainedSkill', 'trainedLore'])
      expect(BOOK_FIELDS).toContain(f);
  });

  it('fails on a planted read of each field, in each shape a read takes', () => {
    const plants: [string, string][] = [
      ['const n = rec.landSpeedBonus;', 'landSpeedBonus'],
      ['for (const sb of rec?.saveBonuses ?? []) x(sb);', 'saveBonuses'],
      ['const t = wa.speedBonusType ?? "status";', 'speedBonusType'],
      ['if (wa!.speedBonusAllSpeeds) all();', 'speedBonusAllSpeeds'],
      ["const b = db.feats[id]['maxHpBonus'];", 'maxHpBonus'],
      ['const b = db.feats[id]?.["maxHpBonus"];', 'maxHpBonus'],
      ['const { trainedLore } = background;', 'trainedLore'],
      ['for (const { maxHpBonus: hp } of feats) use(hp);', 'maxHpBonus'],
      ['return bg?.trainedSkill === key;', 'trainedSkill'],
      ['const s = item.passiveEffects?.skills;', 'passiveEffects.skills'],
      ['const v = pe?.skills?.[key] ?? 0;', 'passiveEffects.skills'],
      ['const v = grant.passive.skills;', 'effectChoices.grant.passive.skills'],
      ['const v = c.resolvedItemPassives?.[id]?.skills?.[key];', 'effectChoices.grant.passive.skills'],
      // item 10 fixer: parameter destructuring and a presence test (checker low finding 3)
      ['const f = ({ landSpeedBonus }: any) => landSpeedBonus;', 'landSpeedBonus'],
      ['const f2 = ({ speedBonusType }: { speedBonusType?: string }): string => speedBonusType ?? "";', 'speedBonusType'],
      ['const g = ({ id, maxHpBonus = null }: Feat): number => use(maxHpBonus);', 'maxHpBonus'],
      ['function h({ saveBonuses }) { return saveBonuses; }', 'saveBonuses'],
      ['feats.map(({ trainedLore: l }) => l);', 'trainedLore'],
      ["if ('maxHpBonus' in rec) use(rec);", 'maxHpBonus'],
      ['const has = "trainedSkill" in bg;', 'trainedSkill'],
    ];
    for (const [text, field] of plants) expect(errorsIn(text), text).toMatch(new RegExp(`x\\.ts:1: reads book field "${field.replace(/\./g, '\\.')}"`));
  });

  it('a read on a later line names that line, after a TSX closing tag and a regex with a quote in it', () => {
    const text = ["const r = /it's/g;", '<span>{a}</span>{b.trainedSkill}', 'const z = 1;'].join('\n');
    expect(scan(text, [], 'src/x.tsx').errors.join('\n')).toMatch(/x\.tsx:2: reads book field "trainedSkill"/);
  });

  it('is not fooled by writers, comments, strings, types, object literals, array literals or look-alike names', () => {
    const fine = [
      'rec.landSpeedBonus = 10;',
      'bg.trainedSkill = pick as SkillId;',
      '// read rec.landSpeedBonus here',
      '/* wa.speedBonusType */',
      "const msg = 'rec.saveBonuses is read in book.ts';",
      'const m = `${n} uses x.maxHpBonus`;',
      "type T = Background['trainedSkill'];",
      'const r = { landSpeedBonus: 5, trainedLore: "Sailing" };',
      "const fields = ['maxHpBonus'];",
      'const s = c.proficiencies.skills;',
      'const g = { ...landSpeedBonus };',
      'interface X { saveBonuses?: number[]; maxHpBonus?: { flat?: number } }',
      'const m = rec.landSpeedMin ?? companion.maxHpBonusPerLevel;',
      // a call ARGUMENT built with shorthand is not a read of a record's field
      'push({ landSpeedBonus, speedBonusType });',
      'if (ok({ maxHpBonus })) { go(); }',
      "for (const k in { trainedSkill: 1 }) use(k);",
    ];
    for (const text of fine) expect(scan(text).errors, text).toEqual([]);
  });

  it('never scans blocks/book.ts itself (the one home)', () => {
    expect(scan('const n = rec.landSpeedBonus;', [], 'src/rules/blocks/book.ts').errors).toEqual([]);
  });

  it('an allowlist entry covers its line only; a stale one, or one with no reason, fails', () => {
    const allow: BookReaderAllow = { file: 'src/rules/x.ts', field: 'trainedSkill', snippet: 'cb.trainedSkill', why: 'an editor' };
    expect(scan('const v = cb.trainedSkill;', [allow]).errors).toEqual([]);
    expect(scan('const v = cb.trainedSkill;\nconst w = bg.trainedSkill;', [allow]).errors.join('\n')).toMatch(/x\.ts:2: reads book field "trainedSkill"/);
    expect(scan('const v = 1;', [allow]).errors.join('\n')).toMatch(/BOOK_FIELD_ALLOW src\/rules\/x\.ts \(trainedSkill, "cb\.trainedSkill"\): matches no read any more/);
    expect(scan('const v = cb.trainedSkill;', [{ ...allow, why: ' ' }]).errors.join('\n')).toMatch(/no reason/);
  });

  it('codeOnly keeps offsets and newlines, and keeps a string that IS a watched name', () => {
    const text = "a.b; // c.d\nconst s = 'x.y', t = 'maxHpBonus';\n";
    const out = codeOnly(text, new Set(['maxHpBonus']));
    expect(out.length).toBe(text.length);
    expect(out.split('\n').length).toBe(text.split('\n').length);
    expect(out).not.toMatch(/c\.d|x\.y/);
    expect(out).toMatch(/'maxHpBonus'/);
  });

  it('passes on the real src/ files, with every allowlist entry still used', () => {
    const files = readdirSync(join(ROOT, 'src'), { recursive: true })
      .map((f) => String(f).replace(/\\/g, '/'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ path: `src/${f}`, text: read(`src/${f}`)! }));
    const { errors, info } = checkBookFieldReaders({ files, bookFields: BOOK_FIELDS, allow: BOOK_FIELD_ALLOW });
    expect(errors).toEqual([]);
    expect(info.join('\n')).toMatch(/read only in src\/rules\/blocks\/book\.ts/);
    for (const a of BOOK_FIELD_ALLOW) expect(a.why.trim().length, a.file).toBeGreaterThan(10);
  });
});

describe('item 7: one content path — applyOverrides only inside blocks/content.ts (checkContentPath)', () => {
  // A minimal valid home: the raw overlay module-private, contentFor the one export.
  const HOME = [
    "import type { ContentDatabase } from '../types';",
    'export type Edits = Record<string, unknown>;',
    'export interface Shape { a?: number }',
    'function applyOverrides(base: ContentDatabase, edits: Edits): ContentDatabase { return base; }',
    'export function contentFor(db: ContentDatabase, ov: { contentEdits?: Edits }): ContentDatabase {',
    '  return ov.contentEdits ? applyOverrides(db, ov.contentEdits) : db;',
    '}',
  ].join('\n');
  const scan = (extra: { path: string; text: string }[] = [], home: string | null = HOME) =>
    checkContentPath([...(home === null ? [] : [{ path: CONTENT_PATH_HOME, text: home }]), ...extra]);
  const errorsOf = (text: string, path = 'src/sheet/Planted.tsx') => scan([{ path, text }]).errors.join('\n');

  it('passes on the planted small input (and finds the home under a Windows path too)', () => {
    expect(scan().errors).toEqual([]);
    expect(checkContentPath([{ path: CONTENT_PATH_HOME.replace(/\//g, '\\'), text: HOME }]).errors).toEqual([]);
  });

  it('fails on applyOverrides named in code anywhere else: a call, a member call, an import, an alias, a re-export, a bracket read', () => {
    const planted = [
      'const db = applyOverrides(content, ov);',
      'const db = build.applyOverrides(content, ov);',
      "import { applyOverrides } from '../rules/build';",
      "import { buildCharacter, applyOverrides as overlay } from '../rules/build';",
      "export { applyOverrides } from './blocks/content';",
      "const raw = mod['applyOverrides'];",
      'const pick = { applyOverrides };',
    ];
    for (const text of planted) expect(errorsOf(text), text).toMatch(/src\/sheet\/Planted\.tsx:1: names applyOverrides outside src\/rules\/blocks\/content\.ts — lay a character's content-edits over a database only through contentFor/);
    // in a test, a script or the tracker as much as in src/
    expect(errorsOf('buildCharacter(b, applyOverrides(db, b.overrides));', 'test/x.test.ts')).toMatch(/test\/x\.test\.ts:1: names applyOverrides/);
    expect(errorsOf('const o = applyOverrides(baseDb, ov);', 'scripts/x.mjs')).toMatch(/scripts\/x\.mjs:1: names applyOverrides/);
    // the line number is the planted line's
    expect(errorsOf('const a = 1;\n\nconst db = applyOverrides(content, ov);')).toMatch(/Planted\.tsx:3: /);
  });

  it('is not fooled by comments, longer strings, templates or look-alike names', () => {
    const fine = [
      '// applyOverrides(db, ov) moved to blocks/content.ts',
      '/* applyOverrides */ const x = 1;',
      "const msg = 'applyOverrides was the old name';",
      'const m = `${n} once called applyOverrides`;',
      "it('applyOverrides overlays feat-text edits', () => {});",
      'const db = applyOverridesOld(content, ov);',
      'const db = reapplyOverrides(content, ov);',
    ];
    for (const text of fine) expect(errorsOf(text), text).toBe('');
  });

  it('the guard file spells the name as a string to look for it; only real code counts there', () => {
    expect(errorsOf("export const RAW = 'applyOverrides';", 'src/rules/blocks/check.ts')).toBe('');
    expect(errorsOf('const db = applyOverrides(content, ov);', 'src/rules/blocks/check.ts')).toMatch(/check\.ts:1: names applyOverrides/);
  });

  it('fails when content.ts exports anything but contentFor', () => {
    expect(scan([], HOME.replace('function applyOverrides', 'export function applyOverrides')).errors.join('\n')).toMatch(/content\.ts: exports applyOverrides — its one export is contentFor/);
    expect(scan([], `${HOME}\nexport { applyOverrides as raw };`).errors.join('\n')).toMatch(/exports raw[\s\S]*exports applyOverrides|exports applyOverrides[\s\S]*exports raw/);
    expect(scan([], `${HOME}\nexport const rawOverlay = applyOverrides;`).errors.join('\n')).toMatch(/exports rawOverlay/);
    expect(scan([], `${HOME}\nexport default contentFor;`).errors.join('\n')).toMatch(/exports default/);
    expect(scan([], `${HOME}\nexport * from './other';`).errors.join('\n')).toMatch(/exports \* \(export \*\)/);
    // types are not a door
    expect(scan([], `${HOME}\nexport type { Shape as S };`).errors).toEqual([]);
  });

  it('fails when content.ts no longer defines applyOverrides (stale guard), no longer exports contentFor, or is missing', () => {
    expect(scan([], HOME.replace(/applyOverrides/g, 'overlay')).errors.join('\n')).toMatch(/no longer defines function applyOverrides — this guard watches a name nothing uses \(stale\)/);
    expect(scan([], HOME.replace('export function contentFor', 'function contentFor')).errors.join('\n')).toMatch(/no longer exports contentFor/);
    expect(scan([], null).errors.join('\n')).toMatch(/src\/rules\/blocks\/content\.ts: not among the scanned files/);
  });

  it('passes on the real src/, test/, scripts/ and tracker/ files', () => {
    const files: { path: string; text: string }[] = [];
    const skip = new Set(['node_modules', 'dist', 'out', 'target', 'graphify-out']);
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!skip.has(e.name)) walk(p);
        } else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(e.name)) files.push({ path: p, text: read(p) ?? '' });
      }
    };
    for (const d of ['src', 'test', 'scripts', 'tracker']) if (existsSync(join(ROOT, d))) walk(d);
    expect(files.some((f) => f.path === CONTENT_PATH_HOME), 'the scan reached the home').toBe(true);
    const { errors, info } = checkContentPath(files);
    expect(errors).toEqual([]);
    expect(info.join('\n')).toMatch(/applyOverrides is named only in src\/rules\/blocks\/content\.ts, which exports contentFor alone/);
  });
});
