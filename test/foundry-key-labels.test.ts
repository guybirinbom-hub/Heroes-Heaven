import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { featChoiceLabel, featChoicePrompt } from '../src/rules/build';

const c = content();

/**
 * The importer kept some of Foundry's i18n KEYS and compendium REFERENCES instead of resolving them,
 * so the builder showed a card headed "Prompt" with options reading
 * "Compendium.pf2e.classfeatures.Item.Blessed Armament" and "Ability Str". These are repaired at
 * DISPLAY time (not by rewriting the data) so the stored choice value stays stable — a character who
 * already picked one keeps their choice and simply starts rendering correctly.
 */
describe('Foundry key artifacts in feat choices', () => {
  it('strips a compendium path down to the feature name', () => {
    expect(featChoiceLabel('Compendium.pf2e.classfeatures.Item.Blessed Armament')).toBe('Blessed Armament');
    expect(featChoiceLabel('Compendium.pf2e.classfeatures.Item.Harmonic Oscillator')).toBe('Harmonic Oscillator');
  });

  it('expands the raw ability keys used by the dedication pickers', () => {
    expect(featChoiceLabel('Ability Str')).toBe('Strength');
    expect(featChoiceLabel('Ability Dex')).toBe('Dexterity');
    expect(featChoiceLabel('Ability Cha')).toBe('Charisma');
  });

  it('keeps the previously-handled i18n shapes working', () => {
    expect(featChoiceLabel('Perception Label')).toBe('Perception');
    expect(featChoiceLabel('Saves Fortitude')).toBe('Fortitude');
    expect(featChoiceLabel('Aquatic')).toBe('Aquatic'); // a good label is untouched
  });

  it('replaces the unresolved prompt keys with real wording', () => {
    expect(featChoicePrompt('Prompt')).toBe('Choose an option');
    expect(featChoicePrompt('Class DCAbility Score')).toBe('Ability score');
    expect(featChoicePrompt(undefined)).toBe('Choose an option');
    expect(featChoicePrompt('Damage Type')).toBe('Damage Type'); // a good prompt is untouched
  });

  it('no feat choice in the shipped data still renders a raw key', () => {
    const badLabel = /^Compendium\.|^Ability (Str|Dex|Con|Int|Wis|Cha)$/;
    const badPrompt = /^(Prompt|Class DCAbility Score)$/;
    for (const f of Object.values(c.feats)) {
      const def = f.choice;
      if (!def) continue;
      expect(badPrompt.test(featChoicePrompt(def.prompt)), `${f.name} prompt`).toBe(false);
      for (const o of def.options ?? []) {
        expect(badLabel.test(featChoiceLabel(o.label)), `${f.name} option ${o.label}`).toBe(false);
      }
    }
  });
});
