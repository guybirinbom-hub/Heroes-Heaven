import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import {
  critSpecConditionFor,
  critSpecSources,
  deriveStrike,
  deriveStrikes,
  ownedFeatureIds,
  strikeShowsCritSpec,
  type Strike,
} from '../src/rules/derive';
import { CATALOG_MODE_MAP } from '../src/rules/modes';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * PACKAGE M — critical specialization reaches the weapons print names, and only those.
 *
 * Found from a swashbuckler's "Weapon Expertise" popup. The swashbuckler's level-5 row named the SHARED
 * Weapon Expertise (the Thaumaturge's page, class-feature-1178, no crit spec) instead of its own
 * (class-feature-1019); and five class features plus three feats carried `critSpec` with the printed
 * gate dropped — so a 5th-level fighter showed the effect on every weapon, not only the ones they are
 * master with. Each case below quotes the printed clause it pins, and each has a planted bad case (an
 * in-memory copy of the database with the fix taken back out) that the same assertion catches.
 */
const db = content();

const held = (instanceId: string, itemId: string): InventoryItem => ({ instanceId, itemId, quantity: 1, equipped: true });
const wielding = (c: Character, ...ids: string[]): Character => ({
  ...c,
  inventory: [...c.inventory, ...ids.map((id) => held(`pm-${id}`, id))],
});
const strikeOf = (c: Character, d: ContentDatabase, itemId: string): Strike => {
  const inv = c.inventory.find((i) => i.itemId === itemId);
  const s = inv ? deriveStrike(c, d, inv) : null;
  if (!s) throw new Error(`no Strike for ${itemId}`);
  return s;
};
const shows = (c: Character, d: ContentDatabase, itemId: string) => strikeShowsCritSpec(strikeOf(c, d, itemId), critSpecSources(c, d), c);
const fistShows = (c: Character, d: ContentDatabase) => {
  const fist = deriveStrikes(c, d).find((s) => s.instanceId === 'fist');
  if (!fist) throw new Error('no Fist');
  return strikeShowsCritSpec(fist, critSpecSources(c, d), c);
};
/** A copy of the database with one record patched — the planted bad case. Never written anywhere. */
const patched = (bucket: 'classFeatures' | 'feats', id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, [bucket]: { ...db[bucket], [id]: { ...db[bucket][id], ...patch } } }) as ContentDatabase;
/** A character holding a weapon at a rank its class does not give — what a familiarity feat does. */
const atRank = (c: Character, itemId: string, rank: 'expert' | 'master'): Character => ({
  ...c,
  proficiencies: { ...c.proficiencies, weaponOverrides: { ...(c.proficiencies.weaponOverrides ?? {}), [itemId]: rank } },
});

/* An ADVANCED weapon no class here is trained in, and two ordinary ones. */
const ADVANCED = 'dwarven-war-axe';
const MARTIAL_SWORD = 'longsword';
const MARTIAL_AXE = 'greataxe';

describe('the shipped items are what this file assumes', () => {
  it('longsword is a martial sword, greataxe a martial axe, dwarven war axe an advanced axe', () => {
    expect(db.items[MARTIAL_SWORD]).toMatchObject({ itemType: 'weapon', category: 'martial', group: 'sword' });
    expect(db.items[MARTIAL_AXE]).toMatchObject({ itemType: 'weapon', category: 'martial', group: 'axe' });
    expect(db.items[ADVANCED]).toMatchObject({ itemType: 'weapon', category: 'advanced', group: 'axe' });
  });
});

describe('Fighter Weapon Mastery — "all weapons and unarmed attacks for which you have master proficiency" (class-feature-699)', () => {
  const fighter = (level: number) => wielding(build('fighter', level, { fighterWeaponGroup: 'sword' }), MARTIAL_SWORD, MARTIAL_AXE);

  // batch package-m premise: class-feature-699 "for which you have master proficiency"
  it('5th level, sword group: the longsword (master) has it, the greataxe (expert) does not', () => {
    const c = fighter(5);
    expect(strikeOf(c, db, MARTIAL_SWORD).rank).toBe('master');
    expect(strikeOf(c, db, MARTIAL_AXE).rank).toBe('expert');
    expect(shows(c, db, MARTIAL_SWORD)).toBe(true);
    expect(shows(c, db, MARTIAL_AXE)).toBe(false);
    expect(fistShows(c, db), 'the Fist is brawling, not the chosen group — expert').toBe(false);
  });

  it('the group the fighter chose is what decides it, not the weapon', () => {
    const c = wielding(build('fighter', 5, { fighterWeaponGroup: 'axe' }), MARTIAL_SWORD, MARTIAL_AXE);
    expect(shows(c, db, MARTIAL_AXE)).toBe(true);
    expect(shows(c, db, MARTIAL_SWORD)).toBe(false);
  });

  it('4th level: nothing yet', () => {
    expect(critSpecSources(fighter(4), db)).toHaveLength(0);
    expect(shows(fighter(4), db, MARTIAL_SWORD)).toBe(false);
  });

  it('planted: without the master gate the expert greataxe lights up again', () => {
    const bad = patched('classFeatures', 'fighter-weapon-mastery', { critSpecWeapons: undefined });
    expect(shows(fighter(5), bad, MARTIAL_AXE)).toBe(true);
  });
});

