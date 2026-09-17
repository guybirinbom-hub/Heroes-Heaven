import { useState } from 'react';
import type { Character, Customization } from '../rules/types';
import { CustomizeModal } from './CustomizeModal';
import { useBackHandler } from './useEscapeClose';

/** A stable ref the sheet's Customize buttons call. `CustomizeHost` writes the opener into it. */
export type CustomizeOpener = { current: () => void };

/**
 * The Customize drawer's OPEN FLAG, off the sheet.
 *
 * Owner: *"opening the Customization button for the first time is super laggy."* The flag used to be
 * `useState` inside CharacterSheet, so every open AND every close re-rendered the entire sheet — the
 * rail, the tab, the inventory, the spell list, all of it — for a panel that draws over the top of it
 * and changes nothing underneath. On a level-20 caster that was ~30 ms of React work per toggle, and
 * it grows with the character: the bigger the sheet, the slower the drawer feels.
 *
 * So the flag lives in this sibling component instead, and the buttons reach it through `opener`, a
 * ref. Writing a ref is not a state update, so the sheet is not re-rendered at all; only this subtree
 * is. What the drawer PREVIEWS still repaints the sheet, because that goes through `onCustomize` and
 * changes the character — which is the whole point of previewing live.
 */
export function CustomizeHost({
  opener,
  character,
  globalDefault,
  onCustomize,
}: {
  opener: CustomizeOpener;
  character: Character;
  globalDefault: Customization;
  onCustomize: (fn: (c: Character) => Character) => void;
}) {
  const [open, setOpen] = useState(false);
  // `setOpen` is stable, so this writes the same closure on every render — and it must be written
  // during render, not in an effect: the button that reads it can be clicked on the very first frame.
  opener.current = () => setOpen(true);
  // Escape / Android Back close the drawer, exactly as they did while the flag lived on the sheet.
  useBackHandler(open, () => setOpen(false));
  if (!open) return null;
  return (
    <CustomizeModal
      character={character}
      globalDefault={globalDefault}
      onCustomize={onCustomize}
      onClose={() => setOpen(false)}
    />
  );
}
