import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { EncounterManager } from './EncounterManager'
import { EncounterTablesSection } from './SettingsModal'
import { HostSaveProvider, type HostSave, type HostSaveFile } from '../data/hostSaveContext'
import { invalidateEncounterCache, writeEncounterStore } from '../store/combatStore'
import { useEncounterTablesStore, type EncounterTable } from '../store/encounterTablesStore'
import type { SavedEncounter } from '../types/pf2e'

/*
 * THE TRACKER'S OWN EXPORTS GO THROUGH THE HOST (item 8, the Android half: "on android have both
 * options"). The Encounter Manager's saved encounters and Settings → Encounter Tables' Export downloaded
 * through a bare object-URL anchor, which the Android app's WebView ignores: on the phone they saved
 * nothing. Inside Heroes Heaven a HostSaveProvider now hands them the app's export (Save to folder /
 * Share on the phone); standalone (no provider) the anchor runs as before.
 *
 *  (a) with a host, each export site hands the host the SAME file name and text it always wrote, with
 *      the JSON type, and no anchor fires;
 *  (b) without one, the anchor saves that same file — attached to the document while it is clicked, its
 *      URL revoked a second later, never in the same tick (the encounter-table export used to click a
 *      detached anchor and revoke at once);
 *  (c) a Cancel at the host says nothing; a refused name (thrown) or a failed save (rejected) says why;
 *  (d) STATIC: no other file under tracker/src hands the browser a file (an object URL, a `download`
 *      name or attribute, a `data:` URL, a native save or share), so a new export cannot skip the host.
 *
 * The expected texts are written out by hand from the pre-change code (encounterTransfer toPortable's
 * field order, `JSON.stringify(t, null, 2)` for a table), so "byte-identical to before" is checked
 * against the old format, not against the new code. Every name here is synthetic.
 *
 * MUTATIONS (each applied, run, read off that run, then restored) — see the leg comments.
 */

const NOW = '2026-10-13T12:34:56.000Z'
const DAY = '2026-10-13'

const AMBUSH: SavedEncounter = {
  name: 'Ambush at the Ford',
  savedAt: '2026-10-01T09:00:00.000Z',
  combatants: [
    { name: 'Mud Lurker', creature: null, creatureId: null, isPC: false, isAlly: false, maxHP: 34, isElite: true, isWeak: false, notes: 'hides under the reeds' },
    { name: 'Synthetic Wren', creature: null, creatureId: null, isPC: true, partyMemberId: 'pm-1', maxHP: 22, isElite: false, isWeak: false, notes: '' },
  ],
}
const TOLL: SavedEncounter = {
  name: 'Bridge Toll',
  savedAt: '2026-10-02T18:30:00.000Z',
  combatants: [
    { name: 'Toll Troll', creature: null, creatureId: null, isPC: false, isAlly: true, downsLikePC: true, maxHP: 60, isElite: false, isWeak: true, scaledToLevel: 3, notes: 'wants 2 sp' },
  ],
}
/** The portable rows the old toPortable wrote, in its field order. */
const AMBUSH_FILE = {
  name: 'Ambush at the Ford',
  savedAt: '2026-10-01T09:00:00.000Z',
  combatants: [
    { name: 'Mud Lurker', creatureName: null, creatureSource: null, isPC: false, isAlly: false, maxHP: 34, isElite: true, isWeak: false, scaledToLevel: null, notes: 'hides under the reeds' },
    { name: 'Synthetic Wren', creatureName: null, creatureSource: null, isPC: true, isAlly: false, partyMemberId: 'pm-1', maxHP: 22, isElite: false, isWeak: false, scaledToLevel: null, notes: '' },
  ],
}
const TOLL_FILE = {
  name: 'Bridge Toll',
  savedAt: '2026-10-02T18:30:00.000Z',
  combatants: [
    { name: 'Toll Troll', creatureName: null, creatureSource: null, isPC: false, isAlly: true, downsLikePC: true, maxHP: 60, isElite: false, isWeak: true, scaledToLevel: 3, notes: 'wants 2 sp' },
  ],
}
const encounterText = (...encounters: unknown[]) => JSON.stringify({ version: 1, exportedAt: NOW, encounters }, null, 2)
const ONE: HostSaveFile = { filename: `pf2e-encounter-Ambush_at_the_Ford-${DAY}.json`, text: encounterText(AMBUSH_FILE), mime: 'application/json' }
const BOTH: HostSaveFile = { filename: `pf2e-encounters-${DAY}.json`, text: encounterText(AMBUSH_FILE, TOLL_FILE), mime: 'application/json' }

