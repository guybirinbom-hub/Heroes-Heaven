import { useEffect, useRef } from 'react';

/**
 * Publish an element's height to a CSS custom property on `<html>`, kept current as it resizes.
 *
 * For layout that has to subtract a box it isn't a sibling of. The app banners are the case this
 * exists for: they sit above the screen in normal flow, so a screen pinned to `100vh` makes the
 * DOCUMENT taller than the window by however much banner is showing — and scrolling the document
 * carries the pinned top bar away with it. Subtracting `--app-banner-h` keeps the document exactly
 * one viewport tall whether zero, one, or three banners are up.
 *
 * `offsetHeight`, not `getBoundingClientRect()`: the app scales itself with `zoom` on `<html>`, which
 * multiplies client rects but leaves offset dimensions in the layout pixels the calc() is written in.
 */
export function useHeightVar<T extends HTMLElement>(varName: string, deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    const write = () => root.style.setProperty(varName, `${el?.offsetHeight ?? 0}px`);
    write();
    // No element or no observer (jsdom): the property stays at the height measured above, which for a
    // missing element is 0px — the same as the CSS fallback, so layout is unaffected either way.
    if (!el || typeof ResizeObserver === 'undefined') return () => root.style.removeProperty(varName);
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(varName);
    };
    // `deps` lets the caller force a re-measure on a render it knows changed the content, so the value
    // is right even before the observer reports — the observer then keeps it right through wrapping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varName, ...deps]);
  return ref;
}
