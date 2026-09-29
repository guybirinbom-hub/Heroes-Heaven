import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dailyItemOptions, dailyItemSlots } from '../src/rules/dailyItems';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Print batch P02, data-rows chunk 3: findings whose whole fix is authored data
 * (work/.bP02-rows-data-rows-3.json). The printed text - each record's own aonId in the AoN mirror -
 * is the authority.
 *
 * The "shipped" assertions read public/core.json + core-descriptions.json through `content()`, so they
 * are red until the driver applies the rows: they pin the row, and a regeneration that drops it fails
 * here. The "mechanism" assertion builds on an in-memory copy with the field PATCHED to the row's value,
 * so it holds before and after the row lands and proves the reader turns the field into slots.
 */
const db = content();

const desc = (bucket: 'feats' | 'spells', id: string) =>
  String((db[bucket] as Record<string, { description?: string }>)[id]?.description ?? '');

/** A built character holding one extra feat (the daily-items test's own idiom). */
const withFeat = (classId: string, level: number, featId: string): Character => {
  const c = build(classId, level, {});
  return { ...c, feats: [...c.feats, { featId, level: 1, slot: 'x:0' }] } as Character;
};

describe('Impossible Magic feat descriptions drop the page header their own fields already carry', () => {
  // batch P02: exploding-bullet#description-header
  it('exploding-bullet: the description opens on its Requirements line, not "Exploding Bullet\\nSource ..."', () => {
    const d = desc('feats', 'exploding-bullet');
    // AoN feat-9055: name, Source and Prerequisites are page chrome; the record's name/source/prerequisites carry them.
    // batch P02: exploding-bullet#description-header
    expect(d.startsWith('**Requirements** You’re wielding an unloaded firearm.')).toBe(true);
    // batch P02: exploding-bullet#description-header
    expect(d).not.toMatch(/^Source |\nSource |^Prerequisites |\nPrerequisites /m);
    // batch P02: exploding-bullet#description-header
    expect(d).toContain('**Special** When you use volatile spark’s Reloading Cascade action');
  });

  // batch P02: recharging-flurry#description-header
  it('recharging-flurry: the description opens on its Requirements line, the MAP clause intact', () => {
    const d = desc('feats', 'recharging-flurry');
    // batch P02: recharging-flurry#description-header
    expect(d.startsWith('**Requirements** You’re wielding two melee weapons, each in a different hand.')).toBe(true);
    // batch P02: recharging-flurry#description-header
    expect(d).not.toMatch(/^Recharging Flurry\n|\nSource |\nPrerequisites /);
    // batch P02: recharging-flurry#description-header
    expect(d).toContain('–8 if it’s your third or further Strike (–6 with an agile weapon)');
  });

  // batch P02: running-recharge#description-header
  it('running-recharge: the description is the rules text alone', () => {
    // batch P02: running-recharge#description-header
    expect(desc('feats', 'running-recharge')).toBe(
      'Preparing in every way for your next assault, you both relocate yourself and ready your Spellstrike. You recharge your Spellstrike and either Stride up to half your Speed or Step.',
    );
  });
});

describe('prose restored to the record’s own printing', () => {
  // batch P02: shattering-spellstrike
  it('shattering-spellstrike: the breaking weapon deals 2d6 FORCE damage', () => {
    // AoN feat-7467: "If the attack hits, it deals an additional 2d6 force damage as your improvised weapon breaks."
    // batch P02: shattering-spellstrike
    expect(desc('feats', 'shattering-spellstrike')).toContain('an additional 2d6 force damage as your improvised weapon breaks');
  });

  // batch P02: strikers-scroll#prose
  it('strikers-scroll: the second paragraph is the feat-9059 wording', () => {
    const d = desc('feats', 'strikers-scroll');
    // batch P02: strikers-scroll#prose
    expect(d).toContain('provided the spell is one you could normally use with Spellstrike');
    // batch P02: strikers-scroll#prose
    expect(d).toContain('use it as a normal—if a bit crumpled—scroll.');
    // batch P02: strikers-scroll#prose
    expect(d).not.toContain('assuming the spell');
  });

  // batch P02: dimensional-assault#prose
  it('dimensional-assault: the spell-2877 body and its Heightened (5th) entry', () => {
    const d = desc('spells', 'dimensional-assault');
    // batch P02: dimensional-assault#prose
    expect(d).toContain('Teleport to any space in range you can see that’s within reach of an enemy, and then make a melee Strike against that enemy.');
    // batch P02: dimensional-assault#prose
    expect(d).toContain('the spell is disrupted');
    // batch P02: dimensional-assault#prose
    expect(d).toContain('**Heightened (5th)** The range is equal to your Speed.');
    // batch P02: dimensional-assault#prose
    expect(d).not.toContain('any square in range');
  });

  // batch P02: force-fang#prose
  it('force-fang: the spell-2878 body, target within your melee reach', () => {
    const d = desc('spells', 'force-fang');
    // batch P02: force-fang#prose
    expect(d).toContain('deals 1d4+1 force damage to a target within your melee reach');
    // batch P02: force-fang#prose
    expect(d).not.toContain('replacing all its normal statistics');
    // batch P02: force-fang#prose
    expect(d).toContain('**Heightened (+2)** The damage increases by 1d4+1.');
  });
});

