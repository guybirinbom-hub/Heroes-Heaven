import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * EVERY TRACKER MODAL CLOSES ON ESCAPE — AND THE LIST OF THE ONES THAT DON'T ONLY SHRINKS.
 *
 * Inside a campaign Heroes Heaven stands down for Escape while any tracker `.modal-overlay` is up
 * (src/integration/CampaignTracker.tsx, trackerModalOpen): a window hidden behind the modal must not
 * close, and the campaign must not be left. So a modal with no Escape of its own is Escape-DEAD there.
 * The Encounter Building tables, the table editor, its Link picker and the custom-condition editor were
 * (item 7; fixed with tracker/src/utils/spendEscape.ts useEscapeCloses). So was a party card's Link Stat
 * Block (MonsterSearch in pick mode: the G7e refuter's browser round, 2026-10-13, pressed Escape there and
 * the picker stayed, the press reaching `window` unspent), the Text Converter and its help box, and the
 * custom-condition Delete confirm — all closed by G7s (2026-10-13).
 *
 * This reads every component under tracker/src that draws a `.modal-overlay` and asks whether THAT
 * component closes it on Escape itself: the overlay carries the ref of a `useEscapeCloses` call made in
 * the same component, or the component listens for keydown, acts on 'Escape' AND SPENDS the press. The
 * host's dismiss stack does not count: the same component opens from places the host never registers
 * (MonsterSearch is the campaign's Add Combatants, which the host closes, AND a party card's Link Stat
 * Block, which it does not).
 * A listener that closes its modal and lets the press go on is no closer (G7s round 2, 2026-10-13): in
 * Heroes Heaven's Settings → Initiative tracker → Turn timer, the DM's turn-time graph (TurnTimeline)
 * closed on Escape, and the same press went on to the Settings page and closed it too; on the phone Back
 * closed the page with the graph still up. TurnTimeline and MonsterPartsPopup, counted as closers until
 * then, went on KNOWN_GAPS — the only entries ever added, by the stricter rule; their files were
 * outside the group that tightened it. Both close through useEscapeCloses since 2026-10-14 (owner's list,
 * item 2) and are off the list again, named in (d) with the closers.
 *
 *  (a) the scanner itself, on synthetic sources whose answer is known;
 *  (b) no NEW Escape-less modal: one added without an Escape fails here, named;
 *  (c) the known gaps are still gaps: give one its Escape and this fails until it leaves KNOWN_GAPS
 *      (the list only shrinks);
 *  (d) not vacuous: the scan reached the modals that do close (item 7's four and G7s's four).
 *
 * MUTATIONS (G7e browser round, 2026-10-13, each applied alone with Edit, run, read off that run, then
 * restored byte-exact):
 *  - EncounterTablesModal: `ref={escapeRef}` dropped from its overlay → (b) red naming
 *    "components/EncounterTablesModal.tsx :: EncounterTablesModal", (d) red.
 *  - openingTag: the brace depth ignored (the tag ends at the first `>`, the one in `=>`) → (a) red at
 *    "the ref after an arrow in the same tag".
 *  - a closer put on KNOWN_GAPS ("components/TurnTimeline.tsx :: TurnTimeline", when it still counted as
 *    one) → (c) red naming it.
 * MUTATIONS (G7s round 2, 2026-10-13, each applied alone with Edit, run, read off that run, then restored
 * byte-exact):
 *  - spendsOwnEscape: the spend asked of the listener dropped (any Escape listener counts, as before) →
 *    (a) red at "a listener that lets the press go on", (c) red naming TurnTimeline and MonsterPartsPopup.
 *  - spendsOwnEscape: the span cut at the listener's own `addEventListener(` dropped (a spend anywhere
 *    later in the component counts) → (a) red at "a spend elsewhere in the component".
 */

// The string form: jsdom replaces the global URL, and node's fileURLToPath refuses jsdom's URL object.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Where each known gap shows. Remove an entry when its modal gets an Escape of its own; never add one. */
const KNOWN_GAPS: Record<string, string> = {
  'App.tsx :: App': "the standalone app's Clear-the-tracker confirm (not drawn in Heroes Heaven)",
  'components/EncounterManager.tsx :: EncounterManager':
    "saved encounters (in a campaign the host's dismiss stack closes it; the standalone app has no Escape)",
  'components/SettingsModal.tsx :: SettingsModal': "the standalone app's Settings (not drawn in Heroes Heaven)",
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourcesUnder(p)
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [p] : []
  })
}

