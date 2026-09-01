import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { emptyBuild, deriveBuildFromCharacter } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { featEntries } from '../src/sheet/FeatsTab';

/**
 * The DISPLAY / REACHABILITY half of the goal.
 *
 * A record can compute perfectly and be listed nowhere, or be modelled perfectly and be offered to
 * nobody. Every case below was found by audit and verified by hand: the mechanics were already
 * right, and the player could not see or reach them.
 */
const db = content();

const namesFor = (classId: string, level: number, over: Record<string, unknown> = {}) =>
  featEntries(build(classId, level, over), db).map((e) => e.featureId ?? e.featId);

describe('a subclass hands over features the class list does not contain', () => {
  it("a gunslinger's deeds are LISTED, not just owned", () => {
    const c = build('gunslinger', 9, { subclassId: 'way-of-the-drifter' });
    // Owned was already true — that is exactly why this went unnoticed.
    expect(ownedFeatureIds(c, db).has('into-the-fray')).toBe(true);
    expect(namesFor('gunslinger', 9, { subclassId: 'way-of-the-drifter' })).toContain('into-the-fray');
  });

  it('and only the ones their level has reached', () => {
    expect(namesFor('gunslinger', 1, { subclassId: 'way-of-the-drifter' })).not.toContain('finish-the-job');
    expect(namesFor('gunslinger', 9, { subclassId: 'way-of-the-drifter' })).toContain('finish-the-job');
  });

  it("an oracle's curse is listed", () => {
    const mystery = db.classes.oracle.subclass!.options[0].id;
    expect(namesFor('oracle', 5, { subclassId: mystery }).some((id) => /curse/.test(id ?? ''))).toBe(true);
  });

  it("every champion cause lists its Champion's Reaction", () => {
    for (const cause of db.classes.champion.subclass!.options) {
      const listed = namesFor('champion', 5, { subclassId: cause.id, deityId: 'iomedae' });
      const want = (cause.featureIds ?? []).map((e) => (typeof e === 'string' ? e : e.id));
      expect(want.length, `${cause.id} must hand over a reaction`).toBeGreaterThan(0);
      for (const id of want) expect(listed, `${cause.id} → ${id}`).toContain(id);
    }
  });
});

describe('class-suffixed feature variants', () => {
  it('a swashbuckler owns their own Weapon Expertise, which carries crit specialization', () => {
    const c = build('swashbuckler', 5, { subclassId: 'fencer' });
    expect(db.classFeatures['weapon-expertise-swashbuckler'].critSpec).toBe(true);
    expect(ownedFeatureIds(c, db).has('weapon-expertise-swashbuckler')).toBe(true);
  });

  it('a spontaneous caster owns their own Spell Repertoire', () => {
    expect(ownedFeatureIds(build('bard', 3, {}), db).has('spell-repertoire-bard')).toBe(true);
  });

  it('the suffix does not smuggle in another class’s variant', () => {
    expect(ownedFeatureIds(build('fighter', 5, {}), db).has('weapon-expertise-swashbuckler')).toBe(false);
  });
});

describe('a class feature can grant a Focus Point', () => {
  it("Clarity of Focus is the psychic's 5th-level feature and says so", () => {
    const f = db.classFeatures['clarity-of-focus'];
    expect(f.level).toBe(5);
    expect(f.focusPoolBonus).toBe(1);
    expect(f.description).toMatch(/Increase the number of Focus Points/i);
  });

  it('a psychic has 2 before 5th and 3 from 5th', () => {
    expect(build('psychic', 4, {}).focus?.max).toBe(2);
    expect(build('psychic', 5, {}).focus?.max).toBe(3);
  });

  it("and never more than 3 — 'this ability can't increase the size of your focus pool above 3'", () => {
    expect(build('psychic', 20, {}).focus?.max).toBe(3);
  });
});

describe('a versatile heritage opens its own feat pool', () => {
  const pool = (heritageId: string | null, level = 9) =>
    eligibleFeatsForSlot(
      { ...emptyBuild(), ancestryId: 'human', heritageId, classId: 'fighter', level },
      db,
      { level, category: 'ancestry', idx: 0 },
    );

  it('nephilim feats are offered to a nephilim', () => {
    const mine = pool('nephilim').filter((f) => f.traits.includes('nephilim'));
    expect(mine.length, 'a nephilim must be offered nephilim feats').toBeGreaterThan(20);
  });

  it('and to nobody else', () => {
    expect(pool(null).filter((f) => f.traits.includes('nephilim'))).toEqual([]);
    expect(pool('skilled-human').filter((f) => f.traits.includes('nephilim'))).toEqual([]);
  });

  it("the ancestry's own feats still come through", () => {
    expect(pool('nephilim').filter((f) => f.traits.includes('human')).length).toBeGreaterThan(0);
  });

  it('every versatile heritage with feats offers at least one', () => {
    const bare: string[] = [];
    for (const [id, h] of Object.entries(db.heritages)) {
      if (!h.versatile) continue;
      if (!Object.values(db.feats).some((f) => (f.traits ?? []).includes(id))) continue;
      if (!pool(id, 20).some((f) => f.traits.includes(id))) bare.push(id);
    }
    expect(bare).toEqual([]);
  });
});

