import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { VERSATILE_VIAL_TIERS, craftRankFor, versatileVialTierFor } from '../src/rules/versatileVial';
import type { BuildState } from '../src/rules/build';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Alchemy (Player Core 2, class-feature-817): "A vial you create is always the highest type you could
 * Craft." The sidebar it points at — read on the live Archives page Classes.aspx?ID=56, 2026-10-15:
 * lesser Item 1 (1d6, 1 splash), moderate Item 4 (+1, 2d6, 2 splash), greater Item 12 (+2, 3d6,
 * 3 splash), major Item 18 (+3, 4d6, 4 splash). And Craft (Player Core, action-2385): "If the item is
 * 9th level or higher, you must be a master in Crafting, and if it's 17th or higher, you must be
 * legendary."
 *
 * Both vial records hold the LESSER type, so before this lane an 18th-level alchemist's Strikes tab
 * showed a 1st-level bomb. The gates are the load-bearing part: every OTHER graded bomb steps at
 * 1/3/11/17, so the levels 3, 11 and 17 below are the ones a borrowed ladder gets wrong.
 */
const db = content();
const held = (itemId: string): InventoryItem => ({ instanceId: 'v1', itemId, quantity: 1, equipped: true });
const throwIt = (ch: Character, itemId = 'versatile-vial', d: ContentDatabase = db) =>
  deriveStrike({ ...ch, inventory: [held(itemId)] }, d, held(itemId))!;
/** Crafting raised at every skill increase that leads to legendary by 15th: the character who COULD
 *  Craft each type as soon as their level reaches it. Which levels those are differs by class. */
const crafting = (level: number, at: number[]) => Object.fromEntries(at.filter((l) => l <= level).map((l) => [l, 'crafting']));
const alchemistBuild = (level: number, over: Partial<BuildState> = {}) =>
  build('alchemist', level, { skillIncreases: crafting(level, [3, 7, 15]), ...over });
const alchemist = (level: number) => throwIt(alchemistBuild(level));
const fireworkTech = (level: number) =>
  build('fighter', level, { featPicks: { '2:class': 'firework-technician-dedication' }, skillIncreases: crafting(level, [3, 5, 7, 15]) });

/** Both sides of each of the three gates, plus the ends: [level, dice, item bonus, splash]. */
const LADDER = [
  [1, 1, 0, 1], [3, 1, 0, 1], [4, 2, 1, 2], [11, 2, 1, 2],
  [12, 3, 2, 3], [17, 3, 2, 3], [18, 4, 3, 4], [20, 4, 3, 4],
] as const;

describe('versatile vial — the printed table', () => {
  it('is four types at Item 1/4/12/18, not the 1/3/11/17 of every other graded bomb', () => {
    expect(VERSATILE_VIAL_TIERS.map((t) => t.minLevel)).toEqual([1, 4, 12, 18]);
    expect(VERSATILE_VIAL_TIERS.map((t) => t.dice)).toEqual([1, 2, 3, 4]);
    expect(VERSATILE_VIAL_TIERS.map((t) => t.itemAttack)).toEqual([0, 1, 2, 3]);
    expect(VERSATILE_VIAL_TIERS.map((t) => t.splash)).toEqual([1, 2, 3, 4]);
  });

  it('asks the Crafting rank Craft asks: master from item level 9, legendary from 17', () => {
    expect([1, 4, 8, 9, 12, 16, 17, 18].map(craftRankFor)).toEqual(['trained', 'trained', 'trained', 'master', 'master', 'master', 'legendary', 'legendary']);
  });

  it('resolves the highest type a level could Craft, on both sides of every gate', () => {
    for (const [level, tier] of [
      [1, 'lesser'], [3, 'lesser'], [4, 'moderate'], [11, 'moderate'],
      [12, 'greater'], [17, 'greater'], [18, 'major'], [20, 'major'],
    ] as const) {
      expect(versatileVialTierFor(level, 'legendary').tier, `level ${level}`).toBe(tier);
    }
    expect(versatileVialTierFor(0, 'legendary').tier).toBe('lesser');
  });

  it('holds a type back until the Crafting rank allows it, and never drops below lesser', () => {
    expect(versatileVialTierFor(4, 'untrained').tier).toBe('lesser');
    expect(versatileVialTierFor(4, 'trained').tier).toBe('moderate');
    expect(versatileVialTierFor(12, 'expert').tier).toBe('moderate');
    expect(versatileVialTierFor(12, 'master').tier).toBe('greater');
    expect(versatileVialTierFor(18, 'master').tier).toBe('greater');
    expect(versatileVialTierFor(18, 'legendary').tier).toBe('major');
  });
});

