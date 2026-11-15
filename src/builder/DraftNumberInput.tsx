import { useEffect, useRef, useState } from 'react';
import { useUnsavedWork } from '../data/unsavedWork';

/**
 * A number box the player can EMPTY while typing (phone audit 2026-10-14, finding D6).
 *
 * The Overrides boxes were controlled straight from the saved value and wrote on every keystroke. An
 * emptied box parsed as NaN, which reverted the override, so the box refilled with the computed value in
 * the middle of the edit: changing Dex 12 to 8 by Backspace, Backspace, 8 gave 128, and that was saved.
 * On a phone there is no easy select-all, so that was THE way to change a number.
 *
 * Here the box keeps its own text while the player edits it and decides once, when they leave it:
 *  - something that parses -> `onCommit(n)` (clamped to `min` / `max`),
 *  - an empty box -> `onClear()` (the caller's "revert to computed"),
 *  - anything else (a lone "-") -> nothing changes, and the box shows the saved value again.
 * Focusing and leaving without typing changes nothing, so a tap never pins a value by accident. Enter
 * commits too, and so does leaving the page while the box still holds an edit (an unmount).
 *
 * The Tweaks editors (plan B WP7) use it for every number part: `value` null shows an empty box with its
 * `placeholder` (the book number, "book: 18"); `onDraft` hears each keystroke that reads as a number (or an
 * emptied box, null) — the Add-a-tweak editor keeps its unsaved draft from it, so "Add" pressed while the box
 * still has focus adds what is typed. A lone "-" or unreadable text is no draft.
 * Guards: test/overrides-write.test.tsx, test/tweaks-editors.test.tsx.
 */
export function DraftNumberInput({
  value,
  onCommit,
  onClear,
  onDraft,
  min,
  max,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: {
  /** The saved value, shown whenever the box is not being edited; null = none (an empty box). */
  value: number | null;
  onCommit: (n: number) => void;
  /** The box was emptied and left. */
  onClear: () => void;
  /** Each keystroke that reads as a number, or null for an emptied box (never for a lone "-"). */
  onDraft?: (n: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  // null = not being edited: the box shows `value`.
  const [draft, setDraft] = useState<string | null>(null);
  // The box shows text the browser cannot read as a number ("-", "12-", "1e"). A type="number" input
  // then reports value "" — the same as an emptied box — so without this a typo cleared the override
  // (final check 2026-10-14). Kept apart from `draft`: writing a marker into the controlled value would
  // make the browser wipe the half-typed text off the screen.
  const unreadable = useRef(false);
  // The latest of everything, for the unmount commit below (its closure is from the first render).
  const live = useRef({ draft, onCommit, onClear, min, max });
  live.current = { draft, onCommit, onClear, min, max };
  // A number still being typed is not saved until the box is left: closing or reloading the app now asks
  // first (data/unsavedWork.ts; checker 2026-11-08, test/unsaved-work-warning.test.tsx).
  const shown = useRef(value);
  shown.current = value;
  useUnsavedWork(
    () => live.current.draft != null && live.current.draft.trim() !== (shown.current == null ? '' : String(shown.current)),
  );
  const clamp = (n: number, lo: number | undefined, hi: number | undefined) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, n));
  const finish = () => {
    const { draft: d, onCommit: commit, onClear: clear, min: lo, max: hi } = live.current;
    if (d == null) return;
    live.current.draft = null;
    setDraft(null);
    const bad = unreadable.current;
    unreadable.current = false;
    const t = d.trim();
    if (t === '' && bad) return; // unreadable text, not an emptied box: nothing changes
    if (t === '') return clear();
    const n = parseInt(t, 10);
    if (Number.isNaN(n)) return;
    commit(clamp(n, lo, hi));
  };
  // Leaving the page while the box still holds an edit (no blur reaches an unmounting input) saves it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => finish(), []);
  return (
    <input
      type="number"
      inputMode="numeric"
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      min={min}
      max={max}
      value={draft ?? (value == null ? '' : String(value))}
      onChange={(e) => {
        const bad = !!e.target.validity?.badInput;
        unreadable.current = bad;
        setDraft(e.target.value);
        if (!onDraft || bad) return;
        const t = e.target.value.trim();
        if (t === '') return onDraft(null);
        const n = parseInt(t, 10);
        if (!Number.isNaN(n)) onDraft(n);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
