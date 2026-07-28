/*
 * Specific familiars — named familiar "templates" (Pipefox, Imp, Aeon Wyrd, …).
 *
 * The roster used to be hardcoded here (9 hand-authored entries). It now lives in
 * public/core.json under `specificFamiliars`, imported from the Archives of Nethys mirror by
 * scripts/import-companions.mjs — so it carries every published specific familiar plus a source
 * book. This module is the typed accessor the rest of the app goes through; ids are unchanged, so
 * saved characters keep their familiar.
 */
import type { ContentDatabase, SpecificFamiliar } from './types';

export type { SpecificFamiliar, SpecificFamiliarSpecial } from './types';

/** Every specific familiar in the content database, alphabetical by name. */
export function specificFamiliars(content: ContentDatabase): SpecificFamiliar[] {
  return Object.values(content.specificFamiliars ?? {}).sort((a, b) => a.name.localeCompare(b.name));
}

/** One specific familiar by id (undefined id → undefined, i.e. a generic familiar). */
export function specificFamiliar(content: ContentDatabase, id: string | undefined): SpecificFamiliar | undefined {
  return id ? content.specificFamiliars?.[id] : undefined;
}
