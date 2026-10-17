import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character, ContentDatabase, GrantedStrike, NaturalAttack } from '../src/rules/types';

/**
 * LOST-CONDITION BLOCKED LANE (2026-10-17) — the granted Strikes whose condition could only be carried
 * in src/rules/build.ts collectGrantedNaturals, which the first fix lane could not touch.
 *
 * · Fey Ascension (AoN feat-4048): *"You gain one of the following features and abilities; this must be
 *   the same animal or fey type as you chose for Fey Influence"*, and only under Dryad *"You gain a leaves
 *   ranged unarmed attack that deals 1d6 slashing damage."* The record asks through `effectChoices`, and
 *   the feat push read only `f.choice`, so the Leaves went to every branch (LIT).
 * · Fang Sharpener (feat-1000): *"If you're an irongut goblin, you gain a jaws unarmed attack that deals
 *   1d4 piercing damage"*. Sprite's Spark (feat-2635): *"The damage type and name of the unarmed attack
 *   depends on your heritage"*. Morphic Strike (feat-6991): *"You gain a melee unarmed Strike depending on
 *   your heritage"*, the elemental current *"the same damage type … of the cantrip you gained from your
 *   heritage"*, the striking surface *"bludgeoning or slashing (chosen when you gain this feat)"*. Every
 *   heritage got every row (DARK under the trust gate today, so read ungated here).
 *
 * The heritage gate is tested BEFORE the name dedup: the razortooth case below is the one a derive-side
 * filter would get wrong. Each gate is mutation-proved by planting the ungated row back. Synthetic
 * characters only.
 */
const db = content();
const gated = content({ trustGate: true });

const names = (ch: Character) => (ch.naturalAttacks ?? []).map((n) => n.name).sort();
const strike = (ch: Character, name: string): NaturalAttack | undefined => (ch.naturalAttacks ?? []).find((n) => n.name === name);
const pc = (d: ContentDatabase, over: Partial<BuildState>, level = 1): Character =>
  buildCharacter({ ...emptyBuild(), name: 'TEST lost-condition blocked', level, classId: 'fighter', keyAbility: 'str', backgroundId: Object.keys(d.backgrounds)[0], ...over } as BuildState, d);
/** Run `fn` with `featId`'s granted Strikes replaced by `rows` on `d` (the shared cached content), then restore. */
function planted<T>(d: ContentDatabase, featId: string, rows: GrantedStrike[], fn: () => T): T {
  const saved = d.feats[featId];
  (d.feats as Record<string, unknown>)[featId] = { ...saved, grantedStrikes: rows };
  try {
    return fn();
  } finally {
    d.feats[featId] = saved;
  }
}
const ungate = (rows: GrantedStrike[]): GrantedStrike[] =>
  rows.map(({ whenHeritage: _h, whenHeritageChoice: _c, ...g }) => ({ ...g })) as GrantedStrike[];

describe('Fey Ascension — the Leaves are the Dryad branch only (lit; gate ON)', () => {
  const FEAT = 'fey-ascension';
  const KEY = 'fey-ascension:fey-ascension-branch';
  const fey = (d: ContentDatabase, branch?: string, extra: Partial<BuildState> = {}) =>
    pc(d, { ancestryId: 'human', featPicks: { '9:ancestry': FEAT } as BuildState['featPicks'], ...(branch ? { effectChoices: { [KEY]: branch } } : {}), ...extra }, 9);

  it('the feat is held and its row is tagged with the Dryad answer', () => {
    expect(fey(gated, 'dryad').feats.some((f) => f.featId === FEAT)).toBe(true);
    // feat-4048 "Dryad … You gain a leaves ranged unarmed attack"
    expect(gated.feats[FEAT].grantedStrikes?.map((g) => g.choiceValue)).toEqual(['dryad']);
  });

  it('Dryad: the Leaves, as printed (1d6 slashing, dart group, magical + unarmed)', () => {
    const leaves = strike(fey(gated, 'dryad'), 'Leaves');
    expect(leaves).toMatchObject({ die: 'd6', damageType: 'slashing', group: 'dart', source: FEAT });
    expect([...(leaves?.traits ?? [])].sort()).toEqual(['magical', 'unarmed']);
  });

  it('Unicorn (or any other branch): no Leaves', () => {
    for (const b of ['unicorn', 'anteater', 'faun', 'monarch']) expect(names(fey(gated, b)), b).not.toContain('Leaves');
  });

  it('unanswered: no Leaves (UNKNOWN is not "dryad"; the builder still asks), and nothing is written back', () => {
    const ch = fey(gated);
    expect(names(ch)).not.toContain('Leaves');
    const back = deriveBuildFromCharacter(ch, gated);
    expect(back.effectChoices?.[KEY]).toBeUndefined();
  });

  it("a player's stored Leaves is never overwritten: kept on a Unicorn, and never doubled on a Dryad", () => {
    const manual = { name: 'Leaves', die: 'd6', damageType: 'slashing', traits: ['unarmed'], group: 'dart' };
    expect(fey(gated, 'unicorn', { naturalAttacks: [manual] }).naturalAttacks?.filter((n) => n.name === 'Leaves')).toHaveLength(1);
    expect(fey(gated, 'dryad', { naturalAttacks: [manual] }).naturalAttacks?.filter((n) => n.name === 'Leaves')).toHaveLength(1);
  });

  it('mutation-proof: the untagged row planted back hands the Leaves to a Unicorn again', () => {
    const row = gated.feats[FEAT].grantedStrikes![0];
    const { choiceValue: _v, ...bare } = row;
    expect(planted(gated, FEAT, [bare as GrantedStrike], () => names(fey(gated, 'unicorn')))).toContain('Leaves');
    expect(names(fey(gated, 'unicorn'))).not.toContain('Leaves');
  });
});

