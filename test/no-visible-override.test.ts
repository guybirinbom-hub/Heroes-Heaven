import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkVisibleOverrideWords, VISIBLE_WORDS_SKIP, type VisibleWordHit, type VisibleWordMarker } from '../src/rules/blocks/check';
import { srcFiles } from '../scripts/lib/feat-readers.mjs';
import { readsAsProse, scanVisibleWordFiles, scanVisibleWords } from '../scripts/lib/visible-words.mjs';

/**
 * THE "NO VISIBLE OVERRIDE" GUARD (Tweaks spec item 1; plan B WP9b, section 7.2). The per-character "Overrides"
 * card is now Tweaks; the stored names stay (`overrides`, `overridesEnabled`, `override:<id>`, `ovr-*`), but no
 * text a player can read says "override". scripts/lib/visible-words.mjs scans src/ with the TypeScript AST
 * (string literals, template chunks, JSX text that reads as prose); `checkVisibleOverrideWords` (check.ts) fails
 * on a hit outside VISIBLE_WORDS_SKIP with no `// tweaks-ok: <reason>` marker; scripts/blocks-check.mjs runs both
 * in `npm run verify`.
 *
 * Every bad case is planted HERE, in memory — never in the repo's files.
 */

type SrcFile = { path: string; text: string };
type Scan = { hits: VisibleWordHit[]; markers: VisibleWordMarker[] };
const ROOT = join(__dirname, '..');
const FILES: SrcFile[] = srcFiles(ROOT);
// One scan of the real tree (a TypeScript parse of ~260 files); a plant scans only its own file and joins it.
const BASE: Scan = scanVisibleWordFiles(FILES) as Scan;

const errorsOfScan = (s: Scan, allow: unknown = VISIBLE_WORDS_SKIP): string[] => checkVisibleOverrideWords(s.hits, allow, s.markers).errors;
/** The real tree plus one planted file. */
const withPlant = (text: string, path = 'src/sheet/Planted.tsx'): Scan => {
  const p = scanVisibleWords(path, text) as Scan;
  return { hits: [...BASE.hits, ...p.hits], markers: [...BASE.markers, ...p.markers] };
};
const plantErrors = (text: string, path?: string): string[] => errorsOfScan(withPlant(text, path));
/** The real tree with one exact snippet of one file replaced (the file is rescanned alone). */
const withReplaced = (path: string, from: string, to: string): Scan => {
  const f = FILES.find((x) => x.path === path)!;
  expect(f?.text.includes(from), `${path} still holds the snippet the plant edits`).toBe(true);
  const p = scanVisibleWords(path, f.text.replace(from, to)) as Scan;
  return {
    hits: [...BASE.hits.filter((h) => h.path !== path), ...p.hits],
    markers: [...BASE.markers.filter((m) => m.path !== path), ...p.markers],
  };
};

