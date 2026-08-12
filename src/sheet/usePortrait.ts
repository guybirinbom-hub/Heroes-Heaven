import { useEffect, useReducer } from 'react';
import { getSharpPortrait, subscribePortraits } from '../data/portraitStore';
import type { CharacterAppearance } from '../rules/types';

/**
 * The best portrait to display: the on-device sharp copy (installed app) when it's present for `ref`,
 * otherwise the synced compressed `fallback`. Re-renders when the sharp store changes (its initial
 * async load, or a new upload landing), so a portrait sharpens in place as soon as its local copy is
 * available. On the web (no sharp copies) this simply always returns `fallback`.
 */
export function usePortrait(ref: string | undefined, fallback: string | undefined): string | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribePortraits(bump), []);
  return getSharpPortrait(ref) ?? fallback;
}

/**
 * The image for a SMALL square slot — the sheet's top bar, a roster card, the party list.
 *
 * Prefers the square the player framed themselves (`avatar`), because everything below it is going to
 * be centre-cropped by CSS, and a centre crop of a standing figure shows their chest. Falls back to the
 * portrait when they never framed one, which is exactly the old behaviour.
 */
export function useAvatar(appearance: CharacterAppearance | undefined): string | undefined {
  const full = usePortrait(appearance?.portraitRef, appearance?.portrait);
  return appearance?.avatar ?? full;
}
