import { useEffect, useRef } from 'react';

/**
 * Escape-to-close for modals/overlays. A single shared window listener dismisses only the TOPMOST
 * (most recently mounted) overlay — matching click-outside — so stacked modals unwind one level per
 * Escape instead of all closing at once. Each mounted hook contributes one entry to a LIFO stack;
 * entries read their close handler through a ref so re-renders never reorder the stack.
 */
type Entry = { get: () => (() => void) | undefined };
const stack: Entry[] = [];
let listening = false;

function handleKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // Find the topmost entry that currently has a close handler (skip no-op entries that passed
  // `undefined`), so an overlay without its own dismiss doesn't swallow Escape from the one below.
  for (let i = stack.length - 1; i >= 0; i--) {
    const fn = stack[i].get();
    if (fn) {
      fn();
      return;
    }
  }
}

export function useEscapeClose(onClose: (() => void) | undefined): void {
  const ref = useRef(onClose);
  ref.current = onClose; // keep the latest handler without reordering the stack on re-render
  useEffect(() => {
    const entry: Entry = { get: () => ref.current };
    stack.push(entry);
    if (!listening) {
      window.addEventListener('keydown', handleKey);
      listening = true;
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener('keydown', handleKey);
        listening = false;
      }
    };
  }, []);
}
