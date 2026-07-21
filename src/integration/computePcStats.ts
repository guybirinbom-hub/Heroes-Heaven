import type { Character, ContentDatabase, ProficiencyRank } from '../rules/types';
import { SKILLS } from '../rules/types';
import {
  deriveAc,
  deriveMaxHp,
  deriveSave,
  derivePerception,
  deriveSkill,
  deriveClassDc,
  deriveSpellcasting,
  deriveSpeeds,
  deriveDefenses,
  abilityModifiers,
} from '../rules/derive';
import type { PcStats, ProfRank } from '../../tracker/src/utils/pcDetail';

/*
 * Turn a Heroes Heaven character into the initiative tracker's PcStats shape.
 *
 * The tracker already knows how to SHOW a PC's stats — in the initiative order (the "Show player AC
 * & saves" toggle) and on the party cards (the "Stats shown" sections) — but only from its own
 * PcStats model, which nothing populated in the embedded campaign view. HH has all of it derived
 * already; this is the one place that maps HH's numbers onto the tracker's field names.
 *
 * Every field is computed defensively (like computeSummary): an odd or partial character must never
 * throw and blank the whole party.
 *
 * Part of the removable seam; see ./README.md.
 */

const RANK: Record<ProficiencyRank, ProfRank> = {
  untrained: 'U',
  trained: 'T',
  expert: 'E',
  master: 'M',
  legendary: 'L',
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function computePcStats(c: Character, content: ContentDatabase): PcStats {
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const mods = safe(() => abilityModifiers(c), { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  const perception = safe(() => derivePerception(c), { rank: 'untrained' as ProficiencyRank, modifier: 0 });
  const fort = safe(() => deriveSave(c, 'fortitude', content), { rank: 'untrained' as ProficiencyRank, modifier: 0 });
  const ref = safe(() => deriveSave(c, 'reflex', content), { rank: 'untrained' as ProficiencyRank, modifier: 0 });
  const will = safe(() => deriveSave(c, 'will', content), { rank: 'untrained' as ProficiencyRank, modifier: 0 });
  const hpMax = safe(() => deriveMaxHp(c, content), c.hitPoints?.current ?? 0);

  const skills: Record<string, { mod: number; prof: ProfRank }> = {};
  for (const key of SKILLS) {
    const line = safe(() => deriveSkill(c, key, content), null);
    if (line) skills[cap(key)] = { mod: line.modifier, prof: RANK[line.rank] };
  }

  // The best spell DC across every spellcasting tradition the character has (a card shows one number).
  const spellDC = safe(() => {
    const dcs = (c.spellcasting ?? []).map((e) => deriveSpellcasting(c, e).dc).filter((n) => typeof n === 'number');
    return dcs.length ? Math.max(...dcs) : undefined;
  }, undefined);

  const senses = safe(() => {
    const list = deriveDefenses(c, content).senses.map((s) => s.name ?? '').filter(Boolean);
    return list.length ? list.join(', ') : undefined;
  }, undefined);

  const speed = safe(() => deriveSpeeds(c, content).land, undefined);

  return {
    ancestryClass:
      [c.ancestryId ? content.ancestries[c.ancestryId]?.name : undefined, c.classId ? content.classes[c.classId]?.name : undefined]
        .filter(Boolean)
        .join(' ') || undefined,
    level: c.level ?? 0,
    ac: safe(() => deriveAc(c, content).value, undefined),
    maxHP: hpMax,
    hpCurrent: c.hitPoints?.current ?? undefined,
    perceptionMod: perception.modifier,
    perceptionProf: RANK[perception.rank],
    fortMod: fort.modifier,
    fortProf: RANK[fort.rank],
    refMod: ref.modifier,
    refProf: RANK[ref.rank],
    willMod: will.modifier,
    willProf: RANK[will.rank],
    str: mods.str,
    dex: mods.dex,
    con: mods.con,
    int: mods.int,
    wis: mods.wis,
    cha: mods.cha,
    skills,
    speed: typeof speed === 'number' ? speed : undefined,
    classDC: safe(() => deriveClassDc(c).dc, undefined),
    spellDC,
    senses,
    languages: (c.languages ?? []).map(cap).join(', ') || undefined,
  };
}
