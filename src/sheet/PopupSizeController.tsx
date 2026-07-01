import { useEffect } from 'react';
import { getPrefs, setPref, usePrefs } from '../data/prefs';

/**
 * When the "apply popup size to all" preference is on, every popup (`.picker`) opens at the shared
 * saved size, and resizing any popup updates that shared size for all of them. When off, popups use
 * their default size and a resize is ephemeral. Implemented by observing `.picker` elements in the
 * DOM so it covers every modal without per-modal wiring. Renders nothing.
 */
export function PopupSizeController() {
  const { popupSizeSync } = usePrefs();
  useEffect(() => {
    if (!popupSizeSync) return;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const observed = new WeakSet<Element>();
    const ros: ResizeObserver[] = [];

    const attach = (el: HTMLElement) => {
      if (observed.has(el)) return;
      if (el.classList.contains('info-modal')) return; // description popup re-fits each node — never size-sync it
      observed.add(el);
      const saved = getPrefs().popupSize;
      if (saved) {
        el.style.width = `${saved.w}px`;
        el.style.height = `${saved.h}px`;
      }
      let first = true;
      const ro = new ResizeObserver(() => {
        // Skip the initial measurement; only a user-driven resize should update the shared size.
        if (first) {
          first = false;
          return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => setPref('popupSize', { w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) }), 250);
      });
      ro.observe(el);
      ros.push(ro);
    };

    document.querySelectorAll<HTMLElement>('.picker').forEach(attach);
    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains('picker')) attach(node);
          node.querySelectorAll?.<HTMLElement>('.picker').forEach(attach);
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      ros.forEach((r) => r.disconnect());
      clearTimeout(saveTimer);
    };
  }, [popupSizeSync]);

  return null;
}