const OVERLAY = /className=(?:"|'|\{\s*['"`])[^"'`]*\bmodal-overlay\b/g
// A declaration at the start of a line: a top-level component (or helper) — bodies are indented.
const TOP_LEVEL = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)|let\s+(\w+)|class\s+(\w+))/gm

/** The JSX opening tag around `at`: from its `<` to the `>` that ends it outside every `{…}` (an
 *  `onClick={e => …}` holds a `>` of its own). */
function openingTag(src: string, at: number): string {
  const start = src.lastIndexOf('<', at)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

type Overlay = { component: string; closes: boolean }

/** Every `.modal-overlay` the source draws: the top-level component that draws it, and whether that
 *  component closes it on Escape itself. */
function overlaysIn(src: string): Overlay[] {
  const decls = [...src.matchAll(TOP_LEVEL)].map((m) => ({ at: m.index ?? 0, name: m[1] ?? m[2] ?? m[3] ?? m[4] }))
  return [...src.matchAll(OVERLAY)].map((m) => {
    const at = m.index ?? 0
    let d = -1
    for (let i = 0; i < decls.length; i++) if (decls[i].at < at) d = i
    const body = src.slice(d >= 0 ? decls[d].at : 0, d + 1 < decls.length ? decls[d + 1].at : src.length)
    const tag = openingTag(src, at)
    const hooked = [...body.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*useEscapeCloses\(/g)].some((h) =>
      new RegExp(`\\bref=\\{\\s*${h[1]}\\s*\\}`).test(tag),
    )
    return { component: d >= 0 ? decls[d].name : '(file)', closes: hooked || spendsOwnEscape(body) }
  })
}

/** The component listens for keydown and, where it acts on 'Escape', spends the press — asked of the
 *  listener's own text: from the 'Escape' it tests to the `addEventListener(` that adds it (or 400
 *  characters), so a stopPropagation elsewhere in the component (a click's) does not count. */
function spendsOwnEscape(body: string): boolean {
  if (!/addEventListener\(\s*['"]keydown['"]/.test(body)) return false
  if (/\bspendEscape\(/.test(body)) return true
  return [...body.matchAll(/['"]Escape['"]/g)].some((m) => {
    const from = m.index ?? 0
    const added = body.indexOf('addEventListener(', from)
    const to = added >= 0 ? Math.min(added, from + 400) : from + 400
    return /\b(?:stopPropagation|stopImmediatePropagation)\(/.test(body.slice(from, to))
  })
}

function scanTracker(): { overlays: number; closers: Set<string>; gaps: Set<string> } {
  const closers = new Set<string>()
  const gaps = new Set<string>()
  let overlays = 0
  for (const f of sourcesUnder(SRC)) {
    const file = relative(SRC, f).replace(/\\/g, '/')
    for (const o of overlaysIn(readFileSync(f, 'utf8'))) {
      overlays++
      ;(o.closes ? closers : gaps).add(`${file} :: ${o.component}`)
    }
  }
  return { overlays, closers, gaps }
}

describe('every tracker modal closes on Escape (the known gaps only shrink)', () => {
  it('(a) the scanner: a hooked overlay closes, an unhooked one does not, a keydown listener counts', () => {
    const hooked = [
      'export function Alpha({ onClose }: P) {',
      '  const escapeRef = useEscapeCloses(onClose)',
      '  return <div className="modal-overlay" ref={escapeRef}><div className="modal-box" /></div>',
      '}',
    ].join('\n')
    expect(overlaysIn(hooked), 'the ref on the overlay').toEqual([{ component: 'Alpha', closes: true }])

    const afterArrow = [
      'export function Beta({ onClose }: P) {',
      '  const r = useEscapeCloses(onClose)',
      '  return (',
      '    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()} ref={r}>',
      '      <div className="modal-box" />',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expect(overlaysIn(afterArrow), 'the ref after an arrow in the same tag').toEqual([{ component: 'Beta', closes: true }])

    const refElsewhere = [
      'export function Gamma({ onClose }: P) {',
      '  const r = useEscapeCloses(onClose)',
      '  return <div className="modal-overlay"><div className="modal-box" ref={r} /></div>',
      '}',
    ].join('\n')
    expect(overlaysIn(refElsewhere), 'the ref on another element: the hook never knows the modal').toEqual([
      { component: 'Gamma', closes: false },
    ])

    const listener = [
      'export function Delta({ onClose }: P) {',
      '  useEffect(() => {',
      "    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }",
      "    document.addEventListener('keydown', onKey)",
      "    return () => document.removeEventListener('keydown', onKey)",
      '  }, [onClose])',
      '  return <div className="modal-overlay" />',
      '}',
    ].join('\n')
    expect(overlaysIn(listener), 'its own keydown listener, which spends the press').toEqual([{ component: 'Delta', closes: true }])

    const enterOnly = listener.replace(/Delta/g, 'Epsilon').replace("'Escape'", "'Enter'")
    expect(overlaysIn(enterOnly), 'a listener for another key').toEqual([{ component: 'Epsilon', closes: false }])

    // Closes, and lets the press go on to the page under it (TurnTimeline's way): no closer.
    const unspent = listener.replace(/Delta/g, 'Eta').replace('e.stopPropagation(); ', '')
    expect(overlaysIn(unspent), 'a listener that lets the press go on').toEqual([{ component: 'Eta', closes: false }])
    // …even with a stopPropagation elsewhere in the component, a click's.
    const clickSpend = unspent
      .replace(/Eta/g, 'Theta')
      .replace('<div className="modal-overlay" />', '<div className="modal-overlay"><div className="modal-box" onClick={e => e.stopPropagation()} /></div>')
    expect(overlaysIn(clickSpend), 'a spend elsewhere in the component').toEqual([{ component: 'Theta', closes: false }])
    // spendEscape in the listener spends it.
    const viaHelper = unspent.replace(/Eta/g, 'Iota').replace("if (e.key === 'Escape') { onClose() }", 'spendEscape(e, onClose)')
    expect(viaHelper, 'fixture: the helper in the listener').toContain('spendEscape(e, onClose)')
    expect(overlaysIn(viaHelper), 'spendEscape in its listener').toEqual([{ component: 'Iota', closes: true }])

    // Two components in one file: each answers for its own overlay; a class list and a helper between.
    const twoInOne = [
      hooked,
      'const helper = (n: number) => n + 1',
      'function Zeta({ onClose }: P) {',
      "  return <div className={'modal-overlay wide'} onClick={onClose} />",
      '}',
    ].join('\n')
    expect(overlaysIn(twoInOne), 'two components, one file').toEqual([
      { component: 'Alpha', closes: true },
      { component: 'Zeta', closes: false },
    ])
  })

  it('(b) no tracker modal is added without an Escape of its own', () => {
    const { gaps } = scanTracker()
    const fresh = [...gaps].filter((k) => !(k in KNOWN_GAPS)).sort()
    expect(
      fresh,
      'a tracker modal with no Escape: inside a campaign Escape does NOTHING there (the host stands down ' +
        'for every `.modal-overlay`). Give it `const r = useEscapeCloses(onClose)` (utils/spendEscape) with ' +
        '`ref={r}` on its `.modal-overlay`',
    ).toEqual([])
  })

  it('(c) a known gap given its Escape leaves KNOWN_GAPS', () => {
    const { gaps } = scanTracker()
    const closedNow = Object.keys(KNOWN_GAPS).filter((k) => !gaps.has(k)).sort()
    expect(closedNow, 'these now close on Escape (or are gone): take them off KNOWN_GAPS').toEqual([])
  })

  it('(d) the scan reached the modals that do close', () => {
    const { overlays, closers } = scanTracker()
    expect(overlays, 'overlays found under tracker/src').toBeGreaterThanOrEqual(10)
    for (const k of [
      'components/EncounterTablesModal.tsx :: EncounterTablesModal',
      'components/EncounterTableEditor.tsx :: EncounterTableEditor',
      'components/CreaturePickerModal.tsx :: CreaturePickerModal',
      'components/AdvancedConditionEditor.tsx :: AdvancedConditionEditor',
      // G7s (2026-10-13): the last four gaps a GM meets inside Heroes Heaven. (MonsterPartsPopup and
      // TurnTimeline, once listed here as closers, let the press go on: KNOWN_GAPS from G7s round 2 until
      // 2026-10-14, when both took useEscapeCloses — below.)
      'components/MonsterSearch.tsx :: MonsterSearch',
      'components/TextConverter.tsx :: TextConverter',
      'components/TextConverter.tsx :: TextConverterHelpModal',
      'components/SettingsModal.tsx :: ConditionDeleteConfirm',
      'components/TurnTimeline.tsx :: TurnTimeline',
      'components/MonsterPartsPopup.tsx :: MonsterPartsPopup',
    ])
      expect(closers.has(k), k).toBe(true)
  })
})
