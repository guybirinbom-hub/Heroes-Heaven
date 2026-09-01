import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * A wizard's CURRICULUM is a list of spells they can prepare in the extra curriculum slot at each
 * rank. A SCHOOL SPELL is a focus spell. Those are different things, and the School of Thassilonian
 * Rune Magic shipped with the second kind stored inside the first: Personal Runewell (the school's
 * advanced school spell, a rank-4 focus spell) and each sin's initial school spell (rank-1 focus
 * spells) were appended to the rank-9 curriculum line, because the option carried no
 * `advancedFocusSpell` field for them to live in.
 *
 * These are guards on the SHAPE, not on those nine records: a focus spell in a curriculum is wrong
 * wherever it appears, and it is invisible when you only read the record you are editing.
 * Source: Lost Omens Rival Academies pg. 114 (AoN arcane-school-25 + the Sin Curriculums sidebar).
 */

/** Every school/subclass option across every class that carries a curriculum. */
function curriculumCarriers(): { id: string; curriculum: Record<string, string[]> }[] {
  const out: { id: string; curriculum: Record<string, string[]> }[] = [];
  for (const [id, rec] of Object.entries(db.classFeatures)) {
    const r = rec as { curriculum?: Record<string, string[]>; curriculumBranches?: Record<string, Record<string, string[]>> };
    if (r.curriculum) out.push({ id, curriculum: r.curriculum });
    for (const [branch, cur] of Object.entries(r.curriculumBranches ?? {})) out.push({ id: `${id}:${branch}`, curriculum: cur });
  }
  return out;
}

describe('curriculum lists hold preparable spells, never focus spells', () => {
  it('no curriculum rank contains a spell with the focus trait', () => {
    const bad: string[] = [];
    for (const { id, curriculum } of curriculumCarriers()) {
      for (const [rank, spells] of Object.entries(curriculum)) {
        for (const sid of spells ?? []) {
          const sp = db.spells[sid];
          if (sp?.traits?.includes('focus')) bad.push(`${id} rank ${rank}: ${sid}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no curriculum rank lists a spell whose own rank exceeds it', () => {
    // The same authoring slip in its general form: a rank-1 spell parked in the rank-9 line. A
    // curriculum entry must be castable from a slot of that rank, so its rank cannot be higher —
    // and a spell far BELOW its line is the signature of something appended rather than authored.
    const bad: string[] = [];
    for (const { id, curriculum } of curriculumCarriers()) {
      for (const [rank, spells] of Object.entries(curriculum)) {
        const r = Number(rank);
        for (const sid of spells ?? []) {
          const sp = db.spells[sid];
          if (sp && typeof sp.rank === 'number' && sp.rank > r) bad.push(`${id} rank ${rank}: ${sid} is rank ${sp.rank}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('Advanced School Spell can reach every wizard school', () => {
  /* The feat is a general wizard feat — *"You gain an advanced school spell"* — so a school with no
   * `advancedFocusSpell` hands the character the focus POINT and no spell. `runelord` was the last
   * of the fourteen still missing one; the Runelord archetype grants the feat outright at 8th
   * ("gaining the advanced school spell for the School of Thassilonian Rune Magic"), so the hole was
   * reachable without the player even choosing the feat. */
  it('every selectable wizard arcane school names its advanced school spell', () => {
    const missing = (db.classes.wizard?.subclass?.options ?? [])
      .filter((o) => !(o as { advancedFocusSpell?: string }).advancedFocusSpell)
      .map((o) => o.id);
    expect(missing).toEqual([]);
  });

  it('every named advanced school spell exists and is a focus spell', () => {
    const bad: string[] = [];
    for (const o of db.classes.wizard?.subclass?.options ?? []) {
      const sid = (o as { advancedFocusSpell?: string }).advancedFocusSpell;
      if (!sid) continue;
      const sp = db.spells[sid];
      if (!sp) bad.push(`${o.id}: ${sid} missing`);
      else if (!sp.traits?.includes('focus')) bad.push(`${o.id}: ${sid} is not a focus spell`);
    }
    expect(bad).toEqual([]);
  });

  it('the runelord school carries Personal Runewell, and its sins keep their own initial spells', () => {
    const opt = (db.classes.wizard?.subclass?.options ?? []).find((o) => o.id === 'runelord');
    expect((opt as { advancedFocusSpell?: string } | undefined)?.advancedFocusSpell).toBe('personal-runewell');
    // The initial school spell still arrives — via the sin's grant, which is where print puts it.
    const sins = (db.classFeatures['runelord'] as { effectChoices?: { id: string; options?: { value: string; grant?: { focusSpells?: string[] } }[] }[] })
      .effectChoices?.find((c) => c.id === 'sin');
    expect(sins?.options?.map((o) => o.grant?.focusSpells?.[0])).toEqual([
      'cutting-eye', 'all-encompassing-hunger', 'precious-gleam', 'hearts-hook', 'crescent-scepter', 'reclined-apport', 'vengeful-glare',
    ]);
  });
});
