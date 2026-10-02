/**
 * The card's scope rules — what a 'mine' card may leave out of, or fold inside, a record's page
 * (docs/card-design.md sections 2 rule 5 and 3; owner rulings in section 13).
 *
 * Card step 4: a PURE STUB. It names the rules and the one switch, and folds nothing: no surface folds
 * yet, so `foldsOf` returns no folds and scripts/card-truth-check.mjs's FOLDED-UNLISTED section reads 0
 * by measurement, not by assumption. Step 13 fills `foldsOf` from scripts/data/level-folds.json; the
 * guard already imports it, so the day a fold appears the check sees it.
 *
 * Card step 5 adds the printed set (the label table, canonLabel, printedSet): the 'mine' card and the
 * guard both read it from here. The tree predicates that use it live in astVisibility.ts.
 *
 * A plain .ts file with no JSX and no stylesheet, because the guard imports it through jiti.
 */

/** Owner ruling Q1 = A (2026-10-02): parts the character does not have yet are folded, never hidden. */
export const FUTURE_TREATMENT = 'fold' as const;
export type FutureTreatment = 'fold' | 'hide' | 'grey';

/**
 * The only rules allowed to leave page text off a 'mine' card (section 2 rule 5). Every omission the
 * guard logs carries one of these names (scripts/lib/card-scope.mjs classifyOmission reads this object);
 * an omission with none is a counted defect — S1-MISSING for a vocabulary label line, S1-UNNAMED for
 * any other line.
 */
export const OMISSION_RULES = {
  /** Other records' sections of a shared page. */
  'S-own': 'another record\'s section of a shared page',
  /** The "Specific Magic Armor / Weapons / Shields" link lists (ruled 2026-09-15). */
  'S-items': 'the item lists appended to a base item\'s page',
  /** Navigation, not rules: spoiler banners, "<X> leads to…", related-feat lists, where-to-get lines. */
  'S-furniture': 'navigation and furniture',
  /** A header line the surface prints in its own stat rows instead. */
  'S-printed': 'printed in the stat rows',
  /** Later-level text: folded, never deleted. */
  'S-future': 'a later level, folded',
  /** Choose-one options not picked: folded (owner ruling Q2 = A). */
  'S-pick': 'an option not picked, folded',
} as const;
export type OmissionRule = keyof typeof OMISSION_RULES;

/* ------------------------------------------------------------------------------------------------ */
/* The printed set (section 2 rule 4.2, plan F1) — card step 5.                                       */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The printed "use lines" and stat lines, each canonical label with the spellings a page or a stat row
 * uses for it. Moved here from scripts/lib/card-scope.mjs in card step 5 so the 'mine' card (which drops
 * a page header line only when the surface's own stat rows printed that label) and the guard (which
 * judges every label line) read ONE table.
 */
export const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Trigger: ['trigger'],
  Frequency: ['frequency'],
  Requirements: ['requirements', 'requirement'],
  Prerequisites: ['prerequisites', 'prerequisite'],
  Cost: ['cost'],
  Access: ['access'],
  'Craft Requirements': ['craft requirements'],
  Cast: ['cast'],
  // A ritual's header lines (docs/display-truth-plan.md F4's vocabulary).
  'Secondary Casters': ['secondary casters'],
  'Primary Check': ['primary check'],
  'Secondary Checks': ['secondary checks'],
  Range: ['range'],
  Area: ['area'],
  Targets: ['targets', 'target', 'target(s)'],
  Duration: ['duration'],
  Defense: ['defense', 'saving throw'],
  Price: ['price'],
  Bulk: ['bulk'],
  Usage: ['usage', 'worn slot'],
  Hands: ['hands'],
  Category: ['category'],
  Group: ['group'],
  Damage: ['damage'],
  Reload: ['reload'],
  'AC Bonus': ['ac bonus'],
  'Dex Cap': ['dex cap'],
  'Check Penalty': ['check penalty'],
  'Speed Penalty': ['speed penalty'],
  Strength: ['strength'],
  Hardness: ['hardness'],
  HP: ['hp', 'hit points'],
  BT: ['bt'],
};
const BY_ALIAS = new Map(Object.entries(LABEL_ALIASES).flatMap(([canon, al]) => al.map((a) => [a, canon] as const)));

/** A bold run's text → its canonical label, or null. "Activate", "Activate—Name" are Activate. */
export function canonLabel(text: unknown): string | null {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[:：]$/, '').trim().toLowerCase();
  if (!t) return null;
  if (/^activat(e|ion)\b/.test(t)) return 'Activate';
  return BY_ALIAS.get(t) ?? null;
}

/**
 * The printed set of one surface: the canonical labels its own stat-row function printed (FeatDetail's
 * featStatRows, ItemDetail's itemStatRows, SpellDetail's spellStatRows). A page header line is left off
 * a 'mine' card only when its label is in this set (S-printed); everything else the page prints shows.
 * StatDetailModal prints no stat rows, so its set is empty and every labelled page line shows.
 */
export function printedSet(labels: readonly string[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const l of labels ?? []) {
    const c = canonLabel(l);
    if (c) out.add(c);
  }
  return out;
}

/** One fold a card draws: its ledger id and whether scripts/data/level-folds.json lists it. */
export interface CardFold {
  id: string;
  listed: boolean;
}

/**
 * The folds a card draws for one (surface, record) row. Step 4: none — no surface scopes by level or
 * pick yet. Kept total (never throws) so the guard can call it for every row.
 */
export function foldsOf(_row: unknown): CardFold[] {
  return [];
}