describe('practical-magic-impossible-magic makes two temporary spell catalysts each morning', () => {
  const ROW = [
    {
      id: 'catalyst',
      label: 'Temporary spell catalyst',
      count: 2,
      filter: {
        traits: ['catalyst'],
        maxLevel: 'floor(@actor.level/2)',
        note: 'Common spell catalysts only; you know their formulas without a formula book. It loses its magic at your next daily preparations if unused.',
      },
    },
  ];

  // batch P02: practical-magic-impossible-magic
  it('practical-magic-impossible-magic: the shipped record carries the daily catalyst slots', () => {
    // AoN feat-9331: "you can make two spell catalysts with an item level no higher than half your level"
    // batch P02: practical-magic-impossible-magic
    expect(db.feats['practical-magic-impossible-magic']!.dailyTemporaryItems).toEqual(ROW);
    const slots = dailyItemSlots(withFeat('wizard', 9, 'practical-magic-impossible-magic'), db);
    // batch P02: practical-magic-impossible-magic
    expect(slots.map((s) => s.maxLevel)).toEqual([4, 4]);
  });

  // batch P02: practical-magic-impossible-magic
  it('practical-magic-impossible-magic: the reader turns the row into two catalyst slots capped at half level', () => {
    const rec = { ...db.feats['practical-magic-impossible-magic']!, dailyTemporaryItems: ROW };
    const patched = { ...db, feats: { ...db.feats, [rec.id]: rec } } as ContentDatabase;
    const ch = withFeat('wizard', 9, rec.id);
    const slots = dailyItemSlots(ch, patched);
    // batch P02: practical-magic-impossible-magic
    expect(slots).toHaveLength(2);
    // batch P02: practical-magic-impossible-magic
    expect(slots.every((s) => s.maxLevel === 4 && s.traits?.includes('catalyst'))).toBe(true);
    const opts = dailyItemOptions(slots[0], ch, patched);
    // batch P02: practical-magic-impossible-magic
    expect(opts.length).toBeGreaterThan(0);
    // batch P02: practical-magic-impossible-magic
    expect(opts.every((o) => (patched.items[o.id]?.level ?? 0) <= 4 && patched.items[o.id]?.traits?.includes('catalyst'))).toBe(true);
  });
});

describe('Impossible Magic conflux spells carry their printed cast, save and area', () => {
  // batch P02: booming-blast#cast
  it('booming-blast: a single action', () => {
    // AoN spell-2875 prints "Single Action".
    // batch P02: booming-blast#cast
    expect(db.spells['booming-blast']!.cast).toEqual({ type: 'actions', value: 1 });
  });

  // batch P02: booming-blast#defense
  it('booming-blast: a non-basic Will save over a 20-foot emanation', () => {
    const sp = db.spells['booming-blast']!;
    // AoN spell-2875: "each enemy in a 20-foot emanation around you must succeed at a Will save against your spell DC"
    // batch P02: booming-blast#defense
    expect(sp.save).toEqual({ type: 'will', basic: false });
    // batch P02: booming-blast#defense
    expect(sp.area).toBe('20-foot emanation');
    // batch P02: booming-blast#defense
    expect(sp.baseArea).toEqual({ value: 20, kind: 'emanation' });
  });

  // batch P02: force-fling#cast
  it('force-fling: a single action', () => {
    // AoN spell-2879 prints "Single Action".
    // batch P02: force-fling#cast
    expect(db.spells['force-fling']!.cast).toEqual({ type: 'actions', value: 1 });
  });
});