describe('versatile vial — the Strike an alchemist throws', () => {
  it('steps dice, item bonus and splash at 4, 12 and 18 — and not at 3, 11 or 17', () => {
    for (const [level, dice, bonus, splash] of LADDER) {
      const s = alchemist(level);
      // The damage string OPENS with the dice; anchoring keeps "1d6 plus 2d6" from passing as 2d6.
      expect(s.damage, `level ${level}`).toMatch(new RegExp(`^${dice}d6\\b`));
      expect(s.damage, `level ${level}`).toContain(`plus ${splash} acid splash`);
      expect(s.potencyBonus, `level ${level}`).toBe(bonus);
    }
  });

  it('puts the item bonus into the attack roll itself', () => {
    // Across one level and one gate: +1 proficiency (level) and the type's bonus going +1 -> +2.
    expect(alchemist(12).attack[0] - alchemist(11).attack[0]).toBe(2);
    // Across a level with no gate: proficiency only.
    expect(alchemist(11).attack[0] - alchemist(10).attack[0]).toBe(1);
  });

  it('names the type in the damage breakdown and the attack breakdown', () => {
    const ch = { ...alchemistBuild(12), inventory: [held('versatile-vial')] } as Character;
    const dmg = explainStat(ch, db, { kind: 'strikeDamage', instanceId: 'v1' })!;
    expect(dmg.description).toMatch(/highest type you could Craft/);
    expect(dmg.description).toMatch(/greater versatile vial \(3d6 acid, \+2 item bonus to attack rolls, 3 acid splash\)/);
    const atk = explainStat(ch, db, { kind: 'strikeAttack', instanceId: 'v1' })!;
    const item = atk.parts.find((p) => p.note === 'item bonus')!;
    expect(item.label).toBe('Greater versatile vial');
    expect(item.value).toBe(2);
  });

  it('a 12th-level alchemist still trained in Crafting throws a moderate vial, and the breakdown says why', () => {
    const ch = build('alchemist', 12);
    expect(ch.proficiencies.skills.crafting, 'fixture: Crafting was raised').toBe('trained');
    const s = throwIt(ch);
    expect(s.damage).toMatch(/^2d6 acid plus 2 acid splash/);
    expect(s.potencyBonus).toBe(1);
    expect(s.dieNote).toMatch(/moderate versatile vial .* A greater vial \(item level 12\) needs master in Crafting\./);
  });

  it('adds no note at 1st level, where the record already states the numbers', () => {
    expect(alchemist(1).dieNote).toBeUndefined();
    expect(alchemist(1).potencyNote).toBeUndefined();
    expect(alchemist(1).damage).toBe('1d6 acid plus 1 acid splash');
  });
});

describe('versatile vial — the Firework Technician', () => {
  it('throws pyrotechnic vials of the same types, dealing fire', () => {
    for (const [level, dice, bonus, splash] of LADDER.filter(([l]) => l >= 2)) {
      const ch = fireworkTech(level);
      expect(ch.feats.some((f) => f.featId === 'firework-technician-dedication'), 'dedication not taken').toBe(true);
      const s = throwIt(ch, 'pyrotechnic-versatile-vial');
      expect(s.damage, `level ${level}`).toMatch(new RegExp(`^${dice}d6(\\+\\d+)? fire plus ${splash} fire splash`));
      expect(s.potencyBonus, `level ${level}`).toBe(bonus);
    }
    const ch = { ...fireworkTech(12), inventory: [held('pyrotechnic-versatile-vial')] } as Character;
    const atk = explainStat(ch, db, { kind: 'strikeAttack', instanceId: 'v1' })!;
    expect(atk.parts.find((p) => p.note === 'item bonus')?.label).toBe('Greater pyrotechnic versatile vial');
  });

  it('makes only pyrotechnic vials — and nobody else makes those', () => {
    // A plain acid vial in a Firework Technician's hand, and a pyrotechnic one in a plain alchemist's,
    // were each made by someone else.
    expect(throwIt(fireworkTech(18), 'versatile-vial').damage).toMatch(/^1d6\b/);
    expect(throwIt(alchemistBuild(18), 'pyrotechnic-versatile-vial').damage).toMatch(/^1d6\b/);
    // An alchemist who is also a Firework Technician makes both.
    const both = alchemistBuild(18, { featPicks: { '2:class': 'firework-technician-dedication' } });
    expect(both.feats.some((f) => f.featId === 'firework-technician-dedication'), 'dedication not taken').toBe(true);
    expect(throwIt(both, 'versatile-vial').damage).toMatch(/^4d6\b/);
    expect(throwIt(both, 'pyrotechnic-versatile-vial').damage).toMatch(/^4d6\b/);
  });
});

