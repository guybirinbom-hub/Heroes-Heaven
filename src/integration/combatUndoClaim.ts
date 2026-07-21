/*
 * Who owns Ctrl+Z while the campaign tracker is on screen.
 *
 * WHY: Heroes Heaven binds Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y globally (App.tsx) to the CHARACTER undo
 * timeline, with no mode gating — so inside a campaign, a GM hitting Ctrl+Z after a bad damage roll
 * silently reverted an unrelated character edit (possibly one from before they opened the campaign)
 * and left the combat untouched. Combat has its own undo stack (combatStore.undo/redo), but it was
 * only reachable from two small glyph buttons in the rail.
 *
 * So the tracker CLAIMS the shortcut while it's mounted: there, undo means "undo the thing I just did
 * here". App.tsx checks `combatOwnsUndo()` and stands down; everywhere else Ctrl+Z keeps its usual
 * character-undo meaning. Both handlers stay window listeners — the claim is what stops them from
 * both firing and undoing two different things at once.
 *
 * A module-level COUNTER, not a boolean or React state:
 *  - App.tsx's keydown listener is created once and must read the CURRENT owner at event time, not a
 *    value closed over at render.
 *  - A counter (rather than a flag) survives React StrictMode's mount → unmount → mount, which would
 *    otherwise release a claim the remounted tracker still holds.
 *
 * Part of the removable seam — delete this file and App.tsx's one guard, and Ctrl+Z goes back to
 * always being the character undo.
 */

let claims = 0;

/** Claim Ctrl+Z for combat undo. Returns the release function (use it as an effect cleanup). */
export function claimCombatUndo(): () => void {
  claims += 1;
  let released = false;
  return () => {
    if (released) return; // a cleanup must never double-decrement
    released = true;
    claims = Math.max(0, claims - 1);
  };
}

/** True while the campaign tracker is on screen and Ctrl+Z should mean "undo the combat". */
export function combatOwnsUndo(): boolean {
  return claims > 0;
}