describe("the swashbuckler's own Weapon Expertise (class-feature-1019)", () => {
  const swash = (level: number) => wielding(build('swashbuckler', level), 'rapier', ADVANCED);

  const expertiseRows = (d: ContentDatabase) => d.classes.swashbuckler.features.filter((f) => /weapon-expertise/.test(f.featureId));

  // batch package-m premise: class-63 "Weapon Expertise" at level 5 is the swashbuckler's own record
  it('the class table lists its OWN record at 5, and no longer the shared one', () => {
    expect(expertiseRows(db)).toEqual([{ level: 5, featureId: 'weapon-expertise-swashbuckler' }]);
    expect(db.classFeatures['weapon-expertise-swashbuckler']).toMatchObject({ aonId: 'class-feature-1019', critSpec: true });
  });

  it('planted: the shipped row (the shared record) fails that check', () => {
    const bad = {
      ...db,
      classes: {
        ...db.classes,
        swashbuckler: {
          ...db.classes.swashbuckler,
          features: db.classes.swashbuckler.features.map((f) => (f.featureId === 'weapon-expertise-swashbuckler' ? { ...f, featureId: 'weapon-expertise' } : f)),
        },
      },
    } as ContentDatabase;
    expect(expertiseRows(bad)).not.toEqual([{ level: 5, featureId: 'weapon-expertise-swashbuckler' }]);
  });

  it('a 5th-level swashbuckler owns it, and not the Thaumaturge-page record', () => {
    const owned = ownedFeatureIds(build('swashbuckler', 5), db);
    expect(owned.has('weapon-expertise-swashbuckler')).toBe(true);
    expect(owned.has('weapon-expertise')).toBe(false);
  });

  it('the crit-spec source comes straight from the table at 5', () => {
    const src = critSpecSources(swash(5), db);
    expect(src.filter((s) => s.weapons?.minRank === 'expert')).toEqual([
      { level: 5, weapons: { minRank: 'expert', categories: ['simple', 'martial', 'advanced'] }, condition: undefined },
    ]);
  });

  // batch package-m premise: class-feature-1019 "all weapons for which you have expert proficiency"
  it('5th level: the rapier (expert) has it; an advanced weapon (untrained) does not', () => {
    const c = swash(5);
    expect(strikeOf(c, db, ADVANCED).rank).toBe('untrained');
    expect(shows(c, db, 'rapier')).toBe(true);
    expect(shows(c, db, ADVANCED)).toBe(false);
  });

  /* rules-2191 (Player Core, Unarmed Attacks): "unarmed attacks aren't weapons, and effects and abilities
   * that work with weapons never work with unarmed attacks unless they specifically say so". The
   * swashbuckler's sentence says "weapons" only (the fighter's, class-feature-699, adds "and unarmed
   * attacks"), so the Fist stays out although the swashbuckler is expert in it. */
  // batch package-m premise: rules-2191 "unarmed attacks aren't weapons"
  it('5th level: the Fist is expert but is not a weapon — no crit spec', () => {
    const c = swash(5);
    const fist = deriveStrikes(c, db).find((s) => s.instanceId === 'fist');
    expect(fist?.rank).toBe('expert');
    expect(fistShows(c, db)).toBe(false);
  });

  it('planted: with only the expert gate (no weapon categories) the Fist lights up', () => {
    const bad = patched('classFeatures', 'weapon-expertise-swashbuckler', { critSpecWeapons: { minRank: 'expert' } });
    expect(fistShows(swash(5), bad)).toBe(true);
  });

  it('…and the same advanced weapon at expert does — the gate is the rank, not the category', () => {
    expect(shows(atRank(swash(5), ADVANCED, 'expert'), db, ADVANCED)).toBe(true);
  });

  it('4th level: nothing', () => {
    expect(critSpecSources(swash(4), db)).toHaveLength(0);
    expect(shows(swash(4), db, 'rapier')).toBe(false);
  });

  it('planted: without the expert gate the untrained advanced weapon lights up', () => {
    const bad = patched('classFeatures', 'weapon-expertise-swashbuckler', { critSpecWeapons: undefined });
    expect(shows(swash(5), bad, ADVANCED)).toBe(true);
  });

  it('Arcana of Iron still recognises "the weapon expertise class feature" (feat-7980)', () => {
    /* Read off advancement.ts rows whose source is 'weapon-expertise' (build.ts), which did not move:
     * a swashbuckler War Mage with it is expert in advanced weapons from 6th. */
    const c = build('swashbuckler', 6, {
      featPicks: { '2:class': 'war-mage-dedication', '4:class': 'bespell-strikes', '6:class': 'arcana-of-iron' },
    });
    expect(c.feats.map((f) => f.featId)).toContain('arcana-of-iron');
    expect(c.proficiencies.attacks.advanced).toBe('expert');
  });
});

