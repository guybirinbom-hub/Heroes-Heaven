/*
 * CHECK 8 of scripts/reprint-check.mjs, as pure functions so a test can pin the verdict on text it
 * controls (test/batchP02-gap-data-rows-2.test.ts). The check itself reads the Archives mirror and
 * core-descriptions.json; this file only says how one prose body is judged against its own page and
 * the pages its document replaced.
 *
 * Two readings, both "the prose is the printing its document replaced" (gold-set R12: a record follows
 * one printing, whole):
 *
 *   margin    - the share of the prose's words (4+ letters) found on the old page beats the share found
 *               on its own page by more than 0.05. The rule CHECK 8 shipped with.
 *   verbatim  - EVERY counted word of the prose is on the old page and not every one is on its own page.
 *               batch P02: distracting-spellstrike#description. feats/distracting-spellstrike carried the
 *               feat-2854 body (the older printing: "The Feint gains the arcane, illusion, and visual
 *               traits", where feat-9053 prints "arcane and visual") through an effect-backfill row,
 *               and the margin rule passed it: own 0.951, old 1.000, a margin of 0.049. A reprint that changes only a few words leaves every margin
 *               that small, so the margin alone cannot see the short bodies. The verbatim reading has no
 *               tuning constant: the prose contains words only the replaced page has, and none only its
 *               own page has.
 */

/** The counted words of a prose body: 4+ letters, lower case, markup and AoN link targets dropped. */
export const proseWords = (s) =>
  new Set(String(s).toLowerCase().replace(/<[^>]*>/g, ' ').replace(/\([^)]*\.aspx[^)]*\)/gi, ' ').match(/[a-z]{4,}/g) ?? []);

/** The share of `w` (a proseWords set) that appears in `text`. */
export const wordShare = (w, text) => {
  const t = proseWords(text);
  let n = 0;
  for (const x of w) if (t.has(x)) n++;
  return w.size ? n / w.size : 0;
};

/**
 * Judge one record's prose. `olds` is [[docId, text], ...] for the documents its own page replaced.
 * Returns null when the prose reads like its own printing, else { kind: 'margin' | 'verbatim', best }.
 */
export function movedProseVerdict(prose, ownText, olds) {
  const w = proseWords(prose);
  const own = wordShare(w, ownText ?? '');
  let best = null;
  let bestShare = -1;
  for (const [id, text] of olds) {
    const s = wordShare(w, text ?? '');
    if (s > bestShare) { best = id; bestShare = s; }
  }
  if (bestShare > own + 0.05) return { kind: 'margin', best };
  if (bestShare === 1 && own < 1) return { kind: 'verbatim', best };
  return null;
}
