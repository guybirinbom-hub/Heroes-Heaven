import { useEffect, useRef, useState } from 'react';

/**
 * A number box the player can EMPTY while typing (phone audit 2026-10-14, finding D6).
 *
 * The Overrides boxes were controlled straight from the saved value and wrote on every keystroke. An
 * emptied box parsed as NaN, which reverted the override, so the box refilled with the computed value in
 * the middle of the edit: changing Dex 12 to 8 by Backspace, Backspace, 8 gave 128, and that was saved.
 * On a phone there is no easy select-all, so that was THE way to change a number.
 *
 * Here the box keeps its own text while the player edits it and decides once, when they leave it:
 *  - something that parses -> `onCommit(n)` (clamped to `min`),
 *  - an empty box -> `onClear()` (the caller's "revert to computed"),
 *  - anything else (a lone "-") -> nothing changes, and the box shows the saved value again.
 * Focusing and leaving without typing changes nothing, so a tap never pins a value by accident. Enter
 * commits too, and so does leaving the page while the box still holds an edit (an unmount).
 * Guard: test/overrides-write.test.tsx.
 */
export function DraftNumberInput({
  value,
  onCommit,
  onClear,
  min,
  className,
  'aria-label': ariaLabel,
}: {
  /** The saved value, shown whenever the box is not being edited. */
  value: number;
  onCommit: (n: number) => void;
  /** The box was emptied and left. */
  onClear: () => void;
  min?: number;
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
  const live = useRef({ draft, onCommit, onClear, min });
  live.current = { draft, onCommit, onClear, min };
  const finish = () => {
    const { draft: d, onCommit: commit, onClear: clear, min: lo } = live.current;
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
    commit(lo != null ? Math.max(lo, n) : n);
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
      value={draft ?? String(value)}
      onChange={(e) => {
        unreadable.current = !!e.target.validity?.badInput;
        setDraft(e.target.value);
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
