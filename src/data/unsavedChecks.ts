/*
 * The list of "unsaved work" checks itself, with no imports at all (data/unsavedWork.ts explains the
 * whole design and re-exports these). Kept apart so the campaign tracker's components — also built as
 * their own app (tracker/), with their own copy of React — can register a check without pulling Heroes
 * Heaven's React into that app (tracker/src/components/TextConverter.tsx).
 */
type Check = () => boolean;

const checks = new Set<Check>();

/** Register a check; returns the function that takes it away again. */
export function registerUnsavedWork(check: Check): () => void {
  checks.add(check);
  return () => {
    checks.delete(check);
  };
}

/** True when any registered check says its screen holds unsaved work. A check that throws counts as
 *  "unsaved": asking once too often is cheaper than losing a character. */
export function hasUnsavedWork(): boolean {
  for (const check of checks) {
    try {
      if (check()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Test seam: forget every check. */
export function _clearUnsavedChecks(): void {
  checks.clear();
}
