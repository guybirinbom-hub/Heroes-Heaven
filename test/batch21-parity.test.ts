import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 21 (100 backgrounds). Headliners: the constellation
 * backgrounds became real mechanics (a sign pick driving an innate spell AND the tied boost), the
 * deviant-classification pickers finally grant their feats (option values were classification words
 * no reader could resolve), and the background bucket gained void healing. Asserted on BUILT
 * characters.
 */
const bg = (id: string, extra?: Partial<BuildState>) => build('fighter', 1, { backgroundId: id, ...(extra ?? {}) } as Partial<BuildState>);

describe('the constellation backgrounds are real mechanics', () => {
  it('Sign Bound: the chosen sign grants its occult spell and ties the first boost', () => {
    const thrush = bg('sign-bound', { featChoices: { 'background:sign-bound': 'thrush' } } as Partial<BuildState>);
    const innate = thrush.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips, 'The Thrush: figment at will').toContain('figment');
    expect(innate?.tradition).toBe('occult');
    const bridge = bg('sign-bound', { featChoices: { 'background:sign-bound': 'bridge' } } as Partial<BuildState>);
    const rep = Object.values(bridge.spellcasting.find((e) => e.type === 'innate')?.repertoire ?? {}).flat();
    expect(rep, 'The Bridge: environmental endurance, 1/week').toContain('environmental-endurance');
    expect(rep, 'only the CHOSEN sign’s spell').not.toContain('figment');
  });

  it("Zodiac Bound: the sign's divine spell arrives and the unanswered default is the first sign", () => {
    const ox = bg('zodiac-bound', { featChoices: { 'background:zodiac-bound': 'ox' } } as Partial<BuildState>);
    const rep = Object.values(ox.spellcasting.find((e) => e.type === 'innate')?.repertoire ?? {}).flat();
    expect(rep).toContain('ant-haul');
    const unanswered = bg('zodiac-bound');
    const innate = unanswered.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips, 'defaults to the first sign (Underworld Dragon: ignition)').toContain('ignition');
  });

  it('the sign-tied boost replaces one of the two free boosts', () => {
    /* Ox ties a boost to Strength: at level 1 with no other Str source, Str reads 12. */
    const ox = bg('zodiac-bound', { featChoices: { 'background:zodiac-bound': 'ox' } } as Partial<BuildState>);
    expect(ox.abilities.str).toBeGreaterThanOrEqual(12);
  });
});

describe('the deviant-classification pickers grant their feats', () => {
  it.each([
    ['sense-of-belonging', 'sonic-dash'],
    ['sense-of-belonging', 'eerie-flicker'],
    ['dreams-of-vengeance', 'titan-swing'],
    ['lost-loved-one', 'draining-touch'],
    ['total-power', 'bone-spikes'],
    ['wanderlust', 'overclock-senses'],
  ])('%s can pick %s and actually owns it', (bgId, featId) => {
    const ch = bg(bgId, { featChoices: { [`background:${bgId}`]: featId } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === featId)).toBe(true);
  });

  it('the dragon branch pins its printed damage type', () => {
    const lim = db.backgrounds['dreams-of-vengeance'].choiceOptionLimits?.[0];
    expect(lim?.allow.map((a) => a.value)).toEqual(['fire']);
    expect(db.backgrounds['total-power'].choiceOptionLimits?.[0]?.allow.map((a) => a.value)).toEqual(['electricity']);
  });
});

describe('the new background carriers', () => {
  it('Revenant has void healing', () => {
    expect(deriveDefenses(bg('revenant'), db).negativeHealing).toBe(true);
  });

  it('Reborn Soul trains BOTH typed past-life Lores', () => {
    const ch = bg('reborn-soul', { backgroundLore: 'Baker', backgroundLore2: 'Soldier' } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:baker' as never]).toBe('trained');
    expect(ch.proficiencies.skills['lore:soldier' as never]).toBe('trained');
  });

  it("Driver's two-way Lore defaults to Driving and binds its Assurance to the pick", () => {
    const ch = bg('driver');
    expect(ch.proficiencies.skills['lore:driving' as never]).toBe('trained');
    const assured = ch.feats.find((f) => f.featId === 'assurance');
    expect(assured, 'the granted Assurance rides the Lore pick').toBeTruthy();
  });

  it('Sewer Dragon greys out for a non-kobold', () => {
    expect(db.backgrounds['sewer-dragon'].ancestryPrerequisite).toEqual(['kobold']);
  });

  it('the created actions exist and are granted', () => {
    expect(db.actions['seasonal-boon']).toBeTruthy();
    expect(db.backgrounds['willowshore-urchin'].grantsActions).toContain('seasonal-boon');
    expect(db.actions['merge-with-ward']).toBeTruthy();
    expect(db.backgrounds['warded-by-kami'].grantsActions).toContain('merge-with-ward');
    expect(db.backgrounds['bookish-providence'].grantsActions).toContain('recall-under-pressure');
    expect(db.actions['recall-under-pressure'].limitedUses).toEqual({ max: 1, per: 'day' });
  });

  it('Student of the Ancients pins one Multilingual pick to Azlanti (the Runelord Scholar pair)', () => {
    const ch = bg('student-of-the-ancients');
    expect(ch.languages).toContain('azlanti');
  });

  it('Empty Whispers trains the full printed Lore, not the truncated one', () => {
    const ch = bg('empty-whispers');
    expect(ch.proficiencies.skills['lore:planar-rift' as never]).toBe('trained');
    expect(ch.proficiencies.skills['lore:planar-ri' as never] ?? 'untrained').toBe('untrained');
  });

  it('Tech-Reliant trains BOTH printed skills', () => {
    const ch = bg('tech-reliant');
    expect(ch.proficiencies.skills.crafting).toBe('trained');
    expect(ch.proficiencies.skills.medicine).toBe('trained');
  });

  it('the persona-rider backgrounds train both printed Lores unconditionally', () => {
    for (const [id, lores] of [
      ['wandering-libertine', ['lore:shelyn', 'lore:sailing']],
      ['art-tutor', ['lore:art', 'lore:academia']],
      ['sideshow-scion', ['lore:games', 'lore:circus']],
      ['bully-or-baiter', ['lore:underworld', 'lore:warfare']],
    ] as const) {
      const ch = bg(id);
      for (const k of lores) expect(ch.proficiencies.skills[k as never], `${id} ${k}`).toBe('trained');
    }
  });

  it('Child of Notoriety delivers exactly the chosen branch', () => {
    const kind = bg('child-of-notoriety');
    expect(kind.proficiencies.skills['lore:genealogy' as never]).toBe('trained');
    expect(kind.feats.some((f) => f.featId === 'group-impression')).toBe(true);
    const cruel = bg('child-of-notoriety', { backgroundSkillChoice: 'intimidation' } as Partial<BuildState>);
    expect(cruel.proficiencies.skills['lore:underworld' as never]).toBe('trained');
    expect(cruel.feats.some((f) => f.featId === 'intimidating-glare')).toBe(true);
    expect(cruel.proficiencies.skills['lore:genealogy' as never] ?? 'untrained').toBe('untrained');
  });
});
