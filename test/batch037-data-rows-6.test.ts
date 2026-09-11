import { describe, it, expect } from 'vitest';
import { content } from './_content';

/**
 * Batch 037, data-rows-6: the WG-comparison findings whose whole fix is authored data.
 *
 * Every assertion reads the SHIPPED artefacts through `content()` (public/core.json plus the
 * split-out public/core-descriptions.json), so each one fails until the driver applies
 * work/.b037-rows-data-rows-6.json — the test pins the row, not a patched copy.
 */
const db = content();

const feat = (id: string) => db.feats[id]!;
const item = (id: string) => db.items[id]!;

describe('arcana-of-iron — the Bespell Strikes clause reaches the strike-damage breakdown', () => {
  // batch 037: arcana-of-iron#bespell-strikes
  it('arcana-of-iron stars strike damage with the 1d8 upgrade', () => {
    // AoN feat-7980: *"The extra damage you deal with Bespell Strikes increases to 1d8."* The clause
    // had no carrier at all, so the upgrade was invisible on the sheet.
    const sit = feat('arcana-of-iron').situational ?? [];
    expect(sit).toHaveLength(1);
    expect(sit[0].targets).toEqual([{ kind: 'strikeDamage' }]);
    expect(sit[0].bonus).toBe('the extra damage is 1d8 instead of 1d6');
    expect(sit[0].when).toContain('Bespell Strikes');
  });
});

describe('astrolabe-of-falling-stars — the same star its six siblings carry', () => {
  // batch 037: astrolabe-of-falling-stars#identify-star
  it('astrolabe-of-falling-stars grants +1 item on ALL skills to identify celestial bodies', () => {
    // AoN equipment-4028 *"can be used as a mariner's astrolabe"* → equipment-4027 *"An astrolabe also
    // grants a +1 item bonus to checks to identify celestial bodies"* — no skill is named, so the
    // bonus is not narrowed to Survival (which is the printed REQUIREMENT, carried in `when`).
    const sit = item('astrolabe-of-falling-stars').situational ?? [];
    expect(sit).toHaveLength(1);
    expect(sit[0].targets).toEqual([{ kind: 'skill', detail: 'all' }]);
    expect(sit[0].bonus).toBe('+1 item');
    expect(sit[0].when).toContain('identify celestial bodies');
    expect(sit[0].when).toContain('Survival');
  });

  // batch 037: astrolabe-of-falling-stars#identify-star
  it('astrolabe-of-falling-stars qualifies its star while carried rather than going dark', () => {
    // `itemInUse` (derive.ts) needs worn/invested/equipped/attachedTo, and an itemType `equipment`
    // record with no `invested` trait gets no Wear/Wield control (equipControl, InventoryTab.tsx) and
    // is refused by the drag path (isEquippable) — so without `whileCarried` the clause can never
    // reach a player. Same state the flag's doc-comment names: *"nothing in the app equips a loose
    // crystal, so the equip test hid that clause outright rather than qualifying it."* The printed
    // requirement (trained in Survival, held in two hands) stays stated in `when`.
    const sit = item('astrolabe-of-falling-stars').situational ?? [];
    expect(sit[0].whileCarried).toBe(true);
    const it0 = db.items['astrolabe-of-falling-stars']!;
    expect(it0.itemType).toBe('equipment');
    expect(it0.traits ?? []).not.toContain('invested');
  });
});

describe('breath-of-the-dragon — shape, damage and save derive from the draconic exemplar', () => {
  // batch 037: breath-of-the-dragon#derive-from-exemplar
  it('breath-of-the-dragon asks ONE question, answered by the dragonblood exemplar flag', () => {
    // AoN feat-5730: *"The shape of the breath, the damage type, and the saving throw match those of
    // your draconic exemplar."* The three free pickers let a player build a breath no dragon has.
    const chs = feat('breath-of-the-dragon').effectChoices ?? [];
    expect(chs).toHaveLength(1);
    expect(chs[0].answerFromChoiceFlag).toBe('draconicExemplar');
    // The flag it reads is the one heritages/dragonblood actually records, or nothing derives.
    expect(db.heritages['dragonblood']!.choice!.flag).toBe('draconicExemplar');
    // …and every exemplar the heritage offers has an option here, with the same value.
    const heritageValues = (db.heritages['dragonblood']!.choice!.options ?? []).map((o) => o.value);
    expect((chs[0].options ?? []).map((o) => o.value)).toEqual(heritageValues);
  });

  // batch 037: breath-of-the-dragon#derive-from-exemplar
  it('breath-of-the-dragon states shape, damage type and save together on each exemplar', () => {
    // Draconic Benefactors (Draconic Codex pg. 206): a cinder dragon breathes a 15-foot cone of fire
    // (basic Reflex); a requiem dragon a 30-foot line of spirit damage (basic Will); a conspirator's
    // poison breath calls for a basic FORTITUDE save. One option = one legal triple.
    const opts = feat('breath-of-the-dragon').effectChoices![0].options ?? [];
    const noteFor = (v: string) => opts.find((o) => o.value === v)?.note ?? '';
    expect(noteFor('cinder')).toBe('15-foot cone, fire damage, basic Reflex save. The ability gains the fire trait.');
    expect(noteFor('requiem')).toBe('30-foot line, spirit damage, basic Will save. The ability gains the spirit trait.');
    expect(noteFor('conspirator')).toBe('15-foot cone, poison damage, basic Fortitude save. The ability gains the poison trait.');
    // Physical damage carries no trait — the shipped damage picker claimed one for every type.
    expect(noteFor('crystal')).toContain('Physical damage carries no trait of its own.');
    // Every option names a shape, a save and a damage word: no half-stated row.
    for (const o of opts) {
      expect(o.note, o.value).toMatch(/^(15-foot cone|30-foot line), \w+ damage, basic (Reflex|Fortitude|Will) save\./);
    }
  });
});

