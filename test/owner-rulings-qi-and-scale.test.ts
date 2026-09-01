import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { qiSpellsPossible, emptyBuild, setupMissing, deriveBuildFromCharacter, type BuildState } from '../src/rules/build';
import { statHasSituational } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * Two owner rulings, 2026-08-19, both from the Wanderer's-Guide parity audit's escalation list.
 */

describe('qi spells: the tradition is the PLAYER’s choice', () => {
  /*
   * Monk, Player Core 2: *"When you gain your first qi spell, you decide whether your qi spells are
   * divine or occult spells, and you become trained in spell attack modifiers and spell DCs; your key
   * spellcasting attribute is Wisdom."*
   *
   * Our engine hard-coded occult in FOCUS_CASTING; their side hard-coded divine. Owner ruled: build
   * the choice.
   */
  const monkWithQi = (over: Partial<BuildState> = {}) =>
    build('monk', 1, {
      featPicks: { '1:class': 'qi-spells' } as BuildState['featPicks'],
      effectChoices: { 'qi-spells:qi-spell': 'inner-upheaval' },
      ...over,
    } as Partial<BuildState>);

  const focusEntry = (ch: Character) => ch.spellcasting?.find((e) => e.type === 'focus');

  it('a qi spell is a focus spell with the monk trait — 15 of them ship', () => {
    const qi = Object.values(db.spells).filter((s) => (s.traits ?? []).includes('monk') && (s.traits ?? []).includes('focus'));
    expect(qi.length).toBeGreaterThanOrEqual(15);
    expect(qi.map((s) => s.id)).toContain('inner-upheaval');
  });

  it('honours a divine answer', () => {
    const ch = monkWithQi({ qiTradition: 'divine' } as Partial<BuildState>);
    const e = focusEntry(ch);
    expect(e?.repertoire && Object.values(e.repertoire).flat()).toContain('inner-upheaval');
    expect(e?.tradition).toBe('divine');
  });

  it('honours an occult answer', () => {
    expect(focusEntry(monkWithQi({ qiTradition: 'occult' } as Partial<BuildState>))?.tradition).toBe('occult');
  });

  it('defaults to occult when unanswered — the app’s prior behaviour, now a starting point', () => {
    expect(focusEntry(monkWithQi())?.tradition).toBe('occult');
  });

  it('keys off Wisdom either way, as the clause prints', () => {
    for (const t of ['divine', 'occult'] as const) {
      expect(focusEntry(monkWithQi({ qiTradition: t } as Partial<BuildState>))?.keyAbility).toBe('wis');
    }
  });

  it('asks the question of a MONK, and of nobody else — the archetypes print their own answer', () => {
    expect(qiSpellsPossible({ ...emptyBuild(), classId: 'monk' } as BuildState, db)).toBe(true);
    /* Student of Perfection hands Inner Upheaval to a non-monk and states the tradition itself:
     * *"Your ki spells from Student of Perfection are occult spells."* Asking a fighter to choose would
     * offer a choice the book does not give them. */
    expect(
      qiSpellsPossible(
        { ...emptyBuild(), classId: 'fighter', featPicks: { '2:class': 'student-of-perfection-dedication' } } as BuildState,
        db,
      ),
    ).toBe(false);
    expect(qiSpellsPossible({ ...emptyBuild(), classId: 'fighter' } as BuildState, db)).toBe(false);
  });

  /*
   * ⚠ THE ANSWER GOVERNS THE QI SPELLS AND NOTHING ELSE.
   *
   * The qi tradition was briefly resolved in the same chain as the class's own, ahead of it — so a
   * champion who took Student of Perfection had Lay on Hands and Shields of the Spirit turned occult, a
   * druid lost primal and a wizard lost arcane. Qi spells now get their own focus entry (one shared
   * point pool, two Focus DCs) whenever the character also has class focus spells.
   */
  it('never touches another class’s focus tradition', () => {
    const sop = { featPicks: { '2:class': 'student-of-perfection-dedication' } } as Partial<BuildState>;
    for (const [cls, printed] of [['champion', 'divine'], ['druid', 'primal'], ['wizard', 'arcane']] as const) {
      const alone = build(cls, 8);
      const withSop = build(cls, 8, sop);
      const classEntry = (ch: Character) => ch.spellcasting?.find((e) => e.type === 'focus' && e.id !== 'qi-focus');
      expect(classEntry(alone)?.tradition, `${cls} alone`).toBe(printed);
      expect(classEntry(withSop)?.tradition, `${cls} + Student of Perfection`).toBe(printed);
    }
  });

  it('gives an archetype monk’s qi spells their own occult entry, keyed off Wisdom', () => {
    const ch = build('champion', 8, { featPicks: { '2:class': 'student-of-perfection-dedication' } } as Partial<BuildState>);
    const qi = ch.spellcasting?.find((e) => e.id === 'qi-focus');
    if (qi) {
      expect(qi.tradition).toBe('occult'); // printed on the dedication; not a choice
      expect(qi.keyAbility).toBe('wis');
    }
    // …and the champion's own entry is untouched either way.
    expect(ch.spellcasting?.find((e) => e.type === 'focus' && e.id !== 'qi-focus')?.tradition).toBe('divine');
  });

  it('survives a round trip — the answer is recovered, not reset to occult', () => {
    const ch = monkWithQi({ qiTradition: 'divine' } as Partial<BuildState>);
    expect(focusEntry(ch)?.tradition).toBe('divine');
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.qiTradition).toBe('divine');
  });

  it('lists the tradition as an outstanding choice until it is answered', () => {
    const b = { ...emptyBuild(), classId: 'monk', level: 1 } as BuildState;
    expect(setupMissing(b, db)).toContain('Qi spell tradition');
    expect(setupMissing({ ...b, qiTradition: 'divine' } as BuildState, db)).not.toContain('Qi spell tradition');
  });

  it('leaves a non-qi focus caster’s tradition alone', () => {
    // A champion's devotion spells are divine by their own class profile, not by this clause.
    expect(focusEntry(build('champion', 1))?.tradition).toBe('divine');
  });
});

