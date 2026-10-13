import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * THE TESTS THE WINDOW MODULES NAME ARE REAL FILES. The floating windows' code points its reader at the
 * test that pins each decision ("…read once when the drag starts (dockDragStore.zoom.test.ts)"). Item 7's
 * refuter (round 3) found that one naming a file that does not exist — the test is `.tsx` — so a reader
 * following it found nothing. A name in a comment is only a pointer if it resolves.
 *
 * MUTATION (applied, run, read off that run, then restored): dockDragStore.ts's
 * `dockDragStore.zoom.test.tsx` → `dockDragStore.zoom.test.ts` → red ("names a test that does not exist").
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(SRC, '..', '..')
const MODULES = ['store/windowStore.ts', 'store/dockDragStore.ts', 'components/FloatingWindow.tsx']

function testFiles(dir: string, out = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'node_modules') testFiles(path.join(dir, e.name), out) }
    else if (/\.test\.tsx?$/.test(e.name)) out.add(e.name)
  }
  return out
}

describe('the window modules point at tests that exist', () => {
  it('every *.test.ts(x) named in windowStore, dockDragStore and FloatingWindow is a real file', () => {
    const real = testFiles(SRC, testFiles(path.join(REPO, 'test')))
    let named = 0
    for (const m of MODULES) {
      const text = readFileSync(path.join(SRC, m), 'utf8')
      for (const hit of text.matchAll(/[\w.-]+\.test\.tsx?\b/g)) {
        named++
        expect(real.has(path.basename(hit[0])), `${m} names a test that does not exist: ${hit[0]}`).toBe(true)
      }
    }
    // Not vacuous: the three modules name their tests.
    expect(named).toBeGreaterThanOrEqual(4)
  })
})
