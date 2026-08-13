// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { deriveStrikes } from '../src/rules/derive';
import { MainTab } from '../src/sheet/MainTab';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * REACH IS A DISPLAYED VALUE (owner principle L).
 *
 * "if the strikes range is always the same when a character has this feat write the new reach; if
 * there are multiple reaches because of feats or other things write the multiple reaches; and on
 * ones that are only under certain circumstances have a *; if there are multiple reaches that are
 * the same reach but different circumstances have them both written reach/reach and * on both of
 * them that opens the source of that reach."
 *
 * The case that raised it: Wukong Extension's popup said "your reach for that Strike is 30 feet" and
 * the Strike row said nothing at all. Nothing in this app had ever computed a reach.
 */
const db = content();
const noop = () => undefined;

const wield = (itemId: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: itemId,
  itemId,
  quantity: 1,
  equipped: true,
  ...over,
});
const wielding = (ch: Character, ...inv: InventoryItem[]): Character => ({ ...ch, inventory: inv });
const strikeNamed = (ch: Character, name: string) => deriveStrikes(ch, db).find((s) => s.name === name)!;
const feet = (ch: Character, name: string) => (strikeNamed(ch, name).reaches ?? []).map((r) => r.feet);

describe('the reach a Strike always has', () => {
  it('is 5 feet on a plain melee weapon, written on the row rather than assumed', () => {
    const ch = wielding(build('fighter', 5, {}), wield('longsword'));
    expect(strikeNamed(ch, 'Longsword').reaches).toEqual([{ feet: 5 }]);
    expect(renderText(<MainTab character={ch} content={db} onPlay={noop} />)).toContain('Reach 5 ft');
  });

  it('is your reach PLUS 5 for a reach weapon, not a flat 10 — the trait extends you, it does not set you', () => {
    const medium = wielding(build('fighter', 5, {}), wield('longspear'));
    expect(feet(medium, 'Longspear')).toEqual([10]);
    // A character whose natural reach a record already raised (Jotun's Heart → 10) reaches 15 with the
    // same longspear. A flat "reach trait = 10 feet" would have quietly shortened them by five feet.
    const large: Character = { ...medium, reach: 10 };
    expect(feet(large, 'Longspear')).toEqual([15]);
    expect(feet(large, 'Longspear')).not.toEqual([10]);
  });

  it('follows a feat that hands an unarmed attack the reach trait, with no star — it is simply true', () => {
    const monk = build('monk', 18, { featPicks: { '18:class': 'effortless-reach' } });
    expect(db.feats['effortless-reach'].unarmedTraits).toBeTruthy();
    expect(strikeNamed(monk, 'Fist').reaches).toEqual([{ feet: 10 }]);
  });

  it('is absent on a projectile, which has a range increment instead', () => {
    const ch = wielding(build('fighter', 5, {}), wield('shortbow'));
    expect(strikeNamed(ch, 'Shortbow').reaches).toBeUndefined();
  });

  it('is present on a thrown-N weapon, whose single Strike the app models as the MELEE one', () => {
    const ch = wielding(build('fighter', 5, {}), wield('dagger'));
    expect(feet(ch, 'Dagger')).toEqual([5]);
  });
});

describe('Wukong Extension — the case that raised the ruling', () => {
  const inventor = (over: Partial<InventoryItem> = {}) =>
    wielding(
      build('inventor', 5, { featPicks: { '2:class': 'wukong-extension' } }),
      wield('greatsword', { designations: ['innovation'], ...over }),
    );

  it('writes 30 feet on the Strike row, starred, next to the reach it always has', () => {
    const s = strikeNamed(inventor(), 'Greatsword');
    expect(s.reaches).toEqual([
      { feet: 5 },
      {
        feet: 30,
        when: 'for the melee Strike made with Wukong Extension',
        sourceId: 'wukong-extension',
        sourceCollection: 'feats',
      },
    ]);
  });

  it("the star has a record to open — that is the whole point of carrying the source", () => {
    const conditional = strikeNamed(inventor(), 'Greatsword').reaches!.find((r) => r.when)!;
    const rec = db[conditional.sourceCollection!][conditional.sourceId!] as { description?: string };
    expect(rec.description).toContain('your reach for that Strike is 30 feet');
  });

  it('does NOT reach a weapon that is not the designated innovation', () => {
    const ch = wielding(
      build('inventor', 5, { featPicks: { '2:class': 'wukong-extension' } }),
      wield('greatsword', { designations: ['innovation'] }),
      wield('longsword'),
    );
    expect(feet(ch, 'Longsword')).toEqual([5]);
    expect(feet(ch, 'Greatsword')).toEqual([5, 30]);
  });

  it('reaches nothing at all when the player has designated no innovation', () => {
    expect(feet(inventor({ designations: undefined }), 'Greatsword')).toEqual([5]);
  });

  it('prints both numbers on the sheet, not just the one in the popup', () => {
    const text = renderText(<MainTab character={inventor()} content={db} onPlay={noop} />);
    expect(text).toContain('Reach 5 ft');
    expect(text).toContain('30 ft');
  });
});

