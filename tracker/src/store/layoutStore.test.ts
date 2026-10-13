import { describe, expect, it } from 'vitest'
import { createLayoutStore, paneCount, useGmLayoutStore, type LeafNode, type PaneNode, type PopupRef } from './layoutStore'

/*
 * addPopup NEVER SPLITS OFF A SECOND, IDENTICAL PANE (the G7e refuter, 2026-10-13).
 *
 * Each "Preview" on the GM screen's Random Encounter widget split the screen again for the same creature
 * — the GM screen ended up with three, four, five identical stat-block panes — and the GM screen's "Add to
 * GM Screen" picker did the same for a page the screen already held. addPopup now looks first: a pane
 * that already holds that popup (the same type and the same ref) is focused, where it is, and nothing
 * is split.
 *
 *  (a) the same popup twice: one pane, and the layout's focus moves to it;
 *  (b) inside a tabbed pane: that tab becomes the pane's active tab;
 *  (c) what is "the same": the type and the ref — another ref or another type is a pane of its own; a
 *      spell asked for at another cast rank is the same page;
 *  (d) a creature picked BY NAME in the GM screen's "Add to GM Screen" lands as 'creature' and the GM
 *      screen turns it into its 'bestiary' tab the moment it lands (GMScreen keepBestiaryPins): picked
 *      again it split off a second, identical pane (the G7s refuter, 2026-10-13) — the two are one page.
 * The widget's own leg: tracker/src/components/RandomEncounterWidget.test.tsx (a).
 *
 * MUTATION (2026-10-13, applied alone with Edit, run, read off that run, then restored byte-exact):
 *  - layoutStore addPopup: `if (held) { get().focusTab(held.leaf.id, held.index); return }` dropped →
 *    (a) red at "one pane for it", (b) at "no new pane", (c) at "a spell at another rank: the same page".
 *  - findPopupTab: `t.type === p.type && t.ref === p.ref` → `t.ref === p.ref` (the ref alone) → (c) red at
 *    "another type with the same ref: a pane of its own".
 *  (G7s round 2, findPopupTab now `t.ref === p.ref && samePageType(t.type, p.type)`):
 *  - samePageType: its last line → `return false` (the type alone, as before) → (d) red at "picked again:
 *    still one pane".
 *  - samePageType → `return true` (the ref alone) → (c) red at "another type with the same ref: a pane of
 *    its own".
 *
 * Every name here is synthetic.
 */

const GLARE: PopupRef = { type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }
const RAIDER: PopupRef = { type: 'bestiary', ref: 'synthetic raider', title: 'Synthetic Raider' }
const HUSH: PopupRef = { type: 'spell', ref: 'synthetic hush', title: 'Synthetic Hush' }

function tabsOf(n: PaneNode | null): PopupRef[] {
  if (!n) return []
  return n.kind === 'leaf' ? n.tabs : [...tabsOf(n.a), ...tabsOf(n.b)]
}
function leafWith(n: PaneNode | null, p: PopupRef): LeafNode | null {
  if (!n) return null
  if (n.kind === 'leaf') return n.tabs.some(t => t.type === p.type && t.ref === p.ref) ? n : null
  return leafWith(n.a, p) ?? leafWith(n.b, p)
}

describe('addPopup never splits off a second, identical pane', () => {
  it('(a) the same popup twice: one pane, and the focus moves to it', () => {
    const s = createLayoutStore()
    s.getState().addPopup(GLARE)
    s.getState().addPopup(RAIDER)
    expect(paneCount(s.getState().root), 'fixture: two panes').toBe(2)
    expect(s.getState().hoveredLeaf, 'fixture: the newest pane has the focus').toBe(leafWith(s.getState().root, RAIDER)!.id)

    s.getState().addPopup({ ...GLARE })
    expect(paneCount(s.getState().root), 'one pane for it').toBe(2)
    expect(tabsOf(s.getState().root)).toEqual([GLARE, RAIDER])
    expect(s.getState().hoveredLeaf, 'the pane already holding it has the focus').toBe(leafWith(s.getState().root, GLARE)!.id)

    // Pressed again and again (the widget's Preview): still the one pane.
    s.getState().addPopup(RAIDER)
    s.getState().addPopup(RAIDER)
    expect(paneCount(s.getState().root)).toBe(2)
    expect(tabsOf(s.getState().root)).toEqual([GLARE, RAIDER])
  })

  it('(b) inside a tabbed pane: that tab becomes the active one', () => {
    const s = createLayoutStore()
    s.getState().addPopup(GLARE)
    const leafId = s.getState().root!.id
    // A second tab in the same pane (dropped on its centre), shown.
    s.getState().dropPopup(leafId, RAIDER, 'center')
    const shown = () => {
      const leaf = s.getState().root as LeafNode
      return leaf.tabs[leaf.active]
    }
    expect(shown(), 'fixture: the dropped tab is shown').toEqual(RAIDER)

    s.getState().addPopup(GLARE)
    expect(paneCount(s.getState().root), 'no new pane').toBe(1)
    expect(shown(), 'its tab is the one shown now').toEqual(GLARE)
    expect(s.getState().hoveredLeaf).toBe(leafId)
  })

  it('(c) "the same" is the type and the ref: another of either is a pane of its own; another cast rank is the same page', () => {
    const s = createLayoutStore()
    s.getState().addPopup(GLARE)
    s.getState().addPopup({ ...GLARE, ref: 'synthetic gloom', title: 'Synthetic Gloom' })
    expect(paneCount(s.getState().root), 'another ref: a pane of its own').toBe(2)
    s.getState().addPopup({ type: 'trait', ref: GLARE.ref, title: 'Synthetic Glare' })
    expect(paneCount(s.getState().root), 'another type with the same ref: a pane of its own').toBe(3)

    s.getState().addPopup({ ...HUSH, castRank: 2 })
    s.getState().addPopup({ ...HUSH, castRank: 4 })
    expect(paneCount(s.getState().root), 'a spell at another rank: the same page').toBe(4)
  })

  it('(d) a creature picked twice in "Add to GM Screen": one pane — it lands as a creature, the GM screen keeps it as a bestiary tab', async () => {
    const { keepBestiaryPins } = await import('../components/GMScreen')
    const { useCombatStore } = await import('./combatStore')
    useCombatStore.setState({ combatants: [] } as never)
    const gm = useGmLayoutStore
    gm.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
    try {
      /** The picker's pick, then the GM screen's rescue — as GMScreen runs it on every change of its tree. */
      const pick = () => {
        gm.getState().addPopup({ type: 'creature', ref: RAIDER.ref, title: RAIDER.title })
        keepBestiaryPins()
      }
      pick()
      expect(tabsOf(gm.getState().root), 'fixture: kept as the bestiary tab').toEqual([RAIDER])

      pick()
      expect(paneCount(gm.getState().root), 'picked again: still one pane').toBe(1)
      expect(tabsOf(gm.getState().root)).toEqual([RAIDER])

      // Another pane focused, the creature picked once more: its own pane is focused, nothing split.
      gm.getState().addPopup(GLARE)
      expect(gm.getState().hoveredLeaf, 'fixture: the new pane has the focus').toBe(leafWith(gm.getState().root, GLARE)!.id)
      pick()
      expect(paneCount(gm.getState().root), 'picked a third time: still its one pane').toBe(2)
      expect(gm.getState().hoveredLeaf, 'the creature’s pane has the focus').toBe(leafWith(gm.getState().root, RAIDER)!.id)
    } finally {
      gm.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
    }
  })
})