describe('Military Expertise — "a weapon you are at least an expert with" (class-feature-1098)', () => {
  const commander = (level: number) => wielding(build('commander', level), MARTIAL_SWORD, ADVANCED);

  it('5th level: a martial weapon (expert) yes, an untrained advanced weapon no', () => {
    const c = commander(5);
    expect(shows(c, db, MARTIAL_SWORD)).toBe(true);
    expect(shows(c, db, ADVANCED)).toBe(false);
  });

  // batch package-m premise: rules-2191 "unarmed attacks aren't weapons"
  it('5th level: the Fist (expert) is not "a weapon" — no crit spec', () => {
    const c = commander(5);
    expect(deriveStrikes(c, db).find((s) => s.instanceId === 'fist')?.rank).toBe('expert');
    expect(fistShows(c, db)).toBe(false);
  });

  it('4th level: nothing', () => {
    expect(critSpecSources(commander(4), db)).toHaveLength(0);
  });

  it('planted: without the gate the untrained weapon lights up', () => {
    expect(shows(commander(5), patched('classFeatures', 'military-expertise', { critSpecWeapons: undefined }), ADVANCED)).toBe(true);
  });

  it('planted: with only the expert gate (no weapon categories) the Fist lights up', () => {
    expect(fistShows(commander(5), patched('classFeatures', 'military-expertise', { critSpecWeapons: { minRank: 'expert' } }))).toBe(true);
  });
});

describe('Bard Weapon Expertise — "one of these weapons [martial, simple] or an unarmed attack" (class-feature-638)', () => {
  const composing = (c: Character): Character => ({ ...c, activeModes: [CATALOG_MODE_MAP['cat-triple-time']] });
  const bard = (level: number) => composing(wielding(build('bard', level), MARTIAL_SWORD, ADVANCED));

  it('the mode used here really is a composition', () => {
    expect(CATALOG_MODE_MAP['cat-triple-time'].exclusiveGroup).toBe('bard-composition');
  });

  it('11th level, composing: a martial weapon and the Fist yes; an advanced weapon no — even at expert', () => {
    const c = bard(11);
    expect(shows(c, db, MARTIAL_SWORD)).toBe(true);
    expect(fistShows(c, db)).toBe(true);
    expect(shows(c, db, ADVANCED)).toBe(false);
    const familiar = atRank(c, ADVANCED, 'expert');
    expect(strikeOf(familiar, db, ADVANCED).rank).toBe('expert');
    expect(shows(familiar, db, ADVANCED), 'proficiency moved; the weapon is still advanced').toBe(false);
  });

  it('the composition gate still holds: not composing, nothing', () => {
    const quiet = wielding(build('bard', 11), MARTIAL_SWORD);
    expect(critSpecSources(quiet, db)).toHaveLength(0);
  });

  it('10th level: nothing', () => {
    expect(critSpecSources(bard(10), db)).toHaveLength(0);
  });

  it('planted: without the category gate the advanced weapon lights up', () => {
    const bad = patched('classFeatures', 'bard-weapon-expertise', { critSpecWeapons: undefined });
    expect(shows(atRank(bard(11), ADVANCED, 'expert'), bad, ADVANCED)).toBe(true);
  });
});

