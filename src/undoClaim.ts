/*
 * Who owns Ctrl+Z.
 *
 * App.tsx binds Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y globally to the ROSTER timeline, with no mode gate. A
 * screen that keeps its own undo history has to take the shortcut over while it is on screen, or undo
 * silently reverts something else. The builder is exactly that case: its entire state is a BuildState
 * the roster knows nothing about, so Ctrl+Z inside it used to rewind a character edit BEHIND the
 * builder while leaving the half-built character untouched — and Builder.tsx prints "You can undo with
 * Ctrl+Z" on its own lower-the-level dialog, a promise the app did not keep.
 *
 * A module-level COUNTER, not a boolean and not React state, for the same two reasons as
 * integration/combatUndoClaim.ts (which claims the same shortcut for combat, and which this
 * deliberately does not merge with — that one is part of a removable integration seam):
 *  - App's keydown listener is created once and must read the CURRENT owner at event time, not a
 *    value closed over at render.
 *  - A counter survives React StrictMode's mount → unmount → mount, which would otherwise release a
 *    claim the remounted screen still holds.
 */

let claims = 0;

/** Take Ctrl+Z for this screen's own timeline. Returns the release function — use it as an effect
 *  cleanup, so the claim can never outlive the screen that made it. */
export function claimUndo(): () => void {
  claims += 1;
  let released = false;
  return () => {
    if (released) return; // a cleanup must never double-decrement
    released = true;
    claims = Math.max(0, claims - 1);
  };
}

/** True while some screen owns Ctrl+Z and the app-wide roster undo should stand down. */
export function undoIsClaimed(): boolean {
  return claims > 0;
}
