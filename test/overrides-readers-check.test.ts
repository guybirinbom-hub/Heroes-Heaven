import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOverridesReaders, type FeatReaderHit } from '../src/rules/blocks/check';
import { OVERRIDES_READERS_ALLOW, OVERRIDES_READERS_HOMES, readAllow, scanOverridesReaders, scanText, srcFiles } from '../scripts/lib/feat-readers.mjs';

/**
 * THE "ONE READER" GUARD (Tweaks spec item 4; plan B WP2, section 7.1): every read of a character's tweaks
 * goes through src/rules/blocks/active.ts, which applies the master switch, each tweak's own on/off and its
 * start level. The places outside the home files that still name `overrides` are listed, with a reason and a
 * count, in src/rules/blocks/overrides-readers.json; scripts/blocks-check.mjs (npm run verify) fails on any
 * other. The scanner is the feat-readers one (scripts/lib/feat-readers.mjs), run for the field `overrides`.
 *
 * Each bad case is planted HERE, in memory, on the real src/ files — never in the repo's files.
 */

type SrcFile = { path: string; text: string };
type Allow = Record<string, Record<string, { count: number; why: string }>>;
const ROOT = join(__dirname, '..');
const FILES: SrcFile[] = srcFiles(ROOT);
const ALLOW = readAllow(ROOT, OVERRIDES_READERS_ALLOW) as Allow;

/* One scan per file set (a TypeScript parse of ~250 files): the allowlist cases below reuse FILES' scan, so the
 * test stays well inside vitest's 5 s under a loaded machine (a worktree run timed out at 7 scans). */
const scans = new WeakMap<SrcFile[], FeatReaderHit[]>();
const hitsOf = (files: SrcFile[]): FeatReaderHit[] => {
  let hits = scans.get(files);
  if (!hits) scans.set(files, (hits = scanOverridesReaders(files) as FeatReaderHit[]));
  return hits;
};
const errorsOf = (files: SrcFile[], allow: unknown = ALLOW): string[] => checkOverridesReaders(hitsOf(files), allow).errors;
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

describe('the one-reader guard on the real files', () => {
  it('passes: every place outside the home files that names "overrides" is listed with its reason and count', () => {
    expect(errorsOf(FILES)).toEqual([]);
  });

  it('every entry has a reason and a whole count, and no home file is listed', () => {
    expect(Object.keys(ALLOW).filter((k) => k !== '$comment')).toEqual(['overrides']);
    for (const [key, e] of Object.entries(ALLOW.overrides)) {
      expect(e.why.trim().length, key).toBeGreaterThan(20);
      expect(Number.isInteger(e.count) && e.count >= 1, key).toBe(true);
      expect(OVERRIDES_READERS_HOMES.some((h: string) => key.startsWith(`${h}#`)), `${key}: a home file needs no entry`).toBe(false);
    }
  });

  it('the readers of what a tweak DOES are routed: no derive, sheet number or engine reader is listed', () => {
    // A listed place may write, carry storage, key a memo, or name another concept — never apply a tweak.
    const writersAndStorage = /^(Writer|Storage|useMemo dependency only|Another concept)/;
    for (const [key, e] of Object.entries(ALLOW.overrides)) expect(e.why, key).toMatch(writersAndStorage);
  });
});

