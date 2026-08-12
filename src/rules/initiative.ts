/*
 * Initiative.
 *
 * "When you roll for initiative, you typically roll a Perception check … Sometimes, the GM might call
 * for a different type of check. For example, if you were Avoiding Notice during exploration, you
 * would roll a Stealth check." Several class features and feats say so outright — a rogue's Surprise
 * Attack, a bard's Fascinating Performance, Deception to Create a Diversion.
 *
 * The app had no initiative statistic at all: it was rolled with Perception, and every one of the ~45
 * initiative bonuses in situationalBonuses.ts is filed under `{kind: 'perception'}` because there was
 * nowhere else to put them. Incredible Initiative even prints "whatever statistic you roll for
 * initiative" and was pinned to Perception regardless.
 *
 * So initiative is now its own stat that READS another one. Nothing is re-tagged: the perception-filed
 * bonuses still apply when initiative is rolled with Perception (the default and the common case),
 * and a character who rolls it with a skill gets that skill's own line instead.
 */
import { derivePerception, deriveSkill, type StatLine } from './derive';
import { modeNumberBonus } from './modes';
import type { Character, ContentDatabase, ProficiencyKey } from './types';

/** What initiative is rolled with. `null`/absent = Perception, which is the default in the rules. */
export type InitiativeStat = ProficiencyKey | null | undefined;

export interface InitiativeLine extends StatLine {
  /** 'perception', or the skill it is rolled with. */
  stat: 'perception' | ProficiencyKey;
  /** Display name — "Perception", "Stealth". */
  label: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The initiative line. `override` lets a caller ask "what would it be with Stealth?" without mutating
 * the character — the Builder's picker preview uses it.
 */
export function deriveInitiative(c: Character, db?: ContentDatabase, override?: InitiativeStat): InitiativeLine {
  const stat = override !== undefined ? override : c.initiativeSkill;
  // A mode aimed at INITIATIVE specifically, on top of whatever the underlying stat already collected.
  // The underlying Perception/skill mode bonuses are already inside the line this builds on, so a
  // Perception mode still moves initiative the way it always did — this only adds the extra lane.
  const initMode = modeNumberBonus(c.activeModes, { kind: 'initiative' });
  if (!stat) {
    const p = derivePerception(c, db);
    return { ...p, modifier: p.modifier + initMode, stat: 'perception', label: 'Perception' };
  }
  const s = deriveSkill(c, stat, db);
  return {
    ...s,
    modifier: s.modifier + initMode,
    stat,
    label: stat.startsWith('lore:') ? `${cap(stat.slice(5))} Lore` : cap(stat),
  };
}

/**
 * Skills that can legitimately be rolled for initiative.
 *
 * Deliberately NOT every skill: the rules let the GM call for one that fits what you were doing, and
 * the ones with a printed initiative use are Stealth (Avoid Notice), Deception (Create a Diversion),
 * Diplomacy, Intimidation (Demoralize), Performance (Fascinating Performance), Society, Occultism,
 * Arcana, Religion, Nature and Medicine (recognising a threat). Offering all twenty-odd, including
 * every Lore, would turn a rules-supported choice into a free pick of your best number.
 */
export const INITIATIVE_SKILLS: ProficiencyKey[] = [
  'stealth',
  'deception',
  'diplomacy',
  'intimidation',
  'performance',
  'society',
  'arcana',
  'occultism',
  'religion',
  'nature',
  'medicine',
  'survival',
  'acrobatics',
  'athletics',
];