describe('reborn-soul — three extra increases, one each, not WG’s six', () => {
  // batch 037: reborn-soul#restricted-increases
  it('reborn-soul’s note states ONE extra increase per level, player’s choice of Lore', () => {
    // AoN background-590: *"At 3rd level, 7th level, and 15th level, you receive skill increases,
    // which you can apply only to these Lore skills."* The shipped note took WG's both-Lores-each-time
    // reading (six raises) without saying so.
    const warn = db.backgrounds['reborn-soul']!.dataWarning ?? '';
    expect(warn).toContain('ONE extra skill increase');
    expect(warn).toContain('you choose which one each time');
    // …and it must not keep the plural reading that let a player raise both Lores at every level.
    expect(warn).not.toContain('EXTRA skill increases');
  });
});

describe('screech-shooter-greater / screech-shooter-major — each grade shows only its own numbers', () => {
  // batch 037: screech-shooter-greater#grade-numbers
  it('screech-shooter-greater prints DC 30 in a 40-foot emanation', () => {
    // AoN equipment-1169-1109: *"The DC for the activation is 30 and it affects creatures in a 40-foot
    // emanation."* The base page's DC 25 / 30-foot sentence was left on the grade.
    const d = item('screech-shooter-greater').description ?? '';
    expect(d).toContain('All creatures in a 40-foot emanation from you must attempt a DC 30 Will save.');
    expect(d).not.toContain('DC 25');
    expect(d).not.toContain('30-foot emanation');
    // The rest of the printed entry is untouched — the frightened ladder still reads.
    expect(d).toContain('**Critical Failure** The creature is Frightened 3 and fleeing for 1 round.');
  });

  // batch 037: screech-shooter-major#grade-numbers
  it('screech-shooter-major prints DC 37 in a 50-foot emanation', () => {
    // AoN equipment-1169-1110: *"The DC for the activation is 37 and it affects creatures in a 50-foot
    // emanation."*
    const d = item('screech-shooter-major').description ?? '';
    expect(d).toContain('All creatures in a 50-foot emanation from you must attempt a DC 37 Will save.');
    expect(d).not.toContain('DC 25');
    expect(d).not.toContain('30-foot emanation');
  });
});

describe('wyrm-spindle-greater / wyrm-spindle-major — the grade’s own Dragon Breath DC', () => {
  // batch 037: wyrm-spindle-greater#grade-numbers
  it('wyrm-spindle-greater breathes 9d6 with a DC 34 basic Reflex save, in both places', () => {
    // AoN equipment-2243-1983: *"damage from Dragon Breath when affixed to a weapon is 9d6 (DC 34)"*;
    // the base page (equipment-2243) gives the area and the save name: *"in a 30-foot cone with a
    // DC 28 basic Reflex save"*. Ours said "with a save" — no DC, no save name — and the affix pick's
    // own note had lost the area too ("in a with a save").
    // CLOSER NOTE: the grade DC is written the way print writes it — parenthetically, "9d6 (DC 34)" —
    // because the applier refuses any 3+ word run no named doc prints contiguously, and "DC 34 basic
    // Reflex save" is a phrase print never forms (the base page's save line carries DC 28).
    const clause = 'deals 9d6 damage to all creatures in a 30-foot cone with a basic Reflex save (DC 34)';
    expect(item('wyrm-spindle-greater').description ?? '').toContain(clause);
    const weapon = (item('wyrm-spindle-greater').effectChoices![0].options ?? []).find((o) => o.value === 'weapon');
    expect(weapon?.note).toContain(clause);
    // The armor half of the same grade keeps its own printed number.
    expect(item('wyrm-spindle-greater').description ?? '').toContain('resistance 10 to fire, force, mental, and spirit');
  });

  // batch 037: wyrm-spindle-major#grade-numbers
  it('wyrm-spindle-major breathes 12d6 with a DC 41 basic Reflex save, in both places', () => {
    // AoN equipment-2243-1984: *"Resistance when affixed to armor is 15, and damage from Dragon Breath
    // when affixed to a weapon is 12d6 (DC 41)."*
    // Same parenthetical form as the greater row, for the same reason.
    const clause = 'deals 12d6 damage to all creatures in a 30-foot cone with a basic Reflex save (DC 41)';
    expect(item('wyrm-spindle-major').description ?? '').toContain(clause);
    const weapon = (item('wyrm-spindle-major').effectChoices![0].options ?? []).find((o) => o.value === 'weapon');
    expect(weapon?.note).toContain(clause);
    expect(item('wyrm-spindle-major').description ?? '').toContain('resistance 15 to fire, force, mental, and spirit');
  });
});