describe('two circumstances giving the SAME reach are both written', () => {
  /** A minotaur barbarian is the one character who can hold both 10-foot reaches at once. */
  const minotaur = () =>
    wielding(
      build('barbarian', 14, {
        ancestryId: 'minotaur',
        subclassId: 'giant-instinct',
        keyAbility: 'str',
        featPicks: { '5:ancestry': 'stretching-reach', '14:class': 'giants-lunge' },
      }),
      wield('greatsword'),
    );

  it('keeps them apart, each with its own source, instead of collapsing them to one', () => {
    const reaches = strikeNamed(minotaur(), 'Greatsword').reaches!;
    expect(reaches.map((r) => r.feet)).toEqual([5, 10, 10]);
    const sources = reaches.filter((r) => r.when).map((r) => r.sourceId).sort();
    expect(sources).toEqual(['giants-lunge', 'stretching-reach']);
  });

  it('writes them as reach/reach on the row', () => {
    const text = renderText(<MainTab character={minotaur()} content={db} onPlay={noop} />);
    expect(text).toContain('Reach 5 ft/10 ft*/10 ft*');
  });

  it('drops a circumstance that changes nothing — a star there would promise a difference', () => {
    // Giant's Lunge grants "a reach of 10 feet"; a character who already reaches 10 gains nothing by
    // it, and the row must not read "10 ft / 10 ft*".
    const already: Character = { ...minotaur(), reach: 10 };
    expect(strikeNamed(already, 'Greatsword').reaches!.filter((r) => r.sourceId === 'giants-lunge')).toEqual([]);
  });
});

/*
 * THE SHAPE: a stated reach that says it COMBINES with a size increase.
 *
 * A stated `feet` wins over `add` — right for every record in the lane except one. Giant's Lunge ends
 * "…but it does combine with abilities that increase your reach due to increased size, such as
 * Giant's Stature", and with `feet` winning, a raging giant-instinct barbarian holding both feats saw
 * two separate 10-ft rows and never the 15 ft the printed rule gives. The number was right and the
 * FIELD could not say the sentence, so `combinesWithSize` / `fromSize` were built rather than the
 * value re-authored — `add: 5` would combine and would be wrong for anyone whose reach is not 5.
 */
