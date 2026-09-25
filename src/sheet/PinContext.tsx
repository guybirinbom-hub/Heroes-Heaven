import { createContext, useContext } from 'react';
import type { DescNode } from './descref';

/**
 * Lets any DescriptionModal — wherever it is opened from — offer a "favorite" star that pins the
 * description to the Main-tab Pinned section, without prop-drilling onPlay through every caller
 * (InfoTerm, DescBody, FilterableSelect rows, RichText links, …). CharacterSheet provides it in
 * play mode, the Builder on the build, and the campaign tracker on the GM screen; it is null elsewhere,
 * where no star is shown.
 */
export interface PinDescApi {
  /** Is this description currently pinned? (matched by title) */
  has: (node: DescNode) => boolean;
  /** Pin/unpin this description. */
  toggle: (node: DescNode) => void;
  /** Where the star pins to, for its tooltip — the character's "Pinned" section unless said otherwise. */
  where?: string;
}

export const PinContext = createContext<PinDescApi | null>(null);

export function usePinDesc(): PinDescApi | null {
  return useContext(PinContext);
}
