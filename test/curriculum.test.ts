import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * A wizard's arcane school grants one extra prepared slot of each rank, "for a spell from your
 * school's curriculum". It shipped as a plain +1 prepared slot, fillable from the whole spellbook —
 * a free general slot at every rank, which at 20th is nine extra unrestricted spells a day.
 *
 * The restriction was previously called unresolvable because the printed `**Curriculum**` block drops
 * 21 of its 211 spell names. It is only the TEXT that is damaged: the AST tree for the same record
 * carries a resolved `spells:<id>` for every entry.
 */
const db = content();
const SCHOOL = 'school-of-battle-magic';

const wizard = (level: number, subclassId = SCHOOL) => build('wizard', level, { subclassId, keyAbility: 'int' } as never);
const entry = (level: number, subclassId = SCHOOL) => wizard(level, subclassId).spellcasting.find((e) => e.type === 'prepared');
const curriculumSlots = (level: number, subclassId = SCHOOL) =>
  (entry(level, subclassId)?.restrictedSlots ?? []).filter((s) => s.label === 'Curriculum');

describe('the curriculum data', () => {
  it('every school that prints one has it, fully resolved', () => {
    const schools = db.classes.wizard.subclass!.options;
    const withCurriculum = schools.filter((o) => db.classFeatures[o.id]?.curriculum);
    // 12 of 14: School of Unified Magical Theory prints "No Curriculum", and the Runelord school has
    // no description shipped at all (its Thassilonian curriculum is a separate gap).
    expect(withCurriculum.length).toBeGreaterThanOrEqual(12);
    let total = 0;
    for (const o of withCurriculum) {
      for (const [, ids] of Object.entries(db.classFeatures[o.id].curriculum!)) {
        for (const id of ids) {
          total++;
          expect(db.spells[id], `${o.id} → ${id}`).toBeTruthy();
        }
      }
    }
    expect(total).toBeGreaterThanOrEqual(220);
  });

  it('a school’s own focus spells are NOT in its curriculum', () => {
    // The "School Spells" heading straddles two text runs, and missing it filed Force Bolt and Energy
    // Absorption under 9th rank — where they would have become legal curriculum picks.
    for (const o of db.classes.wizard.subclass!.options) {
      const cur = db.classFeatures[o.id]?.curriculum;
      if (!cur) continue;
      const focus = [...(o.focusSpells ?? []), ...(o.advancedFocusSpell ? [o.advancedFocusSpell] : [])];
      const all = Object.values(cur).flat();
      for (const f of focus) expect(all, `${o.id} leaked ${f}`).not.toContain(f);
    }
  });
});

describe('the curriculum slot', () => {
  it('is one restricted slot per castable rank, and NOT an extra ordinary slot', () => {
    const e = entry(5)!;
    // The ordinary table matches a base full caster — the extra slot lives apart from it.
    expect(Object.entries(e.prepared ?? {}).map(([r, s]) => `${r}:${s.length}`)).toEqual(['1:3', '2:3', '3:2']);
    expect(curriculumSlots(5).map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('offers the school’s curriculum, cumulative to the slot’s rank', () => {
    const cur = db.classFeatures[SCHOOL].curriculum!;
    for (const slot of curriculumSlots(5)) {
      const expected = new Set<string>();
      for (let r = 1; r <= slot.rank; r++) for (const id of cur[String(r)] ?? []) expected.add(id);
      expect(new Set(slot.allowed), `rank ${slot.rank}`).toEqual(expected);
      // A slot of rank N holds a spell of rank N or lower, so the list must GROW with the rank.
      expect(slot.allowed!.length).toBeGreaterThan(0);
    }
    const ranks = curriculumSlots(5);
    expect(ranks[2].allowed!.length).toBeGreaterThan(ranks[0].allowed!.length);
  });

  it('a school with no curriculum grants no curriculum slot', () => {
    // School of Unified Magical Theory prints "No Curriculum" — and no extra slot either.
    expect(curriculumSlots(5, 'school-of-unified-magical-theory')).toEqual([]);
    const e = entry(5, 'school-of-unified-magical-theory')!;
    expect(Object.entries(e.prepared ?? {}).map(([r, s]) => `${r}:${s.length}`)).toEqual(['1:3', '2:3', '3:2']);
  });

  it('a cleric — no arcane school — has none at all', () => {
    const clr = build('cleric', 5, { keyAbility: 'wis' } as never);
    expect(clr.spellcasting.find((e) => e.type === 'prepared')?.restrictedSlots ?? []).toEqual([]);
  });
});
