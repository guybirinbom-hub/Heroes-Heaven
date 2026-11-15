import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFeatReaders, checkSlotCategoryReaders, type FeatReaderHit } from '../src/rules/blocks/check';
import {
  FEAT_READERS_HOME,
  readAllow,
  scanFeatReaders,
  scanSlotCategoryReaders,
  scanSlotCategoryText,
  scanText,
  SLOT_CATEGORY_ALLOW,
  srcFiles,
} from '../scripts/lib/feat-readers.mjs';

/**
 * CASE D's guard (docs/overrides-redesign.md spec item 2, Building blocks item 9; plan
 * work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md section 5): every reader of the feats a build holds
 * asks src/rules/heldFeats.ts, so a feat given through Tweaks works like the same feat picked. The places
 * that still name the raw stores (`featPicks`, `addedFeats`) are listed, with a reason and a count, in
 * src/rules/blocks/feat-readers.json; scripts/blocks-check.mjs (npm run verify) fails on any other.
 *
 * Each bad case is planted HERE, in memory, on the real src/ files — never in the repo's files.
 */

type SrcFile = { path: string; text: string };
const ROOT = join(__dirname, '..');
const FILES: SrcFile[] = srcFiles(ROOT);
const ALLOW = readAllow(ROOT) as Record<string, Record<string, { count: number; why: string }>>;

const errorsOf = (files: SrcFile[], allow: unknown = ALLOW): string[] => checkFeatReaders(scanFeatReaders(files) as FeatReaderHit[], allow).errors;
/** The real files with `extra` appended to `path` (a new file when the tree has none). */
const withAppended = (path: string, extra: string): SrcFile[] =>
  FILES.some((f) => f.path === path) ? FILES.map((f) => (f.path === path ? { ...f, text: f.text + extra } : f)) : [...FILES, { path, text: extra }];
/** The real files with one exact snippet of `path` replaced. */
const withReplaced = (path: string, from: string, to: string): SrcFile[] =>
  FILES.map((f) => {
    if (f.path !== path) return f;
    expect(f.text.includes(from), `${path} still holds the snippet the plant edits`).toBe(true);
    return { ...f, text: f.text.replace(from, to) };
  });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('feat readers guard on the real files', () => {
  it('passes: every place that names a raw feat store is listed with its reason and count', () => {
    expect(errorsOf(FILES)).toEqual([]);
  });

  it('the addedFeats list is the stored reader and storage only (plan section 5)', () => {
    const allowed = [
      /^src\/rules\/blocks\/stored\.ts#/,
      // the write door (Tweaks part B plan 5.1, WP1): THE storage writer of every old Overrides key
      /^src\/rules\/blocks\/write\.ts#/,
      /^src\/rules\/build\.ts#(collectChosenIds|removeChosenIds|deriveBuildFromCharacter)(>|$)/,
      // (the old Overrides card, src/builder/shared.tsx#OverridesCard, retired in plan B WP7: the Tweaks
      // editors write every given feat through the write door above)
      // the stored key's NAME, read by no character: the registry's storage.key and the check's key list
      /^src\/rules\/blocks\/registry\.ts#BLOCK_KINDS$/,
      /^src\/rules\/blocks\/check\.ts#LEGACY_KEYS$/,
    ];
    for (const key of Object.keys(ALLOW.addedFeats)) expect(allowed.some((re) => re.test(key)), key).toBe(true);
  });

  it('every entry has a reason and a whole count', () => {
    for (const field of ['featPicks', 'addedFeats'])
      for (const [key, e] of Object.entries(ALLOW[field])) {
        expect(e.why.trim().length, `${field} ${key}`).toBeGreaterThan(20);
        expect(Number.isInteger(e.count) && e.count >= 1, `${field} ${key}`).toBe(true);
      }
  });
});