describe('a stated reach that combines with a size increase', () => {
  const giant = (picks: Record<string, string>) =>
    wielding(build('barbarian', 14, { subclassId: 'giant-instinct', keyAbility: 'str', featPicks: picks }), wield('greataxe'));

  const both = () => giant({ '14:class': 'giants-lunge', '8:class': 'giants-stature' });

  it('writes the combined reach as a THIRD row, not in place of either half', () => {
    // Each half stays separately reachable — you may have used one action, the other, or both — so the
    // row can still answer which circumstance you are in.
    expect(feet(both(), 'Greataxe')).toEqual([5, 10, 10, 15]);
  });

  it('names both circumstances on the combined row, and stars the record that explains it', () => {
    const combined = strikeNamed(both(), 'Greataxe').reaches!.find((r) => r.feet === 15)!;
    expect(combined.when).toContain("Giant's Lunge");
    expect(combined.when).toContain('Large');
    // 15 ft is Giant's Lunge's clause doing the work; its text is what the player needs to read.
    expect(combined.sourceId).toBe('giants-lunge');
  });

  it('reaches the unarmed attack too — "all your melee weapons and unarmed attacks"', () => {
    expect(feet(both(), 'Fist')).toEqual([5, 10, 10, 15]);
  });

  it("combines with a LARGER size increase by that record's own number", () => {
    // Titan's Stature prints 10 feet, not 5. Both are listed because it is an alternative ("you can
    // INSTEAD become Huge"), never a second step on top of Large — summing them would invent a reach.
    const titan = giant({ '14:class': 'giants-lunge', '8:class': 'giants-stature', '12:class': 'titans-stature' });
    expect(feet(titan, 'Greataxe')).toEqual([5, 10, 10, 15, 15, 20]);
    expect(feet(titan, 'Greataxe')).not.toContain(25);
  });

  it('does nothing on its own — the size half has to be in play', () => {
    expect(feet(giant({ '14:class': 'giants-lunge' }), 'Greataxe')).toEqual([5, 10]);
    expect(feet(giant({ '8:class': 'giants-stature' }), 'Greataxe')).toEqual([5, 10]);
  });

  it('leaves a reach weapon alone, so the exclusion still wins over the combination', () => {
    // "This doesn't increase the reach of any weapon that already has the reach trait" — a longspear
    // gets the size increase and nothing from Giant's Lunge, combined or otherwise.
    const ch = wielding(
      build('barbarian', 14, {
        subclassId: 'giant-instinct',
        keyAbility: 'str',
        featPicks: { '14:class': 'giants-lunge', '8:class': 'giants-stature' },
      }),
      wield('longspear'),
    );
    expect(feet(ch, 'Longspear')).toEqual([10, 15]);
  });

  it('does NOT combine for a record whose text does not say it does', () => {
    // Stretching Reach prints only "the weapon gains a reach of 10 feet". Combining it would be us
    // writing a rule, which is the failure this lane exists to avoid.
    const ch = wielding(
      build('barbarian', 14, {
        ancestryId: 'minotaur',
        subclassId: 'giant-instinct',
        keyAbility: 'str',
        featPicks: { '5:ancestry': 'stretching-reach', '8:class': 'giants-stature' },
      }),
      wield('greatsword'),
    );
    expect(feet(ch, 'Greatsword')).toEqual([5, 10, 10]);
    expect(feet(ch, 'Greatsword')).not.toContain(15);
  });

  it('prints the combined number on the sheet, not only in the derived value', () => {
    const text = renderText(<MainTab character={both()} content={db} onPlay={noop} />);
    expect(text).toContain('Reach 5 ft/10 ft*/10 ft*/15 ft*');
  });

  it("only Giant's Lunge carries the clause, and every fromSize rider states an increase", () => {
    // The data half, measured rather than asserted: if an import starts marking more records, this is
    // the line that notices.
    type Rider = { fromSize?: true; combinesWithSize?: true; add?: number };
    const riders = (rec: { strikeReach?: Rider | Rider[] }): Rider[] =>
      Array.isArray(rec.strikeReach) ? rec.strikeReach : rec.strikeReach ? [rec.strikeReach] : [];
    const all = [...Object.entries(db.feats), ...Object.entries(db.items)] as [string, { strikeReach?: Rider | Rider[] }][];
    expect(all.filter(([, r]) => riders(r).some((x) => x.combinesWithSize)).map(([id]) => id)).toEqual(['giants-lunge']);
    // `fromSize` without an `add` would be inert — the combination would have no number to add.
    for (const [id, rec] of all) for (const r of riders(rec)) if (r.fromSize) expect(r.add, id).toBeGreaterThan(0);
  });
});

