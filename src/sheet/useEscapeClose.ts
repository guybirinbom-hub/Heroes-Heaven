import { useEffect } from 'react';

/** Bind a window keydown listener that calls `onClose` on Escape. Shared by every modal/overlay so
 *  the whole app dismisses consistently with the keyboard. No-op when `onClose` is undefined. */
export function useEscapeClose(onClose: (() => void) | undefined): void {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
