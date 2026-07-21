import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Overrides the viewport check for a subtree.
 *
 * Normally "mobile" means "narrow viewport". But the sheet can be rendered inside a tiled pane that
 * is far narrower than the window (the tracker's PC panes) — there the phone layout fits better even
 * though the viewport is wide. A provider of `true`/`false` forces the decision for everything below
 * it; `null` (the default, and the whole rest of the app) leaves the viewport check in charge, so
 * nothing outside a provider changes.
 */
export const ForceMobileContext = createContext<boolean | null>(null);

/**
 * True when the viewport is at or below `maxWidth` (phone-ish). Reactive — updates on resize/rotate,
 * so the mobile layout also kicks in when a desktop browser window is narrowed (handy for testing).
 * Matches the 720px breakpoint used by the mobile CSS in sheet.css. A ForceMobileContext above wins.
 */
/** One-time (non-reactive) viewport check — for reads that happen once, e.g. an `autoFocus` prop that
 *  should be off on phones so a popup doesn't auto-open the on-screen keyboard. Safe with no DOM. */
export function isMobileNow(maxWidth = 720): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
}

export function useIsMobile(maxWidth = 720): boolean {
  const forced = useContext(ForceMobileContext);
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return forced ?? isMobile;
}
