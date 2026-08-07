import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { backgroundGrantedFeats } from '../src/rules/build';

/**
 * Ancestry, background and deity data — the values that land on a character once at build time and
 * are never recomputed, so a wrong one is silent for the life of the sheet.
 */
const c = () => content();

describe('deities', () => {
  it.each([
    ['treerazer', ['harm']],
    ['thamir', ['harm']],
    ['imot', ['harm']],
    ['telvrys', ['harm']],
    ['umarik', ['harm']],
    ['srikalis-sritaming-and-sribaril', ['heal']],
    ['diomazul', ['harm', 'heal']],
    ['cormion', ['harm', 'heal']],
  ])('%s has divine font %s', (id, font) => {
    // The font decides whether a cleric's bonus slots hold heal or harm, which is most of the class.
    expect([...(c().deities[id as string].divineFont ?? [])].sort()).toEqual([...(font as string[])].sort());
  });

  it('the two wrong divine skills are right', () => {
    expect(c().deities['the-enlightened-scholars-path'].skill).toBe('lore');
    expect(c().deities.thremyr.skill).toBe('religion');
  });

  it('Laudinmio has all four printed domains', () => {
    expect([...c().deities.laudinmio.domains].sort()).toEqual(['change', 'creation', 'metal', 'sorrow']);
  });
});

describe('backgrounds whose granted feat depends on the skill you chose', () => {
  // "If you choose Athletics, you gain Titan Wrestler. If you choose Thievery, you gain Dirty Trick."
  // Each carried a single grantedFeatId, so picking the second skill handed you the first's feat.
  it.each([
    ['beast-seeker', 'athletics', 'titan-wrestler', 'thievery', 'dirty-trick'],
    ['glory-hound', 'intimidation', 'intimidating-glare', 'performance', 'impressive-performance'],
    ['child-of-the-polis', 'diplomacy', 'bargain-hunter', 'society', 'streetwise'],
    ['obari-wanderer', 'acrobatics', 'cat-fall', 'survival', 'terrain-expertise'],
  ])('%s: %s -> %s, %s -> %s', (id, skillA, featA, skillB, featB) => {
    const bg = c().backgrounds[id as string];
    expect(bg.grantedFeatByChoice, id as string).toEqual({ [skillA as string]: featA, [skillB as string]: featB });
    // …and the grant resolves to the SECOND skill's feat, not the first's. Asserted through the
    // resolver rather than the finished feat list, because a character can reach the same feat by
    // another route and absence from the list would then be testing the wrong thing.
    expect(backgroundGrantedFeats(bg, skillB as never)).toEqual([featB]);
    expect(backgroundGrantedFeats(bg, skillA as never)).toEqual([featA]);
    // Unanswered falls back to the first offered skill, matching how trainedSkillChoice defaults.
    expect(backgroundGrantedFeats(bg, null)).toEqual([featA]);
  });
});

describe('the mirror is not always right', () => {
  it("Alma's Clerk grants Glean Contents, whatever the mirror's field says", () => {
    // Its printed text reads "You gain the Glean Contents skill feat"; the structured `feat` field
    // says Crafter's Appraisal and contradicts it.
    expect(c().backgrounds['almas-clerk'].grantedFeatId).toBe('glean-contents');
  });

  it('Orc has two free attribute boosts', () => {
    // The legacy Advanced Player's Guide Orc had Strength + free; the Remaster has two free, and
    // matching by name alone picks whichever printing came first.
    expect(c().ancestries.orc.abilityBoosts).toEqual([{ kind: 'free' }, { kind: 'free' }]);
  });
});
