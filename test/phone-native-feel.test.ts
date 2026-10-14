// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getAppearance, initTheme, setTheme } from '../src/theme/theme-manager';

/**
 * "FEELS LIKE A REAL PHONE APP" — the native-feel check of the builder (owner, 2026-10-14). Each block
 * pins one tell that a phone player sees as "this is a website":
 *
 *  1. A :hover rule a touch screen leaves switched on after the tap (a source-book row, the feat clear ✕,
 *     Replace, the picker's Filters button stayed lit). 17 builder.css hover rules and 18 sheet.css ones
 *     for controls the builder uses were not in a (hover: hover) block.
 *  2. No press feedback: a web button reacts on `click`, when the finger LEAVES; with hover gated there
 *     was no feedback at all on a tap.
 *  3. Long-press selected a builder button's label: the builder is its own shell, not a .ws-app, so the
 *     app's "no selection on the UI" rule never reached it (nor the confirm boxes, outside every shell).
 *  4. Pull-to-refresh on the phone website RELOADED the page — throwing away a character still in the
 *     builder with no question (the Discard guard only sees Cancel and Back).
 *  5. The phone browser's status bar stayed the default dark theme's colour under a light theme.
 *
 * Each block failed once against the stylesheets / theme-manager from before the check (2026-10-14).
 */
// PHONE_CSS_ROOT: read the two stylesheets from another copy (e.g. `git show HEAD:…` in a scratch folder)
// to watch blocks 1-4 fail on the old CSS. Unset = the working tree.
const REPO = path.join(__dirname, '..');
const CSS_ROOT = process.env.PHONE_CSS_ROOT ?? REPO;
const read = (f: string) => readFileSync(path.join(f.endsWith('.css') ? CSS_ROOT : REPO, ...f.split('/')), 'utf8');

type Rule = { sels: string[]; body: string; at: string[] };
function parse(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: { prelude: string; start: number }[] = [];
  let mark = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ prelude: src.slice(mark, i).trim(), start: i + 1 });
      mark = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced }');
      const at = stack.map((s) => s.prelude);
      if (!top.prelude.startsWith('@') && !at.some((s) => s.startsWith('@keyframes'))) {
        out.push({ sels: top.prelude.split(',').map((s) => s.trim()), body: src.slice(top.start, i), at });
      }
      mark = i + 1;
    } else if (ch === ';' && (!stack.length || stack[stack.length - 1].prelude.startsWith('@'))) {
      mark = i + 1; // a statement (@import …;) between rules is not part of the next selector
    }
  }
  if (stack.length) throw new Error('unbalanced {');
  return out;
}
const PHONE = (r: Rule) => r.at.some((a) => /@media\s*\(max-width:\s*720px\)/.test(a));
const BUILDER = parse(read('src/builder/builder.css'));
const SHEET = parse(read('src/sheet.css'));

