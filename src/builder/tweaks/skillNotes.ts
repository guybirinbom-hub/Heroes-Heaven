/*
 * What a rank tweak means for ONE skill-increase option (plan B WP8; spec item 9, D8). Pure: the Builder's three
 * skill-increase pickers (the level's increase, the class's bonus increase, the background's) ask it per option.
 *
 *   - A skill held "exactly" by a live tweak is greyed with the reason. The clamp is final, so a hold live at the
 *     character's level wastes an increase at ANY level — the hold is read at `host.level`, not the viewed one.
 *   - The stored pick of this level is never greyed (it would vanish from under the player, Q27); when its step
 *     changes nothing, it gets a note under it instead — naming the tweak only when a floor live at that level
 *     is what already put the skill at that rank.
 *
 * `baseRank` is the skill's rank before this level's increase, read the way the page reads it (Builder
 * `baseSkills`: the overrides as of the viewed level, so a floor that starts later is not counted yet).
 */
import { heldExactly, tweakRankLines, type TweakHost } from '../../rules/blocks/active';
import { skillIncreaseCap, stepRank } from '../../rules/ranks';
import { targetName } from '../../rules/blocks/names';
import type { ProficiencyRank } from '../../rules/types';

export interface SkillTweakNote {
  /** Grey the option (never for the stored pick). */
  disabled?: boolean;
  /** Why it is greyed. */
  reason?: string;
  /** Said under the stored pick: its step changes nothing. */
  note?: string;
}

const rankWord = (r: ProficiencyRank) => r.charAt(0).toUpperCase() + r.slice(1);

/**
 * @param host   the draft build (its level is the character's level; the read-time rank sort may ride on it)
 * @param lvl    the level whose increase is being picked
 * @param key    the skill or Lore key (`thievery`, `lore:sailing`)
 * @param baseRank the rank before this level's increase
 * @param picked this option is the increase stored at `lvl` in this picker
 */
export function skillTweakNotes(host: TweakHost, lvl: number, key: string, baseRank: ProficiencyRank, picked = false): SkillTweakNote {
  const target = `skill:${key}`;
  const lines = tweakRankLines(host, target);
  const name = targetName(target);
  if (heldExactly(host, key)) {
    const held = lines.hold?.rank;
    const reason = `Held at ${held ? rankWord(held) : 'its rank'} by a tweak ("exactly") — an increase would change nothing.`;
    return picked ? { note: reason } : { disabled: true, reason };
  }
  if (!picked) return {};
  // The step the build takes (ranks.ts, the level's cap holds it back): nothing moves when it stays put.
  if (stepRank(baseRank, skillIncreaseCap(lvl)) !== baseRank) return {};
  // The floor that already put the skill at this rank by this level — the last one, as the timeline lists them.
  const floor = [...lines.floors].reverse().find((f) => f.level <= lvl && f.rank === baseRank);
  const why = floor ? ` (Tweak: at least ${rankWord(floor.rank)})` : '';
  return { note: `${name} is already ${rankWord(baseRank)} here${why} — this increase changes nothing. Pick another.` };
}
