import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * bug 2026-10-14 (the owner: "why do we even have things that aren't readable for the user"). Two shapes
 * of unreadable text were still in the styles after the undefined-name fix (test/css-undefined-vars):
 *
 * 1. FIXED WHITE TEXT ON A THEME FILL. --app-bad / --app-warn / --app-good are LIGHT on the dark themes
 *    (midnight's warn is yellow), so white text on them measured 1.4–2.8:1 — the "Couldn't save"
 *    banner, the danger buttons, the Dead pill. Text on those fills uses var(--app-bg), which measured
 *    3.6:1 or better on all 19 themes (2026-10-14).
 *    The same for the accent fill: its ink is var(--app-accent-text), which the theme manager computes
 *    for whatever accent the player picked.
 * 2. TEXT MIXED TOWARD WHITE. `color-mix(… var(--app-accent) 45%, white)` is pale-on-pale on every light
 *    theme (the Invested badge, 1.5:1). Mix toward var(--app-text) instead — it flips with the theme.
 */

const ROOT = join(__dirname, '..');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('dist')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

const WHITE_VALUE = String.raw`(?:#fff\b|#ffffff\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))`;
const WHITE = new RegExp(String.raw`(?:^|[;{\s])color:\s*${WHITE_VALUE}`, 'i');
// The accent is in the list too: a player can pick any accent colour, and the theme manager computes
// --app-accent-text as the readable ink for it. Fixed white ignored that on 4 rules. `danger` is the
// tracker's own name for --app-bad (tracker/src/hh-compat.css).
const FILL_NAMES = String.raw`--(?:app-)?(?:bad|warn|good|accent|danger)\b`;
const THEME_FILL = new RegExp(String.raw`background(?:-color)?:\s*var\(${FILL_NAMES}`);
const MIX_TO_WHITE = new RegExp(String.raw`(?:^|[;{\s])color:\s*color-mix\((?:[^;]*?),\s*${WHITE_VALUE}\s*\)`, 'i');
// An "ink for this fill" variable defined as white hides the same mistake one step away: the
// tracker's --text-on-danger was #ffffff, used by every delete button in the GM tools.
const WHITE_INK_DEF = new RegExp(String.raw`(--text-on-(?:bad|warn|good|danger)|--app-(?:bad|warn|good)-text)\s*:\s*${WHITE_VALUE}`, 'i');

/** "file: selector" for every rule block that sets white text on a theme fill, or mixes text to white. */
export function unreadableRules(files: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const body = m[2];
      if (WHITE.test(body) && THEME_FILL.test(body)) out.push(`${f.path}: ${sel} (white text on a theme fill)`);
      if (MIX_TO_WHITE.test(body)) out.push(`${f.path}: ${sel} (text mixed toward white)`);
      const ink = WHITE_INK_DEF.exec(body);
      if (ink) out.push(`${f.path}: ${ink[1]} (fill ink defined as white)`);
    }
  }
  return out;
}

/** The same rule for inline styles in components: a style object, or a hover handler pair, that puts
 *  white text on a theme fill. "file:line" for each. */
export function unreadableInline(files: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  const objWhite = new RegExp(String.raw`color:\s*['"\`]${WHITE_VALUE}['"\`]`, 'i');
  const objFill = new RegExp(String.raw`background(?:Color)?:\s*['"\`]var\(${FILL_NAMES}`);
  const setWhite = new RegExp(String.raw`style\.color\s*=\s*['"\`]${WHITE_VALUE}['"\`]`, 'i');
  const setFill = new RegExp(String.raw`style\.background(?:Color)?\s*=\s*['"\`]var\(${FILL_NAMES}`);
  for (const f of files) {
    // Line windows, not brace matching: a style object holding a template string (`1px solid ${c}`)
    // has braces inside it, and a brace match silently skipped the whole object.
    const lines = f.text.split(/\r?\n/);
    const near = (i: number, re: RegExp) => lines.slice(Math.max(0, i - 3), i + 4).some((x) => re.test(x));
    const anyBg = /background(?:Color)?:\s*['"`]/;
    lines.forEach((l, i) => {
      // A background on the SAME line decides it (a fixed green chip is fine); only a line with no
      // background of its own is judged by its neighbours.
      const white = objWhite.test(l) && (objFill.test(l) || (!anyBg.test(l) && near(i, objFill)));
      if (white) out.push(`${f.path}:${i + 1} (white text on a theme fill)`);
      if (setFill.test(l) && near(i, setWhite)) out.push(`${f.path}:${i + 1} (hover paints white text on a theme fill)`);
    });
  }
  return out;
}

function codeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('dist')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) codeFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('text stays readable on every theme', () => {
  const read = (p: string) => ({ path: relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
  const files = [...cssFiles(join(ROOT, 'src')), ...cssFiles(join(ROOT, 'tracker', 'src'))].map(read);
  const code = [...codeFiles(join(ROOT, 'src')), ...codeFiles(join(ROOT, 'tracker', 'src'))].map(read);

  it('no white text on a theme fill, no fill ink defined as white, no text colour mixed toward white', () => {
    expect(unreadableRules(files)).toEqual([]);
  });

  it('no inline style or hover handler puts white text on a theme fill', () => {
    expect(unreadableInline(code)).toEqual([]);
  });

  it('catches the planted old tracker code', () => {
    const planted = [
      { path: 'a.tsx', text: "const s = {\n  background: 'var(--danger)', color: '#fff',\n};" },
      { path: 'b.tsx', text: "onMouseEnter={e => {\n  e.currentTarget.style.background = 'var(--danger)'\n  e.currentTarget.style.color = '#fff'\n}}" },
      { path: 'c.tsx', text: "const s = {\n  background: 'var(--app-bad)',\n  border: `1px solid ${edge}`,\n  color: '#fff',\n};" },
      { path: 'ok.tsx', text: "const s = { background: 'var(--danger)', color: 'var(--text-on-danger)' };\nconst t = { background: '#4a7a30', color: '#fff' };" },
    ];
    expect(unreadableInline(planted)).toEqual([
      'a.tsx:2 (white text on a theme fill)',
      'b.tsx:2 (hover paints white text on a theme fill)',
      'c.tsx:4 (white text on a theme fill)',
    ]);
    expect(unreadableRules([{ path: 'c.css', text: ':root {\n  --text-on-danger: #ffffff;\n}' }])).toEqual([
      'c.css: --text-on-danger (fill ink defined as white)',
    ]);
  });

  it('catches the planted old rules', () => {
    const planted = [
      { path: 'x.css', text: '.save-warning {\n  background: var(--app-bad);\n  color: #fff;\n}' },
      { path: 'y.css', text: '.inv-badge.invested {\n  color: color-mix(in srgb, var(--app-accent) 45%, white);\n}' },
      { path: 'ok.css', text: '.a { background: var(--app-bad); color: var(--app-bg); }\n.b { color: color-mix(in srgb, var(--app-accent) 45%, var(--app-text)); }' },
    ];
    expect(unreadableRules(planted)).toEqual([
      'x.css: .save-warning (white text on a theme fill)',
      'y.css: .inv-badge.invested (text mixed toward white)',
    ]);
  });
});
