import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { armorSpecAccess, armorSpecCovers, deriveDefenses, critSpecSources, deriveStrikes, strikeShowsCritSpec } from '../src/rules/derive';
import type { ArmorItem, Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 2 (d) — the armor-innovation inventor's own suit counts as the innovation until the
 * player marks something else.
 *
 * class-feature-497, Medium Armor Expertise (Inventor): *"If you have a medium or heavy armor innovation,
 * you gain access to the critical specialization effect with your armor innovation."* Round 1 gave that to
 * the suit the player MARKED as the innovation (InventoryItem.designations) — and the mark is a manual
 * toggle nothing ever sets (types.ts ClassFeature.defensesRequire says so), so an 11th-level inventor in
 * the very suit Armor Innovation hands them (innovation-1: *"Your innovation is a cutting-edge suit of
 * medium armor"*, granted worn by build.ts) had no armor specialization until they found the toggle.
 *
 * Now: with NO item marked, the granted suit is the innovation; a player's mark on any item always wins;
 * nothing is ever written into the stored character. Power suit = medium composite, whose effect is
 * piercing resistance 1 + potency at medium (src/rules/armorSpec.ts).
 */
const db = content();
const SUIT = 'power-suit';

const inventor = (level: number): Character =>
  build('inventor', level, { subclassId: 'armor-innovation', inventorArmorStats: SUIT, inventorModifications: { initial: 'phlogistonic-regulator' } });
const piercing = (c: Character, d: ContentDatabase = db) => deriveDefenses(c, d).resistances.find((r) => r.type === 'piercing')?.value ?? 0;
const slashing = (c: Character, d: ContentDatabase = db) => deriveDefenses(c, d).resistances.find((r) => r.type === 'slashing')?.value ?? 0;
const grantedSuit = (c: Character) => c.inventory.find((i) => i.itemId === SUIT && i.grantedBy);

describe('the build hands the armor inventor their suit, unmarked', () => {
  it('the granted suit is worn, carries no mark, and names its source', () => {
    const c = inventor(11);
    expect(grantedSuit(c)).toMatchObject({ itemId: SUIT, worn: true });
    expect(grantedSuit(c)?.designations).toBeUndefined();
    expect(db.items[SUIT]).toMatchObject({ itemType: 'armor', category: 'medium', group: 'composite' });
  });
});

describe('nothing marked: the granted suit is the innovation', () => {
  // batch package-m premise: class-feature-497 "you gain access to the critical specialization effect with your armor innovation"
  it('11th level: armor specialization on the granted suit — piercing 1', () => {
    const c = inventor(11);
    expect(piercing(c)).toBe(1);
    const suit = grantedSuit(c)!;
    expect(armorSpecCovers(armorSpecAccess(c, db), { inv: suit, armor: db.items[SUIT] as ArmorItem })).toBe(true);
  });

  it('10th level: not yet', () => {
    expect(piercing(inventor(10))).toBe(0);
  });

  it('reading it writes nothing: the stored suit is still unmarked afterwards', () => {
    const c = inventor(11);
    const before = JSON.stringify(c.inventory);
    deriveDefenses(c, db);
    armorSpecAccess(c, db);
    expect(JSON.stringify(c.inventory)).toBe(before);
  });

  it('a bought suit of the same armour that the build did NOT grant is not the innovation', () => {
    const c: Character = { ...inventor(11), inventory: [{ instanceId: 'bought', itemId: SUIT, quantity: 1, worn: true }] };
    expect(piercing(c)).toBe(0);
  });

  it('planted: a record grant NOT scoped to an innovation type gets no fallback — the granted suit has nothing', () => {
    /* The fallback is the innovation's, so it hangs on the record's `innovationType`. Without it the reader is
     * the round-1 one (marks only), and the unmarked granted suit loses its specialization again. */
    const { innovationType: _drop, ...rest } = db.classFeatures['medium-armor-expertise-inventor'].armorSpec!;
    const bad = {
      ...db,
      classFeatures: { ...db.classFeatures, 'medium-armor-expertise-inventor': { ...db.classFeatures['medium-armor-expertise-inventor'], armorSpec: rest } },
    } as ContentDatabase;
    expect(piercing(inventor(11), bad)).toBe(0);
    expect(piercing(inventor(11))).toBe(1);
  });
});

describe("the player's mark wins", () => {
  // batch package-m premise: class-feature-497 "your armor innovation" — the player says which suit that is
  it('the player marks a breastplate: the breastplate has it (slashing 1), the granted suit does not', () => {
    const base = inventor(11);
    const mine: InventoryItem = { instanceId: 'mine', itemId: 'breastplate', quantity: 1, worn: true, designations: ['innovation'] };
    const c: Character = { ...base, inventory: [...base.inventory.map((i) => (i.itemId === SUIT ? { ...i, worn: false } : i)), mine] };
    const access = armorSpecAccess(c, db);
    expect([...access.designated.keys()]).toEqual(['mine']);
    expect(slashing(c)).toBe(1);
    expect(armorSpecCovers(access, { inv: grantedSuit(c)!, armor: db.items[SUIT] as ArmorItem })).toBe(false);
  });

  it('the player marks the granted suit itself: unchanged — it has it', () => {
    const base = inventor(11);
    const c: Character = { ...base, inventory: base.inventory.map((i) => (i.itemId === SUIT ? { ...i, designations: ['innovation'] } : i)) };
    expect(piercing(c)).toBe(1);
  });

  /* Found by the round-2 check: a mark on something that is NOT armor (the toggle is offered on every item)
   * used to count as "the player marked something", so the granted suit lost its fallback and NOTHING had
   * armor specialization. A marked weapon names no suit; only an armor mark takes the suit's place. */
  it('a mark on a weapon (not armor) does not take the granted suit\'s place — the suit keeps it', () => {
    const base = inventor(11);
    const marksAWeapon: InventoryItem = { instanceId: 'blade', itemId: 'longsword', quantity: 1, equipped: true, designations: ['innovation'] };
    const c: Character = { ...base, inventory: [...base.inventory, marksAWeapon] };
    expect(piercing(c)).toBe(1);
    expect([...armorSpecAccess(c, db).designated.keys()]).toEqual([grantedSuit(c)!.instanceId]);
    expect(JSON.stringify(c.inventory.find((i) => i.itemId === SUIT)?.designations)).toBeUndefined();
  });
});

describe('only the armor innovation', () => {
  it('a weapon-innovation inventor gets no armour fallback, and the suit grant does not exist for them', () => {
    const c = build('inventor', 11, { subclassId: 'weapon-innovation', inventorArmorStats: SUIT });
    expect(c.inventory.some((i) => i.itemId === SUIT)).toBe(false);
    expect(armorSpecAccess(c, db).designated.size).toBe(0);
  });

  /* Reported, not changed: a WEAPON innovation is the player's own weapon — the build grants no item to
   * fall back on — so its crit spec (class-feature-490, critSpecWeapons.designated + innovationType) still
   * needs the mark. */
  it('a weapon-innovation inventor\'s crit spec still waits on the mark (no granted weapon to default to)', () => {
    const base = build('inventor', 7, { subclassId: 'weapon-innovation' });
    const unmarked: Character = { ...base, inventory: [{ instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true }] };
    const marked: Character = { ...base, inventory: [{ instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true, designations: ['innovation'] }] };
    const ls = (c: Character) => deriveStrikes(c, db).find((s) => s.instanceId === 'w')!;
    expect(strikeShowsCritSpec(ls(unmarked), critSpecSources(unmarked, db), unmarked)).toBe(false);
    expect(strikeShowsCritSpec(ls(marked), critSpecSources(marked, db), marked)).toBe(true);
  });
});

describe('with the trust gate on, as the app runs', () => {
  it('the granted suit has its specialization at 11', () => {
    expect(piercing(inventor(11), content({ trustGate: true }))).toBe(1);
  });
});

/**
 * PACKAGE M, ROUND 2 REVIEW — Inventor Weapon Expertise needs a WEAPON innovation.
 *
 * class-feature-490 (Guns & Gears (Remastered) pg. 15): *"If you have a weapon innovation, you gain access to
 * the critical specialization effect with your innovation."* The record carried only `designated: 'innovation'`
 * (Foundry's predicate also says `feature:weapon-innovation`; the importer dropped it), and the Innovation mark
 * can be put on any item, so an armor- or construct-innovation inventor who marked a longsword got its critical
 * specialization. The record now carries `critSpecWeapons.innovationType: 'weapon'`, tested in weaponMatches.
 * Guarded in npm run verify by scripts/critspec-narrowing-check.mjs RULE 3 (featureGate).
 */
describe('Inventor Weapon Expertise: only a weapon innovation', () => {
  const marked = (c: Character): Character => ({ ...c, inventory: [...c.inventory, { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true, designations: ['innovation'] }] });
  const shows = (c: Character, d: ContentDatabase = db) => {
    const s = deriveStrikes(c, d).find((x) => x.instanceId === 'w');
    expect(s).toBeDefined();
    return strikeShowsCritSpec(s!, critSpecSources(c, d), c);
  };
  const armor7 = () => marked(build('inventor', 7, { subclassId: 'armor-innovation', inventorArmorStats: SUIT }));
  const weapon7 = () => marked(build('inventor', 7, { subclassId: 'weapon-innovation' }));
  const construct7 = () => marked(build('inventor', 7, { subclassId: 'construct-innovation' }));

  // batch package-m premise: class-feature-490 "If you have a weapon innovation, you gain access to the critical specialization effect with your innovation."
  it('the record carries the innovation-type gate beside the mark', () => {
    expect(db.classFeatures['inventor-weapon-expertise'].critSpecWeapons).toEqual({ designated: 'innovation', innovationType: 'weapon' });
  });

  it('the builds carry the innovation type the gate reads', () => {
    expect(armor7().inventor?.innovationType).toBe('armor');
    expect(weapon7().inventor?.innovationType).toBe('weapon');
    expect(construct7().inventor?.innovationType).toBe('construct');
  });

  it('an armor-innovation inventor 7 who marks a longsword: no critical specialization on it', () => {
    expect(shows(armor7())).toBe(false);
  });

  it('a construct-innovation inventor 7 who marks a longsword: none either', () => {
    expect(shows(construct7())).toBe(false);
  });

  it('a weapon-innovation inventor 7 with the same mark: it has it', () => {
    expect(shows(weapon7())).toBe(true);
  });

  it('a weapon-innovation inventor 4: not yet (the feature is 5th level)', () => {
    expect(shows(marked(build('inventor', 4, { subclassId: 'weapon-innovation' })))).toBe(false);
  });

  it('with the trust gate on, as the app runs: armor inventor no, weapon inventor yes', () => {
    const gated = content({ trustGate: true });
    expect(shows(armor7(), gated)).toBe(false);
    expect(shows(weapon7(), gated)).toBe(true);
  });

  it('planted: the round-1 record (mark only) lights the armor inventor\'s marked longsword again — the case this catches', () => {
    const bad = {
      ...db,
      classFeatures: { ...db.classFeatures, 'inventor-weapon-expertise': { ...db.classFeatures['inventor-weapon-expertise'], critSpecWeapons: { designated: 'innovation' as const } } },
    } as ContentDatabase;
    expect(shows(armor7(), bad)).toBe(true);
    expect(shows(armor7())).toBe(false);
  });

  it('planted: a character with no inventor block fails closed', () => {
    const { inventor: _drop, ...noInventor } = weapon7();
    expect(shows(noInventor as Character)).toBe(false);
  });
});
