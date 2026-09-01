import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import { deriveFamiliar } from '../src/rules/companions';
import { FAMILIAR_ABILITY_CHOICES } from '../src/rules/companionGrants';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 13 — 100 level-4 feats, items excluded on the
 * owner's instruction.
 *
 * Asserted on BUILT characters wherever a character can express it. The batch's dominant defect was a
 * record whose whole printed effect was a grant that reached nothing: five feats shipped with an empty
 * mechanical body, so the sentence "you gain X" gave the player nothing at all.
 */

describe('a feat whose whole text is a grant actually grants it', () => {
  const withFeat = (id: string, cls = 'fighter', level = 6) =>
    build(cls, level, { featPicks: { '4:class': id } } as never);

  it("Guard's Fury gives you the Rage action", () => {
    /* *"You can use the Rage action."* The record was empty; `actions/rage` ships as the 1-action
     * activity and `feats/barbarian-dedication` already grants it the same way. */
    expect(db.feats['guards-fury'].grantsActions ?? []).toContain('rage');
    expect(db.actions['rage']).toBeTruthy();
  });

  it('Base Kinesis gives you the impulse', () => {
    /* *"You gain the Base Kinesis impulse."* Granted as a CLASS FEATURE, not an action: MainTab
     * already surfaces owned class features as actions, so granting both would list it twice. */
    expect(db.feats['base-kinesis'].grantsClassFeatures ?? []).toContain('base-kinesis');
    expect(db.classFeatures['base-kinesis']).toBeTruthy();
  });

  it.each([
    ['bony-barrage', 'bony-barrage'],
    ['thrall-charger', 'thrall-charge'],
  ])('%s teaches its focus spell, and it reaches the sheet', (featId, spellId) => {
    expect(db.feats[featId].focusSpells ?? []).toContain(spellId);
    const ch = build('necromancer', 6, { featPicks: { '4:class': featId } } as never);
    const known = (ch.spellcasting ?? [])
      .filter((e) => e.type === 'focus')
      .flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    expect(known).toContain(spellId);
  });

  it('Tactile Magic Feedback grants spellsense, and the sheet can explain it', () => {
    /* *"You gain an imprecise sense known as spellsense, which has a range of 60 feet."* The record
     * was completely empty. Distinct from magicsense, which finds spells and ITEMS — this finds the
     * CASTER, which is why it needed its own glossary entry rather than reusing one. */
    const senses = deriveDefenses(withFeat('tactile-magic-feedback'), db).senses;
    const s = senses.find((x) => x.name === 'spellsense');
    expect(s, 'the sense must reach the sheet').toBeTruthy();
    expect(s?.acuity).toBe('imprecise');
    expect(s?.range).toBe(60);
  });
});

describe('a conditional skill step that only the printed text states', () => {
  /* Both feats grant a trained Lore and then upgrade it — *"If you are legendary in the Performance
   * skill, you gain expert proficiency in Folktales Lore"* — and only the trained half was authored,
   * so the step never happened. Their side flattens the conditional to a bare `expert`; neither was
   * right. Same shape as `bardic-lore`, which already worked. */
  const bard = (increases: Record<number, string>) =>
    build('bard', 20, { featPicks: { '4:class': 'folktales-lore' }, skillIncreases: increases } as never);

  it('fires only at legendary in the gating skill', () => {
    const legendary = bard({ 3: 'performance', 7: 'performance', 15: 'performance' });
    const master = bard({ 3: 'performance', 7: 'performance' });
    expect(legendary.proficiencies.skills['performance']).toBe('legendary');
    expect(legendary.proficiencies.skills['lore:folktales']).toBe('expert');
    expect(master.proficiencies.skills['performance']).toBe('master');
    expect(master.proficiencies.skills['lore:folktales']).toBe('trained');
  });
});

