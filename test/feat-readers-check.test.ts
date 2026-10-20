import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFeatReaders, type FeatReaderHit } from '../src/rules/blocks/check';
import { FEAT_READERS_HOME, readAllow, scanFeatReaders, scanText, srcFiles } from '../scripts/lib/feat-readers.mjs';

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
      /^src\/rules\/build\.ts#(collectChosenIds|removeChosenIds|deriveBuildFromCharacter)(>|$)/,
      /^src\/builder\/shared\.tsx#OverridesCard(>|$)/,
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
    badCount.featPicks['src/builder/Builder.tsx#Builder>picked'].count = 0;
    expect(errorsOf(FILES, badCount).join('\n')).toMatch(/Builder>picked: "count" must be a whole number from 1/);

    expect(errorsOf(FILES, null).join('\n')).toMatch(/missing or not an object/);
    expect(errorsOf(FILES, { featPicks: [] }).join('\n')).toMatch(/"featPicks" must be an object/);
    // A store left out of the list: every place naming it is unlisted.
    const { addedFeats: _gone, ...noAdded } = clone(ALLOW);
    expect(errorsOf(FILES, noAdded).filter((m) => m.includes('names "addedFeats"')).length).toBe(Object.keys(ALLOW.addedFeats).length);
  });
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
