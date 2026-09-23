import { useEffect } from 'react';

/** Popup surfaces (the thing you are looking at) and the backdrops that dismiss on a click. */
const POPUP = '.picker, .ast-modal, .dice-drawer';
const BACKDROP = '.picker-overlay, .drawer-overlay';

/**
 * One capture-phase guard for every dismiss-on-background-click popup in the app.
 *
 * A popup dismisses on a `click` that lands on its backdrop — and a click is only reported when the
 * press ENDS, so a press that starts on the popup and ends over the backdrop dismisses it too:
 *  - desktop: dragging the bottom-right resize grip, where the popup shrinks out from under the cursor;
 *  - phone: a popup is 94vw, leaving a ~11px strip of backdrop down each side, so a finger that drags
 *    the popup's text and lifts a few pixels outside it closes the popup instead of scrolling it.
 * So: swallow a click on the backdrop whose press began on a popup. A press that begins on the
 * backdrop still dismisses normally. Renders nothing.
 *
 * `pointerdown`, not `mousedown`: on a touch screen the compatibility mouse events are synthesised
 * after the finger LIFTS and are hit-tested where it lifted — the backdrop — which is exactly the case
 * this has to catch. mousedown stays as the fallback for anything without PointerEvent.
 */
export function OverlayDismissGuard() {
  useEffect(() => {
    let downInPopup = false;
    const onDown = (e: Event) => {
      const t = e.target as Element | null;
      downInPopup = !!t?.closest?.(POPUP);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (downInPopup && t?.closest?.(BACKDROP) && !t.closest(POPUP)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      downInPopup = false;
    };
    const downEvent = 'onpointerdown' in window ? 'pointerdown' : 'mousedown';
    document.addEventListener(downEvent, onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener(downEvent, onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return null;
}
