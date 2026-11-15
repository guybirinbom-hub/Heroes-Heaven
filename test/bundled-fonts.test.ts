import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontList } from '../src/theme/fonts';

/**
 * 2026-10-24: the Font picker's free families are shipped with the app (Fontsource, latin + latin-ext)
 * so a chosen font looks the same on every device and offline. Two ways that silently breaks:
 *  - a stack leads with a free family nobody bundled (it shows only where the device happens to have
 *    it installed — the state before this change), or a bundled face points at a file that is gone;
 *  - a bundled family sits behind a system font, so devices that have that system font show it and
 *    the rest show the bundled one — "the same font everywhere" is lost again.
 * This holds src/theme/fonts.ts, src/theme/bundled-fonts.css and src/main.tsx together.
 */

const ROOT = path.join(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

/**
 * Families that are free on Fontsource (checked with npm view, 2026-10-24). A stack that LEADS with one
 * of these must find it bundled. Plain names are listed too: leading with 'Inter' instead of the
 * declared 'Inter Variable' would miss the bundled face.
 */
const FREE_ON_FONTSOURCE = new Set(
  [
    'Inter', 'Inter Variable', 'Quicksand', 'Quicksand Variable', 'Roboto Slab', 'Roboto Slab Variable',
    'Roboto Mono', 'Roboto Mono Variable', 'Cascadia Code', 'Cascadia Code Variable',
    'Atkinson Hyperlegible', 'OpenDyslexic', 'Comic Neue', 'Roboto',
  ].map((s) => s.toLowerCase()),
);

/**
 * Families a stack may LEAD with although they are not bundled: Apple/paid/system faces kept system-only
 * on purpose (not free on Fontsource; substituting them is a later design decision). Anything else
 * leading a stack must be bundled — so a new font added in the redesign ('Lexend', 'Lato'...) fails
 * here until it is either bundled or deliberately listed.
 */
const SYSTEM_ONLY_ON_PURPOSE = new Set(['Optima', 'Georgia', 'Iowan Old Style'].map((s) => s.toLowerCase()));
const GENERIC = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded']);

export function familiesOf(stack: string): string[] {
  return stack.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
}

/** family (lower-case) → every url() its @font-face rules name. */
export function bundledFaces(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const fam = block.match(/font-family:\s*['"]([^'"]+)['"]/)?.[1];
    if (!fam) continue;
    const urls = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    out.set(fam.toLowerCase(), [...(out.get(fam.toLowerCase()) ?? []), ...urls]);
  }
  return out;
}

/** Every problem with a stack list against a bundled-font stylesheet. Empty = fine. */
export function stackProblems(stacks: { id: string; stack: string }[], css: string): string[] {
  const faces = bundledFaces(css);
  const problems: string[] = [];
  for (const { id, stack } of stacks) {
    const fams = familiesOf(stack);
    const first = fams[0].toLowerCase();
    if (FREE_ON_FONTSOURCE.has(first) && !faces.has(first)) {
      problems.push(`${id}: leads with free family '${fams[0]}' but bundled-fonts.css declares no @font-face for it`);
    } else if (!faces.has(first) && !GENERIC.has(first) && !SYSTEM_ONLY_ON_PURPOSE.has(first)) {
      problems.push(`${id}: leads with '${fams[0]}', which is neither bundled nor listed as system-only on purpose`);
    }
    fams.forEach((f, i) => {
      if (i > 0 && faces.has(f.toLowerCase())) {
        problems.push(`${id}: bundled family '${f}' is at position ${i + 1}, not first`);
      }
    });
  }
  return problems;
}

/**
 * 2026-10-24: real italics. Every upright face whose package ALSO ships the matching italic file
 * (same name with -normal → -italic) must have that italic file declared in an @font-face with
 * font-style: italic; and every italic url must sit in an italic block. Otherwise italic rules text is
 * a browser-slanted fake. `exists` is injected so the mutation test can plant a missing file in memory.
 */
export function italicProblems(css: string, exists: (rel: string) => boolean): string[] {
  const problems: string[] = [];
  const upright: string[] = [];
  const italic = new Set<string>();
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const style = block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal';
    for (const m of block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const u = m[1];
      if (style === 'italic') {
        if (!/-italic\.woff2$/.test(u)) problems.push(`${u}: declared as font-style: italic but is not an italic file`);
        if (!exists(u)) problems.push(`${u}: italic file is missing`);
        italic.add(u);
      } else {
        if (/-italic\.woff2$/.test(u)) problems.push(`${u}: italic file declared with font-style: ${style}`);
        upright.push(u);
      }
    }
  }
  for (const u of upright) {
    const it = u.replace(/-normal\.woff2$/, '-italic.woff2');
    if (it !== u && exists(it) && !italic.has(it)) problems.push(`${u}: the package ships ${it}, but no italic @font-face declares it`);
  }
  return problems;
}

