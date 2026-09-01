import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { skillSlotOptions, choiceFlagAnswer } from '../src/rules/build';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "YOU BECOME TRAINED IN SURVIVAL AND THE SKILL ASSOCIATED WITH THE MAGICAL TRADITION FROM YOUR
 * MAGIPHAGE ABILITY (ARCANA FOR ARCANE, NATURE FOR PRIMAL, OCCULTISM FOR OCCULT, OR RELIGION FOR
 * DIVINE)." (Surki Lore, Howl of the Wild.)
 *
 * The record shipped all four as a live pick, so a PRIMAL surki could train Arcana off a feat whose
 * own parenthesis names Nature — and, worse, an unanswered slot defaults to `options[0]`, so a surki
 * who touched nothing was silently trained in Arcana whatever their tradition. The tradition is asked
 * ONCE, on the ancestry; the printed sentence reads that answer rather than offering a choice, and
 * their side derives it the same way through four conditionals.
 */
describe('Surki Lore trains the skill its tradition names', () => {
  const SLOT = '1:ancestry:0';
  const surki = (tradition?: string) =>
    build('fighter', 1, {
      ancestryId: 'surki',
      featPicks: { [SLOT]: 'surki-lore' },
      ...(tradition ? { featChoices: { 'ancestry:surki': tradition } } : {}),
    } as Partial<BuildState>);

  const slot = () => FEAT_GRANTS['surki-lore']!.skillChoices![0];

  it('the ancestry is where the question is asked, and the slot names that flag', () => {
    expect(db.ancestries.surki?.choice?.flag).toBe('magiphageTradition');
    expect(slot().optionsFromChoiceFlag?.flag).toBe('magiphageTradition');
    /* Every printed pairing, and nothing else. */
    expect(slot().optionsFromChoiceFlag?.map).toEqual({ arcane: 'arcana', primal: 'nature', occult: 'occultism', divine: 'religion' });
  });

  it.each([
    ['arcane', 'arcana'],
    ['primal', 'nature'],
    ['occult', 'occultism'],
    ['divine', 'religion'],
  ])('a %s surki trains %s', (tradition, skill) => {
    const c = surki(tradition);
    expect(choiceFlagAnswer('magiphageTradition', { ancestryId: 'surki', featChoices: { 'ancestry:surki': tradition } }, db)).toBe(tradition);
    expect(skillSlotOptions(slot(), { ancestryId: 'surki', featChoices: { 'ancestry:surki': tradition } }, db)).toEqual([skill]);
    expect(c.proficiencies.skills[skill as 'arcana']).toBe('trained');
    expect(c.proficiencies.skills.survival).toBe('trained');
  });

  it('…and the feat itself trains none of the OTHER three', () => {
    /* Measured against a control WITHOUT the feat, not against "untrained": the test build's class
     * and background train skills of their own, and asserting on the finished sheet would make this
     * test about them. What matters is what THIS feat added. */
    const control = build('fighter', 1, { ancestryId: 'surki', featChoices: { 'ancestry:surki': 'primal' } } as Partial<BuildState>);
    const c = surki('primal');
    const added = (k: 'arcana' | 'occultism' | 'religion' | 'nature') =>
      c.proficiencies.skills[k] !== control.proficiencies.skills[k];
    expect(added('nature'), 'the tradition skill should be the one it added').toBe(true);
    for (const dead of ['arcana', 'occultism', 'religion'] as const) {
      expect(added(dead), `a primal surki's feat must not touch ${dead}`).toBe(false);
    }
  });

  it('a stale answer cannot survive a change of tradition', () => {
    /* The bug the derivation removes: the free pick was stored, so switching tradition left the old
     * skill trained. Here the answer is not stored at all — the slot has one option. */
    const c = build('fighter', 1, {
      ancestryId: 'surki',
      featPicks: { [SLOT]: 'surki-lore' },
      featChoices: { 'ancestry:surki': 'primal' },
      featSkillChoices: { 'surki-lore:0': 'arcana' },
    } as Partial<BuildState>);
    expect(c.proficiencies.skills.nature).toBe('trained');
    expect(c.proficiencies.skills.arcana).not.toBe('trained');
  });

  it('an UNANSWERED tradition leaves all four offered, rather than guessing', () => {
    /* An empty picker on a half-built character is worse than a premature one — and since an
     * unanswered slot resolves to options[0], narrowing on no answer would not ask the question, it
     * would answer it wrongly for every surki alive. */
    expect(skillSlotOptions(slot(), { ancestryId: 'surki' }, db)).toEqual(['arcana', 'nature', 'occultism', 'religion']);
  });

  it('the redundancy clause survives the hand-authoring', () => {
    /* The entry REPLACES the generated one, so the half we already do better than they do — "if you
     * would automatically become trained in one of those skills, you instead become trained in a
     * skill of your choice", which their row does not implement at all — has to be restated. */
    expect(slot().redundantFallback).toBe(true);
    expect(FEAT_GRANTS['surki-lore']!.redundantFallback).toBe(true);
    expect(FEAT_GRANTS['surki-lore']!.skills).toEqual({ survival: 'trained' });
  });

  it('a map naming a skill outside the slot is ignored, not honoured', () => {
    /* The field must never be able to grant something the slot did not list. */
    const rogue = { options: ['arcana', 'nature'] as const, rank: 'trained' as const, optionsFromChoiceFlag: { flag: 'magiphageTradition', map: { primal: 'stealth' as const } } };
    expect(skillSlotOptions(rogue as never, { ancestryId: 'surki', featChoices: { 'ancestry:surki': 'primal' } }, db)).toEqual(['arcana', 'nature']);
  });
});
