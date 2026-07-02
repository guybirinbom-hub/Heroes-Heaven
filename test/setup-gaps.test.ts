import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import {
  backgroundTrainedSkill,
  buildCharacter,
  deriveBuildFromCharacter,
  emptyBuild,
  setupMissing,
  subclassKeyAbility,
  type BuildState,
} from '../src/rules/build';

const c = content();

// ---------------------------------------------------------------------------
// Item 2 — backgrounds that grant no skill (importer description fallback)
// ---------------------------------------------------------------------------

describe('background trained-skill recovery (importer fallback)', () => {
  it('brevic-noble recovers its fixed skill + lore from the description', () => {
    const bg = c.backgrounds['brevic-noble'];
    expect(bg.trainedSkill).toBe('crafting');
    expect(bg.trainedLore).toBe('architecture');
  });

  it('brevic-outcast recovers its lore (it grants no core skill)', () => {
    const bg = c.backgrounds['brevic-outcast'];
    expect(bg.trainedSkill).toBeUndefined();
    expect(bg.trainedLore).toBe('politics');
  });

  it('choice backgrounds carry trainedSkillChoice (able-carter, animal-wrangler, historical-reenactor)', () => {
    expect(c.backgrounds['able-carter'].trainedSkillChoice).toEqual(['deception', 'diplomacy']);
    expect(c.backgrounds['animal-wrangler'].trainedSkillChoice).toEqual(['athletics', 'nature']);
    expect(c.backgrounds['historical-reenactor'].trainedSkillChoice).toEqual(['performance', 'society']);
    expect(c.backgrounds['historical-reenactor'].trainedLore).toBe('dwarf');
  });

  it('a background with structured data is never second-guessed (acolyte)', () => {
    expect(c.backgrounds['acolyte'].trainedSkill).toBe('religion');
    expect(c.backgrounds['acolyte'].trainedSkillChoice).toBeUndefined();
  });
});

describe('background skill choice in the build engine', () => {
  it('unpicked choice defaults to the FIRST offered skill', () => {
    const ch = build('fighter', 1, { backgroundId: 'able-carter' });
    expect(ch.proficiencies.skills.deception).toBe('trained');
  });

  it('a picked choice trains that skill instead', () => {
    const ch = build('fighter', 1, { backgroundId: 'able-carter', backgroundSkillChoice: 'diplomacy' });
    expect(ch.proficiencies.skills.diplomacy).toBe('trained');
    expect(ch.proficiencies.skills.deception).toBe('untrained');
  });

  it('an off-list pick falls back to the first option', () => {
    const b: BuildState = { ...emptyBuild(), backgroundId: 'able-carter', backgroundSkillChoice: 'arcana' };
    expect(backgroundTrainedSkill(b, c.backgrounds['able-carter'])).toBe('deception');
  });

  it("the background's granted skill FEAT still applies alongside a recovered choice (hermit)", () => {
    // hermit: choice of Nature/Occultism + grants Dubious Knowledge.
    const ch = build('fighter', 1, { backgroundId: 'hermit' });
    expect(ch.proficiencies.skills.nature).toBe('trained');
    expect(ch.feats.some((f) => f.featId === 'dubious-knowledge')).toBe(true);
  });

  it('deriveBuildFromCharacter recovers the pick', () => {
    const ch = build('fighter', 1, { backgroundId: 'able-carter', backgroundSkillChoice: 'diplomacy' });
    const rb = deriveBuildFromCharacter(ch, c);
    expect(rb.backgroundSkillChoice).toBe('diplomacy');
    // Rebuilding reproduces the same training without consuming a class pick.
    const ch2 = buildCharacter({ ...rb, backgroundId: 'able-carter' }, c);
    expect(ch2.proficiencies.skills.diplomacy).toBe('trained');
  });
});

// ---------------------------------------------------------------------------
// Item 3 — versatile human bonus general feat
// ---------------------------------------------------------------------------

describe('versatile human general feat', () => {
  it('the heritage is flagged as feat-granting', () => {
    expect(c.heritages['versatile-human'].grantsGeneralFeat).toBe(true);
  });

  it('the picked general feat lands on the character', () => {
    const ch = build('fighter', 1, {
      ancestryId: 'human',
      heritageId: 'versatile-human',
      heritageFeatId: 'toughness',
    });
    const feat = ch.feats.find((f) => f.featId === 'toughness');
    expect(feat).toBeTruthy();
    expect(feat!.level).toBe(1);
    expect(feat!.category).toBe('general');
  });

  it('no feat is injected when unpicked or when the heritage does not grant one', () => {
    const unpicked = build('fighter', 1, { ancestryId: 'human', heritageId: 'versatile-human' });
    expect(unpicked.feats.some((f) => f.featId === 'toughness')).toBe(false);
    const skilled = build('fighter', 1, { ancestryId: 'human', heritageId: 'skilled-human', heritageFeatId: 'toughness' });
    expect(skilled.feats.some((f) => f.featId === 'toughness')).toBe(false);
  });

  it('deriveBuildFromCharacter recovers the heritage feat (round-trip)', () => {
    const ch = build('fighter', 1, {
      ancestryId: 'human',
      heritageId: 'versatile-human',
      heritageFeatId: 'toughness',
    });
    const rb = deriveBuildFromCharacter(ch, c);
    expect(rb.heritageFeatId).toBe('toughness');
  });
});

