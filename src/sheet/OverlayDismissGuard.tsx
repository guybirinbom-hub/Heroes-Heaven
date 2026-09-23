import { useEffect } from 'react';

/**
 * One capture-phase guard for every dismiss-on-background-click popup in the app.
 *
 * A PRESS THAT STARTS ON THE POPUP AND ENDS ON THE BACKDROP MUST NOT DISMISS IT. A popup dismisses on
 * a `click` on its backdrop, and the browser reports that click only when the press ENDS — on the
 * nearest common ancestor of the pressed and the released element, which (the backdrop being the
 * popup's parent) is the backdrop itself the moment the finger or cursor crosses the popup's edge:
 *   - desktop: dragging the bottom-right resize grip, where the popup shrinks out from under the cursor;
 *   - phone: a popup is 94vw, leaving a ~11px strip of backdrop down each side, so a finger that drags
 *     the popup's text and lifts a few pixels outside it closes the popup instead of scrolling it.
 * So: swallow a click reported on a backdrop whose press began inside it.
 *
 * WHAT A BACKDROP IS, IS MEASURED — IT IS NOT A LIST OF NAMES, AND PLEASE DON'T MAKE IT ONE AGAIN.
 * This guard used to carry two class lists (`.picker, .ast-modal, .dice-drawer, .tc-panel` and
 * `.picker-overlay, .drawer-overlay, .tc-overlay`), and every round of review found another surface
 * that was in neither: the tracker's Customize drawer, then `.portrait-lightbox` (both character
 * portrait lightboxes, the one surface where dragging the picture IS the natural gesture), then the
 * tracker's own `.modal-overlay` — twelve mount sites across eleven files, all rendered into THIS
 * document — and finally `tracker/src/components/GlobalSearch.tsx`, whose backdrop is inline-styled
 * and has no className at all, so no name-keyed check could ever have seen it. A list cannot be
 * completed by the person adding the fourteenth popup; the property can, because it is the same
 * property that MAKES something a backdrop:
 *
 *   positioned (`fixed` or `absolute`) with all four insets at 0 — a layer over its whole containing
 *   block, which is what leaves dim area all round the popup for the press to land on.
 *
 * NOT "position: fixed" ALONE, and that is measured, not cautious: `.tc-overlay` (the tracker's
 * Customize drawer) is `position: absolute` in src/integration/campaign-tracker.css because it covers
 * the tracker PANE rather than the screen — a fixed-only guard reads it as ordinary content and does
 * not arm, on the one surface a previous pass had just fixed by name. Every other backdrop in both
 * apps is fixed + inset 0 (`.picker-overlay`, `.drawer-overlay`, `.portrait-lightbox` in sheet.css;
 * `.modal-overlay` via `@apply fixed inset-0` in tracker/src/index.css; GlobalSearch's inline
 * `position:'fixed', inset:0`). So the guard reads the computed style of the element the click was
 * reported on and arms itself; a popup added tomorrow is covered the moment it dims what is behind it.
 *
 * THE OTHER SIDE OF THAT WIDENING IS NOT A SHORT LIST EITHER. This paragraph used to name "the app's
 * four other inset-0 layers"; parsing every stylesheet in src/ and tracker/src/ for the property finds
 * about twenty, and the largest are the ones a hand-written list would never think of: at <=720px the
 * SHELLS are `position: fixed; inset: 0` (`.ws-app`, `.builder`), so on the phone — the surface this
 * guard exists for — the whole app is an armable layer. What keeps that free is a property, not a
 * census: this guard only ever SWALLOWS, so a false arm costs exactly what the swallowed click was
 * worth, and the only click handlers on any of those layers are `e.stopPropagation()` on a popup body
 * or a dismiss on a sibling tap-catcher, which is never the element a cross-edge click is reported on
 * (see THE CEILING). It swallows at document capture with `stopImmediatePropagation`, though, which
 * kills the click for React's root listener too — so the day a shell or a page wrapper starts
 * listening for clicks of its own, this is the file to re-measure.
 *
 * THE PRESS SIDE NEEDS NO LIST EITHER. "The press began on the popup" is "the press began strictly
 * inside the element the click was reported on" — the backdrop wraps its popup, so anything in the
 * popup is a descendant. A tap that starts AND ends on the strip has the backdrop itself as its press
 * target, so it still dismisses; that is the whole difference between the two gestures.
 *
 * NESTED OVERLAYS FALL OUT FOR FREE, and they were the case the old list got wrong: a `.ref-link`
 * inside a description opens its own backdrop INSIDE the outer popup's body, so `closest('.picker')`
 * from the inner backdrop found the OUTER popup and the old test ("matches BACKDROP and not POPUP")
 * called it "inside a popup" — the guard was a no-op for every nested popup, which is most of the ones
 * the 11px strip is actually hit on. Here the inner backdrop is measured on its own merits.
 *
 * `pointerdown`, not `mousedown`: on a touch screen the compatibility mouse events are synthesised
 * after the finger LIFTS and are hit-tested where it lifted — the backdrop — which is exactly the case
 * above. mousedown stays as the fallback for anything without PointerEvent. Renders nothing.
 *
 * THE CEILING: the click has to be reported ON the element that carries the dismiss. Most backdrops in
 * both apps wrap their popup directly, so the common ancestor of "popup" and "dim area" IS the
 * backdrop, and the guard is looking straight at it. Six surfaces use the other arrangement — the
 * dismissing backdrop is a SIBLING of the panel inside a full-bleed wrap: `.cust-drawer-wrap` (the
 * sheet's Customize drawer), `.menu-backdrop` (PageMenu, NotesTab's row menu) and three inline ones in
 * the tracker (GMScreen's add menu, PartyView's stats menu, the standalone app's party picker). "Nothing
 * renders that shape today" stood here and was simply false. It is also harmless, for the same reason
 * it is that shape: a press crossing the panel's edge reports its click on the WRAP, and the wrap is
 * not what carries onClose — so that gesture cannot dismiss whether this guard arms or not, while a
 * plain tap on the backdrop still reports on the backdrop and still closes. Pinned in
 * test/bug-phone-web.test.tsx against the Customize drawer's real markup, both halves.
 *
 * WHAT WOULD STILL REACH PAST THIS GUARD, then, is one shape and it is not that one: a wrap that
 * carries the dismiss handler ITSELF and is not a layer. The cross-edge click lands on it, `isLayer`
 * says no, and the popup closes. Nothing does that today; if something starts to, move the dismiss
 * onto the full-bleed element (which is what every backdrop here already is) rather than widening
 * `isLayer` to match a box that isn't one.
 *
 * DELIBERATELY NOT HERE (2026-09-23, and please don't put it back): a second rule that counted presses
 * and swallowed "the second half of one gesture" — a click arriving with no press behind it — on the
 * theory that a dismissing tap also presses whatever the popup was covering. A browser reports a
 * POINTER click only when a press ends, and the element under a dismissing tap is the backdrop, so
 * that rule was a counter quietly eating real clicks to defend against something that cannot occur.
 * Press-less clicks do exist — keyboard activation is reported on the focused control, and a backdrop
 * div is not focusable; a synthetic one goes wherever its caller aims it. Which is why the press below
 * is FORGOTTEN when it ends without a click rather than counted: a stale press is the only way one of
 * those could be swallowed, and forgetting costs nothing, where counting cost real clicks.
 */
