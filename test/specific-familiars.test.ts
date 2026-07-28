import { describe, it, expect } from 'vitest';
import { deriveFamiliar } from '../src/rules/companions';
import { specificFamiliar, specificFamiliars } from '../src/rules/specificFamiliars';
import { content, build } from './_content';
import type { CompanionConfig } from '../src/rules/types';

const fam = (over: Partial<CompanionConfig>): CompanionConfig => ({ id: 'f1', kind: 'familiar', name: '', abilities: [], ...over });

describe('specific familiars', () => {
  it('the requested roster is present', () => {
    const all = specificFamiliars(content());
    for (const id of ['spellslime', 'poppet', 'pipefox', 'imp', 'homunculus', 'grindle-drake', 'fey-dragonet', 'aeon-wyrd', 'calligraphy-wyrm']) {
      expect(all.some((f) => f.id === id), id).toBe(true);
    }
  });

  it('ships the full published roster from the AoN import, each with a source book', () => {
    const all = specificFamiliars(content());
    expect(all.length).toBeGreaterThanOrEqual(38);
    // Ones the old hardcoded table never had.
    for (const id of ['clockwork-familiar', 'nosoi', 'shadow-familiar', 'dweomercat-cub', 'crawling-hand']) {
      expect(all.some((f) => f.id === id), id).toBe(true);
    }
    expect(all.filter((f) => !f.source?.book).map((f) => f.id)).toEqual([]);
    // Every entry keeps the fields the stat block renders.
    for (const f of all) {
      expect(f.requiredCount, f.id).toBeGreaterThan(0);
      expect(f.requiredAbilities.length, f.id).toBeGreaterThan(0);
      expect(f.specials.length, f.id).toBeGreaterThan(0);
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

  it('Spellslime still forces the Ooze Defense AC and the Tough HP bump', () => {
    const character = build('wizard', 5);
    const block = deriveFamiliar(fam({ specificFamiliarId: 'spellslime' }), character, content());
    expect(block.ac).toBe(10 + character.level); // Ooze Defense, not the master's AC
    expect(block.hp).toBe((5 + 2) * character.level); // required Tough ability
    expect(specificFamiliar(content(), 'spellslime')?.requiredAbilities).toContain('Tough');
  });

  it('a generic familiar has no specific block', () => {
    const block = deriveFamiliar(fam({}), build('wizard', 5), content());
    expect(block.specific).toBeUndefined();
    expect(block.name).toBe('Familiar');
  });
});
