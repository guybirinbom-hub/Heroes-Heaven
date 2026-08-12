import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, championDevotionOptions, emptyBuild, setupMissing, type BuildState } from '../src/rules/build';

/*
 * "They need to stay empty so the user can choose the choice he wants."
 *
 * Eight pickers used to display the first legal option when the player had chosen nothing, so the
 * choice looked answered and got skipped. The pickers are empty now, which means the SAME choices have
 * to be reported by setupMissing — an empty slot nobody mentions is worse than a wrong default.
 *
 * buildCharacter deliberately keeps its own fallback so a character with one of these outstanding is
 * still legal to save (a draconic sorcerer needs SOME tradition to exist). These tests pin both halves:
 * the choice is reported as missing, and the character still builds while it is.
 */

const c = content();

const withClass = (classId: string, extra: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  classId,
  ...extra,
});

describe('a class trained-skill choice is reported, not silently taken', () => {
  // The thaumaturge is the one class whose OWN trainedSkills carry a choice (its esoteric skill).
  it('is listed while unchosen', () => {
    expect(setupMissing(withClass('thaumaturge'), c)).toContain('Class trained skill');
  });

  it('goes away once the player picks one', () => {
    const b = withClass('thaumaturge', { subclassSkill: 'occultism' });
    expect(setupMissing(b, c)).not.toContain('Class trained skill');
  });

  it('a stored pick outside the allowed list still counts as unchosen', () => {
    const b = withClass('thaumaturge', { subclassSkill: 'athletics' });
    expect(setupMissing(b, c)).toContain('Class trained skill');
  });

  it('is not asked of a class whose trained skills are all fixed', () => {
    expect(setupMissing(withClass('fighter'), c)).not.toContain('Class trained skill');
  });
});

describe('a subclass trained-skill choice (Pistolero, Empiricism) uses the same slot', () => {
  it('is listed while unchosen and cleared by a valid pick', () => {
    const b = withClass('gunslinger', { subclassId: 'way-of-the-pistolero' });
    expect(setupMissing(b, c)).toContain('Class trained skill');
    expect(setupMissing({ ...b, subclassSkill: 'deception' }, c)).not.toContain('Class trained skill');
  });
});

describe('a draconic sorcerer must pick their dragon', () => {
  const draconic = withClass('sorcerer', { subclassId: 'bloodline-draconic' });

  it('is listed while unchosen — the dragon decides the spell tradition', () => {
    expect(setupMissing(draconic, c)).toContain('Dragon exemplar');
  });

  it('goes away once picked', () => {
    const slug = c.classes.sorcerer.subclass?.options.find((o) => o.id === 'bloodline-draconic')?.dragonChoice?.[0].slug;
    expect(slug).toBeTruthy();
    expect(setupMissing({ ...draconic, dragonExemplar: slug }, c)).not.toContain('Dragon exemplar');
  });

  it('a bloodline with no dragon list is never asked', () => {
    expect(setupMissing(withClass('sorcerer', { subclassId: 'bloodline-angelic' }), c)).not.toContain('Dragon exemplar');
  });
});

describe('the druid Voice of Nature choice', () => {
  it('is listed while unchosen — Animal and Plant Empathy are alternatives, not a default', () => {
    const b = withClass('druid');
    expect(setupMissing(b, c)).toContain('Voice of Nature');
    expect(setupMissing({ ...b, voiceOfNature: 'plant-empathy' }, c)).not.toContain('Voice of Nature');
  });

  it('is not asked of a class without the feature', () => {
    expect(setupMissing(withClass('fighter'), c)).not.toContain('Voice of Nature');
  });
});

describe('the champion devotion spell', () => {
  // The options come from the cause's font, so a champion only HAS a choice once a deity gives them a
  // second one. Iomedae's heal font adds Lay on Hands alongside Shields of the Spirit.
  const choosing = withClass('champion', { subclassId: 'desecration', deityId: 'iomedae' });

  it('is listed while unchosen', () => {
    expect(setupMissing(choosing, c)).toContain('Devotion spell');
  });

  it('goes away once picked', () => {
    expect(setupMissing({ ...choosing, devotionSpell: 'lay-on-hands' }, c)).not.toContain('Devotion spell');
  });

  it('is NOT asked when the font leaves only one legal spell — that is not a choice', () => {
    const only = withClass('champion', { subclassId: 'justice' });
    expect(championDevotionOptions(only, c).length).toBe(1);
    expect(setupMissing(only, c)).not.toContain('Devotion spell');
  });

  it('is never asked of a class without devotion spells', () => {
    expect(setupMissing(withClass('fighter'), c)).not.toContain('Devotion spell');
  });
});

describe('the inventor armour base', () => {
  it('is listed for an armour innovation only', () => {
    const armor = withClass('inventor', { subclassId: 'armor-innovation' });
    expect(setupMissing(armor, c)).toContain('Armor base');
    expect(setupMissing({ ...armor, inventorArmorStats: 'power-suit' }, c)).not.toContain('Armor base');
    expect(setupMissing(withClass('inventor', { subclassId: 'weapon-innovation' }), c)).not.toContain('Armor base');
  });
});

describe('a half-finished character is still buildable', () => {
  it('each of these builds with the choice left open', () => {
    const cases: [string, Partial<BuildState>][] = [
      ['thaumaturge', {}],
      ['sorcerer', { subclassId: 'bloodline-draconic' }],
      ['druid', {}],
      ['champion', { subclassId: 'justice' }],
      ['inventor', { subclassId: 'armor-innovation' }],
    ];
    for (const [classId, extra] of cases) {
      expect(() => buildCharacter(withClass(classId, extra), c), classId).not.toThrow();
    }
  });

  it('an empty build reports rather than throws', () => {
    expect(() => setupMissing(emptyBuild(), c)).not.toThrow();
  });
});
