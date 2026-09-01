import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveMaxHp, deriveSpeeds, deriveStrikes, deriveBulk } from '../src/rules/derive';
import { heritageAdjustedAncestryAttributes, ancestryBodySize, type BuildState } from '../src/rules/build';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 19 — the FIRST batch over ancestries and
 * backgrounds, which is why most of its findings were whole missing CARRIERS rather than wrong
 * numbers: the ancestry bucket had never had readers for granted actions, feats, or items.
 * Everything here is asserted on BUILT characters.
 */

describe('printed swim Speeds reach the sheet', () => {
  it.each([
    ['merfolk', 25],
    ['azarketi', 30],
    ['athamaru', 25],
  ])('%s swims at %i', (anc, swim) => {
    expect(deriveSpeeds(build('fighter', 1, { ancestryId: anc } as Partial<BuildState>), db).swim).toBe(swim);
  });

  it('a heritage that states a LOWER speed replaces the chassis value (Mistbreath)', () => {
    /* The azarketi chassis says swim 30; the Mistbreath heritage — raised away from water — prints
     * swim 15. The heritage is the more specific statement, so 15 stands; max() would say 30. */
    expect(deriveSpeeds(build('fighter', 1, { ancestryId: 'azarketi', heritageId: 'mistbreath-azarketi' } as Partial<BuildState>), db).swim).toBe(15);
  });
});

describe('the skeleton plays as printed (basic undead benefits)', () => {
  const sk = () => build('fighter', 3, { ancestryId: 'skeleton' } as Partial<BuildState>);
  it('void healing, death-effect immunity, low-light vision', () => {
    const d = deriveDefenses(sk(), db);
    expect(d.negativeHealing, 'void healing comes from the ANCESTRY carrier').toBe(true);
    expect(d.immunities).toContain('death');
    expect(db.ancestries.skeleton.vision).toBe('low-light-vision');
  });
});

describe('Full Moon Sarangay swaps the printed attributes', () => {
  it('boost Wis instead of Str; flaw Con instead of Wis', () => {
    const eff = heritageAdjustedAncestryAttributes(db.ancestries.sarangay, db.heritages['full-moon-sarangay']);
    const fixed = eff.abilityBoosts.filter((b) => b.kind === 'fixed').map((b) => (b as { ability: string }).ability);
    expect(fixed.sort()).toEqual(['cha', 'wis']);
    expect(eff.abilityFlaws).toEqual(['con']);
    // …and a plain sarangay is untouched.
    const plain = heritageAdjustedAncestryAttributes(db.ancestries.sarangay, undefined);
    expect(plain.abilityBoosts.filter((b) => b.kind === 'fixed').map((b) => (b as { ability: string }).ability).sort()).toEqual(['cha', 'str']);
    expect(plain.abilityFlaws).toEqual(['wis']);
  });
});

describe('the printed size choices are real picks', () => {
  it('an automaton can be Small, and unanswered stays Medium', () => {
    const small = build('fighter', 1, { ancestryId: 'automaton', featChoices: { 'ancestry:automaton': 'small' } } as Partial<BuildState>);
    expect(small.size).toBe('small');
    const unanswered = build('fighter', 1, { ancestryId: 'automaton' } as Partial<BuildState>);
    expect(unanswered.size ?? 'medium').toBe('medium');
  });

  it("the awakened animal's HP follows its chosen size (6/6/8/10)", () => {
    const at = (size?: string) =>
      deriveMaxHp(build('fighter', 1, { ancestryId: 'awakened-animal', ...(size ? { featChoices: { 'ancestry:awakened-animal': size } } : {}) } as Partial<BuildState>), db);
    expect(at('large') - at('tiny')).toBe(4);
    expect(at('medium') - at('small')).toBe(2);
    expect(at(), 'unanswered defaults to the record scalar (medium, 8)').toBe(at('medium'));
    expect(ancestryBodySize(db.ancestries['awakened-animal'], { featChoices: { 'ancestry:awakened-animal': 'large' } })).toBe('large');
  });
});

