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
    setHist((h) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(h.present) : updater;
      if (next === h.present) return h;
      const now = Date.now();
      const coalesce =
        !!opts?.coalesce && !!opts.tag && lastPush.current.tag === opts.tag && now - lastPush.current.time < COALESCE_MS;
      lastPush.current = { time: now, tag: opts?.tag };
      if (coalesce) {
        // Extend the current step in place — no new past entry, and any redo branch is dropped.
        return { past: h.past, present: next, future: [] };
      }
      const past = h.past.length >= MAX_DEPTH ? [...h.past.slice(1), h.present] : [...h.past, h.present];
      return { past, present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (!h.past.length) return h;
      lastPush.current = { time: 0 }; // a fresh edit after undo starts a new step
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (!h.future.length) return h;
      lastPush.current = { time: 0 };
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    });
  }, []);

  return { state: hist.present, set, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0 };
}