describe('Ranger Weapon Expertise — "all such weapons and unarmed attacks when attacking your hunted prey" (class-feature-722)', () => {
  const ranger = (level: number) => wielding(build('ranger', level), MARTIAL_SWORD, ADVANCED);

  it('5th level: a martial weapon yes, and still says "hunted prey"', () => {
    const c = ranger(5);
    expect(shows(c, db, MARTIAL_SWORD)).toBe(true);
    expect(critSpecConditionFor(strikeOf(c, db, MARTIAL_SWORD), critSpecSources(c, db), c)).toBe('when attacking your hunted prey');
  });

  it('an advanced weapon no — untrained or at expert', () => {
    const c = ranger(5);
    expect(shows(c, db, ADVANCED)).toBe(false);
    expect(shows(atRank(c, ADVANCED, 'expert'), db, ADVANCED)).toBe(false);
  });

  it('4th level: nothing', () => {
    expect(critSpecSources(ranger(4), db)).toHaveLength(0);
  });

  it('planted: without the category gate the advanced weapon lights up', () => {
    const bad = patched('classFeatures', 'ranger-weapon-expertise', { critSpecWeapons: undefined });
    expect(shows(atRank(ranger(5), ADVANCED, 'expert'), bad, ADVANCED)).toBe(true);
  });
});

describe('the SHARED Weapon Expertise grants no crit spec (class-feature-1178)', () => {
  /* Every class whose 5th/11th-level Weapon Expertise is the shared record or its own non-swashbuckler
   * variant. The Thaumaturge's page prints only "Your proficiency ranks for unarmed attacks, simple
   * weapons, and martial weapons increase to expert". */
  const CASES: [string, number, string][] = [
    ['champion', 5, 'weapon-expertise'],
    ['investigator', 5, 'weapon-expertise'],
    ['thaumaturge', 5, 'weapon-expertise'],
    ['guardian', 5, 'weapon-expertise'],
    ['exemplar', 5, 'weapon-expertise'],
    ['wizard', 11, 'weapon-expertise'],
    ['druid', 11, 'weapon-expertise'],
    ['magus', 5, 'weapon-expertise-magus'],
    ['runesmith', 5, 'weapon-expertise-runesmith'],
    ['necromancer', 11, 'weapon-expertise-necromancer'],
  ];

  // batch package-m premise: class-feature-1178 "increase to expert" (no critical specialization clause)
  it('the records say so', () => {
    expect(db.classFeatures['weapon-expertise'].critSpec).toBe(false);
    for (const [, , id] of CASES) expect(db.classFeatures[id].critSpec ?? false, id).toBe(false);
  });

  for (const [cls, level, id] of CASES) {
    it(`${cls} ${level}: owns ${id}, and no Strike shows crit spec from it`, () => {
      const c = wielding(build(cls, level), MARTIAL_SWORD, 'club');
      expect(ownedFeatureIds(c, db).has(id)).toBe(true);
      expect(shows(c, db, MARTIAL_SWORD), MARTIAL_SWORD).toBe(false);
      expect(shows(c, db, 'club'), 'club').toBe(false);
      expect(fistShows(c, db), 'Fist').toBe(false);
    });
  }

  it('planted: the shared record carrying critSpec again lights every one of them up', () => {
    const bad = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        ...Object.fromEntries(CASES.map(([, , id]) => [id, { ...db.classFeatures[id], critSpec: true }])),
      },
    } as ContentDatabase;
    for (const [cls, level] of CASES) expect(shows(wielding(build(cls, level), MARTIAL_SWORD), bad, MARTIAL_SWORD), cls).toBe(true);
  });
});