export function OverlayDismissGuard() {
  useEffect(() => {
    /** The element the press began on — the whole state this guard keeps. */
    let downOn: Element | null = null;
    const el = (t: EventTarget | null): Element | null =>
      t && (t as Node).nodeType === 1 ? (t as Element) : null;

    /** Does this element declare itself a layer over everything behind it? Positioned + four zero
     *  insets. Read from the COMPUTED style, so it is true for `inset: 0`, for the four longhands, for
     *  a Tailwind `@apply fixed inset-0` and for an inline style alike — a backdrop cannot dim what is
     *  behind it without saying one of them. (Not the measured RECT: `position: fixed` resolves
     *  against the nearest TRANSFORMED ancestor, so a nested backdrop inside an outer popup still
     *  running its open animation measured 14.5,223.8 346.5x799.8 in the live app — a real backdrop,
     *  nowhere near the viewport box. The declaration is what holds.) */
    const isLayer = (node: Element): boolean => {
      const s = getComputedStyle(node);
      if (s.position !== 'fixed' && s.position !== 'absolute') return false;
      const zero = (v: string) => v === '0px' || v === '0';
      // A browser expands `inset: 0` into the four longhands (and serialises four zero longhands back
      // as `inset: 0px`); jsdom keeps the shorthand and leaves the longhands at `auto`. Either answers.
      return zero(s.inset) || (zero(s.top) && zero(s.right) && zero(s.bottom) && zero(s.left));
    };

    const onDown = (e: Event) => {
      downOn = el(e.target);
    };
    /** Forget the press. A click belongs to the press that produced it, and a press can end without
     *  producing one at all: a drag that leaves the window, a touch the browser takes over as a scroll
     *  or a gesture (`pointercancel`), the popup unmounting under the finger, a tab switched away from.
     *  Left set, that stale element is still sitting there for the next PRESS-LESS click (keyboard,
     *  synthetic) to be matched against, and gets it swallowed if it lands on a layer containing the
     *  stale node. A fresh press needs nothing here — `onDown` overwrites — so these three are only the
     *  endings that produce no click to clear it. */
    const forget = () => {
      downOn = null;
    };
    const onClick = (e: MouseEvent) => {
      const down = downOn;
      // Per-press: one drag out of the popup must not leave the backdrop dead for the next tap.
      downOn = null;
      const target = el(e.target);
      // `target === down` is the dismissing tap itself (press and lift both on the strip) — it must go
      // through, or the popup has no way out but its X.
      if (!down || !target || target === down) return;
      if (!target.contains(down) || !isLayer(target)) return;
      // Propagation only. No `preventDefault()`: the target here is always a backdrop div, whose
      // click has no default action to cancel — and suppressing one we haven't got a case for is a
      // second, invisible behaviour riding along with this fix.
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const downEvent = 'onpointerdown' in window ? 'pointerdown' : 'mousedown';
    document.addEventListener(downEvent, onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointercancel', forget, true);
    document.addEventListener('visibilitychange', forget);
    window.addEventListener('blur', forget);
    return () => {
      document.removeEventListener(downEvent, onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointercancel', forget, true);
      document.removeEventListener('visibilitychange', forget);
      window.removeEventListener('blur', forget);
    };
  }, []);
  return null;
}
