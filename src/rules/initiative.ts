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
import { derivePerception, deriveSkill, formatMod, type StatLine } from './derive';
import { modeModifiersFor, modeNumberBonus } from './modes';
import { explainStat, type SituationalNote, type StatRef } from './explain';
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

/**
 * Everything that changes THIS character's initiative — excluding the plain statistic it is rolled
 * with.
 *
 * Owner, 2026-09-15: *"in pf2e initiative isn't always perception"*. An Initiative row that always
 * repeated the Perception number said nothing, so the rail shows one only when this list is
 * non-empty: a bonus or penalty aimed at initiative, a clause on the underlying statistic that names
 * initiative, an active mode aimed at it, or the character rolling it with something else.
 *
 * Read through `explainStat` rather than off the registry directly. Two reasons, both about not
 * drifting: the `extra` lanes (an item's authored clauses, an answered choice) are assembled there
 * and would be silently missing from a second reader, and the wording is then the same one every
 * other star list in the app prints. The initiative breakdown DELEGATES to the statistic it reads —
 * see `explainStat`'s `initiative` case — so subtracting that statistic's own list is what leaves
 * the initiative-only terms.
 */
export function initiativeInfluences(c: Character, db: ContentDatabase): SituationalNote[] {
  const init = deriveInitiative(c, db);
  const innerRef: StatRef = init.stat === 'perception' ? { kind: 'perception' } : { kind: 'skill', skill: init.stat };
  const inner = explainStat(c, db, innerRef).situational ?? [];
  const all = explainStat(c, db, { kind: 'initiative' }).situational ?? [];
  const out: SituationalNote[] = [
    // What the initiative breakdown added on top of the statistic it reads — the `{kind:'initiative'}`
    // entries (Incredible Initiative, Swaggering Initiative, a juggernaut mutagen's -2).
    ...all.filter((s) => !inner.some((i) => i.text === s.text)),
    // …plus the entries filed against that statistic that SAY initiative. Battlefield Surveyor's
    // "+2 circumstance when you roll initiative using Perception" is a PERCEPTION entry and has to
    // be: it stops applying the moment the character rolls initiative with something else.
    ...inner.filter((s) => /initiative/i.test(s.text)),
  ];
  // An active mode aimed at initiative is named nowhere else: it moves the number (above), and the
  // breakdown's delegation only ever sees the underlying statistic's modes.
  for (const { mode, mod } of modeModifiersFor(c.activeModes, { kind: 'initiative' })) {
    out.push({ text: `${formatMod(mod.value)} ${mod.type} from ${mode}${mod.appliesWhen ? ` — ${mod.appliesWhen}` : ''}` });
  }
  // Rolling it with something else IS the influence — it is the whole reason a character Avoiding
  // Notice has an initiative worth reading separately from their Perception.
  if (c.initiativeSkill) out.unshift({ text: `Rolled with ${init.label} instead of Perception` });
  return out;
}
