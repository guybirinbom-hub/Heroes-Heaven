import { useEffect } from 'react';

/**
 * Every `.picker` is resizable (`resize: both`). A drag that begins on the bottom-right resize
 * handle and ends over the surrounding `.picker-overlay` (because the popup shrank out from under
 * the cursor) fires a `click` on the overlay — which would dismiss the popup. This installs one
 * capture-phase guard that swallows a click whose mousedown started inside a picker but landed on
 * the overlay, so resizing never closes a popup. A genuine background click (mousedown started on
 * the overlay) still dismisses normally. Renders nothing.
 */
export function OverlayDismissGuard() {
  useEffect(() => {
    let downInPicker = false;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      downInPicker = !!t?.closest?.('.picker');
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (downInPicker && t?.closest?.('.picker-overlay') && !t.closest('.picker')) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      downInPicker = false;
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return null;
}