describe('feat readers guard: each planted bad case fails', () => {
  it('Object.values(build.featPicks) in a new function', () => {
    const e = errorsOf(withAppended('src/rules/build.ts', '\nexport function plantedWalker(build: BuildState): string[] {\n  return Object.values(build.featPicks).filter((v): v is string => !!v);\n}\n'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/rules\/build\.ts#plantedWalker \(line \d+\): names "featPicks" 1×.*heldFeats\.ts/);
  });

  it('const { featPicks } = b', () => {
    const e = errorsOf(withAppended('src/rules/derive.ts', '\nexport function plantedDestructure(b: { featPicks: Record<string, string> }) {\n  const { featPicks } = b;\n  return featPicks;\n}\n'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/rules\/derive\.ts#plantedDestructure .*names "featPicks"/);
  });

  it("b['featPicks']", () => {
    const e = errorsOf(withAppended('src/rules/featSlots.ts', "\nexport const plantedBracket = (b: BuildState) => Object.keys(b['featPicks']);\n"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/rules\/featSlots\.ts#plantedBracket .*names "featPicks"/);
  });

  it('a raw overrides.addedFeats read', () => {
    const e = errorsOf(withAppended('src/builder/Builder.tsx', '\nexport function plantedGiven(b: BuildState) {\n  return (b.overrides?.addedFeats ?? []).map((a) => a.featId);\n}\n'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/builder\/Builder\.tsx#plantedGiven .*names "addedFeats"/);
  });

  it('a shorthand { featPicks } and a string literal key list, in a new file', () => {
    const e = errorsOf(withAppended('src/rules/zz-plant.ts', "export const keys = ['featPicks'];\nexport const rebuilt = (featPicks: object) => ({ featPicks });\n"));
    expect(e.join('\n')).toMatch(/src\/rules\/zz-plant\.ts#keys .*names "featPicks"/);
    expect(e.join('\n')).toMatch(/src\/rules\/zz-plant\.ts#rebuilt .*names "featPicks"/);
  });

  it('a second read inside an allowlisted place (a count above the listed one)', () => {
    const e = errorsOf(
      withReplaced('src/builder/Builder.tsx', 'const isCurrent = build.featPicks?.[pickerKey] === f.id;', 'const isCurrent = build.featPicks?.[pickerKey] === f.id || Object.values(build.featPicks).includes(f.id);'),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/Builder\.tsx#Builder>isCurrent .*names "featPicks" 2×, but .* allows 1/);
  });

  it('a stale entry, a count left too high, an empty reason, a bad count, a bad shape', () => {
    const stale = clone(ALLOW);
    stale.featPicks['src/rules/build.ts#noSuchWalker'] = { count: 1, why: 'a place that no longer exists' };
    expect(errorsOf(FILES, stale).join('\n')).toMatch(/build\.ts#noSuchWalker: names "featPicks" nowhere any more \(stale\)/);

    const high = clone(ALLOW);
    high.featPicks['src/builder/Builder.tsx#Builder>isCurrent'].count = 3;
    expect(errorsOf(FILES, high).join('\n')).toMatch(/Builder>isCurrent: lists 3, the scan finds 1 — lower the count/);

    const noWhy = clone(ALLOW);
    noWhy.addedFeats['src/rules/blocks/stored.ts#readLegacyBlocks'].why = '  ';
    expect(errorsOf(FILES, noWhy).join('\n')).toMatch(/stored\.ts#readLegacyBlocks: no reason/);

    const badCount = clone(ALLOW);
    // tweaks p2 WP7: the slot card's own-pick read moved into slotPickLines (a book slot's and an extra place's card).
    badCount.featPicks['src/builder/Builder.tsx#Builder>slotPickLines>picked'].count = 0;
    expect(errorsOf(FILES, badCount).join('\n')).toMatch(/Builder>slotPickLines>picked: "count" must be a whole number from 1/);

    expect(errorsOf(FILES, null).join('\n')).toMatch(/missing or not an object/);
    expect(errorsOf(FILES, { featPicks: [] }).join('\n')).toMatch(/"featPicks" must be an object/);
    // A store left out of the list: every place naming it is unlisted.
    const { addedFeats: _gone, ...noAdded } = clone(ALLOW);
    expect(errorsOf(FILES, noAdded).filter((m) => m.includes('names "addedFeats"')).length).toBe(Object.keys(ALLOW.addedFeats).length);
    // Seven whole-source scans: 5.1-5.3 s in a 28-29-file vt.mjs run (WP6, WP7 and its fix round each hit the
    // default 5 s once; alone it passes in about 2 s), so it gets a load-proof limit instead of a flaky red.
  }, 30_000);
});

describe('feat readers guard: what is NOT a read', () => {
  it('comments, types, object keys and longer names pass', () => {
    const benign = [
      '',
      '// Object.values(build.featPicks) — a comment naming the store',
      "/* b['featPicks'], const { featPicks } = b, b.overrides?.addedFeats */",
      'export interface PlantedShape { featPicks: Record<string, string>; addedFeats?: string[] }',
      "export type PlantedPicks = BuildState['featPicks'];",
      "export type PlantedKey = 'featPicks' | 'addedFeats';",
      "export const plantedTyped = (x: unknown) => x as BuildState['featPicks'];",
      'export const plantedLiteral = { featPicks: {}, addedFeats: [] };',
      'export const plantedLonger = (b: { featPicksOf: number; addedFeatsCount: number }) => b.featPicksOf + b.addedFeatsCount;',
      '',
    ].join('\n');
    expect(errorsOf(withAppended('src/rules/build.ts', benign))).toEqual([]);
  });

  it(`never scans ${FEAT_READERS_HOME} itself (the one home)`, () => {
    expect(errorsOf(withAppended(FEAT_READERS_HOME, '\nexport const plantedHome = (b: HeldInput) => Object.values(b.featPicks ?? {}).concat(b.overrides?.addedFeats?.map((a) => a.featId) ?? []);\n'))).toEqual([]);
  });

  it('keys each read by its enclosing named symbols, outermost first', () => {
    const text = [
      'export function Outer(build: B) {',
      '  const inner = () => build.featPicks;',
      '  const deps = useMemo(() => 1, [build.featPicks]);',
      '  return { act: (b: B) => b.overrides?.addedFeats, deps, inner };',
      '}',
      'class K { m(b: B) { return b["featPicks"]; } }',
      'const top = featPicksOf(x).featPicks;',
    ].join('\n');
    expect(scanText('src/x.tsx', text).map((h: { field: string; chain: string; line: number }) => `${h.field} ${h.chain} ${h.line}`)).toEqual([
      'featPicks Outer>inner 2',
      'featPicks Outer>deps 3',
      'addedFeats Outer>act 4',
      'featPicks K>m 6',
      'featPicks top 7',
    ]);
  });
});

/**
 * Tweaks phase 2, WP7 (plan C10): an extra feat place's key is `<level>:extra<category>:<n>`, so every reader of
 * a slot key's CATEGORY asks slotCategoryOf (heldFeats.ts) or slotRefOf (featSlots.ts). The raw reads still
 * allowed (slot geometry kept on purpose, the Character.feats row, splits of things that are not slot keys) are
 * listed in src/rules/blocks/slot-category-readers.json; scripts/blocks-check.mjs fails on any other.
 */
describe('slot-category readers guard (WP7, C10)', () => {
  const CAT_ALLOW = readAllow(ROOT, SLOT_CATEGORY_ALLOW) as Record<string, Record<string, { count: number; why: string }>>;
  const catErrors = (files: SrcFile[], allow: unknown = CAT_ALLOW): string[] =>
    checkSlotCategoryReaders(scanSlotCategoryReaders(files) as FeatReaderHit[], allow).errors;

  it('passes on the real files: every raw read of a slot key category is listed with its reason and count', () => {
    expect(catErrors(FILES)).toEqual([]);
    for (const [key, e] of Object.entries(CAT_ALLOW.slotCategory)) {
      expect(e.why.trim().length, key).toBeGreaterThan(20);
      expect(Number.isInteger(e.count) && e.count >= 1, key).toBe(true);
    }
  }, 30_000);

  it('the three raw-category keepers named by the plan are listed (rekey, losing slot, the Character.feats row)', () => {
    const keys = Object.keys(CAT_ALLOW.slotCategory);
    expect(keys).toContain('src/rules/featSlots.ts#rekeyFeatSlots');
    expect(keys.some((k) => k.startsWith('src/rules/featSlots.ts#picksLosingSlot'))).toBe(true);
    expect(keys).toContain('src/rules/build.ts#buildCharacter');
  });

  it("PLANT: slotName going back to a raw `key.split(':')[1]` fails", () => {
    const e = catErrors(withReplaced('src/builder/shared.tsx', 'const cat = slotCategoryOf(key);', "const cat = key.split(':')[1];"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/builder\/shared\.tsx#slotName>cat \(line \d+\): reads a slot key's category 1×.*slotCategoryOf/);
  }, 30_000);

  it('PLANT: each shape of a new raw read fails (split index, array binding, SLOT_PREFIX index 2, exec then m[2], a regex copy)', () => {
    const plants: [string, string][] = [
      ['plantedSplit', "\nexport const plantedSplit = (k: string) => k.split(':')[1] === 'class';\n"],
      ['plantedBind', "\nexport function plantedBind(k: string) {\n  const [, cat] = k.split(':');\n  return cat;\n}\n"],
      ['plantedExec', '\nexport const plantedExec = (k: string) => SLOT_PREFIX.exec(k)![2];\n'],
      ['plantedExecVar', '\nexport function plantedExecVar(k: string) {\n  const m = SLOT_PREFIX.exec(k);\n  return m ? m[2] : undefined;\n}\n'],
      ['plantedRegex', '\nexport const plantedRegex = /^(\\d+):([a-z]+):(\\d+)$/;\n'],
    ];
    for (const [name, text] of plants) {
      const e = catErrors(withAppended('src/rules/featSlots.ts', text));
      expect(e, name).toHaveLength(1);
      expect(e[0], name).toMatch(new RegExp(`^src/rules/featSlots\\.ts#${name} .*reads a slot key's category 1×`));
    }
  }, 30_000);

  // WP7 run 2 (the run-1 checker's item 3): the shapes the first scan let through.
  it('PLANT: each further shape fails (.at(1) on a split, match(SLOT_PREFIX) at 2, a SLOT_PREFIX alias, split(/:/)[1], a bound split then [1])', () => {
    const plants: [string, string][] = [
      ['plantedAt', "\nexport const plantedAt = (k: string) => k.split(':').at(1) === 'class';\n"],
      ['plantedMatch', '\nexport const plantedMatch = (k: string) => k.match(SLOT_PREFIX)![2];\n'],
      ['plantedAlias', '\nexport function plantedAlias(k: string) {\n  const RE = SLOT_PREFIX;\n  return RE.exec(k)![2];\n}\n'],
      ['plantedRegexSplit', '\nexport const plantedRegexSplit = (k: string) => k.split(/:/)[1];\n'],
      ['plantedParts', "\nexport function plantedParts(k: string) {\n  const parts = k.split(':');\n  return parts[1];\n}\n"],
    ];
    for (const [name, text] of plants) {
      const e = catErrors(withAppended('src/rules/featSlots.ts', text));
      expect(e, name).toHaveLength(1);
      expect(e[0], name).toMatch(new RegExp(`^src/rules/featSlots\\.ts#${name} .*reads a slot key's category 1×`));
    }
  }, 30_000);

  it('PLANT: a second raw read inside an allowlisted place (a count above the listed one) fails', () => {
    const e = catErrors(withReplaced('src/rules/featSlots.ts', 'place: category !== m[2]', "place: category !== m[2] && m[2] !== ''"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/featSlots\.ts#slotRefOf .*reads a slot key's category 2×, but .* allows 1/);
  }, 30_000);

  // Each test that scans the real files takes 1-3 s alone; beside a full named run it passed vitest's 5 s default
  // once (2026-10-25), so every such test carries the file's 30 s limit.
  it('a stale entry and a missing list fail', () => {
    const stale = clone(CAT_ALLOW);
    stale.slotCategory['src/rules/build.ts#noSuchReader'] = { count: 1, why: 'a place that no longer exists at all' };
    expect(catErrors(FILES, stale).join('\n')).toMatch(/build\.ts#noSuchReader: names "slotCategory" nowhere any more \(stale\)/);
    expect(catErrors(FILES, null).join('\n')).toMatch(/missing or not an object/);
  }, 30_000);

  it('what is NOT a read: a split of index 0 or 2, a comment, a string', () => {
    const text = [
      "export const lvl = (k: string) => Number(k.split(':')[0]);",
      "export const idx = (k: string) => Number(k.split(':')[2]);",
      "// k.split(':')[1] in a comment",
      "export const words = \"k.split(':')[1]\";",
      "export const other = (k: string) => k.split('-')[1];",
      "export const first = (k: string) => k.split(':').at(0);",
      "export function lvlOf(k: string) {\n  const parts = k.split(':');\n  return parts[0];\n}",
      'export const notSlot = (k: string) => k.match(/(a)(b)/)![2];',
    ].join('\n');
    expect(scanSlotCategoryText('src/x.ts', text)).toEqual([]);
  });
});
