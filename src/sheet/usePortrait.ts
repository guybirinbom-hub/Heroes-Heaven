import { useEffect, useReducer } from 'react';
import { getSharpPortrait, subscribePortraits } from '../data/portraitStore';

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
