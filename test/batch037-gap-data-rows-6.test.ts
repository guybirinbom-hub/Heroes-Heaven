import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

/**
 * Batch 037, GAP AGENT for family data-rows-6.
 *
 * The four rows here close the DATA STILL NEEDED lines the builder and the verifier both left as
 * prose in work/.b037-gaps.json. Every assertion reads the SHIPPED artefacts through `content()`, so
 * each one fails until the driver applies work/.b037-rows-gap-data-rows-6.json — the test pins the
 * row, not a patched copy, exactly as test/batch037-data-rows-6.test.ts does for the same family.
 */
const db = content();

describe('screech-shooter-major — the grade rolls the sonic damage its own text prints', () => {
  // batch 037 premise: equipment-1169 "A screech shooter deals sonic damage"
  it('screech-shooter-major deals sonic damage, like the base and greater grades', () => {
    // The family page states the damage type once, for every grade; neither grade block overrides it
    // (equipment-1169-1109 and -1110 change only the activation DC and the emanation). The major
    // record's OWN description repeats the sentence while its `damage.type` said "piercing", so the
    // sheet rolled piercing off a record whose prose said sonic.
    expect(db.items['screech-shooter-major']!.damage).toEqual({ dice: 1, die: 'd10', type: 'sonic' });
    // The two siblings are the control: this was one grade's defect, not the family's.
    expect(db.items['screech-shooter']!.damage!.type).toBe('sonic');
    expect(db.items['screech-shooter-greater']!.damage!.type).toBe('sonic');
  });
});

describe('heritages/dragonblood — the exemplar speeds breath-of-the-dragon derives from', () => {
  // batch 037: breath-of-the-dragon#derive-from-exemplar
  it('dragonblood magma and bog read the Draconic Benefactors speed column breath-of-the-dragon shares', () => {
    // The table the owner transcribed on 2026-09-10 (carried whole in that finding's proposal, because
    // the Draconic Benefactors page is not in the AoN mirror) gives each exemplar ONE extra Speed:
    // "Bog|Primal|Swim" and "Magma|Primal|Burrow". Ours had them crossed over.
    const opts = db.heritages['dragonblood']!.choice!.options ?? [];
    const desc = (value: string) => opts.find((o) => o.value === value)?.description;
    expect(desc('magma')).toBe('Primal dragon — fly, burrow.');
    expect(desc('bog')).toBe('Primal dragon — fly, swim.');
    // The controls: two rows that already agreed with the table, so a re-emit that "fixed" the wrong
    // records is loud.
    expect(desc('adamantine')).toBe('Primal dragon — fly, burrow.');
    expect(desc('requiem')).toBe('Divine dragon — fly, swim.');
  });

  // batch 037: breath-of-the-dragon#derive-from-exemplar
  it('the re-emitted dragonblood choice keeps every value and label breath-of-the-dragon keys off', () => {
    // feats/breath-of-the-dragon's effectChoices row keys its 40 options off these `value` strings and
    // choiceFlagAnswer resolves the feat's answer from this record's flag, so a whole-field re-emit
    // that moved a value or dropped an option would silently unanswer the feat.
    const ch = db.heritages['dragonblood']!.choice!;
    expect(ch.flag).toBe('draconicExemplar');
    expect(ch.options).toHaveLength(40);
    expect((ch.options ?? []).map((o) => o.value)).toEqual([
      'adamantine', 'barrage', 'bog', 'brine', 'cinder', 'cloud', 'conspirator', 'coral', 'crystal',
      'delight', 'despair', 'diabolic', 'empyreal', 'executor', 'forest', 'fortune', 'horned', 'magma',
      'mirage', 'mocking', 'oath', 'omen', 'phase', 'requiem', 'resurrection', 'rime', 'rune', 'sage',
      'sea', 'sky', 'sovereign', 'stormcrown', 'time', 'umbral', 'underworld', 'vizier', 'vorpal',
      'wailing', 'whisper', 'wish',
    ]);
    // Only two descriptions moved: every option still opens with its tradition word from the table.
    for (const o of ch.options ?? []) expect(o.description).toMatch(/^(Arcane|Divine|Occult|Primal) dragon — fly/);
  });
});

describe('bespell-strikes — the printed 1d6 finally has a carrier', () => {
  // batch 037 premise: feat-5028 "the weapon or unarmed attack deals an extra 1d6 force damage"
  it('bespell-strikes stars strike damage with the base 1d6', () => {
    // The record shipped no `situational` at all, so the only star the pair had was the arcana-of-iron
    // upgrade ("the extra damage is 1d8 instead of 1d6") — an upgrade over nothing. The clause cannot
    // be a flat number: feat-5028 gates it on a non-cantrip spell cast this turn, once per turn, on
    // one chosen weapon.
    const sit = db.feats['bespell-strikes']!.situational ?? [];
    expect(sit).toHaveLength(1);
    expect(sit[0].targets).toEqual([{ kind: 'strikeDamage' }]);
    expect(sit[0].bonus).toContain('1d6 force');
    expect(sit[0].when).toContain('non-cantrip spell');
  });

  // batch 037 premise: feat-5028 "the weapon or unarmed attack deals an extra 1d6 force damage"
  it('a built wizard who takes bespell-strikes puts the record on the situational walk', () => {
    // The row is only worth having if the reader reaches it: `characterSituationalIds` is the list
    // `featSituationalFor` walks, and explain.ts files each feat record's own `situational` off it.
    const base = build('wizard', 4);
    const c = {
      ...base,
      feats: [...base.feats, { featId: 'bespell-strikes', level: 4, slot: 'b037gap:0' }],
    } as unknown as Character;
    expect(characterSituationalIds(c, db)).toContain('bespell-strikes');
  });
});

describe('astrolabe-of-the-falling-stars — the duplicate record reads the printed numbers', () => {
  // batch 037 premise: equipment-4028 "Price 150 gp"
  it('the duplicate astrolabe costs what the AoN record costs', () => {
    // Two records of one item ship: items/astrolabe-of-falling-stars (aonId equipment-4028) and this
    // one (no aonId), whose names differ by a word so the duplicate-name suppression never saw them.
    // A player who bought this one paid 50 gp for a 150-gp item — wealth by level, not display.
    expect(db.items['astrolabe-of-the-falling-stars']!.price).toEqual({ gp: 150 });
    expect(db.items['astrolabe-of-falling-stars']!.price).toEqual({ gp: 150 });
  });

  // batch 037 premise: equipment-4028 "Activate—Starfall Two Actions"
  it('the duplicate astrolabe activates Starfall in two actions', () => {
    expect(db.items['astrolabe-of-the-falling-stars']!.activationCost).toEqual({ type: 'actions', value: 2 });
    // Its frequency counter is the same activation's "once per day" and was already right.
    expect(db.items['astrolabe-of-the-falling-stars']!.frequency).toEqual({ max: 1, per: 'day' });
  });
});