describe("Fang Sharpener — the 1d4 Jaws is the irongut goblin's (gated before the name dedup)", () => {
  const FEAT = 'fang-sharpener';
  const gob = (heritageId: string) => build('fighter', 1, { ancestryId: 'goblin', heritageId, featPicks: { '1:ancestry': FEAT } as BuildState['featPicks'] });

  it('irongut goblin: a 1d4 piercing Jaws from the feat', () => {
    expect(strike(gob('irongut-goblin'), 'Jaws')).toMatchObject({ die: 'd4', damageType: 'piercing', source: FEAT });
  });

  it("razortooth goblin: the heritage's own 1d6 finesse Jaws survives (heritage-252) — the feat's row never claims the name", () => {
    const jaws = (gob('razortooth-goblin').naturalAttacks ?? []).filter((n) => n.name === 'Jaws');
    expect(jaws).toHaveLength(1);
    expect(jaws[0]).toMatchObject({ die: 'd6', source: 'razortooth-goblin' });
    expect(jaws[0].traits).toContain('finesse');
  });

  it('any other goblin heritage: no Jaws', () => {
    expect(names(gob('snow-goblin'))).not.toContain('Jaws');
  });

  it('the round trip subtracts exactly what the build adds (no manual Jaws comes back)', () => {
    for (const h of ['irongut-goblin', 'razortooth-goblin']) expect(deriveBuildFromCharacter(gob(h), db).naturalAttacks, h).toBeUndefined();
  });

  it("mutation-proof: the ungated row hides the razortooth's own Jaws and arms a snow goblin", () => {
    const rows = ungate(db.feats[FEAT].grantedStrikes!);
    planted(db, FEAT, rows, () => {
      expect(strike(gob('razortooth-goblin'), 'Jaws')).toMatchObject({ die: 'd4', source: FEAT });
      expect(names(gob('snow-goblin'))).toContain('Jaws');
    });
  });
});

describe("Sprite's Spark — each sprite heritage gets only its own spark", () => {
  const FEAT = 'sprites-spark';
  // feat-2635: Draxie euphoric spark (mental), Firefly Sprite luminous spark (fire), Grig dissonant note
  // (sonic), Melixie sting shot (poison), Nyktera ultrasonic pulse (sonic), Pixie pixie dust (mental);
  // Dijiang primordial pulse (spirit), Gandharva celestial song (sonic), Kanchil puzzling bolt (mental),
  // Leungli surging splash (bludgeoning). The row names are the shipped ones (heritage labels).
  const OWN: Record<string, [string, string]> = {
    draxie: ['Draxie', 'mental'],
    'luminous-sprite': ['LuminousSprite', 'fire'],
    grig: ['Grig', 'sonic'],
    melixie: ['Melixie', 'poison'],
    nyktera: ['Nyktera', 'sonic'],
    pixie: ['Pixie', 'mental'],
    dijiang: ['Dijiang', 'spirit'],
    gandharva: ['Gandharva', 'sonic'],
    kanchil: ['Kanchil', 'mental'],
    leungli: ['Leungli', 'bludgeoning'],
  };
  const sprite = (heritageId: string | null) => build('fighter', 1, { ancestryId: 'sprite', heritageId, featPicks: { '1:ancestry': FEAT } as BuildState['featPicks'] });

  it('every one of the ten heritages: exactly one spark, its own, 1d4 at range 20', () => {
    for (const [h, [name, type]] of Object.entries(OWN)) {
      const ch = sprite(h);
      const mine = (ch.naturalAttacks ?? []).filter((n) => n.source === FEAT);
      expect(mine.map((n) => n.name), h).toEqual([name]);
      expect(mine[0], h).toMatchObject({ die: 'd4', damageType: type, range: 20, group: 'sling' });
    }
  });

  it('a heritage no row names (a versatile heritage, or none chosen yet): no spark', () => {
    for (const h of ['suli', null]) expect((sprite(h).naturalAttacks ?? []).filter((n) => n.source === FEAT), String(h)).toEqual([]);
  });

  it('mutation-proof: the ungated rows hand every sprite all ten', () => {
    const rows = ungate(db.feats[FEAT].grantedStrikes!);
    expect(planted(db, FEAT, rows, () => (sprite('pixie').naturalAttacks ?? []).filter((n) => n.source === FEAT).length)).toBe(10);
  });
});

