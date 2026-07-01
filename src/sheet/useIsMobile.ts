import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below `maxWidth` (phone-ish). Reactive — updates on resize/rotate,
 * so the mobile layout also kicks in when a desktop browser window is narrowed (handy for testing).
 * Matches the 720px breakpoint used by the mobile CSS in sheet.css.
 */
/** One-time (non-reactive) viewport check — for reads that happen once, e.g. an `autoFocus` prop that
 *  should be off on phones so a popup doesn't auto-open the on-screen keyboard. Safe with no DOM. */
export function isMobileNow(maxWidth = 720): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
}

export function useIsMobile(maxWidth = 720): boolean {
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
  return isMobile;
}
