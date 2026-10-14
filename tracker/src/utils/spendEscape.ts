import { useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * ESCAPE IN A TRACKER TEXT BOX IS SPENT IN THE BOX.
 *
 * Inside Heroes Heaven an Escape that bubbles out of the tracker reaches the host's dismiss stack, whose
 * campaign handler finds no popup on <body> for a box inside the tracker and LEAVES THE CAMPAIGN (the
 * local table: the whole page). Found 2026-10-10 in the initiative row's rename and number boxes, then
 * (2026-10-11) in the stat block's HP boxes and notes boxes and the party card's name and notes boxes.
 *
 * A box calls this from its onKeyDown: an Escape goes no further, and `then` does what Escape means in
 * that box (cancel the edit, clear it, or just leave the box). Answers whether the key was Escape.
 * Takes a React key event or the DOM's own (useEscapeCloses below spends a `document` listener's).
 *
 * The host now also stands down for an Escape typed in any tracker text box (src/integration/
 * CampaignTracker.tsx, editableInTracker); a box that means something by Escape still spends its own.
 */
export function spendEscape(e: { key: string; stopPropagation(): void }, then?: () => void): boolean {
  if (e.key !== 'Escape') return false
  e.stopPropagation()
  then?.()
  return true
}

/** For a box whose every keystroke is already kept (a notes box): Escape just leaves the box. */
export function escapeLeavesBox(e: ReactKeyboardEvent<HTMLElement>): void {
  const box = e.currentTarget
  spendEscape(e, () => box.blur())
}

