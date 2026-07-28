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
import type { Character, ContentDatabase, FeatChoiceDef } from './types';
import { ownedFeatureIds } from './derive';

export interface DailyChoice {
  /** Storage key in PlayState.dailyChoices — `${recordId}:${flag}`. */
  key: string;
  recordId: string;
  recordName: string;
  prompt: string;
  /** 'array' renders option chips; 'text' renders a field — Quick Study's Lore subject and Call Gun's
   *  bonded weapon have no closed option set, so chips would misrepresent them. */
  kind: 'array' | 'text';
  options: { value: string; label: string; description?: string }[];
}

/** `${recordId}:${flag}` — the one place this key is spelled, so callers can't drift. */
export const dailyChoiceKey = (recordId: string, flag: string) => `${recordId}:${flag}`;

/** Records that can carry a daily choice, in the order the Rest sheet should list them. */
function ownedRecords(c: Character, db: ContentDatabase): { id: string; name: string; choice?: FeatChoiceDef }[] {
  const out: { id: string; name: string; choice?: FeatChoiceDef }[] = [];
  const push = (id: string | null | undefined, bucket: Record<string, { name: string; choice?: FeatChoiceDef }> | undefined) => {
    if (!id || !bucket) return;
    const r = bucket[id];
    if (r) out.push({ id, name: r.name, choice: r.choice });
  };
  for (const f of c.feats ?? []) push(f.featId, db.feats as never);
  for (const id of ownedFeatureIds(c, db)) push(id, db.classFeatures as never);
  push(c.heritageId, db.heritages as never);
  push(c.ancestryId, db.ancestries as never);
  push(c.backgroundId, db.backgrounds as never);
  // Items only count while actually in use — a wand in your backpack prepares nothing.
  for (const inv of c.inventory ?? []) {
    if (inv.equipped || inv.worn || inv.invested) push(inv.itemId, db.items as never);
  }
  return out;
}

/** Every daily-preparation choice this character has to make, deduped by key. */
export function dailyChoicesFor(c: Character, db: ContentDatabase): DailyChoice[] {
  const seen = new Set<string>();
  const out: DailyChoice[] = [];
  for (const rec of ownedRecords(c, db)) {
    const def = rec.choice;
    if (!def?.daily) continue;
    // 'domains'/'skills' resolve against the BUILD, not the morning, so they never belong at rest.
    if (def.kind !== 'array' && def.kind !== 'text') continue;
    const options = def.kind === 'array' ? (def.options ?? []) : [];
    // An 'array' choice with no options is malformed data — skip it rather than render an empty row.
    if (def.kind === 'array' && !options.length) continue;
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

/** Human-readable label for a stored answer ("Severe heat"), or null when unset/stale. */
export function dailyChoiceLabel(choice: DailyChoice, stored: Record<string, string> | undefined): string | null {
  const value = stored?.[choice.key];
  if (!value) return null;
  // Free text is its own label — there is no option list to look it up in.
  if (choice.kind === 'text') return value;
  // A stored value can go stale if the record's options change; show nothing rather than a raw slug.
  return choice.options.find((o) => o.value === value)?.label ?? null;
}
