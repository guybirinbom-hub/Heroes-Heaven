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
      // Magaambyan (innate cantrip) + Halcyon (custom initiate/adept/sage schedule) don't use the
      // standard basic/expert/master spellcasting feats — their gating feats are checked below.
      if (cfg.innateCantrip || cfg.customUnlocks) continue;
      expect(c.feats[cfg.basicId], cfg.basicId).toBeTruthy();
      expect(c.feats[cfg.expertId], cfg.expertId).toBeTruthy();
      // Summoner archetype caps at Expert — there is no master-summoner-spellcasting feat.
      if (ded !== 'summoner-dedication') expect(c.feats[cfg.masterId], cfg.masterId).toBeTruthy();
    }
  });

  it('Magaambyan/Halcyon gating feats + the Halcyon schedule are real', () => {
    for (const id of ['magaambyan-attendant-dedication', 'halcyon-speaker-dedication', 'halcyon-spellcasting-initiate', 'halcyon-spellcasting-adept', 'halcyon-spellcasting-sage'])
      expect(c.feats[id], id).toBeTruthy();
  });
});

describe('Magaambyan Attendant + Halcyon Speaker archetypes', () => {
  it('Magaambyan Attendant grants an innate cantrip of the chosen tradition (no slots)', () => {
    const ch = build('fighter', 2, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'magaambyan-attendant-dedication' },
      archetypeTradition: 'primal',
      cantrips: ['cz1'],
    });
    const entry = ch.spellcasting.find((e) => e.id === 'magaambyan-attendant-dedication-casting');
    expect(entry?.type).toBe('innate');
    expect(entry?.tradition).toBe('primal');
    expect(entry?.keyAbility).toBe('wis'); // primal → Wis (arcane would be Int)
    expect(entry?.cantrips).toEqual(['cz1']);
    expect(entry?.prepared ?? {}).toEqual({});
    expect(entry?.slots ?? {}).toEqual({});
  });

  it('Halcyon Speaker: dedication gives a 1st-rank slot; Initiate adds 2nd & 3rd at level 10', () => {
    const ch = build('fighter', 10, {
      keyAbility: 'str',
      featPicks: { '6:class:0': 'halcyon-speaker-dedication', '10:class:1': 'halcyon-spellcasting-initiate' },
      archetypeTradition: 'arcane',
      spells: { 1: ['h1'], 2: ['h2'], 3: ['h3'] },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'halcyon-speaker-dedication-casting');
    expect(entry?.type).toBe('spontaneous');
    expect(entry?.keyAbility).toBe('int'); // arcane → Int
    expect(entry?.proficiency).toBe('trained');
    expect(Object.keys(entry?.slots ?? {}).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('Halcyon schedule + proficiency advance with Adept (14, expert) and Sage (18, master)', () => {
    const arch = activeCasterArchetype(['halcyon-speaker-dedication', 'halcyon-spellcasting-initiate', 'halcyon-spellcasting-adept', 'halcyon-spellcasting-sage'])!;
    expect(archetypeProficiency(arch)).toBe('master');
    expect(Object.keys(archetypeSlots(18, arch)).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // At level 6 with only the dedication: just the 1st-rank slot.
    const justDed = activeCasterArchetype(['halcyon-speaker-dedication'])!;
    expect(archetypeSlots(6, justDed)).toEqual({ 1: 1 });
    expect(archetypeProficiency(justDed)).toBe('trained');
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