describe('the no-visible-override guard on the real files', () => {
  it('passes: no text a player can read says "override"', () => {
    expect(errorsOfScan(BASE)).toEqual([]);
  });

  it('the two markers: decision 19\'s "Moved from Overrides" chip and content.ts\'s developer TypeError, each covering its text', () => {
    expect(BASE.markers.map((m) => [m.path, m.used]).sort()).toEqual([
      ['src/builder/tweaks/model.ts', true],
      ['src/rules/blocks/content.ts', true],
    ]);
    const marked = BASE.hits.filter((h) => h.marker !== undefined).sort((a, b) => a.path.localeCompare(b.path));
    expect(marked.map((h) => h.path)).toEqual(['src/builder/tweaks/model.ts', 'src/rules/blocks/content.ts']);
    expect(marked[0].text).toBe('Moved from Overrides');
    expect(marked[0].marker).toMatch(/decision 19/);
    expect(marked[1].text).toMatch(/^contentFor\(db, host\): pass the character or build/);
    expect(marked[1].marker).toMatch(/developer TypeError/);
  });

  it('content.ts is not skipped whole: its TypeError without the marker fails (ErrorBoundary shows error.message)', () => {
    expect(VISIBLE_WORDS_SKIP.some((s) => s.path === 'src/rules/blocks/content.ts')).toBe(false);
    const path = 'src/rules/blocks/content.ts';
    const noMarker = withReplaced(path, '// tweaks-ok: developer TypeError', '// developer TypeError');
    expect(errorsOfScan(noMarker).join('\n')).toMatch(/content\.ts:\d+: a player can read "override" here/);
  });

  it('every skip entry names a real file with a hit and a reason', () => {
    for (const s of VISIBLE_WORDS_SKIP) {
      expect(s.why.trim().length, s.path).toBeGreaterThan(30);
      expect(FILES.some((f) => f.path === s.path), s.path).toBe(true);
      expect(BASE.hits.some((h) => h.path === s.path), `${s.path} has a hit (else the entry is stale)`).toBe(true);
    }
  });

  it('a renamed text coming back fails, named by file and line (the FeatsTab "Your text:" line)', () => {
    const e = errorsOfScan(withReplaced('src/sheet/FeatsTab.tsx', 'Your text: ${text}', 'Your override: ${text}'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/sheet\/FeatsTab\.tsx:\d+: a player can read "override" here — Overrides is now Tweaks/);
  });

  it('the attribute card and the FullStats tooltip coming back fail', () => {
    expect(errorsOfScan(withReplaced('src/builder/shared.tsx', "is set by a tweak — boosts don't change it", "is set by an Override — boosts don't change it"))).toHaveLength(1);
    expect(errorsOfScan(withReplaced('src/builder/shared.tsx', "a tweak — boosts and class changes won't change", "an Override — boosts and class changes won't change"))).toHaveLength(1);
  });

  it('removing the "Moved from Overrides" marker fails; the marker without the chip is stale', () => {
    const path = 'src/builder/tweaks/model.ts';
    const noMarker = withReplaced(path, '// tweaks-ok: decision 19', '// decision 19');
    expect(errorsOfScan(noMarker).join('\n')).toMatch(/model\.ts:\d+: a player can read "override" here[\s\S]*Moved from Overrides/);
    const noChip = withReplaced(path, "text: 'Moved from Overrides'", "text: 'Moved from the old card'");
    expect(errorsOfScan(noChip).join('\n')).toMatch(/model\.ts:\d+: a "\/\/ tweaks-ok:" marker covers no text that says "override" \(stale\)/);
  });
});

describe('plants fail (each in memory, in a new src/ file)', () => {
  it.each([
    ['a title attribute', '<button title="Remove this override">x</button>'],
    ['an object label', "export const row = { label: 'Manual override' };"],
    ['a template chunk', 'export const s = (x: string) => `Your override: ${x}`;'],
    ['an aria-label', '<button aria-label="Clear override" />'],
    ['a confirm message', "void confirmDialog({ title: 'Turn this off?', message: 'Your override will stop counting.' });"],
    ['JSX text, one capital word', '<h3>Overrides</h3>'],
    ['JSX text in a sentence', '<p>This is set by an override.</p>'],
    ['a toast / notice string', "notify('Overridden by the GM');"],
    ['a placeholder', '<input placeholder="Why override this?" />'],
    ['an object key with a space (rendered through Object.keys)', "export const LABELS = { 'Manual override': 1 };\nexport const O = () => <>{Object.keys(LABELS).map((k) => <option key={k}>{k}</option>)}</>;"],
    ['an object key, one capital word', "export const LABELS = { 'Overridden': 1 };"],
    ['JSX text, one lowercase word', '<span className="chip">overridden</span>'],
    ['a title, one lowercase word', '<span title="overridden">x</span>'],
    ['an aria-label, one lowercase word', '<i aria-label="override" />'],
    ['a placeholder in braces, one lowercase word', "<input placeholder={'overrides'} />"],
    ['an alt, one lowercase word', '<img alt="overridden" />'],
    ['a title through a ternary, one lowercase word', "<span title={Math.random() > 1 ? 'overridden' : ''}>x</span>"],
    ['a title through a template, one lowercase word', '<span title={`overridden${1}`}>x</span>'],
    ['a title through ?? in brackets, one lowercase word', "<span title={(undefined ?? 'override')}>x</span>"],
  ])('%s', (_name, code) => {
    const e = plantErrors(`export const P = () => (${code.startsWith('<') ? code : '0'});\n${code.startsWith('<') ? '' : code}\n`);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^src\/sheet\/Planted\.tsx:\d+: a player can read "override" here/);
  });

  it('a hit in a .ts file anywhere under src/ fails too (not only .tsx)', () => {
    expect(plantErrors("export const why = 'an old Overrides entry';\n", 'src/rules/planted.ts')).toHaveLength(1);
  });
});

