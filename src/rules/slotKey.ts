/**
 * A feat slot key at the start of a key: `<level>:<category>:<index>`, then the end or `#` / `:` (the Builder's
 * slotKey, featSlots.ts `featSlotKey`). A leaf module on purpose: the Tweaks write door (blocks/write.ts, which
 * build.ts imports) refuses a tweak that would store one (C32), and importing featSlots.ts there would close the
 * loop build.ts → write.ts → featSlots.ts → build.ts. featSlots.ts re-exports it, so every existing import stays.
 */
export const SLOT_PREFIX = /^(\d+):([a-z]+):(\d+)(?=$|[#:])/;

/** The answers made under a slot key: its sub-choice (`<slot>#n`), and the spell / Lore / effect / pick-a-feat
 *  answers (`<slot>:granted-spell`, `<slot>:0`, `<slot>:<choice id>`, `<slot>#1`). SLOT_KEYED less the pick. */
export const SLOT_ANSWER_MAPS = ['featChoices', 'featSpellChoices', 'featLoreChoices', 'effectChoices', 'pickFeatChoices'] as const;
/** Every build map whose keys START with a slot key: the pick, and every answer made under it. Here (a leaf)
 *  rather than in featSlots.ts so build.ts's Character.tweakKept (./tweakKept.ts, Tweaks phase 2 C46) reads the
 *  same list `swapSlotKeys` moves; featSlots.ts re-exports it. */
export const SLOT_KEYED = ['featPicks', ...SLOT_ANSWER_MAPS] as const;
/**
 * …and the keys that carry a slot AFTER `#`: a later pick taking's answer (build.ts `pickTakingVariants`,
 * package F 2026-10-16) — `major-lesson#10:class:4` in grantedFeatChoices, its familiar-spell pick
 * `granted:major-lesson#10:class:4:granted-spell`, a Lore subject `advanced-witchcraft#10:class:4:major-lesson:0`.
 * The slot there is the GRANTING feat's, so it moves with that pick: left behind, a "Move to slot" or Dual
 * Class switched on lost the second Major Lesson's answer and its hex with nothing said (checker, same day).
 */
export const VARIANT_KEYED = ['grantedFeatChoices', 'featSpellChoices', 'featLoreChoices'] as const;
/** The slot such a key carries after `#` (group 1). */
export const VARIANT_SLOT = /#(\d+:[a-z]+:\d+)(?=$|:)/;

/** Does `k` hold slot `slot` in either form `swapSlotKeys` moves (featSlots.ts): at its start (the slot itself,
 *  `slot#…`, `slot:…`), or after `#` (a later taking's variant key)? `slot` is a bare slot key. */
export const keyHoldsSlot = (k: string, slot: string): boolean => SLOT_PREFIX.exec(k)?.[0] === slot || VARIANT_SLOT.exec(k)?.[1] === slot;
