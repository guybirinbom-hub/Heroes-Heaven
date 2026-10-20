import { describe, expect, it } from 'vitest';
import {
  buildCharacter,
  classArchetypeSpellMods,
  classCantripBonus,
  dedicationBlock,
  emptyBuild,
  levelChoices,
  takenForDedicationRule,
  type BuildState,
} from '../src/rules/build';
import { adoptedAncestryIds, eligibleFeatsForSlot } from '../src/rules/featSlots';
import type { Character, FeatCategory, SpellcastingEntry } from '../src/rules/types';
import { content } from './_content';

/**
 * CASE D (docs/overrides-redesign.md spec item 2 case D, Building blocks item 9; plan
 * work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md section 4): a feat in `overrides.addedFeats` works
 * exactly like the same feat picked in a slot. Each case builds ONE character twice — the feat in a slot
 * (`featPicks`, its answer under the slot key) and the feat given through Tweaks (`overrides.addedFeats`,
 * its answer under `override:<featId>`) — and holds the given one to the picked one.
 *
 * Every case but the Wizard Dedication sanity pair failed on the code before case D (2026-10-20): the
 * walkers named in each case read `build.featPicks` only. Synthetic characters only.
 */

const db = content();

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...more,
  } as BuildState;
}

/** The same character with `featId` picked into `slot`, and given through Tweaks at `level`. */
function pickedAndGiven(
  base: BuildState,
  slot: string,
  featId: string,
  category: FeatCategory,
  level: number,
  answer?: string,
): { picked: BuildState; given: BuildState } {
  const picked: BuildState = {
    ...base,
    featPicks: { ...base.featPicks, [slot]: featId },
    featChoices: { ...base.featChoices, ...(answer ? { [slot]: answer } : {}) },
  };
  const given: BuildState = {
    ...base,
    overrides: { addedFeats: [{ featId, level, category }] },
    featChoices: { ...base.featChoices, ...(answer ? { [`override:${featId}`]: answer } : {}) },
  };
  return { picked, given };
}

const entry = (c: Character, id: string): SpellcastingEntry | undefined => c.spellcasting.find((e) => e.id === id);
const slotMax = (e: SpellcastingEntry | undefined) => Object.fromEntries(Object.entries(e?.slots ?? {}).map(([r, s]) => [r, s.max]));