describe('the converse passes: stored names, keys, classes, comments and types are not text', () => {
  it.each([
    ['overridesEnabled', 'export const on = (b: any) => b.options?.overridesEnabled === true;'],
    ["the 'overridesEnabled' key", "export const k = 'overridesEnabled';"],
    ['a className', 'export const C = () => <span className="ovr-chip" />;'],
    ['a className with a space', 'export const C = () => <div className="attr-override-warn picker-override-note" />;'],
    ['a className expression', "export const C = (p: boolean) => <i className={'fs-ab' + (p ? ' attr-override-lock x' : '')} />;"],
    ["the 'override:' slot key", "export const key = (id: string) => 'override:' + id;"],
    ["kind: 'override'", "export const line = { kind: 'override', text: 'x' };"],
    ['a comment', '// The old Overrides card is now the Tweaks page; an override here …\nexport const z = 1;'],
    ['a block comment', '/* Overrides, override, Overridden */\nexport const z = 1;'],
    ['hitPoints.maxOverride', 'export const m = (c: any) => c.hitPoints.maxOverride;'],
    ['a type', "export type K = 'Override me' | 'and me override';"],
    ['an import path', "import { x } from './Override panel';\nexport const y = x;"],
    ['a lowercase one-word object key', "export const map = { 'override': 1, overrides: 2 };"],
    ['a key inside a type', "export type T = { 'Manual override': number };\nexport interface I { 'Override x': string }"],
    ['a lowercase one-word value of a non-shown attribute', 'export const C = () => <div data-kind="override" />;'],
    ['a lowercase one-word CONDITION of a shown attribute (not its text)', "export const C = (m: string) => <span title={m === 'override' ? 'Set' : ''} />;"],
    ['a lowercase one-word string that IS the condition of a shown attribute', "export const C = () => <span title={'override' ? 'Set' : ''} />;"],
  ])('%s', (_name, code) => {
    expect(plantErrors(code)).toEqual([]);
  });

  it('readsAsProse: a space or a capital "O" word makes text prose; a lowercase one-word key does not', () => {
    expect(readsAsProse('override')).toBe(false);
    expect(readsAsProse('overrides')).toBe(false);
    expect(readsAsProse('override:feat-x')).toBe(false);
    expect(readsAsProse('maxOverride')).toBe(false);
    expect(readsAsProse('Override')).toBe(true);
    expect(readsAsProse('an override')).toBe(true);
    expect(readsAsProse('Tweaks only')).toBe(false);
  });
});

describe('the marker and the skip list', () => {
  it('a marker with a reason on the line above exempts that one text', () => {
    expect(plantErrors("// tweaks-ok: names the old card on purpose\nexport const a = 'Moved from Overrides';\n")).toEqual([]);
  });

  it('a JSX comment marker on the line above exempts JSX text', () => {
    expect(plantErrors('export const C = () => (\n  <p>\n    {/* tweaks-ok: names the old card */}\n    Moved from Overrides\n  </p>\n);\n')).toEqual([]);
  });

  it('a marker covers only the next line, not two lines down, and not a second text', () => {
    const e = plantErrors("// tweaks-ok: one only\nexport const a = 'Moved from Overrides';\nexport const b = 'Your override';\n");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/Planted\.tsx:3: /);
    const far = plantErrors("// tweaks-ok: too far\n\nexport const a = 'Moved from Overrides';\n");
    expect(far.join('\n')).toMatch(/Planted\.tsx:3: a player can read/);
    expect(far.join('\n')).toMatch(/Planted\.tsx:1: a "\/\/ tweaks-ok:" marker covers no text/);
  });

  it('a marker with no reason fails', () => {
    expect(plantErrors("// tweaks-ok:\nexport const a = 'Moved from Overrides';\n").join('\n')).toMatch(/marker gives no reason/);
  });

  it('a marker that covers nothing is stale', () => {
    expect(plantErrors("// tweaks-ok: nothing here\nexport const a = 'Tweaks';\n").join('\n')).toMatch(/covers no text that says "override" \(stale\)/);
  });

  it('a string that only spells the marker is not a marker', () => {
    expect(plantErrors("export const m = 'see // tweaks-ok: in the guard';\n")).toEqual([]);
  });

  it('a hit in a skipped file passes; the same text elsewhere fails', () => {
    const skip = [...VISIBLE_WORDS_SKIP, { path: 'src/sheet/Planted.tsx', why: 'a planted test skip with a reason' }];
    expect(errorsOfScan(withPlant("export const a = 'Your override';\n"), skip)).toEqual([]);
  });

  it('a stale skip entry fails (a file with no hit, or no file at all)', () => {
    const skip = [...VISIBLE_WORDS_SKIP, { path: 'src/data/customization.ts', why: 'the customization override is another concept' }];
    expect(errorsOfScan(BASE, skip).join('\n')).toMatch(/src\/data\/customization\.ts: no text there says "override" any more \(stale\)/);
    const gone = [...VISIBLE_WORDS_SKIP, { path: 'src/nope.tsx', why: 'a file that does not exist' }];
    expect(errorsOfScan(BASE, gone).join('\n')).toMatch(/src\/nope\.tsx: no text there says "override" any more \(stale\)/);
  });

  it('a skip entry with no reason, a repeated path or a malformed list fails', () => {
    const [first] = VISIBLE_WORDS_SKIP;
    expect(errorsOfScan(BASE, [{ ...first, why: ' ' }, ...VISIBLE_WORDS_SKIP.slice(1)]).join('\n')).toMatch(/no reason \("why"\)/);
    expect(errorsOfScan(BASE, [...VISIBLE_WORDS_SKIP, first]).join('\n')).toMatch(/listed twice/);
    expect(errorsOfScan(BASE, { path: 'x' }).join('\n')).toMatch(/must be a list of \{ path, why \}/);
    expect(errorsOfScan(BASE, [...VISIBLE_WORDS_SKIP, 'src/x.ts']).join('\n')).toMatch(/an entry is not \{ path, why \}/);
  });
});
