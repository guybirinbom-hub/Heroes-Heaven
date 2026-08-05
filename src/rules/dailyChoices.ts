/*
 * Choices re-made at DAILY PREPARATIONS.
 *
 * Most feat choices are settled once, when you take the feat, and belong to the build. A smaller set
 * is re-chosen every morning — "During your daily preparations, choose to be protected from severe
 * cold or severe heat" (Environmental Adaptability), "choose Fear, Phantom Pain, or Sure Strike"
 * (Mask of Power). Those answers are PLAY state: they change nightly and must be changeable without
 * editing the character.
 *
 * A record opts in with `choice.daily = true`; everything here is driven by that flag, so wiring a
 * new feat is a data edit, not a code edit.
 */
import type { Character, ContentDatabase } from './types';
import { dailyChoiceKey, ownedDailyChoiceRecords as ownedRecords } from './derive';
import { openChoiceOptions } from './openChoice';

export { dailyChoiceKey } from './derive';

export interface DailyChoice {
  /** Storage key in PlayState.dailyChoices — `${recordId}:${flag}`. */
  key: string;
  recordId: string;
  recordName: string;
  prompt: string;
  /** 'array' renders option chips; 'text' renders a field (Quick Study's Lore subject, Call Gun's
   *  bonded weapon); 'open' renders a searchable list resolved from content — Aroden's Innovation
   *  picks "a general feat of 3rd level or lower", which is far too many for chips. */
  kind: 'array' | 'text' | 'open';
  options: { value: string; label: string; description?: string }[];
}



/** Every daily-preparation choice this character has to make, deduped by key. */
export function dailyChoicesFor(c: Character, db: ContentDatabase): DailyChoice[] {
  const seen = new Set<string>();
  const out: DailyChoice[] = [];
  for (const rec of ownedRecords(c, db)) {
    const def = rec.choice;
    if (!def?.daily) continue;
    // 'domains'/'skills' resolve against the BUILD, not the morning, so they never belong at rest.
    if (def.kind !== 'array' && def.kind !== 'text' && def.kind !== 'open') continue;
    const options =
      def.kind === 'array'
        ? (def.options ?? [])
        : def.kind === 'open'
          ? openChoiceOptions(def.from, db, { character: c }).map((o) => ({ value: o.id, label: o.name, description: o.description }))
          : [];
    // An array/open choice with nothing to offer is malformed or unresolvable — skip it rather than
    // render an empty row the player can't answer (and which would block "Prepare for the day").
    if (def.kind !== 'text' && !options.length) continue;
    const key = dailyChoiceKey(rec.id, def.flag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, recordId: rec.id, recordName: rec.name, prompt: def.prompt, kind: def.kind, options });
  }
  return out;
}

/** The choices with no stored answer yet — what "reuse" still has to ask for the first time. */
export function unansweredDailyChoices(choices: DailyChoice[], stored: Record<string, string> | undefined): DailyChoice[] {
  return choices.filter((ch) => !stored?.[ch.key]);
}

/**
 * What this morning's answers actually GRANT.
 *
 * Until now a daily choice was recorded and nothing more — the Rest sheet collected the answer and no
 * sheet number moved, so "habituate your skin against this type of injury" was a note. An answer
 * grants only while it is the stored one, so tomorrow's pick replaces today's rather than stacking.
 *
 * Reads the CHOICE DEFINITIONS rather than the raw store, so an answer left behind by a record the
 * character no longer owns grants nothing.
 */
/** Human-readable label for a stored answer ("Severe heat"), or null when unset/stale. */
export function dailyChoiceLabel(choice: DailyChoice, stored: Record<string, string> | undefined): string | null {
  const value = stored?.[choice.key];
  if (!value) return null;
  // Free text is its own label — there is no option list to look it up in.
  if (choice.kind === 'text') return value;
  // A stored value can go stale if the record's options change; show nothing rather than a raw slug.
  return choice.options.find((o) => o.value === value)?.label ?? null;
}
