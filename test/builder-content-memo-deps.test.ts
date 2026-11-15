import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * THE BUILDER'S BOOK FILTER FOLLOWS EVERY SWITCH IT READS (2026-10-23).
 *
 * `content` in src/builder/Builder.tsx is the database the pickers show: Sources, the Mythic / Kingmaker /
 * Deviant switches and "Hide legacy" filter it. Its useMemo read `build.deviantEnabled` but did not list it,
 * so flipping "Deviant abilities" changed nothing in the pickers until some other listed field changed —
 * the 30 deviant feats stayed hidden (or shown) against the switch. This reads the memo's body and its
 * dependency list and fails for any `build.<field>` the body reads that the list leaves out.
 *
 * MUTATION (run 2026-10-23): take `build.deviantEnabled` out of the list and this fails naming it.
 */
const src = readFileSync('src/builder/Builder.tsx', 'utf8');

function contentMemo(): { body: string; deps: string[] } {
  const start = src.indexOf('const content = useMemo(() => {');
  if (start < 0) throw new Error('fixture: the `content` memo moved — update this test');
  const close = src.indexOf('}, [', start);
  const end = src.indexOf(']);', close);
  const body = src
    .slice(start, close)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const deps = src
    .slice(close + 4, end)
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  return { body, deps };
}

describe('the Builder `content` memo lists every build field it reads', () => {
  it('each `build.<field>` in the body is a dependency', () => {
    const { body, deps } = contentMemo();
    const read = [...new Set([...body.matchAll(/\bbuild\.(\w+)/g)].map((m) => `build.${m[1]}`))];
    expect(read, 'fixture: the memo reads the switches').toContain('build.mythicEnabled');
    const missing = read.filter((f) => !deps.includes(f));
    expect(missing, 'read inside the memo but missing from its dependency list').toEqual([]);
    expect(deps).toContain('build.deviantEnabled');
  });
});
