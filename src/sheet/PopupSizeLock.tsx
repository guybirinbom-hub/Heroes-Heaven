import { useEffect } from 'react';

/**
 * Keeps a popup the size it opened at. Pickers are `height: auto`, so expanding a section inside one
 * (a dropdown, a "Details" toggle, the cast-rank picker…) grows the whole popup. This pins each
 * picker's height once it has SETTLED, so later content changes scroll within the body (which is
 * already `overflow-y: auto`) instead of resizing the popup.
 *
 * "Settled" is the whole trick. This used to pin `offsetHeight` synchronously, the instant the element
 * was inserted — and almost every detail popup in the app fills itself from a lazily fetched ast
 * bucket, so at that instant it holds a placeholder and is a couple of hundred pixels tall. The
 * description then arrived into a popup frozen at its loading height: a 200px box with 800px of text
 * scrolling inside it, on a screen with room to show the lot. So instead: watch the popup, and pin only
 * once its size has stopped changing. If it never settles, it is never pinned — which is just the
 * original `height: auto` behaviour, and safe.
 *
 * Skipped: pickers that manage their own fill-and-scroll layout (the filter/ref search result lists),
 * and any picker that already has an explicit height — the popup-size-sync feature sets one itself,
 * and a user resize sets one too, both of which should win.
 */
// 'info-modal' = the description popup: it navigates (each linked term pushes a new node), so it must
// re-fit each node's text rather than stay pinned at its opening height.
// 'settings-modal' = the Settings dialog: it already has an explicit `height: 70vh` with a flex body
// that scrolls internally (.settings-body/.settings-pane), so its CSS height should stand.
const SELF_SIZED = ['fsel', 'ref-search', 'info-modal', 'settings-modal'];

/** How long the height must hold steady before we call it settled. Long enough to cover an ast bucket
 *  arriving from cache or the network on a warm start; short enough that a dropdown opened straight
 *  after the popup still grows it (the old behaviour) rather than being clipped. */
const SETTLE_MS = 350;

export function PopupSizeLock() {
  useEffect(() => {
    const watched = new WeakSet<Element>();
    const observers: ResizeObserver[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const watch = (el: HTMLElement) => {
      if (watched.has(el)) return;
      if (el.style.height) return; // already sized by popup-size-sync or a user resize
      if (SELF_SIZED.some((c) => el.classList.contains(c))) return;
      watched.add(el);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const pin = () => {
        ro.disconnect();
        if (!el.isConnected || el.style.height) return;
        const h = el.offsetHeight;
        if (h > 0) el.style.height = `${h}px`;
      };
      const restart = () => {
        if (timer) {
          clearTimeout(timer);
          timers.delete(timer);
        }
        timer = setTimeout(pin, SETTLE_MS);
        timers.add(timer);
      };
      // ResizeObserver fires once on observe with the current size, which starts the clock.
      const ro = new ResizeObserver(restart);
      ro.observe(el);
      observers.push(ro);
    };

    document.querySelectorAll<HTMLElement>('.picker').forEach(watch);
    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains('picker')) watch(node);
          node.querySelectorAll?.<HTMLElement>('.picker').forEach(watch);
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      observers.forEach((r) => r.disconnect());
      timers.forEach(clearTimeout);
    };
  }, []);
  return null;
}