// ---------------------------------------------------------------------------
// Item 4 — rogue racket key-ability choice (Dex or the racket attribute)
// ---------------------------------------------------------------------------

describe('rogue racket key attribute', () => {
  it('rackets expose keyAbilityOptions including dex', () => {
    const opts = Object.fromEntries(c.classes.rogue.subclass!.options.map((o) => [o.id, o.keyAbilityOptions]));
    expect(opts.ruffian).toEqual(['str', 'dex']);
    expect(opts.mastermind).toEqual(['int', 'dex']);
    expect(opts.scoundrel).toEqual(['cha', 'dex']);
    expect(opts['eldritch-trickster']).toBeUndefined(); // KEY_ABILITY_IGNORE
    expect(opts.thief).toBeUndefined(); // no keyOptions at all — class default (dex) applies
  });

  it('a ruffian with keyAbility dex KEEPS dex', () => {
    const ch = build('rogue', 1, { subclassId: 'ruffian', keyAbility: 'dex' });
    expect(ch.keyAbility).toBe('dex');
  });

  it('an unpicked ruffian (keyAbility null) defaults to the racket attribute (str — first option)', () => {
    const ch = build('rogue', 1, { subclassId: 'ruffian', keyAbility: null });
    expect(ch.keyAbility).toBe('str');
  });

  it('an off-list pick falls back to the racket attribute', () => {
    const ch = build('rogue', 1, { subclassId: 'ruffian', keyAbility: 'wis' });
    expect(ch.keyAbility).toBe('str');
  });

  it('subclassKeyAbility agrees with buildCharacter (boost + resolved key never disagree)', () => {
    const b: BuildState = { ...emptyBuild(), classId: 'rogue', subclassId: 'ruffian', keyAbility: 'dex' };
    expect(subclassKeyAbility(b, c)).toBe('dex');
    expect(subclassKeyAbility({ ...b, keyAbility: null }, c)).toBe('str');
  });

  it('a fixed-key subclass is unchanged (psychic subconscious mind still forces its attribute)', () => {
    // thief has no keyAbilityOptions: the rogue class key (dex) applies regardless of a stray pick.
    const ch = build('rogue', 1, { subclassId: 'thief', keyAbility: null });
    expect(ch.keyAbility).toBe('dex');
  });
});

// ---------------------------------------------------------------------------
// Item 1 — setup completeness (missing level-0 choices)
// ---------------------------------------------------------------------------

describe('setupMissing', () => {
  it('an empty build reports the identity picks + the 4 free boosts', () => {
    const missing = setupMissing(emptyBuild(), c);
    expect(missing).toContain('Ancestry');
    expect(missing).toContain('Heritage');
    expect(missing).toContain('Background');
    expect(missing).toContain('Class');
    expect(missing).toContain('Free attribute boosts (4)');
  });

  it('a fully-chosen build reports nothing', () => {
    const b: BuildState = {
      ...emptyBuild(),
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acolyte',
      classId: 'cleric',
      subclassId: 'cloistered-cleric',
      keyAbility: 'wis',
      ancestryBoosts: ['str', 'con'],
      backgroundBoosts: ['wis', 'int'],
      levelBoosts: ['wis', 'con', 'dex', 'cha'],
    };
    expect(setupMissing(b, c)).toEqual([]);
  });

  it('counts unfilled boost slots and the voluntary-flaw attribute', () => {
    const b: BuildState = {
      ...emptyBuild(),
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acolyte',
      classId: 'cleric',
      keyAbility: 'wis',
      ancestryBoosts: ['str', null],
      backgroundBoosts: [null, null],
      levelBoosts: ['wis', 'con', 'dex', null],
      options: { voluntaryFlaw: true },
    };
    const missing = setupMissing(b, c);
    expect(missing).toContain('Ancestry boost');
    expect(missing).toContain('Background boosts (2)');
    expect(missing).toContain('Free attribute boost');
    expect(missing).toContain('Voluntary flaw attribute');
  });

  it('reports the racket key-attribute choice and the versatile-human feat when unpicked', () => {
    const racket: BuildState = {
      ...emptyBuild(),
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'rogue',
      subclassId: 'ruffian',
      keyAbility: null,
      ancestryBoosts: ['str', 'con'],
      backgroundBoosts: ['wis', 'int'],
      levelBoosts: ['str', 'con', 'dex', 'cha'],
    };
    const missing = setupMissing(racket, c);
    expect(missing).toContain('Key attribute');
    expect(missing).toContain('Heritage general feat');
    // Picking both clears them.
    const done = setupMissing({ ...racket, keyAbility: 'dex', heritageFeatId: 'toughness' }, c);
    expect(done).not.toContain('Key attribute');
    expect(done).not.toContain('Heritage general feat');
  });

  it('reports an unmade background skill choice', () => {
    const b: BuildState = {
      ...emptyBuild(),
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'able-carter',
      classId: 'fighter',
      keyAbility: 'str',
      ancestryBoosts: ['str', 'con'],
      backgroundBoosts: [null, null],
      levelBoosts: ['str', 'con', 'dex', 'cha'],
    };
    expect(setupMissing(b, c)).toContain('Background trained skill');
    expect(setupMissing({ ...b, backgroundSkillChoice: 'diplomacy' }, c)).not.toContain('Background trained skill');
  });
});