describe('versatile vial — who it scales for', () => {
  it('follows the vial counter exactly: every maker the counter knows tiers, nobody else does', () => {
    const at12 = { skillIncreases: crafting(12, [3, 5, 7]) };
    const cases: [string, Character, string][] = [
      ['alchemist', alchemistBuild(12), 'versatile-vial'],
      ['Alchemist Dedication', build('fighter', 12, { featPicks: { '2:class': 'alchemist-dedication' }, ...at12 }), 'versatile-vial'],
      ['Wandering Chef Dedication', build('fighter', 12, { featPicks: { '2:class': 'wandering-chef-dedication' }, ...at12 }), 'versatile-vial'],
      ['Firework Technician Dedication', fireworkTech(12), 'pyrotechnic-versatile-vial'],
      ['Munitions Machinist', build('gunslinger', 12, { featPicks: { '6:class': 'munitions-machinist' }, ...at12 }), 'versatile-vial'],
      // Herbalist Dedication sets `advancedAlchemy` and grants NO vials.
      ['Herbalist Dedication', build('fighter', 12, { featPicks: { '2:class': 'herbalist-dedication' }, ...at12 }), 'versatile-vial'],
      ['fighter', build('fighter', 12, at12), 'versatile-vial'],
    ];
    const makers: string[] = [];
    for (const [label, ch, vial] of cases) {
      expect(ch.proficiencies.skills.crafting, `${label}: fixture Crafting`).toBe('master');
      const counter = 'versatile-vials' in (ch.classResources ?? {});
      const tiered = /^3d6\b/.test(throwIt(ch, vial).damage);
      expect(tiered, `${label}: counter ${counter}, bomb tiered ${tiered}`).toBe(counter);
      if (counter) makers.push(label);
    }
    // The fixture must really exercise both sides — a dedication that silently failed to land would
    // otherwise pass as a "non-maker".
    expect(makers).toEqual(['alchemist', 'Alchemist Dedication', 'Wandering Chef Dedication', 'Firework Technician Dedication', 'Munitions Machinist']);
  });

  it('keeps the printed lesser type for a vial its holder did not make', () => {
    const s = throwIt(build('fighter', 20, { skillIncreases: crafting(20, [3, 5, 7, 15]) }));
    expect(s.damage).toMatch(/^1d6\b/);
    expect(s.damage).toContain('plus 1 acid splash');
    expect(s.potencyBonus).toBe(0);
    expect(s.dieNote).toBeUndefined();
  });

  it('touches no other bomb — the type belongs to the vial, not to the bomb group', () => {
    // A graded sibling held by the same 18th-level alchemist keeps its own record's numbers.
    expect(db.items['necrotic-bomb-lesser'], 'fixture bomb missing').toBeTruthy();
    const s = throwIt(alchemistBuild(18), 'necrotic-bomb-lesser');
    expect(s.damage).toMatch(/^1d6\b/);
    expect(s.potencyBonus).toBe(0);
    expect(s.dieNote).toBeUndefined();
  });

  it('labels a bomb’s own printed item bonus with the bomb, not as a potency rune it cannot carry', () => {
    const ch = { ...build('alchemist', 4), inventory: [held('acid-flask-moderate')] } as Character;
    const atk = explainStat(ch, db, { kind: 'strikeAttack', instanceId: 'v1' })!;
    expect(atk.parts.find((p) => p.note === 'item bonus')?.label).toBe('Acid Flask (Moderate)');
  });

  it('under automatic bonus progression the larger dice count wins — ABP does not add onto the type', () => {
    // ABP's devastating attacks: "N damage dice instead of one" (2 dice from 4th, 3 from 12th, 4 from 19th).
    const abp = (ch: Character) => ({ ...ch, variantRules: { ...(ch.variantRules ?? {}), abp: true } }) as Character;
    // The fixture really is under ABP: at 12th the plain record would otherwise read 1d6 + 2 ABP dice.
    expect(throwIt(abp(build('fighter', 12)), 'versatile-vial').damage).toMatch(/^3d6\b/);
    expect(throwIt(abp(alchemistBuild(12))).damage).toMatch(/^3d6\b/);
    expect(throwIt(abp(alchemistBuild(20))).damage).toMatch(/^4d6\b/);
  });

  it('still tiers under the trust gate the app runs', () => {
    const gated = content({ trustGate: true });
    expect(throwIt(alchemistBuild(12), 'versatile-vial', gated).damage).toMatch(/^3d6\b/);
    expect(throwIt(fireworkTech(18), 'pyrotechnic-versatile-vial', gated).damage).toMatch(/^4d6\b/);
  });
});