describe('Fast Movement raises the Speed the player chooses', () => {
  /*
   * *"Increase ONE of your familiar's Speeds from 25 feet to 40 feet."* The picker was a bare on/off
   * toggle and the engine applied the 40 to the LAND Speed only, so a familiar with Flier or Climber —
   * each a 25-foot Speed the ability explicitly may raise — could never point it at the right one.
   */
  const fam = (abilities: string[], abilityChoices?: Record<string, string>) =>
    deriveFamiliar(
      { id: 'f1', kind: 'familiar', name: 'Fam', abilities, ...(abilityChoices ? { abilityChoices } : {}) } as never,
      build('wizard', 6),
      db,
    );

  it('defaults to land, which is what every existing familiar had', () => {
    expect(fam(['fast-movement']).speed).toBe(40);
  });

  it.each([
    ['fly', 'flier', 'fly 40 feet'],
    ['climb', 'climber', 'climb 40 feet'],
  ])('can be pointed at the %s Speed', (target, ability, expected) => {
    const f = fam(['fast-movement', ability], { 'fast-movement': target });
    expect(f.extraSpeeds).toContain(expected);
    expect(f.speed, 'and the land Speed then stays at its base').toBe(25);
  });

  it('is offered for burrow and correctly does nothing — that Speed is 5, not 25', () => {
    expect(fam(['fast-movement', 'burrower'], { 'fast-movement': 'burrow' }).extraSpeeds).toContain('burrow 5 feet');
  });

  it('offers all five Speeds from the rules layer, not from the picker component', () => {
    /* The table lived in CompanionsTab.tsx, where the derive path could not read it and no data audit
     * could see it. A record's options are data. */
    expect(FAMILIAR_ABILITY_CHOICES['fast-movement'].options.map((o) => o.value)).toEqual([
      'land', 'swim', 'fly', 'climb', 'burrow',
    ]);
  });
});

describe('the generic spellcasting ladder grants slots', () => {
  /* `basic-` / `expert-` / `master-spellcasting` are the archetype-agnostic feats from the
   * Spellcasting Archetypes rules, and NOTHING in the app read them — a character holding all three
   * received no slots at any level. Now keyed on `cantrip-casting` in CASTER_ARCHETYPES. */
  const ranks = (level: number, picks: Record<string, string>) => {
    const ch = build('fighter', level, { featPicks: picks, archetypeTradition: 'occult' } as never);
    const e = ch.spellcasting?.find((x) => x.id === 'cantrip-casting-casting');
    return e ? Object.keys(e.repertoire ?? {}) : [];
  };
  const base = { '2:class': 'cantrip-casting', '4:class': 'basic-spellcasting' };

  it('unlocks 1st at 4th, through 3rd at 8th', () => {
    expect(ranks(4, base)).toEqual(['1']);
    expect(ranks(8, base)).toEqual(['1', '2', '3']);
  });

  it('and the Expert feat carries it further', () => {
    expect(ranks(14, { ...base, '12:class': 'expert-spellcasting' })).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('an innate-ranked archetype is fillable by a caster too', () => {
  /* The Captivator's three ranks unlocked for a caster class and there was nothing to put in them:
   * `build.archetypeSpells.spells` had no writer anywhere, and the Builder's per-level pickers are
   * gated on the character NOT being a caster. Measured before the fix as {1:[],2:[],3:[]} on a bard. */
  it('a bard can learn its spells', () => {
    const ch = build('bard', 8, {
      featPicks: { '2:class': 'captivator-dedication', '4:class': 'basic-captivator-spellcasting' },
      archetypeSpells: { cantrips: [], tradition: 'occult', spells: { 1: ['charm'], 2: ['illusory-creature'], 3: ['hypnotize'] } },
    } as never);
    const e = ch.spellcasting?.find((x) => x.id === 'captivator-dedication-casting');
    expect(e?.type).toBe('innate');
    expect(e?.repertoire?.[1]).toEqual(['charm']);
    expect(e?.repertoire?.[3]).toEqual(['hypnotize']);
  });
});
