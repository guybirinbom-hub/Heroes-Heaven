import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild, CUSTOM_BACKGROUND_ID, type BuildState } from '../src/rules/build';
import { content } from './_content';

const c = content();

function customBuild(): BuildState {
  return {
    ...emptyBuild(),
    name: 'T',
    level: 1,
    ancestryId: 'human',
    classId: 'fighter',
    keyAbility: 'str',
    backgroundId: CUSTOM_BACKGROUND_ID,
    customBackground: {
      name: 'Shipwreck Survivor',
      description: 'Washed ashore with nothing.',
      boosts: ['dex', 'wis'],
      trainedSkill: 'athletics',
      loreSubject: 'Sailing',
      skillFeatId: 'hefty-hauler',
    },
  };
}

describe('custom ("deep") background', () => {
  const ch = buildCharacter(customBuild(), c);

  it('applies the two chosen attribute boosts', () => {
    expect(ch.abilities.dex).toBeGreaterThanOrEqual(12);
    expect(ch.abilities.wis).toBeGreaterThanOrEqual(12);
  });

  it('trains the chosen skill and the Lore', () => {
    expect(ch.proficiencies.skills.athletics).toBe('trained');
    expect(ch.proficiencies.skills['lore:Sailing']).toBe('trained');
  });

  it('grants the chosen skill feat', () => {
    expect(ch.feats.some((f) => f.featId === 'hefty-hauler')).toBe(true);
  });

  it('records the custom background on the character', () => {
    expect(ch.backgroundId).toBe(CUSTOM_BACKGROUND_ID);
    expect(ch.customBackground?.name).toBe('Shipwreck Survivor');
  });

  it('a build with no custom background still works (regression)', () => {
    const plain = buildCharacter({ ...emptyBuild(), name: 'T', level: 1, ancestryId: 'human', classId: 'fighter', keyAbility: 'str', backgroundId: 'acolyte' }, c);
    expect(plain.backgroundId).toBe('acolyte');
    expect(plain.customBackground).toBeUndefined();
  });
});
