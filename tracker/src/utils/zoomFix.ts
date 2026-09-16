/*
 * Mouse coordinates → the coordinate space a `position: fixed` element is laid out in: where to put a
 * popup opened from a click (`fixedPopupPos`), an element's box (`localRect`), a drag delta (`localDelta`).
 *
 * Heroes Heaven scales the whole app with CSS `zoom` on <html>. Under a zoomed root a fixed
 * element's `left`/`top` are multiplied by that zoom — but MouseEvent.clientX/clientY are not, they
 * arrive in real viewport pixels. So writing a click's client coords straight into left/top lands
 * the popup at (x·zoom, y·zoom): dead on at 100%, and further off the further the click is from the
 * top-left corner. Measured in the embed at zoom 0.7, a right-click at client (109, 159) drew the
 * row menu at (76, 111); at 1.3 the same click drew it at (237, 339).
 *
 * Dividing the client coords (and the viewport the popup is clamped against) by the zoom cancels it.
 * At zoom 1 — every standalone tracker, every test, and the embed at 100% — the division is a no-op;
 * the edge clamp below still applies there, so a caller that had no clamp of its own gains one.
 */

/** The CSS `zoom` in effect on <html>, or 1 when there is none (standalone tracker, jsdom). */
export function pageZoom(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 1
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('zoom'))
  return Number.isFinite(z) && z > 0 ? z : 1
}

/**
 * Top-left for a popup `w`×`h` local px wide, opened at client coords (`x`, `y`), kept `gap` px
 * inside the viewport's right/bottom edges. The remaining arguments are injectable so the maths can
 * be tested without a zoomed document.
 */
export function fixedPopupPos(
  x: number,
  y: number,
  w: number,
  h: number,
  gap = 8,
  zoom = pageZoom(),
  // No window (SSR, a bare unit test) = no edge to clamp against, so the popup just sits on the click.
  vw = typeof window === 'undefined' ? Infinity : window.innerWidth,
  vh = typeof window === 'undefined' ? Infinity : window.innerHeight,
): { left: number; top: number } {
  return {
    left: Math.min(x / zoom, vw / zoom - w - gap),
    top: Math.min(y / zoom, vh / zoom - h - gap),
  }
}

/**
 * An element's box in a fixed popup's own coordinate space. `getBoundingClientRect()` reports real
 * viewport pixels under a zoomed root exactly like `clientX`/`clientY` do, so anything measured off
 * a trigger element has to come through here before it becomes a `left`/`top`/`max-height`.
 */
export function localRect(el: Element, zoom = pageZoom()) {
  const r = el.getBoundingClientRect()
  return {
    top: r.top / zoom, left: r.left / zoom, bottom: r.bottom / zoom, right: r.right / zoom,
    width: r.width / zoom, height: r.height / zoom,
  }
}

/**
 * A mouse-drag delta in a fixed element's own coordinate space. A drag measures `ev.clientX - startX`
 * in real viewport pixels, while the `width`/`height`/`left` it is added to are layout pixels of the
 * zoomed root, and a layout pixel renders as `zoom` real pixels — so the box lags the cursor at
 * zoom < 1 and outruns it at zoom > 1 (at 0.7, dragging a resize grip 100 real px grew a pinned
 * window by 100 layout px, which is 70 real px on screen — 30 short). Dividing by the zoom makes the
 * box travel exactly as far as the cursor did on screen. Identity at zoom 1.
 */
export function localDelta(d: number, zoom = pageZoom()): number {
  return d / zoom
}
