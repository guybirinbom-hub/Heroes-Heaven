import { useCallback, useRef, useState } from 'react';

/**
 * A piece of state with undo/redo history. Wraps a value in a { past, present, future } timeline:
 * `set` records a new history step (or coalesces rapid edits sharing a tag into the current step,
 * so typing into a field is one undo, not one-per-keystroke); `undo`/`redo` walk the timeline.
 * History is in-memory (session-scoped) and depth-capped so it can't grow unbounded.
 */

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_DEPTH = 60;
/** Edits sharing a tag within this window collapse into one undo step (e.g. typing a number). */
const COALESCE_MS = 350;

export interface Undoable<T> {
  state: T;
  /** Record a change as a new (or coalesced) history step. */
  set: (updater: T | ((prev: T) => T), opts?: { coalesce?: boolean; tag?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoableState<T>(initial: T | (() => T)): Undoable<T> {
  const [hist, setHist] = useState<History<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const lastPush = useRef<{ time: number; tag?: string }>({ time: 0 });

  const set = useCallback<Undoable<T>['set']>((updater, opts) => {
    // Coalescing is decided ONCE here, from lastPush.current as it stood before this call — never
    // inside the updater below. React 18 StrictMode double-invokes a setState updater function in dev
    // builds (both calls get the same `h`); a version of this that read AND wrote lastPush.current
    // inside the updater made the second, discarded invocation see the timestamp the first one had
    // just written — a same-tag, zero-ms-old match — and take the coalesce branch instead, so every
    // tagged edit lost the history entry for whatever came before it, dev-only. Reading before and
    // writing after keeps the updater a pure function of `h`, so both invocations agree.
    const now = Date.now();
    const coalesce =
      !!opts?.coalesce && !!opts.tag && lastPush.current.tag === opts.tag && now - lastPush.current.time < COALESCE_MS;
    setHist((h) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(h.present) : updater;
      if (next === h.present) return h;
      if (coalesce) {
        // Extend the current step in place — no new past entry, and any redo branch is dropped.
        return { past: h.past, present: next, future: [] };
      }
      const past = h.past.length >= MAX_DEPTH ? [...h.past.slice(1), h.present] : [...h.past, h.present];
      return { past, present: next, future: [] };
    });
    lastPush.current = { time: now, tag: opts?.tag };
  }, []);

  const undo = useCallback(() => {
    // Reset at call time, like set() above — not inside the updater, which React may not run until
    // it flushes. A set() dispatched in the same batch right after this undo() (same synchronous
    // tick) must see the reset already, or it coalesces against a tag/timestamp undo was about to
    // clear and drops a past entry that undo had just restored.
    lastPush.current = { time: 0 }; // a fresh edit after undo starts a new step
    setHist((h) => {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    lastPush.current = { time: 0 }; // same call-time reset as undo(), see comment above
    setHist((h) => {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    });
  }, []);

  return { state: hist.present, set, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0 };
}