describe('three feats whose printed gate the import dropped', () => {
  it('Crossbow Infiltrator Dedication — "If you\'re at least an expert in any of these weapons" (feat-7913)', () => {
    expect(db.feats['crossbow-infiltrator-dedication'].critSpecWeapons).toMatchObject({ minRank: 'expert' });
    /* A thief rogue: trained in simple weapons at 4 (expert only from 5), and no racket crit spec. */
    const trained = wielding(build('rogue', 4, { subclassId: 'thief', featPicks: { '2:class': 'crossbow-infiltrator-dedication' } }), 'hand-crossbow');
    expect(trained.feats.map((f) => f.featId)).toContain('crossbow-infiltrator-dedication');
    expect(strikeOf(trained, db, 'hand-crossbow').rank).toBe('trained');
    expect(shows(trained, db, 'hand-crossbow'), 'trained: not yet').toBe(false);
    expect(shows(atRank(trained, 'hand-crossbow', 'expert'), db, 'hand-crossbow'), 'expert: yes').toBe(true);
    const bad = patched('feats', 'crossbow-infiltrator-dedication', { critSpecWeapons: { bases: ['hand-crossbow', 'gauntlet-bow', 'repeating-hand-crossbow'] } });
    expect(shows(trained, bad, 'hand-crossbow'), 'planted: without the gate, trained shows it').toBe(true);
  });

  it('Aristocratic Arms — "If you\'re at least an expert in one of the selected weapons" (feat-8973)', () => {
    expect(db.feats['aristocratic-arms'].critSpecWeapons).toEqual({ traits: ['disarm', 'parry'], minRank: 'expert' });
  });

  it('Brawling Focus — "unarmed strikes in the brawling group and weapons in the brawling group" (feat-438)', () => {
    expect(db.feats['brawling-focus'].critSpecWeapons).toEqual({ groups: ['brawling'] });
    const src = [{ level: 1, weapons: db.feats['brawling-focus'].critSpecWeapons }];
    const s = (p: Partial<Strike>) => ({ instanceId: 'w', name: 'W', attack: [0], damage: '', traits: [], ranged: false, rank: 'trained', ...p }) as Strike;
    expect(strikeShowsCritSpec(s({ group: 'brawling', category: 'unarmed' }), src)).toBe(true);
    expect(strikeShowsCritSpec(s({ group: 'sword', category: 'martial' }), src)).toBe(false);
  });
});

describe('the categories gate itself', () => {
  const s = (p: Partial<Strike>) => ({ instanceId: 'w', name: 'W', attack: [0], damage: '', traits: [], ranged: false, rank: 'expert', ...p }) as Strike;
  const src = [{ level: 1, weapons: { categories: ['simple', 'martial', 'unarmed'] as ('simple' | 'martial' | 'unarmed')[] } }];

  it('matches the listed categories and nothing else', () => {
    expect(strikeShowsCritSpec(s({ category: 'simple' }), src)).toBe(true);
    expect(strikeShowsCritSpec(s({ category: 'unarmed' }), src)).toBe(true);
    expect(strikeShowsCritSpec(s({ category: 'advanced' }), src)).toBe(false);
  });

  it('fails closed on a Strike with no category (a blast, a battle form)', () => {
    expect(strikeShowsCritSpec(s({}), src)).toBe(false);
  });

  it('every weapon and unarmed Strike now carries its category', () => {
    const c = wielding(build('fighter', 1), MARTIAL_SWORD, 'club', ADVANCED);
    expect(strikeOf(c, db, MARTIAL_SWORD).category).toBe('martial');
    expect(strikeOf(c, db, 'club').category).toBe('simple');
    expect(strikeOf(c, db, ADVANCED).category).toBe('advanced');
    expect(deriveStrikes(c, db).find((x) => x.instanceId === 'fist')?.category).toBe('unarmed');
  });
});

describe('with the trust gate on, as the app runs', () => {
  const gated = content({ trustGate: true });
  it("the swashbuckler's and the fighter's grants survive the gate (class-owned features)", () => {
    const sw = wielding(build('swashbuckler', 5), 'rapier', ADVANCED);
    expect(shows(sw, gated, 'rapier')).toBe(true);
    expect(shows(sw, gated, ADVANCED)).toBe(false);
    const f = wielding(build('fighter', 5, { fighterWeaponGroup: 'sword' }), MARTIAL_SWORD, MARTIAL_AXE);
    expect(shows(f, gated, MARTIAL_SWORD)).toBe(true);
    expect(shows(f, gated, MARTIAL_AXE)).toBe(false);
  });

  it("Crossbow Infiltrator's grant RUNS under the gate (WG encodes its weapon familiarity), with the expert gate", () => {
    const c = wielding(build('rogue', 4, { subclassId: 'thief', featPicks: { '2:class': 'crossbow-infiltrator-dedication' } }), 'hand-crossbow');
    expect(gated.feats['crossbow-infiltrator-dedication'].critSpec).toBe(true);
    expect(shows(c, gated, 'hand-crossbow'), 'trained').toBe(false);
    expect(shows(atRank(c, 'hand-crossbow', 'expert'), gated, 'hand-crossbow'), 'expert').toBe(true);
  });
});