const TABLE: EncounterTable = {
  id: 'table-syn-1',
  name: 'Goblin Warrens: Deep (L3)',
  dc: 14,
  note: 'Synthetic note.',
  creatures: [{ id: 'e-1', label: '1d4 cave goblins', weight: 3, creature: { name: 'Cave Goblin', level: 1 } }],
  hazards: [{ id: 'e-2', label: 'Loose rubble', weight: 1 }],
}
/** The old exportTable's name for it: `[^\w -]` stripped, trimmed, spaces to '-'. */
const TABLE_FILE: HostSaveFile = { filename: 'Goblin-Warrens-Deep-L3.json', text: JSON.stringify(TABLE, null, 2), mime: 'application/json' }

const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
/** Every anchor click: its name, its address, and whether it was in the document when clicked. */
let clicks: { download: string; href: string; attached: boolean }[]
let blobs: Blob[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  localStorage.clear()
  invalidateEncounterCache()
  writeEncounterStore({ [AMBUSH.name]: AMBUSH, [TOLL.name]: TOLL })
  useEncounterTablesStore.setState({ tables: [TABLE] })
  clicks = []
  blobs = []
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b)
    return `blob:tracker-test-${blobs.length}`
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ download: this.download, href: this.getAttribute('href') ?? '', attached: this.isConnected })
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  localStorage.clear()
  invalidateEncounterCache()
  useEncounterTablesStore.setState({ tables: [] })
})

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (match: (b: HTMLButtonElement) => boolean, what: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(match)
  expect(b, `no ${what} button`).toBeTruthy()
  return b!
}
const readBlob = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(r.error)
  r.readAsText(b)
})

/** Encounter Manager → Export → (Bridge Toll left out unless `both`) → Export (n). */
async function exportEncounters(both: boolean) {
  fireEvent.click(button(b => b.title === 'Choose encounters to export to a JSON file', 'Export'))
  if (!both) fireEvent.click([...document.querySelectorAll('span')].find(s => s.textContent === TOLL.name)!)
  fireEvent.click(button(b => /^Export \(\d+\)$/.test((b.textContent ?? '').trim()), 'Export (n)'))
  await flush()
}
const exportTable = async () => {
  fireEvent.click(button(b => b.title === 'Export this table to a JSON file', 'table Export'))
  await flush()
}