/*
 * ESCAPE CLOSES THE TRACKER MODAL ON TOP — AND IS SPENT THERE.
 *
 * The tracker's own modals (a `.modal-overlay`: the Encounter Building tables, the encounter-table editor
 * and its Link picker, the advanced condition editor) had no Escape at all. Inside a campaign Heroes Heaven
 * stands down while one is open (a window hidden behind it must not close, the campaign must not be left),
 * so Escape did NOTHING there (the item-7 refuter, 2026-10-13); in Heroes Heaven's Settings → Initiative
 * tracker it reached the Settings page's own Escape and closed the whole page, the half-made table or
 * condition with it. A modal calls this with its close: Escape closes it and goes no further.
 *
 * One `document` listener serves every open modal and closes only the one opened LAST — a modal opened
 * from inside another (the table editor's Link picker) is drawn over it, and one press peels one layer.
 * A box inside a modal that spends its own Escape (spendEscape above) keeps it: its press never reaches
 * `document`. tracker/src/components/modalEscape.test.tsx, test/bug-tracker-escape-boxes.test.tsx.
 *
 * ONE PRESS, ONE LAYER — HELD DOWN TOO. A held key repeats (every keydown after the first has `repeat`
 * set), and each repeat peeled the next layer: from the table editor's Link picker a held Escape closed
 * the picker, then the editor, the half-made table with it (the G7e refuter, 2026-10-13). So a repeat
 * never closes a tracker modal; and once a press has reached an open one, its repeats go nowhere at all —
 * not to the window behind it, not to the campaign — until the key is let go or pressed afresh.
 *
 * …WHICHEVER LISTENER TAKES THE PRESS (the G7e refuter's MAJOR, measured 2026-10-13). The hold used to
 * start inside the modal's own `document` listener, and only when that listener took the press. A modal
 * opened from a component with a `document` Escape listener of its own — the advanced condition editor,
 * over the condition picker (ConditionPanel) — then hung on the order the two were added in. Under
 * React.StrictMode (the dev build, src/main.tsx) the editor's effect runs twice and its listener lands
 * AFTER the picker's: the picker's runs first and closes the editor, the browser commits React between
 * the two listeners, the editor's cleanup takes its listener off before it runs — the hold never
 * started, and a HELD Escape closed the editor, then the picker, then LEFT THE CAMPAIGN. So the hold
 * starts on `window` in the CAPTURE phase, ahead of every listener on the page, while any tracker modal
 * is open (onModalPress below): a fresh press with the top modal not covered all over holds its repeats,
 * whoever then closes the modal. The modal's own listener still does the closing and the spending.
 * CombatantMenu.test.tsx (the StrictMode leg), modalEscape.test.tsx.
 * (Since 2026-10-14 the condition picker has no listener of its own: it is a registered panel here, under
 * the editor it opens, so the ONE listener below closes the editor, then the picker — and Android's Back
 * reaches it too, which no `document` listener ever did: Back with the picker up left the campaign.)
 *
 * ONLY THE LAYER DRAWN ON TOP. "Opened last" is the modals' own order; the screen has others. Search
 * (Ctrl+K, z 9500, its own `document` listener) opened over the Encounter Building tables (z 2000): with
 * the focus off its box, one Escape closed the tables hidden UNDER the search, then the search too — the
 * tables' listener was added first, so it ran first (the G7e refuter, round 2). So:
 *  - a modal COVERED ALL OVER by something drawn above it — asked of the browser's own hit test
 *    (`elementFromPoint`) at the middle and near each corner of its box — stands down: the press is left,
 *    unspent, for the layer on top (a search, a confirm, a host popup). Covered only in part (a tooltip,
 *    a small menu) it is still the modal's. Nothing measurable (no box on screen, no hit test): on top.
 *  - a press a modal takes is spent for every listener still to come on `document` too
 *    (`stopImmediatePropagation`), not only for `window`: the custom-condition editor (z 10001) is drawn
 *    OVER a search opened after it (z 9500), and the search's later listener closed it as well.
 *  - a modal inside a floating WINDOW that another window is drawn over stands down the same way
 *    (underAnotherWindow). A window (FloatingWindow's root, `[data-float-win]`) is a stacking context of
 *    its own, so the Edit converter of a stat block in a window is painted at that window's z-index,
 *    full-screen overlay and all — and a window opened since (a link in the converter's preview) is painted
 *    over it. One Escape closed the converter hidden under that window, its unsaved edits with it (the
 *    G7s refuter, 2026-10-13). The press is left for the window on top, which the host closes. A press
 *    from INSIDE the modal's own window (the focus there, reached by Tab: a click would have raised the
 *    window) is still the modal's.
 * The modal tells which element it is through the ref this hook returns (on its `.modal-overlay`). The
 * box the hit test measures is the dialog INSIDE that full-screen backdrop (its first child); a PANEL with
 * no backdrop of its own around it (the condition picker, the GM screen's + menu) says so (`panel`), and
 * its own box is measured — its first child is only its top row, and a layer over that row alone is no
 * layer over the panel.
 *  - a modal drawn UNDER the floating windows and covered all over by one (the GM screen's + menu, z 41 in
 *    the page, under windows at 500 and up — 2026-10-14): the window is the layer on top, and the host's
 *    Back handler closes it (topTrackerModalUnderAWindow), as for a modal inside a lower window.
 *
 * ANDROID'S BACK IS NO KEY PRESS. On the phone Back reaches Heroes Heaven as a `popstate` on its dismiss
 * stack (src/sheet/useEscapeClose.ts), which no listener here ever hears: with a tracker modal up, Back
 * left the campaign, or in Heroes Heaven's Settings closed the whole Settings page over the table editor.
 * The host asks how many are open (useTrackerModalCount) and, while any is, puts a Back handler on its
 * own stack that closes the top one (closeTopTrackerModal) — src/integration/CampaignTracker.tsx,
 * TrackerSettingsSection.tsx; test/bug-tracker-escape-boxes.test.tsx (BACK).
 * That handler sits on the stack the keyboard's Escape reaches too, and an Escape gets there past an open
 * modal only when the modal's own listener left it unspent — for a layer drawn over all of the modal. A
 * layer that closes itself on that press without spending it (the row menu's way) is gone by then, the
 * modal shows again, and the handler closed the modal under it as well: one press, two layers (the G7s
 * refuter, 2026-10-13). So while a press onModalKey left to a layer is still being dispatched,
 * closeTopTrackerModal closes nothing: that press was the layer's.
 * Under another window, the host's handler closes that window instead (topTrackerModalUnderAWindow).
 */
/* `el`: the element the ref is on (everything inside it is the modal's); `box`: the box the hit test
 * measures — the dialog inside a backdrop, or a panel's own (useEscapeCloses `panel`). */
type OpenModal = { close: () => void; el: () => HTMLElement | null; box: () => Element | null }
const openModals: OpenModal[] = []

/* Who wants the count (useTrackerModalCount): told on every open and every close. */
const countListeners = new Set<() => void>()
function openModalsChanged(): void {
  for (const l of [...countListeners]) l()
}

