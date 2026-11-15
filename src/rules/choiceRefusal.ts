/*
 * WHY A FEAT PLACE OR A PICK-A-FEAT REFUSES A FEAT, rule by rule (Tweaks phase 2, WP5, C22).
 *
 * `slotRefusal` (featSlots.ts) and `pickRefusal` (featPickGrants.ts) return EVERY rule that refuses a feat, each with
 * the player's words, and a live "Pick from any list" (`choice.anyList`, one block per rule) lifts them one by one:
 * a feat is taken only when every refusal can be lifted AND is (`liftedAll`). A leaf module, so both can share it
 * (featSlots.ts imports the build, which imports featPickGrants.ts).
 */
import type { Feat } from './types';

/** A rule a feat place or a pick refuses a feat for. `list`, `level` and `onlyAtLevel` are what a `choice.anyList`
 *  lifts; `taken` (the feat's cap: "The same feat more times", WP8) and `slotRule` (a mythic or impulse place's own
 *  rule, an impulse's element; C18) are never lifted here. */
export type SlotRule = 'list' | 'level' | 'onlyAtLevel' | 'taken' | 'slotRule';

export interface SlotRefusal {
  rule: SlotRule;
  /** The rule in the player's words ("A general feat, not a class feat"). */
  words: string;
  liftable: boolean;
}

const LIFTABLE: ReadonlySet<SlotRule> = new Set(['list', 'level', 'onlyAtLevel']);
export const refusal = (rule: SlotRule, words: string): SlotRefusal => ({ rule, words, liftable: LIFTABLE.has(rule) });

/** Every refusal liftable and lifted (none = taken). */
export function liftedAll(refusals: readonly SlotRefusal[], lifted: ReadonlySet<string> | undefined): boolean {
  if (!refusals.length) return true;
  if (!lifted) return false;
  return refusals.every((r) => r.liftable && lifted.has(r.rule));
}

/** The refusals a live tweak still has to lift: none = allowed. Only liftable ones are offered "Allow here". */
export const unlifted = (refusals: readonly SlotRefusal[], lifted: ReadonlySet<string> | undefined): SlotRefusal[] =>
  refusals.filter((r) => !lifted?.has(r.rule) || !r.liftable);

const CATEGORY_WORD: Record<string, string> = {
  ancestry: 'an ancestry',
  class: 'a class',
  skill: 'a skill',
  general: 'a general',
  bonus: 'a bonus',
  impulse: 'an impulse',
  archetype: 'an archetype',
  mythic: 'a mythic',
};
const categoryWord = (c: string) => CATEGORY_WORD[c] ?? `a ${c}`;
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);

/** "A general feat, not a class feat". */
export const categoryWords = (featCategory: string, wanted: string) => `${capFirst(categoryWord(featCategory))} feat, not ${categoryWord(wanted)} feat`;
/** "A level 6 feat: this place takes level 2 or lower" (the Tweaks sample's words). */
export const levelWords = (featLevel: number, cap: number, where = 'this place') => `A level ${featLevel} feat: ${where} takes level ${cap} or lower`;
/** "Only at level 1" — Bestial Manifestation's *"You can select this feat only at 1st level."* */
export const onlyAtWords = (level: number) => `Only at level ${level}`;
/** "An Elf feat, not a Human feat" when the feat names another record of the bucket, else "Not a Human feat". */
export function notOursWords(f: Feat, bucket: Record<string, { name?: string } | undefined>, ourId: string): string {
  const ours = bucket[ourId]?.name ?? ourId;
  const theirs = f.traits.find((t) => t !== ourId && bucket[t]);
  return theirs ? `${capFirst(article(bucket[theirs]?.name ?? theirs))} feat, not ${article(ours)} feat` : `Not ${article(ours)} feat`;
}