describe('(a) with a host, both exports hand it the file they always wrote', () => {
  // MUTATION (tried 2026-10-13): saveTextFile's `if (hostSave) { … }` dropped → both legs red
  // ("expected "vi.fn()" to be called 1 times, but got 0 times": the anchor fires instead), and the three
  // (c) legs with them. The old downloadEncounters / exportTable bodies put back → both red the same way.
  it('Encounter Manager: one encounter, then two — the old names and the old text, typed JSON; no anchor', async () => {
    const host = vi.fn<HostSave>(async () => 'saved')
    render(<HostSaveProvider value={host}><EncounterManager onClose={() => undefined} /></HostSaveProvider>)
    await exportEncounters(false)
    expect(host).toHaveBeenCalledTimes(1)
    expect(host.mock.calls[0][0]).toEqual(ONE)
    expect(host.mock.calls[0][0].text).toBe(ONE.text)
    expect(document.body.textContent).toContain('Exported 1 encounter')

    await exportEncounters(true)
    expect(host).toHaveBeenCalledTimes(2)
    expect(host.mock.calls[1][0]).toEqual(BOTH)
    expect(document.body.textContent).toContain('Exported 2 encounters')
    expect(clicks).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('Encounter tables: the old name and the old text, typed JSON; no anchor', async () => {
    const host = vi.fn<HostSave>(async () => 'shared')
    render(<HostSaveProvider value={host}><EncounterTablesSection /></HostSaveProvider>)
    await exportTable()
    expect(host).toHaveBeenCalledTimes(1)
    expect(host.mock.calls[0][0]).toEqual(TABLE_FILE)
    expect(clicks).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('(b) standalone, the anchor saves the same file — attached while clicked, revoked a second later', () => {
  async function expectAnchorSaved(want: HostSaveFile) {
    expect(clicks.map(c => c.download)).toEqual([want.filename])
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe(want.mime)
    expect(await readBlob(blobs[0])).toBe(want.text)
    expect(clicks[0].href).toBe('blob:tracker-test-1')
    expect(clicks[0].attached, 'the anchor was not in the document when clicked').toBe(true)
    expect(document.querySelector('a[download]'), 'the anchor was left in the document').toBeNull()
    expect(URL.revokeObjectURL, 'the URL was revoked in the same tick as the click').not.toHaveBeenCalled()
    await act(async () => { await new Promise(r => setTimeout(r, 1050)) })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tracker-test-1')
  }

  it('Encounter Manager, no provider: the old file through the anchor', async () => {
    render(<EncounterManager onClose={() => undefined} />)
    await exportEncounters(false)
    await expectAnchorSaved(ONE)
    expect(document.body.textContent).toContain('Exported 1 encounter')
  })

  // MUTATIONS (tried 2026-10-13): the old exportTable body put back (a detached anchor, revoked at once)
  // → red at "the anchor was not in the document when clicked", AFTER the name, type and text matched —
  // the expected file is the old one (and the old downloadEncounters body put back keeps the leg above
  // GREEN: its expected file is byte for byte what the old code wrote); saveTextFile's
  // `document.body.appendChild(a)` / `removeChild(a)` pair dropped (a detached anchor) → both (b) legs red
  // at "not in the document"; its `setTimeout(() => URL.revokeObjectURL(url), 1000)` made a plain
  // `URL.revokeObjectURL(url)` → both red at "revoked in the same tick".
  it('Encounter tables, no provider: the old file through the anchor', async () => {
    render(<EncounterTablesSection />)
    await exportTable()
    await expectAnchorSaved(TABLE_FILE)
  })
})

describe('(c) what the GM is told', () => {
  it('a Cancel at the host says nothing, at either export', async () => {
    const host = vi.fn<HostSave>(async () => 'cancelled')
    render(<HostSaveProvider value={host}><EncounterManager onClose={() => undefined} /><EncounterTablesSection /></HostSaveProvider>)
    await exportEncounters(false)
    await exportTable()
    expect(host).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toMatch(/Exported|Shared|Export failed/)
  })

  // MUTATION (tried 2026-10-13): saveTextFile's try/catch round `hostSave(file)` dropped → red: the
  // synchronous throw escapes the click handler, no "Export failed" line is drawn, and vitest reports
  // the unhandled error.
  it('a refused name (thrown at once) and a failed save (rejected) say "Export failed" with the reason', async () => {
    const thrown = vi.fn<HostSave>(() => { throw new Error('"x" is not a file name, so nothing was saved.') })
    const { unmount } = render(<HostSaveProvider value={thrown}><EncounterManager onClose={() => undefined} /></HostSaveProvider>)
    await exportEncounters(false)
    expect(document.body.textContent).toContain('Export failed: "x" is not a file name, so nothing was saved.')
    unmount()

    const rejected = vi.fn<HostSave>(async () => { throw new Error('No space left on the device.') })
    render(<HostSaveProvider value={rejected}><EncounterTablesSection /></HostSaveProvider>)
    await exportTable()
    expect(document.body.textContent).toContain('Export failed: No space left on the device.')
    expect(clicks).toEqual([])
  })

  it('a share says "Shared" in the Encounter Manager', async () => {
    const host = vi.fn<HostSave>(async () => 'shared')
    render(<HostSaveProvider value={host}><EncounterManager onClose={() => undefined} /></HostSaveProvider>)
    await exportEncounters(true)
    expect(document.body.textContent).toContain('Shared 2 encounters')
  })
})

// The string form: jsdom replaces the global URL, and node's fileURLToPath refuses jsdom's URL object.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(t|j)sx?$/.test(name) && !/\.test\.(t|j)sx?$/.test(name) ? [p] : []
  })
}

/*
 * Every way a page can hand the browser a file without the host: each of these skips the Android app's
 * chooser exactly as the old anchors did. The refuter (2026-10-13) showed the first version of this guard
 * matched only the literal text `createObjectURL(` — a `data:` URL, a `download` attribute set another
 * way, or `URL.createObjectURL (blob)` with a space walked past it.
 */
const FILE_ROUTES: { what: string; re: RegExp }[] = [
  { what: 'an object URL', re: /createObjectURL\s*\(/ },
  { what: 'an anchor download name', re: /\.download\s*=(?!=)/ },
  { what: 'a download attribute', re: /setAttribute\(\s*['"`]download['"`]/ },
  { what: 'a download attribute in JSX', re: /<a\b[^<]*?\sdownload(?=[\s=/>])/ },
  { what: 'a data: URL', re: /['"`]data:[a-z]+\/[-\w.+]+[;,]/i },
  { what: 'a native save or share', re: /\b(?:showSaveFilePicker|msSaveOrOpenBlob|msSaveBlob)\b|navigator\.share\s*\(/ },
]
const fileRoutesIn = (src: string) => FILE_ROUTES.filter(r => r.re.test(src)).map(r => r.what)

describe('(d) STATIC: the tracker hands the browser a file in one place', () => {
  // Checked against hand-written evasions, not against itself: each line is a way to save a file that the
  // first guard missed or that a new export could plausibly use.
  // MUTATIONS (tried 2026-10-13): the object-URL pattern put back to the first guard's literal
  // `createObjectURL(` → red ("const u = URL.createObjectURL (new Blob([t])): expected [] to include 'an
  // object URL'"); a probe file under tracker/src/utils saving through a data: URL, setAttribute('download')
  // and a spaced createObjectURL → the next leg red, listing it with those three routes (probe deleted).
  it('the scanner catches each way round the host (and not the tracker\'s harmless look-alikes)', () => {
    const evasions: [string, string][] = [
      ['an object URL', 'const u = URL.createObjectURL (new Blob([t]))'],
      ['an object URL', 'window.open(URL.createObjectURL(blob))'],
      ['an anchor download name', 'link.download = `${name}.json`'],
      ['a download attribute', "a.setAttribute('download', name)"],
      ['a download attribute in JSX', '<a href={href} download={name}>Export</a>'],
      ['a download attribute in JSX', '<a\n  href={href}\n  download\n>'],
      ['a data: URL', "a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text)"],
      ['a data: URL', 'window.open(`data:text/plain,${text}`)'],
      ['a native save or share', 'const h = await window.showSaveFilePicker({ suggestedName })'],
      ['a native save or share', 'await navigator.share({ files: [file] })'],
    ]
    for (const [what, line] of evasions) expect(fileRoutesIn(line), line).toContain(what)
    // What the tracker really does elsewhere, and must stay allowed: open a creature's image in a tab,
    // read a picked image, a field called `data`, a `download` in prose.
    for (const line of [
      "window.open(img, '_blank')",
      'reader.readAsDataURL(file)',
      'const data: Record<string, string> = {}',
      '// the browser download runs at once',
      'if (a.download === name) return',
    ]) expect(fileRoutesIn(line), line).toEqual([])
  })

  // MUTATION (tried 2026-10-13): the old anchor bodies put back into SettingsModal's exportTable and
  // encounterTransfer's downloadEncounters → red ("expected [ Array(4) ] to deeply equal [ …(2) ]", the
  // two files added to the list).
  it('saveTextFile is the only file route under tracker/src (and the dead full-backup export stays unwired)', () => {
    const files = filesUnder(SRC)
    expect(files.some(f => f.endsWith(join('utils', 'saveTextFile.ts'))), 'the walk reached utils/').toBe(true)
    const users = files
      .map(f => ({ file: relative(SRC, f).replace(/\\/g, '/'), routes: fileRoutesIn(readFileSync(f, 'utf8')) }))
      .filter(u => u.routes.length > 0)
      .sort((a, b) => a.file.localeCompare(b.file))
    // dataTransfer.ts keeps the original app's "Export all data" (exportAllData) — imported by nothing:
    // inside Heroes Heaven the whole-app backup covers the tracker. Wiring it back up must go through
    // saveTextFile, which the next assertion makes someone look at.
    expect(users).toEqual([
      { file: 'utils/dataTransfer.ts', routes: ['an object URL', 'an anchor download name'] },
      { file: 'utils/saveTextFile.ts', routes: ['an object URL', 'an anchor download name'] },
    ])
    const importsDeadExport = files.filter(f => /import\s*\{[^}]*\bexportAllData\b[^}]*\}/.test(readFileSync(f, 'utf8')))
    expect(importsDeadExport.map(f => relative(SRC, f)), 'exportAllData is wired up — route it through saveTextFile and the host').toEqual([])
    // …and both export sites take the host's hook.
    for (const f of ['components/EncounterManager.tsx', 'components/SettingsModal.tsx']) {
      expect(readFileSync(join(SRC, f), 'utf8'), f).toContain('useHostSave()')
    }
  })
})
