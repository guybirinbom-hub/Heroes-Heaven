import { describe, it, expect } from 'vitest';
import { deriveFamiliar } from '../src/rules/companions';
import { SPECIFIC_FAMILIARS } from '../src/rules/specificFamiliars';
import { content, build } from './_content';
import type { CompanionConfig } from '../src/rules/types';

const fam = (over: Partial<CompanionConfig>): CompanionConfig => ({ id: 'f1', kind: 'familiar', name: '', abilities: [], ...over });

describe('specific familiars', () => {
  it('the requested roster is present', () => {
    for (const id of ['spellslime', 'poppet', 'pipefox', 'imp', 'homunculus', 'grindle-drake', 'fey-dragonet', 'aeon-wyrd', 'calligraphy-wyrm']) {
      expect(SPECIFIC_FAMILIARS.some((f) => f.id === id), id).toBe(true);
    }
  });

  it('a Pipefox familiar carries its required + special abilities', () => {
    const block = deriveFamiliar(fam({ specificFamiliarId: 'pipefox' }), build('wizard', 5), content());
    expect(block.specific?.name).toBe('Pipefox');
    expect(block.specific?.requiredCount).toBe(5);
    expect(block.specific?.requiredAbilities).toContain('Speech');
    expect(block.specific?.specials.some((s) => s.name === 'Scholarly Linguist')).toBe(true);
    expect(block.name).toBe('Pipefox'); // unnamed → uses the specific name
  });

  it('a generic familiar has no specific block', () => {
    const block = deriveFamiliar(fam({}), build('wizard', 5), content());
    expect(block.specific).toBeUndefined();
    expect(block.name).toBe('Familiar');
  });
});