function onModalKey(e: KeyboardEvent): void {
  const top = openModals[openModals.length - 1]
  if (!top || e.key !== 'Escape') return
  // Under another layer: the press is that layer's, and goes on unspent — and closes no tracker modal
  // through the host's Back handler either (closeTopTrackerModal), even once the layer is gone.
  if (notTheModals(top, e)) {
    leftToLayer = e
    return
  }
  // The modal's: no listener after this one hears it — on `document` or above.
  e.stopImmediatePropagation()
  // A repeat (the key held down) of a press something else took — a box in the modal that spends its own,
  // a search drawn over the modal that closed on it — closes nothing.
  if (e.repeat) return
  spendEscape(e, top.close)
}

/* The last press onModalKey left unspent for a layer drawn over all of the top modal. A dispatched
 * event's `eventPhase` goes back to NONE once its dispatch is over, so this answers "is that press still
 * on its way — to the host's dismiss stack?" with no timer to clear it. */
let leftToLayer: Event | null = null
function layersPressOnItsWay(): boolean {
  return !!leftToLayer && leftToLayer.eventPhase !== Event.NONE
}

/* A fresh Escape while a tracker modal is open, on `window` in the capture phase — before any listener on
 * the page has run, so before any of them can close the modal and take its listener away: with the top
 * modal the layer on top (notTheModals), the press is a modal's (its own listener, or one under it that
 * closes it first), and its repeats are held until the key is let go. Covered, or under another window,
 * the press is the layer on top's, and holds nothing. */
function onModalPress(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.repeat) return
  const top = openModals[openModals.length - 1]
  if (!top || notTheModals(top, e)) return
  holdUntilLetGo(e)
}

/* The top modal is NOT the layer this press (or, with no press, a dismiss with no key — Android's Back)
 * belongs to: something is drawn over all of it, or it sits in a floating window another window is drawn
 * over — unless the press comes from inside that window itself (the focus is there). */
function notTheModals(top: OpenModal, e?: Event): boolean {
  const el = top.el()
  if (coveredAllOver(el, top.box())) return true
  const win = windowUnderAnother(el)
  if (!win) return false
  return !(e && e.target instanceof Node && win.contains(e.target))
}

/* The floating window holding `el` (FloatingWindow's root, `[data-float-win]`), when another window has a
 * higher z-index — opened later, or raised since — and so is painted over all of it; else null. */
function windowUnderAnother(el: Element | null): HTMLElement | null {
  const win = el?.closest<HTMLElement>('[data-float-win]') ?? null
  if (!win) return null
  const z = zIndexOf(win)
  const over = [...document.querySelectorAll<HTMLElement>('[data-float-win]')].some((w) => w !== win && zIndexOf(w) > z)
  return over ? win : null
}
function zIndexOf(el: HTMLElement): number {
  return Number.parseInt(getComputedStyle(el).zIndex, 10) || 0
}

/** Whether `el` sits inside a floating window that another floating window is drawn over (a later one,
 *  or one raised since): a modal in it shows UNDER that window, its full-screen overlay included — the
 *  window is the layer on top. */
export function underAnotherWindow(el: Element | null): boolean {
  return !!windowUnderAnother(el)
}

/* Something else is drawn over the whole of the modal's box: the browser's hit test finds it, not the
 * modal, at the box's middle and near each of its corners. A point off the screen (the hit test finds
 * nothing there) says nothing either way; with nothing found anywhere, the modal is on top as before.
 * getBoundingClientRect and elementFromPoint both speak client pixels, so Heroes Heaven's CSS zoom needs
 * no correction here (utils/zoomFix). `by`, when given, asks what the cover must be: a point covered by
 * anything else answers "no" (topTrackerModalUnderAWindow: covered by floating windows alone). */
function coveredAllOver(modal: HTMLElement | null, box: Element | null, by?: (hit: Element) => boolean): boolean {
  if (!modal || !box || typeof document.elementFromPoint !== 'function') return false
  const r = box.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return false
  const dx = Math.min(8, r.width / 4)
  const dy = Math.min(8, r.height / 4)
  const points: [number, number][] = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + dx, r.top + dy],
    [r.right - dx, r.top + dy],
    [r.left + dx, r.bottom - dy],
    [r.right - dx, r.bottom - dy],
  ]
  let covered = false
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y)
    if (!hit) continue
    if (modal.contains(hit)) return false // the modal shows here: it is on top
    if (by && !by(hit)) return false // covered here by something else than `by` asks for
    covered = true
  }
  return covered
}

