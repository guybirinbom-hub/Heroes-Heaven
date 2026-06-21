import { createContext, useContext } from 'react';
import type { DescNode } from './descref';

/**
 * Lets any DescriptionModal — wherever it is opened from — offer a "favorite" star that pins the
 * description to the Main-tab Pinned section, without prop-drilling onPlay through every caller
 * (InfoTerm, DescBody, FilterableSelect rows, RichText links, …). CharacterSheet provides it in
 * play mode; it is null elsewhere (e.g. the builder), where no star is shown.
 */
export interface PinDescApi {
  /** Is this description currently pinned? (matched by title) */
  has: (node: DescNode) => boolean;
  /** Pin/unpin this description. */
  toggle: (node: DescNode) => void;
}

export const PinContext = createContext<PinDescApi | null>(null);

export function usePinDesc(): PinDescApi | null {
  return useContext(PinContext);
}
