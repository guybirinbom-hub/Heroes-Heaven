// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import { deriveDefenses } from '../src/rules/derive';
import { featEntries } from '../src/sheet/FeatsTab';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 036, SITUATIONAL lane.
 *
 * Same discipline as batches 29-35: every assertion goes through the reader the SHEET uses —
 * `explainStat(...).situational` and `.parts` (StatDetailModal's rows), `deriveDefenses(...).senses`
 * (the Senses row of VitalsRail / DetailsTab) and `featEntries` (the Feats tab's own entry builder) —
 * never the registry literal.
 *
 * Three of the four findings are DATA rows this family only SPECS (work/.b036-rows-situational.json);
 * the driver applies them. So those tests read a content copy with the field stripped or patched IN
 * MEMORY, never a patched-vs-shipped delta that would flip the moment the row lands.
 */
const db = content();

const wearing = (itemId: string, level = 8): Character =>
  ({
    ...build('fighter', level),
    inventory: [{ instanceId: 'i1', itemId, quantity: 1, worn: true, invested: true } as InventoryItem],
  }) as Character;

/** A content copy with one item's `passiveEffects` gone — the shape the overlay row produces. */
const withoutPassives = (itemId: string): ContentDatabase => {
  const item = { ...(db.items[itemId] as Record<string, unknown>) };
  delete item.passiveEffects;
  return { ...db, items: { ...db.items, [itemId]: item } } as ContentDatabase;
};

/** `when :: bonus` for the rows ONE record contributes to a stat, as StatDetailModal reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe("illusionists-hat carries its two printed +1 item bonuses", () => {
  /* AoN equipment-5201 (Pathfinder #224 pg. 239): "You gain a +1 item bonus to Deception checks made
   * to Create a Diversion and to Thievery checks made to Palm an Object." The record carried nothing
   * mechanical at all, so both bonuses reached the player nowhere; WG's row 23007 encodes both. Both
   * are action-scoped, which is why they are stars and not a whole-skill passive. */

  const hatted = wearing('illusionists-hat');
  const bare = build('fighter', 8);

  // batch 036: illusionists-hat#skill-bonuses
  it('illusionists-hat: the Deception bonus reaches the Deception rows, scoped to Create a Diversion', () => {
    expect(characterSituationalIds(hatted, db)).toContain('illusionists-hat');
    const rows = stars(hatted, { kind: 'skill', skill: 'deception' }, 'illusionists-hat');
    expect(rows.length, 'one row for the one printed clause').toBe(1);
    expect(rows[0]).toContain('Create a Diversion');
    expect(rows[0]).toContain('+1 item');
  });

  // batch 036: illusionists-hat#skill-bonuses
  it('illusionists-hat: the Thievery bonus reaches the Thievery rows, scoped to Palm an Object', () => {
    const rows = stars(hatted, { kind: 'skill', skill: 'thievery' }, 'illusionists-hat');
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('Palm an Object');
    expect(rows[0]).toContain('+1 item');
  });

  // batch 036: illusionists-hat#skill-bonuses
  it('illusionists-hat: both notes are on the sheet, and neither moves the whole skill', () => {
    const dec = explainStat(hatted, db, { kind: 'skill', skill: 'deception' });
    expect((dec.situational ?? []).filter((n) => n.sourceId === 'illusionists-hat').length).toBe(1);
    // Action-scoped: nothing may land in the totals as a flat item bonus.
    expect(dec.parts.some((p) => p.label === "Illusionist's Hat")).toBe(false);
    const thi = explainStat(hatted, db, { kind: 'skill', skill: 'thievery' });
    expect((thi.situational ?? []).filter((n) => n.sourceId === 'illusionists-hat').length).toBe(1);
    expect(thi.parts.some((p) => p.label === "Illusionist's Hat")).toBe(false);
  });

  // batch 036: illusionists-hat#skill-bonuses
  it('illusionists-hat: a character without the hat, and a hat left in the pack, read nothing', () => {
    expect(stars(bare, { kind: 'skill', skill: 'deception' }, 'illusionists-hat')).toEqual([]);
    const packed = {
      ...build('fighter', 8),
      inventory: [{ instanceId: 'i1', itemId: 'illusionists-hat', quantity: 1 } as InventoryItem],
    } as Character;
    expect(stars(packed, { kind: 'skill', skill: 'thievery' }, 'illusionists-hat')).toEqual([]);
  });
});

describe('eye-of-the-unseen states its +1 once, and only for sight', () => {
  /* AoN equipment-1367-1240: "While wearing the eye, you gain a +1 item bonus to visual Perception
   * checks." The record ALSO shipped passiveEffects={perception:1}, which passiveItemBonusDetail reads
   * on any in-use row (derive.ts:386-408, gate is itemInUse alone) — so every Perception check got the
   * bonus and the same +1 was then listed a second time as the conditional star. The overlay row this
   * batch specs deletes that field; the star is the whole mechanic, the day-goggles shape.
   *
   * Read against a content copy with `passiveEffects` STRIPPED, which is what the row produces —
   * asserting the shipped side would flip when the row lands. */

  const stripped = withoutPassives('eye-of-the-unseen');
  const eyed = wearing('eye-of-the-unseen');

  // batch 036: eye-of-the-unseen
  it('eye-of-the-unseen: no flat item bonus reaches the Perception total', () => {
    const perc = explainStat(eyed, stripped, { kind: 'perception' });
    expect(perc.parts.some((p) => p.label === 'Eye of the Unseen')).toBe(false);
    expect(perc.parts.some((p) => p.note === 'item bonus')).toBe(false);
  });

  // batch 036: eye-of-the-unseen
  it('eye-of-the-unseen: the sight-only +1 is still stated, exactly once', () => {
    const notes = (explainStat(eyed, stripped, { kind: 'perception' }).situational ?? []).filter(
      (n) => n.sourceId === 'eye-of-the-unseen',
    );
    expect(notes.length, 'one line, not the flat bonus plus its own restatement').toBe(1);
    expect(notes[0].text).toContain('+1 item');
    expect(notes[0].text).toContain('rely on sight');
    expect(notes[0].sourceCollection).toBe('items');
  });
});

