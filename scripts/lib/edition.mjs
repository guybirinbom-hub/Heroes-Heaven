/*
 * WHICH EDITION A RECORD IS SHOWN AS, AND WHAT THE REMASTER RENAMED.
 *
 * `applyEditionFilter` drops two of the five `edition` values and keeps three. Two scripts need that
 * split — `edition-drift-check.mjs` to find records we hide that the Archives have since reprinted,
 * and `repair-dropped-inline.mjs` to know whether a phrase lifted from the Archives may carry legacy
 * vocabulary into text the app presents as current. Duplicating the sets is how they drift apart, so
 * they live here once.
 */

/** The two values applyEditionFilter drops, and the three it keeps. */
export const HIDDEN = new Set(['legacy', 'legacy-era']);
export const CURRENT = new Set(['remaster', 'remaster-era', 'neutral']);

/**
 * The remaster renames that are strictly 1:1, so a word lifted out of a legacy printing can be carried
 * into current text without changing what the rule says.
 */
export const REMASTER_RENAME = new Map([
  ['positive', 'vitality'],
  ['negative', 'void'],
  ['flat-footed', 'off-guard'],
]);

/**
 * Alignment damage is NOT a rename — the remaster redistributed it across spirit, vitality and void
 * depending on the source, so there is no substitution that is right in every case. A phrase carrying
 * one of these has to be refused rather than guessed at.
 */
export const NO_CLEAN_RENAME = /^(?:good|evil|chaotic|lawful|alignment)$/i;

/** Rewrite the 1:1 renames inside a lifted phrase, preserving the punctuation around each word. */
export const toCurrentTerms = (words) =>
  words.map((w) => {
    const bare = w.replace(/[^A-Za-z-]/g, '').toLowerCase();
    const to = REMASTER_RENAME.get(bare);
    return to ? w.replace(new RegExp(bare, 'i'), to) : w;
  });
