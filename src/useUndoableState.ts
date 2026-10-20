import { useCallback, useRef, useState } from 'react';

/**
 * A piece of state with undo/redo history. Wraps a value in a { past, present, future } timeline:
 * `set` records a new history step (or coalesces rapid edits sharing a tag into the current step,
 * so typing into a field is one undo, not one-per-keystroke); `undo`/`redo` walk the timeline.
 * History is in-memory (session-scoped) and depth-capped so it can't grow unbounded.
 *
 * NOT EVERY CHANGE IS AN UNDO STEP (S4, 2026-10-20). A change that is not this screen's own action —
 * another tab's write folded in, a cloud copy adopted — is set with `record: false`: it moves the present
 * and leaves the steps alone. A step is kept as the pair it was (`before` → `after`), so undoing it once
 * such a change came in carries the step back onto the present with `revert` (App: a three-way revert,
 * src/data/rosterMerge.ts revertRosterStep) rather than restoring the old snapshot — which took back the
 * other tab's change and kept this tab's own (Ctrl+Z after the other tab gave a dagger removed the
 * dagger, everywhere). Without `revert` (or with nothing come in since the step) undo restores `before`
 * exactly, as it always did.
 */

interface Step<T> {
  before: T;
  after: T;
}

interface History<T> {
  past: Step<T>[];
  present: T;
  future: Step<T>[];
}

const MAX_DEPTH = 60;
/** Edits sharing a tag within this window collapse into one undo step (e.g. typing a number). */
const COALESCE_MS = 350;

export interface Undoable<T> {
  state: T;
  /** Record a change as a new (or coalesced) history step. `record: false`: a change that is not an undo
   *  step (another tab's, the cloud's) — the present moves, the steps stay; `resetHistory` also clears
   *  every step (the value now belongs to someone else: another account). */
  set: (updater: T | ((prev: T) => T), opts?: { coalesce?: boolean; tag?: string; record?: boolean; resetHistory?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface UndoableOptions<T> {
  /** Carry a step from `from` to `to` onto `present`, which changed since the step without a step of its
   *  own. Default: `to` (the snapshot). */
  revert?: (present: T, from: T, to: T) => T;
}

export function useUndoableState<T>(initial: T | (() => T), options: UndoableOptions<T> = {}): Undoable<T> {
  const [hist, setHist] = useState<History<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const lastPush = useRef<{ time: number; tag?: string }>({ time: 0 });
  const revertRef = useRef(options.revert);
  revertRef.current = options.revert;
  /** `present` carried along the step `from` → `to`: the snapshot when nothing came in since. */
  const carry = (present: T, from: T, to: T): T => (present === from || !revertRef.current ? to : revertRef.current(present, from, to));

  const set = useCallback<Undoable<T>['set']>((updater, opts) => {
    if (opts?.record === false) {
      // Not a step — and the next edit must not coalesce into the step before it, which would then
      // carry this change as part of that step.
      lastPush.current = { time: 0 };
      const reset = !!opts.resetHistory;
      setHist((h) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(h.present) : updater;
        if (reset) return { past: [], present: next, future: [] };
        return next === h.present ? h : { past: h.past, present: next, future: h.future };
      });
      return;
    }
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
      const last = h.past[h.past.length - 1];
      if (coalesce && last && last.after === h.present) {
        // Extend the current step in place — no new past entry, and any redo branch is dropped.
        return { past: [...h.past.slice(0, -1), { before: last.before, after: next }], present: next, future: [] };
      }
      const step = { before: h.present, after: next };
      const past = h.past.length >= MAX_DEPTH ? [...h.past.slice(1), step] : [...h.past, step];
      return { past, present: next, future: [] };
    });
    lastPush.current = { time: now, tag: opts?.tag };
    // `carry` reads a ref only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => {
    // Reset at call time, like set() above — not inside the updater, which React may not run until
    // it flushes. A set() dispatched in the same batch right after this undo() (same synchronous
    // tick) must see the reset already, or it coalesces against a tag/timestamp undo was about to
    // clear and drops a past entry that undo had just restored.
    lastPush.current = { time: 0 }; // a fresh edit after undo starts a new step
    setHist((h) => {
      if (!h.past.length) return h;
      const s = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: carry(h.present, s.after, s.before), future: [s, ...h.future] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redo = useCallback(() => {
    lastPush.current = { time: 0 }; // same call-time reset as undo(), see comment above
    setHist((h) => {
      if (!h.future.length) return h;
      const s = h.future[0];
      return { past: [...h.past, s], present: carry(h.present, s.before, s.after), future: h.future.slice(1) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state: hist.present, set, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0 };
}
