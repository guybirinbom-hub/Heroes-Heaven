import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Package G, item 4 (2026-10-16): src/rules/sources.ts told the reader to "see companionSourceFilter()",
 * a function that existed nowhere in src/ — a comment pointing at code that was renamed or never written
 * sends the next reader on a search for nothing. Every `name()` a comment in these files cites must be a
 * name the code of src/ actually calls or defines.
 *
 * MUTATION LINE: put "see companionSourceFilter()" back into a comment in src/rules/sources.ts — red
 * (it is what the file said before this change; proven by running this test on that text).
 */
const FILES = ['src/rules/sources.ts', 'src/rules/companionGrants.ts', 'src/rules/companions.ts', 'src/sheet/CompanionsTab.tsx'];
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every identifier the CODE of src/ (comments stripped) calls or defines, i.e. written as `name(`. */
const codeNames = (() => {
  const names = new Set<string>();
  for (const f of walk('src')) {
    const code = readFileSync(f, 'utf8').replace(COMMENT, ' ');
    for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g)) names.add(m[1]);
  }
  return names;
})();

const citedIn = (text: string) => {
  const comments = (text.match(COMMENT) ?? []).join('\n');
  return [...new Set([...comments.matchAll(/\b([A-Za-z_$][\w$]*)\(\)/g)].map((m) => m[1]))];
};

describe('comments cite only functions that exist', () => {
  for (const file of FILES) {
    it(`${file}: every name() in a comment is called or defined somewhere in src/`, () => {
      const missing = citedIn(readFileSync(file, 'utf8')).filter((n) => !codeNames.has(n));
      expect(missing).toEqual([]);
    });
  }

  it('the check sees the stale name the old sources.ts comment cited', () => {
    const old = '/** … so see companionSourceFilter() — the Add-companion picker … */';
    expect(citedIn(old)).toEqual(['companionSourceFilter']);
    expect(codeNames.has('companionSourceFilter')).toBe(false);
    expect(codeNames.has('classOptionRecords')).toBe(true);
  });
});