describe('bundled fonts', () => {
  const css = read('src/theme/bundled-fonts.css');
  const stacks = fontList.map((f) => ({ id: f.id, stack: f.stack }));

  it('main.tsx imports the bundled-font stylesheet', () => {
    expect(read('src/main.tsx')).toMatch(/^import '\.\/theme\/bundled-fonts\.css';/m);
  });

  it('the standalone tracker (which shows the same fontList) imports it too', () => {
    expect(read('tracker/src/main.tsx')).toMatch(/^import '@hh\/theme\/bundled-fonts\.css'/m);
  });

  it('every bundled @font-face names a woff2 file that exists in node_modules', () => {
    const faces = bundledFaces(css);
    expect(faces.size).toBeGreaterThan(0);
    for (const [fam, urls] of faces) {
      expect(urls.length, fam).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u, `${fam}: ${u}`).toMatch(/^@fontsource(-variable)?\/[^/]+\/files\/[^/]+\.woff2$/);
        expect(existsSync(path.join(ROOT, 'node_modules', u)), `${fam}: missing ${u}`).toBe(true);
      }
    }
  });

  it('every bundled family is used, and leads its stack; no stack leads with an unbundled free family', () => {
    expect(stackProblems(stacks, css)).toEqual([]);
    const leading = new Set(stacks.map((s) => familiesOf(s.stack)[0].toLowerCase()));
    for (const fam of bundledFaces(css).keys()) expect(leading.has(fam), `${fam} bundled but leads no stack`).toBe(true);
  });

  const inNodeModules = (rel: string) => existsSync(path.join(ROOT, 'node_modules', rel));

  it('every family whose package has italic files ships a real italic face for each upright file', () => {
    expect(italicProblems(css, inNodeModules)).toEqual([]);
    // The four families with italic designs, one italic face per upright face (Quicksand and Roboto
    // Slab have no italic design — their packages hold no italic files).
    const italicCount = (fam: string) =>
      (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).filter(
        (b) => b.includes(`font-family: '${fam}'`) && /font-style:\s*italic/.test(b),
      ).length;
    expect({
      inter: italicCount('Inter Variable'),
      cascadia: italicCount('Cascadia Code Variable'),
      atkinson: italicCount('Atkinson Hyperlegible'),
      dyslexic: italicCount('OpenDyslexic'),
      quicksand: italicCount('Quicksand Variable'),
      slab: italicCount('Roboto Slab Variable'),
    }).toEqual({ inter: 2, cascadia: 2, atkinson: 4, dyslexic: 2, quicksand: 0, slab: 0 });
  });

  // mutation-proof: the italic check goes red on a broken copy (in memory; the real files are untouched).
  it('goes red when an italic file is missing or an italic face is dropped', () => {
    const gone = 'opendyslexic-latin-700-italic.woff2';
    expect(italicProblems(css, (rel) => !rel.endsWith(gone) && inNodeModules(rel))).toEqual([
      `@fontsource/opendyslexic/files/${gone}: italic file is missing`,
    ]);
    const dropped = css.replace(
      /@font-face\s*\{[^}]*inter-latin-wght-italic\.woff2[^}]*\}/,
      '',
    );
    expect(italicProblems(dropped, inNodeModules)).toEqual([
      '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2: the package ships @fontsource-variable/inter/files/inter-latin-wght-italic.woff2, but no italic @font-face declares it',
    ]);
  });

  // mutation-proof: the check above goes red on a broken copy (in memory; the real files are untouched).
  it('goes red when a bundled family is moved behind a system font, or a free leader is unbundled', () => {
    const moved = stacks.map((s) =>
      s.id === 'slab' ? { ...s, stack: "Rockwell, 'Roboto Slab Variable', Georgia, serif" } : s,
    );
    expect(stackProblems(moved, css)).toEqual([
      "slab: leads with 'Rockwell', which is neither bundled nor listed as system-only on purpose",
      "slab: bundled family 'Roboto Slab Variable' is at position 2, not first",
    ]);
    const unbundled = css.replace(/font-family: 'Inter Variable'/g, "font-family: 'Not Inter'");
    expect(stackProblems(stacks, unbundled)).toEqual([
      "grotesque: leads with free family 'Inter Variable' but bundled-fonts.css declares no @font-face for it",
    ]);
    const newFont = stacks.map((s) => (s.id === 'humanist' ? { ...s, stack: "'Lexend', Optima, sans-serif" } : s));
    expect(stackProblems(newFont, css)).toEqual([
      "humanist: leads with 'Lexend', which is neither bundled nor listed as system-only on purpose",
    ]);
  });
});