/* While the Escape that reached a modal is still held down: on `window` in the capture phase, ahead of
 * every listener its repeats would reach — the next modal's, the host's dismiss stack. */
let held = false
/* The press that started (or took over) the hold. Both this listener and onModalPress sit on `window`'s
 * capture phase, in whichever order they were added: the press that holds is never also the press
 * that lets go. */
let holdStart: Event | null = null
function onHeldKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e === holdStart) return
  if (e.type === 'keydown' && e.repeat) {
    e.stopPropagation()
    return
  }
  letGo() // let go, or pressed afresh: that press is a press like any other
}
function holdUntilLetGo(start: Event): void {
  holdStart = start
  if (held) return
  held = true
  window.addEventListener('keydown', onHeldKey, true)
  window.addEventListener('keyup', onHeldKey, true)
}
function letGo(): void {
  held = false
  holdStart = null
  window.removeEventListener('keydown', onHeldKey, true)
  window.removeEventListener('keyup', onHeldKey, true)
}

/** Escape closes this modal while it is the one on top. Put the returned ref on its `.modal-overlay` —
 *  or, with `panel`, on a panel that has no backdrop around it (its own box is then the one measured). */
export function useEscapeCloses(onClose: () => void, opts?: { panel?: boolean }): (el: HTMLElement | null) => void {
  const latest = useRef(onClose)
  latest.current = onClose
  const panel = useRef(!!opts?.panel)
  const node = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const entry: OpenModal = {
      close: () => latest.current(),
      el: () => node.current,
      box: () => (panel.current ? node.current : (node.current?.firstElementChild ?? node.current)),
    }
    openModals.push(entry)
    document.addEventListener('keydown', onModalKey)
    window.addEventListener('keydown', onModalPress, true)
    openModalsChanged()
    return () => {
      const i = openModals.indexOf(entry)
      if (i >= 0) openModals.splice(i, 1)
      if (!openModals.length) {
        document.removeEventListener('keydown', onModalKey)
        window.removeEventListener('keydown', onModalPress, true)
      }
      openModalsChanged()
    }
  }, [])
  return useCallback((el: HTMLElement | null) => { node.current = el }, [])
}

/**
 * Close the tracker modal on top, as Escape would — for a dismiss that is no key press (Android's Back,
 * a `popstate` on the host's dismiss stack; the host's on-screen Back arrow). Covered all over by another
 * layer, or under another floating window, it closes nothing, as Escape does: that layer is on top.
 * Called on the way of an Escape press the modal's own listener left to such a layer it closes nothing
 * either — the layer may have taken itself away on that press, and the press was the layer's. Answers
 * whether it closed one.
 */
export function closeTopTrackerModal(): boolean {
  if (layersPressOnItsWay()) return false
  const top = openModals[openModals.length - 1]
  if (!top || notTheModals(top)) return false
  top.close()
  return true
}

/** Whether the tracker modal on top is drawn UNDER a floating window: it sits in a window another window
 *  is drawn over (underAnotherWindow), or it is drawn under the windows and one covers all of it (the GM
 *  screen's + menu). That window is the layer on top, and a host's Back closes it, not the modal. */
export function topTrackerModalUnderAWindow(): boolean {
  const top = openModals[openModals.length - 1]
  if (!top) return false
  const el = top.el()
  return underAnotherWindow(el) || coveredAllOver(el, top.box(), (hit) => coveredByAWindowOf(el, hit))
}
/* `hit` is in a floating window (FloatingWindow's root, `[data-float-win]`) — not the one `modal` is in. */
function coveredByAWindowOf(modal: HTMLElement | null, hit: Element): boolean {
  const win = hit.closest('[data-float-win]')
  return !!win && !(modal && win.contains(modal))
}

/** How many tracker modals are open (each `useEscapeCloses`), kept current — a host puts its Back
 *  handler on its own stack while this is above 0. */
export function useTrackerModalCount(): number {
  return useSyncExternalStore(subscribeModalCount, openModalCount, openModalCount)
}
function subscribeModalCount(onChange: () => void): () => void {
  countListeners.add(onChange)
  return () => {
    countListeners.delete(onChange)
  }
}
function openModalCount(): number {
  return openModals.length
}
