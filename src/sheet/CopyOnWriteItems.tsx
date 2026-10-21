import { createContext, useContext } from 'react';
import type { ModeUsage } from '../rules/modes';
import type { ModeDef } from '../rules/types';

/**
 * Item ids THIS view must never edit in place: an edit of one makes a COPY under a fresh id, and the
 * caller repoints the edited instance to it — exactly what an edit of a printed item already does
 * (ItemEditorModal copy-on-write). The delete control of the Add-items list is hidden for them too.
 *
 * Provided by the GM's edit sheet with the item records the player's sheet CARRIES (src/data/carried.ts).
 * Why (2026-10-20, checker findings saving-C1 / coverage-F1 / semantics-C1): an in-place edit of a carried
 * record could reach nobody. Which copy of a record rides along is not authorship (`authoredKey` ignores
 * `carried`), so a push that changed only that copy was 'settled' on the player's device and never
 * applied, his pending overlay stood down on the next read, and his screen went back to the player's copy
 * — after telling him "Sent". A copy under a new id is a real change to the sheet (the instance points
 * at it), so it is applied, and the push carries the new record with it (owner ruling 2026-10-20: "the
 * others should see the same item as the player"). The player's own record is never changed by it.
 *
 * And by the player's OWN sheet (src/App.tsx `carriedOnlyItems`) with the item records only the roster
 * entry's `carried` holds — the device's own content lacks them: a GM-made item a push brought. 2026-10-20,
 * checker finding N1: edited in place (or "deleted", which retires it by SAVING it) the GM's record was
 * written into the player's homebrew — owner ruling 2026-10-20, "i dont want it in the homebrew". A copy
 * under a new id is the player's own record because they made it; the GM's is never written there.
 *
 * Null everywhere else: the player's own records are edited in place, as they always were.
 */
export const CopyOnWriteItemsContext = createContext<ReadonlySet<string> | null>(null);

export function useCopyOnWriteItems(): ReadonlySet<string> | null {
  return useContext(CopyOnWriteItemsContext);
}

/**
 * The same for MODES: mode ids this view must never edit in place or delete. Provided by the GM's edit
 * sheet with the modes the player's sheet CARRIES (src/data/carried.ts). The Modes panel hides Delete for
 * them; an edit reaches the sheet's own `onSaveMode`, which saves a COPY under a fresh id and repoints the
 * sheet's active modes to it (src/sheet/GmEditSheet.tsx saveModeDef).
 *
 * Why (2026-10-20, checker findings saving-R2-chk-2 / coverage-R2-gm-mode-edit-dead): edited in place, the
 * GM's change went into HIS saved modes under the carried id, the sheet kept drawing the carried copy
 * (foreign view: it wins), and the next push sent the old copy — the edit never showed and never reached
 * the player; for a mode the player wrote, a copy of it also landed in the GM's synced modes ("Never moved
 * into anyone's homebrew or saved modes", storage.ts SavedChar.carried). Delete only tombstoned the GM's
 * own id, which a foreign view ignores, so the mode stayed on.
 *
 * And by the player's OWN sheet (src/App.tsx `carriedOnlyModes`, round 3) with the modes only the roster
 * entry's `carried` holds — the device's own saved modes lack them: typically one the GM made on this
 * sheet and pushed. 2026-10-20, final findings N-a / N-c (owner ruling 2026-10-20, "i dont want it in the
 * homebrew"): an in-place edit wrote the GM's mode into the player's saved modes, and Delete wrote a
 * `mode:<id>` tombstone on their account while the id stayed in the character's active modes — so the GM,
 * whose device holds that mode, still saw it on, and the player did not. There an edit saves the player's
 * OWN copy under a fresh id, and Delete is "Remove from this character" (`ModesRemoveFromCharacterContext`).
 *
 * Null everywhere else: a player's own modes are edited and deleted in place, as they always were.
 */
export const CopyOnWriteModesContext = createContext<ReadonlySet<string> | null>(null);

export function useCopyOnWriteModes(): ReadonlySet<string> | null {
  return useContext(CopyOnWriteModesContext);
}

/**
 * Whether a copy-on-write mode (above) offers a Delete that means "take it off THIS character" — the
 * caller's `onDeleteMode` then removes it from the character's active modes, its companions' and the
 * roster entry's `carried`, and deletes nothing anywhere else (src/App.tsx, round 3, 2026-10-20). True on
 * the player's own sheet only. False (the default) on the GM's edit sheet, which offers no Delete for one:
 * it is not his to remove there, and his removal could reach nobody.
 */
export const ModesRemoveFromCharacterContext = createContext(false);

export function useModesRemoveFromCharacter(): boolean {
  return useContext(ModesRemoveFromCharacterContext);
}

/**
 * Which of this device's roster characters use which modes (src/data/carried.ts `modeUsage`), for the Modes
 * panel's per-character list (src/rules/modes.ts `modeListedFor`, Guy 2026-10-21: "modes need to be per
 * character"). Provided by App over every screen, from its live roster. Null (the default — a sheet drawn
 * outside the app) keeps the older answer: a mode no character owns is listed everywhere.
 */
export const ModeUsageContext = createContext<ModeUsage | null>(null);

export function useModeUsage(): ModeUsage | null {
  return useContext(ModeUsageContext);
}

/**
 * Save an edited mode as THIS character's own copy (fresh id, owned here, this character's play pointed at it)
 * instead of in place — the Modes editor's Save for a mode another roster character also uses
 * (src/rules/modes.ts `modeAlsoElsewhere`; review 2026-10-21: an edit on one character changed another's
 * numbers). Provided on the player's own sheet only (src/App.tsx copyModeHere); null elsewhere, where the
 * editor saves through its `onSave` as before. Never used by the toggle's claim.
 */
export const ModesSaveAsCopyContext = createContext<((mode: ModeDef) => void) | null>(null);

export function useModesSaveAsCopy(): ((mode: ModeDef) => void) | null {
  return useContext(ModesSaveAsCopyContext);
}