describe("Mightyfall Kobold's optional package", () => {
  /* Printed: "You gain 10 Hit Points from your ancestry instead of 6. Instead of the normal
   * attribute boosts and flaws, you can choose to gain a boost to Strength, a boost to Charisma,
   * and a flaw in Intelligence." — surfaced by the kobold row's select on their side. */
  const kobold = (answer?: string) =>
    build('fighter', 1, {
      ancestryId: 'kobold', heritageId: 'mightyfall-kobold',
      ...(answer ? { featChoices: { 'heritage:mightyfall-kobold': answer } } : {}),
    } as Partial<BuildState>);

  it('chosen: Str+Cha boosts, Int flaw, 10 ancestry HP', () => {
    const eff = heritageAdjustedAncestryAttributes(db.ancestries.kobold, db.heritages['mightyfall-kobold'], 'kaiju');
    expect(eff.abilityBoosts.map((b) => (b as { ability?: string }).ability).sort()).toEqual(['cha', 'str']);
    expect(eff.abilityFlaws).toEqual(['int']);
    expect(kobold('kaiju').ancestryHp, 'the resolved ancestry HP rides the Character').toBe(10);
    /* +4 ancestry HP, +1 more because the kaiju package also lifts the normal Con FLAW (Con 8 → 10). */
    expect(deriveMaxHp(kobold('kaiju'), db) - deriveMaxHp(kobold('normal'), db)).toBe(5);
  });

  it('unanswered or normal: the ordinary kobold array stands', () => {
    const eff = heritageAdjustedAncestryAttributes(db.ancestries.kobold, db.heritages['mightyfall-kobold'], undefined);
    expect(eff.abilityBoosts).toEqual(db.ancestries.kobold.abilityBoosts);
    expect(deriveMaxHp(kobold(), db)).toBe(deriveMaxHp(kobold('normal'), db));
  });
});

describe('the three new ancestry carriers deliver', () => {
  it('grantsFeats: a lizardfolk owns Breath Control', () => {
    const ch = build('fighter', 1, { ancestryId: 'lizardfolk' } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'breath-control')).toBe(true);
  });

  it('grantsItems: a dwarf starts with the printed birth-gift clan dagger', () => {
    const ch = build('fighter', 1, { ancestryId: 'dwarf' } as Partial<BuildState>);
    expect((ch.inventory ?? []).map((i) => i.itemId)).toContain('clan-dagger');
  });

  it('grantedStrikes: the printed fangs and jaws exist as Strikes', () => {
    const strike = (anc: string, name: string) =>
      deriveStrikes(build('fighter', 1, { ancestryId: anc } as Partial<BuildState>), db).find((s) => s.name.toLowerCase().includes(name));
    /* The damage string carries the Str mod ("1d6+1 P"), so assert the printed die and type. */
    expect(strike('nagaji', 'fangs')?.damage).toMatch(/^1d6(\+\d+)? P$/);
    expect(strike('anadi', 'fangs')?.damage).toMatch(/^1d6(\+\d+)? P$/);
    expect(strike('dragonet', 'jaws')?.damage).toMatch(/^1d4(\+\d+)? P$/);
    /* Conrasu's attack belongs to the Ceremony of the Evened Hand FEAT, not the ancestry — the
     * unconditional ancestry copy was the over-grant this batch removed. */
    expect(deriveStrikes(build('fighter', 1, { ancestryId: 'conrasu' } as Partial<BuildState>), db).filter((s) => /claw|branch/i.test(s.name))).toEqual([]);
  });
});

describe('smaller printed clauses', () => {
  it("centaur's Robust raises both Bulk thresholds by 2", () => {
    /* Against the FORMULA, not against a human — the centaur's own fixed Str boost would otherwise
     * smuggle an extra +1 into the comparison through the Strength modifier. */
    const ch = build('fighter', 1, { ancestryId: 'centaur' } as Partial<BuildState>);
    const strMod = Math.floor((ch.abilities.str - 10) / 2);
    const bulk = deriveBulk(ch, db);
    expect(bulk.max).toBe(10 + strMod + 2);
    expect(bulk.encumberedAt).toBe(5 + strMod + 2);
  });

  it('the printed choosable-language lists shipped (46 ancestries)', () => {
    const withOptions = Object.values(db.ancestries).filter((a) => (a.languages.options?.length ?? 0) > 1);
    expect(withOptions.length).toBeGreaterThanOrEqual(40);
    // Spot-check one against its printed list: the dwarf chooses from these.
    expect(db.ancestries.dwarf.languages.options).toContain('petran');
  });

  it('a kashrishi has the printed imprecise Empathic Sense and speaks Kashrishi', () => {
    const ch = build('fighter', 1, { ancestryId: 'kashrishi' } as Partial<BuildState>);
    const sense = deriveDefenses(ch, db).senses.find((s) => /empathic/i.test(s.name));
    expect(sense?.acuity).toBe('imprecise');
    expect(sense?.range).toBe(15);
    expect(ch.languages).toContain('kashrishi');
  });

  it('Runelord Scholar grants Thassilonian and pins one Multilingual pick', () => {
    const ch = build('fighter', 1, { backgroundId: 'runelord-scholar' } as Partial<BuildState>);
    expect(ch.languages).toContain('thassilonian');
    expect(ch.feats.some((f) => f.featId === 'multilingual'), 'the background grants Multilingual').toBe(true);
  });

  it('Banished Celestial trains a chosen skill and owns its printed reaction', () => {
    const ch = build('fighter', 1, { backgroundId: 'banished-celestial', featChoices: { 'background:banished-celestial': 'athletics' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills.athletics).toBe('trained');
    expect(db.backgrounds['banished-celestial'].grantsActions).toContain('enlightenment-in-adversity');
    expect(db.actions['enlightenment-in-adversity']).toBeTruthy();
  });
});
