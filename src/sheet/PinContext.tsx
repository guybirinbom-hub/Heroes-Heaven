import { createContext, useContext } from 'react';
import type { PinnedDesc } from '../rules/types';
import type { DescNode } from './descref';

/**
 * The node a star hands to the pin: a description node, plus (card step 19) the mode it was pinned from
 * and the popup's ours lines, and (package M round 2) the class a class feature was read for — all stored on
 * the pin by play.ts pinOf; none is part of its identity.
 */
export type PinNode = DescNode & Pick<PinnedDesc, 'mode' | 'ours' | 'classId'>;

/** The class a card node is read for, when it carries one: a pin reopened from the Pinned list keeps the
 *  class it was read for (PinnedDesc.classId). Any other node carries none. */
export function nodeClassOf(n: DescNode | undefined): string | undefined {
  const c = (n as PinNode | undefined)?.classId;
  return typeof c === 'string' && c ? c : undefined;
}

/**
 * Lets any DescriptionModal — wherever it is opened from — offer a "favorite" star that pins the
 * description to the Main-tab Pinned section, without prop-drilling onPlay through every caller
 * (InfoTerm, DescBody, FilterableSelect rows, RichText links, …). CharacterSheet provides it in
 * play mode, the Builder on the build, and the campaign tracker on the GM screen; it is null elsewhere,
 * where no star is shown.
 */
export interface PinDescApi {
  /** Is this description currently pinned? (matched by record — play.ts samePin) */
  has: (node: PinNode) => boolean;
  /** Pin/unpin this description. */
  toggle: (node: PinNode) => void;
  /** Where the star pins to, for its tooltip — the character's "Pinned" section unless said otherwise. */
  where?: string;
}

export const PinContext = createContext<PinDescApi | null>(null);

export function usePinDesc(): PinDescApi | null {
  return useContext(PinContext);
}
