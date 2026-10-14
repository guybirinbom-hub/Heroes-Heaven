import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/*
 * bug 2026-10-14 (the owner's screenshot): the "Missing data" box on the Feats tab was unreadable — a
 * cream panel with the theme's light text on it. Cause: its style read `var(--warn)` and
 * `var(--card-bg, #fff)`, names this app never defines, so the browser used the light-theme fallback on
 * every theme. The class-archetype box beside it had the identical bug and was fixed alone on
 * 2026-09-02; 60 more uses of 20 made-up names were still in the styles.
 *
 * The rule this guards: every `var(--name)` a style or inline style reads must be a name the SAME app
 * defines somewhere (tokens.css, themes.ts, the theme manager, a CSS rule, an inline style object).
 * A fallback colour is not a theme colour — it is one theme's guess, wrong on the others.
 */

const ROOT = join(__dirname, '..');

type File = { path: string; text: string };

function walk(dir: string, out: File[] = []): File[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('dist')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx)$/.test(name)) out.push({ path: relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
  }
  return out;
}

/** Custom properties a file DEFINES: `--x:` in CSS, or a quoted '--x' in code (style objects,
 *  setProperty, the theme token tables). */
function definedIn(files: File[]): Set<string> {
  const defs = new Set<string>();
  for (const f of files) {
    for (const m of f.text.matchAll(/(--[\w-]+)\s*:/g)) defs.add(m[1]);
    if (!f.path.endsWith('.css')) for (const m of f.text.matchAll(/['"`](--[\w-]+)['"`]/g)) defs.add(m[1]);
  }
  return defs;
}

/** Every `var(--x…)` read whose name is not in `defs`, as "file:line --x". A stylesheet nothing
 *  imports never reaches a screen, so it is skipped rather than "fixed". */
export function undefinedVarUses(files: File[], defs: Set<string>, importers: File[]): string[] {
  const imported = (f: File) =>
    !f.path.endsWith('.css') || importers.some((g) => g !== f && g.text.includes(basename(f.path)));
  const out: string[] = [];
  for (const f of files) {
    if (!imported(f)) continue;
    f.text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) if (!defs.has(m[1])) out.push(`${f.path}:${i + 1} ${m[1]}`);
    });
  }
  return out;
}

const app = walk(join(ROOT, 'src'));
const tracker = walk(join(ROOT, 'tracker', 'src'));
const theme = app.filter((f) => f.path.startsWith('src/theme/'));
const everything = [...app, ...tracker];

describe('every colour/size name a style reads is one the app defines', () => {
  it('the main app (src/) reads only names src/ defines', () => {
    // The tracker's dictionary (tracker/src/hh-compat.css) is NOT counted here: it only loads with the
    // tracker, so `--accent` or `--text` on the character sheet fell back to a fixed colour.
    expect(undefinedVarUses(app, definedIn(app), everything)).toEqual([]);
  });

  it('the tracker (tracker/src/) reads only names it or the theme tokens define', () => {
    expect(undefinedVarUses(tracker, definedIn([...tracker, ...theme]), everything)).toEqual([]);
  });

  it('catches a planted bad case: an undefined name, with or without a fallback', () => {
    const planted: File[] = [
      { path: 'src/x.css', text: '.a { color: var(--app-text); }\n.b { background: color-mix(in srgb, var(--warn, #b8862e) 12%, var(--card-bg, #fff)); }' },
      { path: 'src/y.tsx', text: "const s = { color: 'var(--app-danger, #ef4444)' };" },
    ];
    const importer: File = { path: 'src/main.tsx', text: "import './x.css';" };
    expect(undefinedVarUses(planted, definedIn(theme), [importer, ...planted])).toEqual([
      'src/x.css:2 --warn',
      'src/x.css:2 --card-bg',
      'src/y.tsx:1 --app-danger',
    ]);
  });

  it('the theme really defines the names the fixes moved to', () => {
    const defs = definedIn(theme);
    for (const n of ['--app-text', '--app-text-dim', '--app-surface', '--app-surface-2', '--app-border', '--app-accent', '--app-accent-text', '--app-warn', '--app-bad', '--app-good', '--app-bg'])
      expect(defs.has(n), n).toBe(true);
  });
});