const HOVER_GATED = (r: Rule) => r.at.some((a) => /hover:\s*hover/.test(a));
/** Every class name the builder and the popups it opens write into their markup. */
const BUILDER_CLASSES = (() => {
  const used = new Set<string>();
  for (const f of ['src/builder/Builder.tsx', 'src/builder/shared.tsx', 'src/sheet/FilterableSelect.tsx', 'src/sheet/RecordCard.tsx']) {
    const t = read(f);
    for (const m of t.matchAll(/className=(?:"([^"]+)"|\{['`]([^'`]+)['`])/g)) for (const c of (m[1] ?? m[2]).split(/\s+/)) if (c) used.add(c);
    for (const m of t.matchAll(/'([a-z][a-z0-9-]+)'/g)) used.add(m[1]);
  }
  return used;
})();

describe('1. no builder hover style sticks after a tap', () => {
  it('every :hover rule in builder.css sits in a (hover: hover) block', () => {
    const loose = BUILDER.filter((r) => r.sels.some((s) => s.includes(':hover')) && !HOVER_GATED(r));
    expect(loose.map((r) => r.sels.join(', '))).toEqual([]);
  });
  it('so does every sheet.css hover rule of a class the builder or its pickers use', () => {
    // Pure hover rules only: a rule that ALSO styles a non-hover state (".x:disabled, .x:disabled:hover")
    // is a shared look, not a hover effect, and must keep applying on a touch screen.
    const loose = SHEET.filter(
      (r) =>
        !HOVER_GATED(r) &&
        r.sels.every((s) => s.includes(':hover')) &&
        r.sels.some((s) => [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => BUILDER_CLASSES.has(m[1]))),
    );
    expect(loose.map((r) => r.sels.join(', '))).toEqual([]);
  });
});

describe('2. a tap shows at once that it landed', () => {
  const pressRules = BUILDER.filter((r) => PHONE(r) && r.sels.some((s) => s.includes(':active')));
  it('phone press feedback on the builder choice control, the level chips, Select and the picker rows', () => {
    const sels = pressRules.filter((r) => /transform:\s*scale|opacity:/.test(r.body)).flatMap((r) => r.sels);
    for (const want of ['popsel', 'lchip', 'pick-add', 'pick-body', 'picker-item', 'b-create']) {
      expect(sels.some((s) => s.startsWith(`button.${want}:active`)), `${want} has no press feedback on a phone`).toBe(true);
    }
  });
  it('only the pressed BUTTON reacts — never a wrapper around it (:active also matches every ancestor)', () => {
    // A .lvl-card or .popsel is often a <div> holding the buttons; `.lvl-card:active` dimmed the whole
    // card when one boost pill was pressed, and the pill twice over (final check 2026-10-14).
    const bare = pressRules.flatMap((r) => r.sels).filter((s) => !/(^|\s)button\.[\w-]+:active/.test(s));
    expect(bare).toEqual([]);
  });
});

describe('3. long-press never selects a builder button’s label', () => {
  it('the phone no-selection rule covers the builder shell and the detached popups', () => {
    const rule = SHEET.find((r) => PHONE(r) && /user-select:\s*none/.test(r.body) && r.sels.includes('.ws-app'));
    expect(rule, 'the phone no-selection rule is gone').toBeTruthy();
    expect(rule!.sels).toEqual(expect.arrayContaining(['.builder', '.picker-overlay']));
    expect(rule!.body).toMatch(/-webkit-touch-callout:\s*none/);
  });
});

describe('4. pulling down never reloads the page under an unsaved character', () => {
  it('the builder scroller keeps its overscroll, and the page has none while the builder is open', () => {
    expect(SHEET.some((r) => PHONE(r) && r.sels.includes('.builder > .builder-body') && /overscroll-behavior:\s*contain/.test(r.body))).toBe(true);
    const root = SHEET.find((r) => r.sels.includes('html:has(.builder)'));
    expect(root, 'no page-level overscroll rule for the builder').toBeTruthy();
    expect(root!.body).toMatch(/overscroll-behavior-y:\s*none/);
    // At EVERY width: a phone held sideways (800-930px) or a tablet gets the desktop layout, and the
    // browser's pull-to-refresh with it (final check 2026-10-14).
    expect(root!.at, 'the page rule sits inside a media query').toEqual([]);
    // Its own rule: a browser without :has() drops the whole rule, so nothing else may ride on it.
    expect(root!.sels.every((s) => s.startsWith('html:has(.builder)'))).toBe(true);
  });
});

describe('5. the phone browser’s status bar follows the theme', () => {
  const start = getAppearance().themeId;
  afterAll(() => setTheme(start));
  it('theme-color is the background of the theme on screen, light or dark', () => {
    initTheme();
    setTheme('daylight');
    const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;
    const bg = () => document.documentElement.style.getPropertyValue('--app-bg').trim();
    expect(bg()).toBe('#f4f6fa');
    expect(meta()).toBe(bg());
    setTheme('midnight');
    expect(meta()).toBe('#14161f');
  });
});