describe('a reach rider only reaches the Strikes its record names', () => {
  it("Lunge's +5 lands on a wielded weapon and not on your fist", () => {
    const ch = wielding(build('fighter', 5, { featPicks: { '2:class': 'lunge' } }), wield('longsword'));
    expect(feet(ch, 'Longsword')).toEqual([5, 10]);
    expect(feet(ch, 'Fist')).toEqual([5]);
  });

  it('a two-handed clause skips a one-handed weapon, and skips unarmed attacks entirely', () => {
    const ch = wielding(
      build('barbarian', 5, { ancestryId: 'minotaur', featPicks: { '5:ancestry': 'stretching-reach' } }),
      wield('greatsword'),
      wield('longsword'),
    );
    expect(feet(ch, 'Greatsword')).toEqual([5, 10]);
    expect(feet(ch, 'Longsword')).toEqual([5]);
    expect(feet(ch, 'Fist')).toEqual([5]);
  });

  it("Sever Space needs slashing damage, so a longspear gets nothing from it", () => {
    const ch = wielding(
      build('fighter', 20, { featPicks: { '20:class': 'sever-space' } }),
      wield('greatsword'),
      wield('longspear'),
    );
    expect(feet(ch, 'Greatsword')).toEqual([5, 80]);
    expect(feet(ch, 'Longspear')).toEqual([10]);
  });

  it("Giant's Lunge leaves a reach weapon alone, exactly as its text says", () => {
    const ch = wielding(
      build('barbarian', 14, { subclassId: 'giant-instinct', keyAbility: 'str', featPicks: { '14:class': 'giants-lunge' } }),
      wield('longspear'),
      wield('greatsword'),
    );
    expect(feet(ch, 'Longspear')).toEqual([10]);
    expect(feet(ch, 'Greatsword')).toEqual([5, 10]);
  });
});

describe('a rider with no circumstance is simply the new reach', () => {
  /** No shipped record prints an unconditional strike reach — every real one is a stance, an
   *  activation or a trait — so the always-true half of the ruling is exercised against a record
   *  built for it, over a CLONED database so nothing leaks into the rest of the suite. */
  const withRider = () => ({
    ...db,
    feats: {
      ...db.feats,
      lunge: { ...db.feats.lunge, strikeReach: { feet: 15, match: { unarmed: false } } },
    },
  }) as typeof db;

  it('raises the number itself, with no star to open', () => {
    const ch = wielding(build('fighter', 5, { featPicks: { '2:class': 'lunge' } }), wield('longsword'));
    const s = deriveStrikes(ch, withRider()).find((x) => x.name === 'Longsword')!;
    expect(s.reaches).toEqual([{ feet: 15 }]);
  });

  it('and a conditional reach is measured from that new number, not from the old one', () => {
    const ch = wielding(build('fighter', 5, { featPicks: { '2:class': 'lunge' } }), wield('longsword'));
    const db2 = withRider();
    db2.feats = { ...db2.feats, lunge: { ...db2.feats.lunge, strikeReach: [
      { feet: 15, match: { unarmed: false } },
      { add: 5, when: 'for the Strike made with Lunge', match: { unarmed: false } },
    ] } };
    const s = deriveStrikes(ch, db2).find((x) => x.name === 'Longsword')!;
    expect(s.reaches!.map((r) => r.feet)).toEqual([15, 20]);
    expect(s.reaches!.map((r) => r.feet)).not.toEqual([15, 10]);
  });
});

describe('an item can write a reach too', () => {
  it("a worn tasset of flexibility's Lunging Attack shows +5 on the weapon it is used with", () => {
    const ch = wielding(build('fighter', 5, {}), wield('longsword'), {
      instanceId: 'tasset',
      itemId: 'tasset-of-flexibility',
      quantity: 1,
      worn: true,
    });
    const reaches = strikeNamed(ch, 'Longsword').reaches!;
    expect(reaches).toEqual([{ feet: 5 }, { feet: 10, when: expect.any(String), sourceId: 'tasset-of-flexibility', sourceCollection: 'items' }]);
  });

  it('the same tasset in the backpack writes nothing', () => {
    const ch = wielding(build('fighter', 5, {}), wield('longsword'), {
      instanceId: 'tasset',
      itemId: 'tasset-of-flexibility',
      quantity: 1,
    });
    expect(feet(ch, 'Longsword')).toEqual([5]);
  });

  it('a reach that SHRINKS is written alongside the one you normally have, not instead of it', () => {
    const ch = wielding(build('fighter', 5, {}), wield('longsword'), {
      instanceId: 'module',
      itemId: 'miniaturization-module',
      quantity: 1,
      worn: true,
    });
    expect(feet(ch, 'Longsword')).toEqual([5, 0]);
  });
});