describe('the one-reader guard: each planted bad case fails', () => {
  it('build.overrides.maxHp in a new function', () => {
    const e = errorsOf(withAppended('src/rules/derive.ts', '\nexport function plantedMaxHp(build: BuildState): number | undefined {\n  return build.overrides?.maxHp;\n}\n'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/rules\/derive\.ts#plantedMaxHp \(line \d+\): names "overrides" 1×.*blocks\/active\.ts/);
  });

  it('const { overrides } = c', () => {
    const e = errorsOf(withAppended('src/sheet/partySummary.ts', '\nexport function plantedDestructure(c: Character) {\n  const { overrides } = c;\n  return overrides?.addedLanguages ?? [];\n}\n'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/sheet\/partySummary\.ts#plantedDestructure .*names "overrides"/);
  });

  it("c['overrides']", () => {
    const e = errorsOf(withAppended('src/rules/play.ts', "\nexport const plantedBracket = (c: Character) => c['overrides']?.removedFeatIds ?? [];\n"));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/rules\/play\.ts#plantedBracket .*names "overrides"/);
  });

  it("a shorthand { overrides } and the string 'overrides', in a new file", () => {
    const e = errorsOf(withAppended('src/sheet/zz-plant.ts', "export const keys = ['overrides'];\nexport const rebuilt = (overrides: object) => ({ overrides });\n"));
    expect(e.join('\n')).toMatch(/src\/sheet\/zz-plant\.ts#keys .*names "overrides"/);
    expect(e.join('\n')).toMatch(/src\/sheet\/zz-plant\.ts#rebuilt .*names "overrides"/);
  });

  it('a second read inside an allowlisted place (a count above the listed one)', () => {
    // The listed place is the memo itself (its dependency list); a read inside `ids` would be a new place.
    const e = errorsOf(
      withReplaced(
        'src/sheet/SpellsTab.tsx',
        '}, [character.overrides, character.options,',
        '}, [character.overrides, character.overrides?.addedSpells, character.options,',
      ),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/SpellsTab\.tsx#SpellsTab>myRituals .*names "overrides" 2×, but .* allows 1/);
  });

  it('a stale entry, a count left too high, an empty reason, a bad count, a bad shape', () => {
    const stale = clone(ALLOW);
    stale.overrides['src/rules/build.ts#noSuchReader'] = { count: 1, why: 'a place that no longer exists at all' };
    expect(errorsOf(FILES, stale).join('\n')).toMatch(/build\.ts#noSuchReader: names "overrides" nowhere any more \(stale\)/);

    const high = clone(ALLOW);
    high.overrides['src/sheet/SpellsTab.tsx#SpellsTab>myRituals'].count = 3;
    expect(errorsOf(FILES, high).join('\n')).toMatch(/SpellsTab>myRituals: lists 3, the scan finds 1 — lower the count/);

    const noWhy = clone(ALLOW);
    noWhy.overrides['src/rules/build.ts#collectChosenIds'].why = '  ';
    expect(errorsOf(FILES, noWhy).join('\n')).toMatch(/build\.ts#collectChosenIds: no reason/);

    const badCount = clone(ALLOW);
    badCount.overrides['src/rules/build.ts#collectChosenIds'].count = 0;
    expect(errorsOf(FILES, badCount).join('\n')).toMatch(/collectChosenIds: "count" must be a whole number from 1/);

    expect(errorsOf(FILES, null).join('\n')).toMatch(/missing or not an object/);
    expect(errorsOf(FILES, { overrides: [] }).join('\n')).toMatch(/"overrides" must be an object/);
    // The whole list left out: every place naming it is unlisted.
    expect(errorsOf(FILES, {}).filter((m) => m.includes('names "overrides"')).length).toBe(Object.keys(ALLOW.overrides).length);
  });
});

describe('the one-reader guard: what is NOT a read', () => {
  it('a type position, a comment, an object key and a longer name pass', () => {
    const benign = [
      '',
      '// build.overrides?.maxHp — a comment naming the store',
      "/* c['overrides'], const { overrides } = c */",
      'export interface PlantedShape { overrides?: BuildOverrides }',
      "export type PlantedOv = BuildState['overrides'];",
      "export type PlantedKey = 'overrides' | 'options';",
      "export const plantedTyped = (x: unknown) => x as Character['overrides'];",
      'export const plantedLiteral = { overrides: {} };',
      'export const plantedLonger = (b: { overridesEnabled: boolean; overridesOf: number }) => b.overridesEnabled || b.overridesOf;',
      '',
    ].join('\n');
    expect(errorsOf(withAppended('src/rules/derive.ts', benign))).toEqual([]);
  });

  it.each(OVERRIDES_READERS_HOMES as string[])('never scans the home file %s', (home) => {
    expect(errorsOf(withAppended(home, '\nexport const plantedHome = (b: { overrides?: { maxHp?: number } }) => b.overrides?.maxHp;\n'))).toEqual([]);
  });

  it('keys each read by its enclosing named symbols, outermost first', () => {
    const text = ['export function Outer(c: C) {', '  const deps = useMemo(() => 1, [c.overrides]);', '  return { act: (b: B) => b.overrides?.maxHp, deps };', '}'].join('\n');
    expect(scanText('src/x.tsx', text, ['overrides']).map((h: { field: string; chain: string; line: number }) => `${h.field} ${h.chain} ${h.line}`)).toEqual([
      'overrides Outer>deps 2',
      'overrides Outer>act 3',
    ]);
  });
});