describe('composer-staff-greater bonuses only the Performance you play on it', () => {
  /* AoN equipment-2249-1995: "In this way, you can play it as though it were an instrument, and it
   * grants a +1 item bonus to Performance checks made with it." A held staff is `equipped`, so the
   * shipped passiveEffects={skills:{performance:1}} passed passiveItemBonus's itemInUse gate and raised
   * EVERY Performance check, with the conditional star restating the same +1 beside it. The sibling
   * instrument pipes-of-compulsion-greater already carries the star and no passive.
   *
   * Same stripped-copy discipline as the eye: the row is this batch's spec, not yet applied. */

  const stripped = withoutPassives('composer-staff-greater');
  const bard = {
    ...build('bard', 8),
    inventory: [{ instanceId: 'i1', itemId: 'composer-staff-greater', quantity: 1, equipped: true } as InventoryItem],
  } as Character;

  // batch 036: composer-staff-greater
  it('composer-staff-greater: merely holding the staff adds nothing to the Performance total', () => {
    const perf = explainStat(bard, stripped, { kind: 'skill', skill: 'performance' });
    expect(perf.parts.some((p) => p.label === 'Composer Staff (Greater)')).toBe(false);
    expect(perf.parts.some((p) => p.note === 'item bonus')).toBe(false);
  });

  // batch 036: composer-staff-greater
  it('composer-staff-greater: the played-as-an-instrument +1 is stated once, on Performance', () => {
    const notes = (explainStat(bard, stripped, { kind: 'skill', skill: 'performance' }).situational ?? []).filter(
      (n) => n.sourceId === 'composer-staff-greater',
    );
    expect(notes.length).toBe(1);
    expect(notes[0].text).toContain('+1 item');
    expect(notes[0].text).toContain('playing the staff as an instrument');
  });
});

describe("cultivators-keen-eye senses cultivation materials and pays ritual costs with them", () => {
  /* AoN feat-7090: "Attuned to all arrangements of qi, you gain lifesense as an imprecise sense with a
   * range of 30 feet. You can also sense the presence of precious materials in the same range, which
   * cultivators refer to as 'cultivation materials.' When you participate in rituals, you can
   * substitute all or part of the ritual's cost with an equivalent value of precious materials. This
   * applies only to costs in valuable substances like diamonds, not to rituals that require specific
   * items to function; the GM makes the call if it's unclear." Only the lifesense shipped (ours and
   * WG's ability block 28489 both), so neither the second sense nor the ritual clause reached a sheet.
   *
   * Two overlay rows this batch specs, read here against a PATCHED copy of the content: `senses` gains
   * the printed note (SenseEntry.note is the field written for a clause printed in the same breath as
   * the range) and the feat's `note` carries the ritual substitution, which no stat row can hold. */

  const ROW_SENSES = [
    {
      name: 'lifesense',
      range: 30,
      acuity: 'imprecise' as const,
      note: 'You also sense precious materials ("cultivation materials") in the same range.',
    },
  ];
  const ROW_NOTE =
    'When you participate in a ritual you can substitute all or part of its cost with an equivalent value of precious materials. ' +
    "Costs in valuable substances like diamonds only — never a ritual that requires specific items to function; the GM makes the call if it's unclear.";

  const patched = {
    ...db,
    feats: { ...db.feats, 'cultivators-keen-eye': { ...db.feats['cultivators-keen-eye'], senses: ROW_SENSES, note: ROW_NOTE } },
  } as ContentDatabase;
  const cultivator = {
    ...build('fighter', 8),
    feats: [{ featId: 'cultivators-keen-eye', level: 8, category: 'class' as const }],
  } as Character;

  // batch 036: cultivators-keen-eye#materials
  it('cultivators-keen-eye: the Senses row keeps lifesense 30 ft and gains the materials clause', () => {
    const lifesense = deriveDefenses(cultivator, patched).senses.find((s) => s.name === 'lifesense');
    expect(lifesense, 'the shipped half must survive the superseding row').toBeTruthy();
    expect(lifesense!.range).toBe(30);
    expect(lifesense!.acuity).toBe('imprecise');
    expect(lifesense!.note).toContain('precious materials');
    expect(lifesense!.note).toContain('cultivation materials');
  });

  // batch 036: cultivators-keen-eye#materials
  it('cultivators-keen-eye: the ritual-cost substitution reaches the feat entry the player reads', () => {
    const entry = featEntries(cultivator, patched).find((e) => e.featId === 'cultivators-keen-eye');
    expect(entry, 'the feat has to be on the Feats tab at all').toBeTruthy();
    expect(entry!.description).toContain('substitute all or part of its cost');
    expect(entry!.description).toContain('diamonds');
    expect(entry!.description).toContain('specific items');
  });

  // batch 036: cultivators-keen-eye#materials
  it('cultivators-keen-eye: a character without the feat gains neither clause', () => {
    const plain = build('fighter', 8);
    expect(deriveDefenses(plain, patched).senses.some((s) => s.name === 'lifesense')).toBe(false);
    expect(featEntries(plain, patched).some((e) => e.featId === 'cultivators-keen-eye')).toBe(false);
  });
});
