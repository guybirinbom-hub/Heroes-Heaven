import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import {
  CASTER_ARCHETYPES,
  activeCasterArchetype,
  archetypeSlots,
  archetypeProficiency,
} from '../src/rules/casterArchetypes';

const c = content();

describe('archetype spell slot table', () => {
  const basic = { basic: true, expert: false, master: false };

  it('Basic Spellcasting: 1 slot of 1st@4, 2nd@6, 3rd@8; capped there without Expert', () => {
    expect(archetypeSlots(4, basic)).toEqual({ 1: 1 });
    expect(archetypeSlots(6, basic)).toEqual({ 1: 1, 2: 1 });
    expect(archetypeSlots(8, basic)).toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(archetypeSlots(11, basic)).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it('Expert adds 4th/5th/6th (12/14/16); Master adds 7th/8th (18/20)', () => {
    const all = { basic: true, expert: true, master: true };
    expect(archetypeSlots(16, all)).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 });
    expect(archetypeSlots(20, all)).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 });
  });

  it('proficiency: trained → expert → master by tier', () => {
    expect(archetypeProficiency({ basic: true, expert: false, master: false })).toBe('trained');
    expect(archetypeProficiency({ basic: true, expert: true, master: false })).toBe('expert');
    expect(archetypeProficiency({ basic: true, expert: true, master: true })).toBe('master');
  });

  it('every curated archetype feat id exists in the import', () => {
    for (const [ded, cfg] of Object.entries(CASTER_ARCHETYPES)) {
      expect(c.feats[ded], ded).toBeTruthy();
      expect(c.feats[cfg.basicId], cfg.basicId).toBeTruthy();
      expect(c.feats[cfg.expertId], cfg.expertId).toBeTruthy();
      // Summoner archetype caps at Expert — there is no master-summoner-spellcasting feat.
      if (ded !== 'summoner-dedication') expect(c.feats[cfg.masterId], cfg.masterId).toBeTruthy();
    }
  });
});

describe('activeCasterArchetype + buildCharacter', () => {
  it('detects the dedication and which spellcasting feats are taken', () => {
    expect(activeCasterArchetype([])).toBeNull();
    const a = activeCasterArchetype(['wizard-dedication', 'basic-wizard-spellcasting']);
    expect(a?.dedicationId).toBe('wizard-dedication');
    expect(a?.tier).toEqual({ basic: true, expert: false, master: false });
  });

  it('a non-caster + caster dedication + Basic Spellcasting gains a prepared archetype pool', () => {
    const ch = build('fighter', 4, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' },
      cantrips: ['c1', 'c2'],
      spells: { 1: ['s1'] },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'wizard-dedication-casting');
    expect(entry?.tradition).toBe('arcane');
    expect(entry?.keyAbility).toBe('int');
    expect(entry?.proficiency).toBe('trained');
    expect(entry?.cantrips).toEqual(['c1', 'c2']);
    expect(entry?.prepared?.[1]).toEqual([{ spellId: 's1', expended: false }]);
  });

  it('the dedication alone grants cantrips but no slots', () => {
    const ch = build('fighter', 4, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'wizard-dedication' },
      cantrips: ['c1'],
    });
    const entry = ch.spellcasting.find((e) => e.id === 'wizard-dedication-casting');
    expect(entry?.cantrips).toEqual(['c1']);
    expect(entry?.prepared ?? {}).toEqual({});
  });

  it('a full-caster class taking a caster Dedication gets a SECOND, independent archetype entry', () => {
    const ch = build('wizard', 4, {
      keyAbility: 'int',
      featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting' },
      archetypeSpells: { cantrips: [], spells: {}, tradition: null, keyAbility: null },
    });
    const wiz = ch.spellcasting.find((e) => e.id === 'wizard-casting');
    const arch = ch.spellcasting.find((e) => e.id === 'cleric-dedication-casting');
    expect(wiz?.tradition).toBe('arcane'); // class pool intact
    expect(arch).toBeDefined(); // two-casters now modelled
    expect(arch?.tradition).toBe('divine'); // cleric dedication = fixed divine tradition
  });

  it('a choice-tradition archetype (sorcerer) uses the chosen tradition, else its default', () => {
    expect(CASTER_ARCHETYPES['sorcerer-dedication'].choiceTradition).toBe(true);
    const picks = { '2:class:0': 'sorcerer-dedication', '4:class:1': 'basic-sorcerer-spellcasting' };
    const divine = build('fighter', 4, { keyAbility: 'str', featPicks: picks, archetypeTradition: 'divine', spells: { 1: ['s1'] } });
    expect(divine.spellcasting.find((e) => e.id === 'sorcerer-dedication-casting')?.tradition).toBe('divine');
    const def = build('fighter', 4, { keyAbility: 'str', featPicks: picks });
    expect(def.spellcasting.find((e) => e.id === 'sorcerer-dedication-casting')?.tradition).toBe('arcane'); // config default
  });
});
