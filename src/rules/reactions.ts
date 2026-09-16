/*
 * Extra reactions — the row exists only when something CHANGES how many you get, and it prints no
 * number at all.
 *
 * Owner, 2026-09-16 (second ruling, after the screenshot below): *"don't show 1 per round because
 * everyone has one per round, it has no point; if a character has something with reaction amount
 * changes then add the reaction line and have a `*` and the `*` when clicked shows the reaction
 * changes."* So the row is the label and the situational star, and the star opens the list of what
 * changes the count.
 *
 * What the screenshot caught first: a guardian's Reactions row read "2 per round". The guardian does
 * not get two reactions. Reaction Time gives one more that *"you can use only for reactions from
 * guardian feats or class features (including Shield Block)"* — so a player who reads "2" plans a
 * Reactive Strike they may not make. Counting only the unrestricted extras fixed that number and left
 * a different useless one ("1 per round", true of every character alive), which is what the ruling
 * above removes: there is no count to be wrong about any more.
 *
 * The RESTRICTION is already in the data and needs no new field: `extraReaction.usableFor` IS the
 * printed clause naming what the reaction may be spent on ("Shield Block", "a Reactive Strike"), and
 * the field exists only because 15 feats and one class feature grant a restricted second reaction.
 * It is what each line of that popup says, and `isRestrictedReaction` is how the line knows whether
 * to say it — an unrestricted grant would leave `usableFor` empty or say "any reaction".
 */
import type { Character } from './types';

export type ExtraReaction = NonNullable<Character['extraReactions']>[number];

/** `usableFor` wordings that name NO restriction, i.e. a plain extra reaction. Anything else — any
 *  clause naming a thing to spend it on — restricts it. */
const UNRESTRICTED = /^(?:any\s+|an?\s+)?(?:reactions?|actions?)$|^any(?:thing|\s+purpose)?$/i;

/** Whether this grant restricts what its reaction may be spent on. */
export function isRestrictedReaction(r: { usableFor?: string }): boolean {
  const s = (r.usableFor ?? '').trim();
  return s !== '' && !UNRESTRICTED.test(s);
}

/* There is deliberately no `reactionsPerRound` here any more. It existed to print "N per round", and
 * the owner's ruling is that no such number goes on the sheet — a count nobody may rely on is worse
 * than no count, and the one every character shares says nothing. The popup lists the changes. */