describe('case D: a feat given through Tweaks works like the same feat picked', () => {
  it('grant.feat: Flexible Spellcaster Dedication via addedFeats works like picked', () => {
    // A cloistered cleric L4: measured 2026-10-20, picked → spontaneous, 2 slots a rank, a collection of 4,
    // 5 cantrips; given → prepared, no collection, the class archetype ignored.
    const { picked, given } = pickedAndGiven(hero('cleric', 4, { subclassId: 'cloistered-cleric' }), '2:class:0', 'flexible-spellcaster-dedication', 'class', 2);
    for (const b of [picked, given]) {
      expect(classArchetypeSpellMods(b, db, 'cleric')).toEqual({ slotCap: 2, cantripDelta: -2, spellCollection: true });
      expect(classCantripBonus(b, db, 'cleric')).toBe(2);
      const e = entry(buildCharacter(b, db), 'cleric-casting');
      expect(e?.type).toBe('spontaneous');
      expect(slotMax(e)).toEqual({ 1: 2, 2: 2 });
      expect(e?.spellCollection).toBe(4);
      expect(e?.cantripCap).toBe(5);
    }
    expect(entry(buildCharacter(given, db), 'cleric-casting')).toEqual(entry(buildCharacter(picked, db), 'cleric-casting'));
    // At 2nd level the dedication's ladder is on its first rung: four cantrips, picked or given.
    const at2 = pickedAndGiven(hero('cleric', 2, { subclassId: 'cloistered-cleric' }), '2:class:0', 'flexible-spellcaster-dedication', 'class', 2);
    expect(entry(buildCharacter(at2.picked, db), 'cleric-casting')?.cantripCap).toBe(4);
    expect(entry(buildCharacter(at2.given, db), 'cleric-casting')?.cantripCap).toBe(4);
  });

  it("Blessing of the Sun Gods given with the answer 'ambition': its focus spell is divine and Charisma, as picked", () => {
    const { picked, given } = pickedAndGiven(hero('fighter', 4), '4:class:0', 'blessing-of-the-sun-gods', 'class', 4, 'ambition');
    const p = buildCharacter(picked, db);
    const g = buildCharacter(given, db);
    expect(g.focus).toEqual(p.focus);
    const pe = entry(p, 'fighter-focus');
    const ge = entry(g, 'fighter-focus');
    expect(pe?.tradition).toBe('divine');
    expect(pe?.keyAbility).toBe('cha');
    expect(ge?.tradition).toBe(pe?.tradition);
    expect(ge?.keyAbility).toBe(pe?.keyAbility);
    expect(ge).toEqual(pe);
  });

  it('Adopted Ancestry given with an answer opens that ancestry\'s feats, as picked', () => {
    const { picked, given } = pickedAndGiven(hero('fighter', 3), '3:general:0', 'adopted-ancestry', 'general', 3, 'elf');
    expect(adoptedAncestryIds(picked, db, 5)).toEqual(['elf']);
    expect(adoptedAncestryIds(given, db, 5)).toEqual(['elf']);
    const elfFeats = (b: BuildState) => eligibleFeatsForSlot(b, db, { level: 5, category: 'ancestry', idx: 0 }).filter((f) => f.traits.includes('elf') && f.level === 1).map((f) => f.id);
    expect(elfFeats(picked).length).toBeGreaterThan(0);
    expect(elfFeats(given)).toEqual(elfFeats(picked));
  });

  it('Wizard Dedication given to a fighter L4: the archetype casting entry is the picked one (sanity pair)', () => {
    // NOT a case D regression guard: this entry was already equal before case D (fixer, 2026-10-20, run on
    // the committed code), because buildCharacter always listed given feats. What case D changed for a given
    // caster dedication is the BUILDER's archetype pool (`activeCasterArchetype` / `archetypeCantripCounts`
    // fed by held feats) — guarded in test/given-feat-builder-ui.test.tsx ("Archetype spellcasting", "Spells -
    // Arcane prepared (archetype)"), which failed on the old code, and by the feat-readers guard in blocks-check.
    const { picked, given } = pickedAndGiven(hero('fighter', 4), '2:class:0', 'wizard-dedication', 'class', 2, 'school-of-battle-magic');
    const e = entry(buildCharacter(picked, db), 'wizard-dedication-casting');
    expect(e).toBeDefined();
    expect(entry(buildCharacter(given, db), 'wizard-dedication-casting')).toEqual(e);
  });

  it('Runesmith Dedication given: the runic repertoire is owed, as picked', () => {
    const { picked, given } = pickedAndGiven(hero('fighter', 4), '2:class:0', 'runesmith-dedication', 'archetype', 2);
    const runic = (b: BuildState) => levelChoices(b, db).filter((x) => /^Runic repertoire/.test(x.label));
    expect(runic(picked)).toHaveLength(1);
    expect(runic(given)).toEqual(runic(picked));
  });

  it("Rogue Dedication given with a bonus skill feat answer: the skill feat is on the character, as picked", () => {
    const pair = pickedAndGiven(hero('fighter', 4), '2:class:0', 'rogue-dedication', 'class', 2);
    const answer = { dedicationSkillFeats: { 'rogue-dedication': 'quick-jump' } };
    const bonus = (b: BuildState) => buildCharacter({ ...b, ...answer }, db).feats.filter((f) => f.featId === 'quick-jump').map((f) => ({ level: f.level, category: f.category }));
    expect(bonus(pair.picked)).toEqual([{ level: 2, category: 'skill' }]);
    expect(bonus(pair.given)).toEqual(bonus(pair.picked));
  });

  it('a dedication with a dedicationGate given (Juggler Dedication) blocks a second dedication, as picked', () => {
    const { picked, given } = pickedAndGiven(hero('fighter', 4), '2:class:0', 'juggler-dedication', 'class', 2);
    const why = (b: BuildState) => dedicationBlock(takenForDedicationRule(b, '4:class:0'), db.feats['wizard-dedication'], db);
    expect(why(picked)).toBe('Take 1 more feat from the Juggler archetype first.');
    expect(why(given)).toBe(why(picked));
  });

  it('Ultimate Polymath given to a bard L20 makes the whole repertoire signature, as picked', () => {
    const spells = { 1: ['imprint-message', 'object-reading'], 2: ['death-knell', 'mirror-image'] };
    const { picked, given } = pickedAndGiven(hero('bard', 20, { spells } as Partial<BuildState>), '20:class:0', 'ultimate-polymath', 'class', 20);
    const sig = (b: BuildState) => {
      const e = entry(buildCharacter(b, db), 'bard-casting');
      return { signature: [...(e?.signature ?? [])].sort(), repertoire: [...new Set(Object.values(e?.repertoire ?? {}).flat())].sort() };
    };
    const p = sig(picked);
    expect(p.signature.length).toBeGreaterThan(1);
    expect(p.signature).toEqual(p.repertoire);
    expect(sig(given)).toEqual(p);
  });
});
