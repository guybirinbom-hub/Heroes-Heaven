import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createRef, type CSSProperties } from 'react'
import { BodyPortal } from './BodyPortal'
import { HostThemeProvider } from '../data/hostThemeContext'

/*
 * THE ONE WAY THE TRACKER DRAWS ON <body> (the owner's 2026-10-01 list, item 1: "if i open a pop up in
 * the initiative tracker it needs to have the same colors as the initiative tracker").
 *
 * The row's right-click menu and every hover preview are portalled to <body>, outside the tracker's
 * themed root, and resolved the app's look from <html>. They now go through BodyPortal, which carries
 * `.tracker-root` and the host's tracker look. These legs keep it that way:
 *
 *  (a) STATIC: no other file under tracker/src calls createPortal — a new body surface cannot skip the
 *      class (it would draw transparent in the embed) or the look (it would draw in the app's colours).
 *      MUTATION: Tooltip back to `createPortal(popupEl, document.body)` → (a) red, naming Tooltip.tsx.
 *  (b) the root is a DIRECT child of <body>, exactly `tracker-root` (the host's Escape handling finds an
 *      open tracker popup as `body > .tracker-root:not(.campaign-tracker)`), and carries the host's
 *      variables before the surface's own style. MUTATIONS: `className="tracker-root"` dropped from
 *      BodyPortal → (b) red; the `vars` spread dropped → (b) red ("expected '' to be '#0a1b2c'").
 *  (c) standalone (no provider) it is exactly the surface's own style — nothing changes there.
 *
 * Every value here is synthetic.
 */

// The string form: jsdom replaces the global URL, and node's fileURLToPath refuses jsdom's URL object.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(t|j)sx?$/.test(name) ? [p] : []
  })
}

afterEach(() => {
  cleanup()
  for (const n of [...document.body.children]) n.remove()
})

describe('BodyPortal — the tracker’s one door to <body>', () => {
  it('(a) is the only createPortal under tracker/src', () => {
    const needle = 'createPortal' + '('
    const files = filesUnder(SRC)
    // Not vacuous: the walk reached the tracker's components, and BodyPortal itself holds the one call.
    expect(files.some((f) => f.endsWith(join('components', 'Tooltip.tsx')))).toBe(true)
    const own = readFileSync(join(SRC, 'components', 'BodyPortal.tsx'), 'utf8')
    expect(own.split(needle).length - 1, 'BodyPortal.tsx holds exactly one createPortal call').toBe(1)
    const elsewhere = files
      .filter((f) => !f.endsWith(join('components', 'BodyPortal.tsx')) && !f.endsWith(join('components', 'BodyPortal.test.tsx')))
      .filter((f) => readFileSync(f, 'utf8').includes(needle))
      .map((f) => relative(SRC, f))
    expect(elsewhere, 'draw on <body> through BodyPortal, never createPortal directly').toEqual([])
    // …and the two surfaces that need <body> do use it.
    for (const f of ['InitiativeTracker.tsx', 'Tooltip.tsx'])
      expect(readFileSync(join(SRC, 'components', f), 'utf8'), f).toContain('<BodyPortal')
  })

  it('(b) puts a `.tracker-root` straight on <body>, wearing the host’s tracker look', () => {
    const ref = createRef<HTMLDivElement>()
    const vars = { '--app-surface': '#0a1b2c', '--app-text': '#fedcba' } as unknown as CSSProperties
    render(
      <HostThemeProvider value={vars}>
        <BodyPortal ref={ref} style={{ position: 'fixed', left: 7, ['--tooltip-max-h' as string]: '120px' } as CSSProperties} data-probe="menu">
          <button>Rename</button>
        </BodyPortal>
      </HostThemeProvider>,
    )
    const root = document.querySelector<HTMLElement>('body > [data-probe="menu"]')
    expect(root, 'a direct child of <body>').not.toBeNull()
    expect(root!.className).toBe('tracker-root')
    expect(document.querySelector('body > .tracker-root:not(.campaign-tracker)')).toBe(root)
    expect(ref.current).toBe(root)
    expect(root!.style.getPropertyValue('--app-surface')).toBe('#0a1b2c')
    expect(root!.style.getPropertyValue('--app-text')).toBe('#fedcba')
    // The surface's own placement and paint survive the theme.
    expect(root!.style.left).toBe('7px')
    expect(root!.style.getPropertyValue('--tooltip-max-h')).toBe('120px')
    expect(root!.textContent).toBe('Rename')
  })

  it('(c) standalone, with no host, carries only the surface’s own style', () => {
    render(
      <BodyPortal style={{ position: 'fixed', top: 3 }} data-probe="tip">
        preview
      </BodyPortal>,
    )
    const root = document.querySelector<HTMLElement>('body > [data-probe="tip"]')!
    expect(root.className).toBe('tracker-root')
    expect(root.style.getPropertyValue('--app-surface')).toBe('')
    expect(root.style.top).toBe('3px')
    // A host that says "no tracker look" (null) is the same as no host.
    cleanup()
    render(
      <HostThemeProvider value={null}>
        <BodyPortal data-probe="tip2">preview</BodyPortal>
      </HostThemeProvider>,
    )
    expect(document.querySelector<HTMLElement>('body > [data-probe="tip2"]')!.getAttribute('style')).toBeNull()
  })
})
