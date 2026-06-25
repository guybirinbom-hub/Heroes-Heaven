import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below `maxWidth` (phone-ish). Reactive — updates on resize/rotate,
 * so the mobile layout also kicks in when a desktop browser window is narrowed (handy for testing).
 * Matches the 720px breakpoint used by the mobile CSS in sheet.css.
 */
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
