import { useEffect } from 'react';

/**
 * Keeps a popup the size it opened at. Pickers are `height: auto`, so expanding a section inside one
 * (a dropdown, a "Details" toggle, the cast-rank picker…) grows the whole popup. This pins each
 * picker's height once, just after it opens, so later content changes scroll within the body
 * (which is already `overflow-y: auto`) instead of resizing the popup.
 *
 * Skipped: pickers that manage their own fill-and-scroll layout (the filter/ref search result
 * lists), and any picker that already has an explicit height — the popup-size-sync feature sets one
 * itself, and a user resize sets one too, both of which should win.
 */
// 'info-modal' = the description popup: it navigates (each linked term pushes a new node), so it must
// re-fit each node's text rather than stay pinned at its opening height.
const SELF_SIZED = ['fsel', 'ref-search', 'info-modal'];

export function PopupSizeLock() {
  useEffect(() => {
    const lock = (el: HTMLElement) => {
      if (el.style.height) return; // already sized by popup-size-sync or a prior lock
      if (SELF_SIZED.some((c) => el.classList.contains(c))) return;
      // Reading offsetHeight forces layout, so the natural opening height is accurate right here —
      // pin it synchronously (a rAF would be throttled while the window is backgrounded).
      const h = el.offsetHeight;
      if (h > 0) el.style.height = `${h}px`;
    };
    document.querySelectorAll<HTMLElement>('.picker').forEach(lock);
    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains('picker')) lock(node);
          node.querySelectorAll?.<HTMLElement>('.picker').forEach(lock);
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