describe('Morphic Strike — the Strike depending on your heritage', () => {
  const FEAT = 'morphic-strike';
  const yao = (heritageId: string, over: Partial<BuildState> = {}) =>
    build('fighter', 1, { ancestryId: 'yaoguai', heritageId, featPicks: { '1:ancestry': FEAT } as BuildState['featPicks'], ...over });
  const mine = (ch: Character) => (ch.naturalAttacks ?? []).filter((n) => n.source === FEAT);

  it('Animal: claw (agile, finesse) 1d6 slashing — and nothing else', () => {
    const m = mine(yao('born-of-animal'));
    expect(m.map((n) => n.name)).toEqual(['Claw']);
    expect(m[0]).toMatchObject({ die: 'd6', damageType: 'slashing' });
    expect(m[0].traits).toEqual(expect.arrayContaining(['agile', 'finesse']));
  });

  it('Celestial: spirit touch 1d4 spirit; Vegetation: root (reach) 1d6 bludgeoning', () => {
    expect(mine(yao('born-of-celestial')).map((n) => [n.name, n.damageType])).toEqual([['Spirit Touch', 'spirit']]);
    const root = mine(yao('born-of-vegetation'));
    expect(root.map((n) => [n.name, n.die, n.damageType])).toEqual([['Root', 'd6', 'bludgeoning']]);
    expect(root[0].traits).toContain('reach');
  });

  it("Elements: the elemental current follows the heritage's cantrip (damage type and elemental trait)", () => {
    const cur = (cantrip: string) => mine(yao('born-of-elements', { effectChoices: { 'born-of-elements:cantrip': cantrip } }));
    expect(cur('frostbite').map((n) => [n.name, n.damageType])).toEqual([['Elemental Current', 'cold']]);
    expect(cur('frostbite')[0].traits).toContain('cold');
    expect(cur('spout').map((n) => n.damageType)).toEqual(['bludgeoning']);
    expect(cur('spout')[0].traits).toContain('water');
    expect(cur('needle-darts')[0].traits).toContain('metal');
  });

  it('Elements with the cantrip not chosen yet: no current (no damage type to give it)', () => {
    expect(mine(yao('born-of-elements'))).toEqual([]);
  });

  it("Object: striking surface 1d8 of the feat's own chosen type; unchosen, none", () => {
    const pick = (v?: string) => mine(yao('born-of-item', v ? { featChoices: { '1:ancestry': v } as BuildState['featChoices'] } : {}));
    expect(pick('slashing').map((n) => [n.name, n.die, n.damageType])).toEqual([['Striking Surface', 'd8', 'slashing']]);
    expect(pick('bludgeoning').map((n) => n.damageType)).toEqual(['bludgeoning']);
    expect(pick()).toEqual([]);
  });

  it('no damage type is a Foundry template any more', () => {
    for (const g of db.feats[FEAT].grantedStrikes ?? []) expect(g.damageType, g.name).not.toMatch(/[{}]/);
  });

  it('mutation-proof: the ungated rows hand an Animal yaoguai every variant again', () => {
    const rows = ungate(db.feats[FEAT].grantedStrikes!);
    const got = planted(db, FEAT, rows, () => mine(yao('born-of-animal')).map((n) => n.name));
    expect(got).toEqual(expect.arrayContaining(['Claw', 'Spirit Touch', 'Elemental Current', 'Root']));
  });
});