describe('the advanced half of every multiclass archetype', () => {
  it('each basic-* row has an advanced-* sibling naming the same class', () => {
    const basics = Object.keys(FEAT_PICK_GRANTS).filter((k) => k.startsWith('basic-'));
    /* 27 since parity batch 12 added the necromancer and runesmith archetypes. The count is a
     * tripwire for exactly what happened there: both `basic-*` rows went in without their advanced
     * halves, and the sibling assertion below is what named the two that were missing. */
    expect(basics.length).toBe(27);
    for (const b of basics) {
      const a = b.replace(/^basic-/, 'advanced-');
      expect(FEAT_PICK_GRANTS[a], `${a} missing`).toBeTruthy();
      expect(FEAT_PICK_GRANTS[a].traits, a).toEqual(FEAT_PICK_GRANTS[b].traits);
      expect(FEAT_PICK_GRANTS[a].maxLevel, a).toBe('half');
    }
  });

  it("'half' means half the character's level, rounded down", () => {
    const c = build('fighter', 12, { featPicks: { '6:class': 'advanced-arcana' } });
    expect(c.feats.some((f) => f.featId === 'advanced-arcana')).toBe(true);
  });

  it('every registered id names a real record that can actually grant it', () => {
    // Widened as the lane widened: a pick grant may hang off a feat, a heritage, a BACKGROUND or a
    // CLASS FEATURE — buildCharacter resolves all four. It may not hang off nothing, which is the
    // typo this guard exists to catch.
    const dead = Object.keys(FEAT_PICK_GRANTS).filter(
      (id) => !db.feats[id] && !db.heritages[id] && !db.backgrounds[id] && !db.classFeatures[id],
    );
    expect(dead).toEqual([]);
  });

  it('and every registered pick offers a NON-EMPTY pool', () => {
    // A spec whose filters match nothing renders an empty picker while the audit records "fixed" —
    // the exact failure the referential guard was added for.
    const c = build('fighter', 20);
    const b2 = deriveBuildFromCharacter(c, db);
    const empty = Object.entries(FEAT_PICK_GRANTS)
      .filter(([, spec]) => !spec.dynamicTrait && !spec.excludeDynamicTrait) // these depend on the character
      .filter(([, spec]) => pickableFeats(spec, b2, db).length === 0)
      .map(([id]) => id);
    expect(empty).toEqual([]);
  });
});

describe('the wizard’s advanced school spell', () => {
  it('reaches the repertoire, not just the pool', () => {
    const sch = db.classes.wizard.subclass!.options.find((o) => o.advancedFocusSpell)!;
    const c = build('wizard', 8, { subclassId: sch.id, featPicks: { '8:class': 'advanced-school-spell' } });
    const focus = c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    expect(focus).toContain(sch.advancedFocusSpell);
  });

  it('13 schools carry one, so the map must not be bloodline/revelation only', () => {
    const n = db.classes.wizard.subclass!.options.filter((o) => o.advancedFocusSpell).length;
    expect(n).toBeGreaterThan(10);
  });
});

describe('Witch Lesson of the Elements', () => {
  it('its option points at a record that exists', () => {
    const opts = ['basic-lesson', 'greater-lesson', 'major-lesson'].flatMap((id) => db.feats[id].choice!.options!);
    const dead = opts.map((o) => o.value).filter((v) => !db.classFeatures[v] && !db.classFeatures[v.replace(/^aon-/, '')]);
    expect(dead).toEqual([]);
  });

  it('picking it grants its hex, like the other eighteen', () => {
    const c = build('witch', 4, { featPicks: { '2:class': 'basic-lesson' }, featChoices: { '2:class': 'aon-lesson-of-elements' } });
    expect([...ownedFeatureIds(c, db)]).toContain('lesson-of-elements');
    const hexes = c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    expect(hexes.length).toBeGreaterThan(1);
  });
});
