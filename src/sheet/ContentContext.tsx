import { createContext, useContext } from 'react';
import type { ContentDatabase } from '../rules/types';

/** The loaded content database, provided once near the app root so deeply-nested description
 *  popups can resolve cross-references without prop-drilling `content` everywhere. */
export const ContentContext = createContext<ContentDatabase | null>(null);

export function useContent(): ContentDatabase | null {
  return useContext(ContentContext);
}