describe("Merchant's Scale", () => {
  /*
   * OWNER RULING, 2026-08-19: the Archives of Nethys entry is the whole item — name, *"Source Player
   * Core pg. 290"*, *"Price 2 sp"*, *"Hands 2; Bulk L"* — and carries no body text at all. Both mirror
   * documents agree and Foundry ships `rules: []`.
   *
   * So there is no printed effect to model. A `+1 item` bonus was briefly authored here from Wanderer's
   * Guide's own wording; their data is GPL-3.0 and a DIFFER, never a source, and it was removed. This
   * suite now guards the ABSENCE, because "nobody has authored it yet" and "the book grants nothing"
   * look identical in the data and only one of them is true.
   */
  const scale = () => db.items['merchants-scale'];

  it('has no printed description, and that is not a defect', () => {
    expect(scale().description ?? '').toBe('');
  });

  it('grants no mechanical effect — the printed entry states none', () => {
    expect(scale().situational ?? []).toHaveLength(0);
    expect(scale().passiveEffects).toBeUndefined();
  });

  it('stars nothing: holding it raises no skill', () => {
    const base = build('fighter', 1);
    const holding: Character = {
      ...base,
      inventory: [{ instanceId: 's1', itemId: 'merchants-scale', quantity: 1, equipped: true }],
    };
    for (const skill of ['arcana', 'crafting', 'society'] as const) {
      expect(statHasSituational(holding, { kind: 'skill', skill }, db), skill).toBe(false);
      // …and their flattened reading would have raised the NUMBER for carrying a 2 sp balance.
      expect(holding.proficiencies.skills[skill]).toBe(base.proficiencies.skills[skill]);
    }
  });
});
