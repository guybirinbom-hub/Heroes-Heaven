import { describe, it, expect } from 'vitest';
import { build, content, mainCasting } from './_content';
import { buildCharacter, emptyBuild, flexibleCollectionSize, type BuildState } from '../src/rules/build';
import { deriveSpeeds } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 037 — GATE-RED, group `owner-ruled-engine-lanes`.
 *
 * Two findings the owner ruled on 2026-09-10 and the engine could not express:
 *   swashbucklers-speed#typed-all-speeds  (#127) — Speed bonuses carry a TYPE, and "to your Speeds"
 *                                                  is every Speed, not land alone.
 *   flexible-spellcaster#collection-shape (#102) — the spell collection is ONE flat pool sized by the
 *                                                  character's total slots, not a per-rank list.
 *
 * The TYPE rows are the driver's to apply, so every speed assertion runs against two IN-MEMORY copies
 * of the database — one with the fields patched in, one with them stripped — never a patched-vs-shipped
 * delta, which would flip the day the rows land. The collection half is pure code and is asserted on a
 * BUILT character against the shipped content.
 */
const db = content();

/** A character holding feats by id — the same injection route batch 031's speed tests use. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8, over: Partial<BuildState> = {}): Character => {
  const base = build(classId, level, over);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b37:${i}` }))],
  } as unknown as Character;
};

/** A copy of the database with one feat record's fields overridden. */
const patchFeats = (over: Record<string, Record<string, unknown>>): ContentDatabase =>
  ({
    ...db,
    feats: Object.fromEntries([
      ...Object.entries(db.feats),
      ...Object.entries(over).map(([id, rec]) => [id, { ...db.feats[id], ...rec }]),
    ]),
  }) as ContentDatabase;

describe('swashbucklers-speed: a typed Speed bonus does not stack with its own type', () => {
  /* AoN feat-6238: "You gain a +5-foot status bonus to your Speeds; this increases to a +10-foot
   * status bonus while you have panache." Every Speed bonus was summed untyped into land Speed. */

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('two status bonuses give the HIGHEST, where untyped ones gave the sum', () => {
    // Scout's Speed (feat-6398) prints "+10-foot status bonus to your Speed" — the same named type, so
    // print gives the character 10 feet, not 15.
    const c = withFeats(['swashbucklers-speed', 'scouts-speed']);
    const untyped = patchFeats({ 'swashbucklers-speed': { speedBonusType: undefined }, 'scouts-speed': { speedBonusType: undefined } });
    const typed = patchFeats({ 'swashbucklers-speed': { speedBonusType: 'status' }, 'scouts-speed': { speedBonusType: 'status' } });
    expect(deriveSpeeds(c, untyped).land, 'the shape being corrected: 5 + 10 added together').toBe((deriveSpeeds(build('fighter', 8), db).land ?? 0) + 15);
    expect(deriveSpeeds(c, typed).land, 'highest of the two status bonuses').toBe((deriveSpeeds(build('fighter', 8), db).land ?? 0) + 10);
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('an UNTYPED bonus still stacks with a status one — Fleet prints no type', () => {
    /* "Your Speed increases by 5 feet" (feat-5150) names no bonus type, and untyped modifiers stack:
     * suppressing Fleet here would be a second defect dressed as a fix. */
    const c = withFeats(['swashbucklers-speed', 'fleet']);
    const typed = patchFeats({ 'swashbucklers-speed': { speedBonusType: 'status' } });
    expect(deriveSpeeds(c, typed).land).toBe((deriveSpeeds(build('fighter', 8), db).land ?? 0) + 10);
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('the plural clause raises a swim Speed too, and invents none where there is no Speed', () => {
    /* "to your SpeedS" — the seaweed leshy has a swim Speed of 20 feet (heritage-270), so the feat's
     * +5 reaches it; the same character's fly Speed does not exist and is not created. */
    const swimmer = withFeats(['swashbucklers-speed'], 'fighter', 8, { ancestryId: 'leshy', heritageId: 'seaweed-leshy' } as Partial<BuildState>);
    /* VERIFIER FIX (gate-red, 2026-09-11): `speedBonusAllSpeeds` must be STRIPPED here, not merely
     * left unset. `patchFeats` spreads the shipped record and overrides the named keys, so once the
     * driver applies work/.b037-rows-red-owner-ruled-engine-lanes.json this copy would inherit the
     * real `speedBonusAllSpeeds: true` from core.json, the swim Speed would read 25, and the
     * "land only" assertion below would flip from green to red the day the row lands — the exact
     * patched-vs-shipped delta this file's header promises it never writes. */
    const landOnly = patchFeats({ 'swashbucklers-speed': { speedBonusType: 'status', speedBonusAllSpeeds: undefined } });
    const allSpeeds = patchFeats({ 'swashbucklers-speed': { speedBonusType: 'status', speedBonusAllSpeeds: true } });
    expect(deriveSpeeds(swimmer, landOnly).swim, 'the shape being corrected: land only').toBe(20);
    expect(deriveSpeeds(swimmer, allSpeeds).swim, '"to your Speeds"').toBe(25);
    expect(deriveSpeeds(swimmer, allSpeeds).land, 'land takes it exactly once').toBe(deriveSpeeds(swimmer, landOnly).land);
    expect(deriveSpeeds(swimmer, allSpeeds).fly, 'a Speed you do not have stays absent').toBeUndefined();
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('every assertion above survives the day the rows land — proved on an APPLIED copy', () => {
    /* VERIFIER ADDITION (gate-red, 2026-09-11). The three cases above patch the two fields in; this
     * one applies work/.b037-rows-red-owner-ruled-engine-lanes.json to the database FIRST — the state
     * the driver leaves behind — and then re-derives the same two numbers off it, stripping the field
     * to get the before-shape. If a later edit reintroduced the patched-vs-shipped delta (an override
     * that sets `speedBonusType` and leaves `speedBonusAllSpeeds` to be inherited), this case reads
     * 25 where the "land only" shape must read 20 and fails HERE, not in the driver's run. */
    const applied = patchFeats({
      'swashbucklers-speed': { speedBonusType: 'status', speedBonusAllSpeeds: true },
      'scouts-speed': { speedBonusType: 'status' },
    });
    const stripOn = (base: ContentDatabase, over: Record<string, unknown>): ContentDatabase =>
      ({ ...base, feats: { ...base.feats, 'swashbucklers-speed': { ...base.feats['swashbucklers-speed'], ...over } } }) as ContentDatabase;
    const swimmer = withFeats(['swashbucklers-speed'], 'fighter', 8, { ancestryId: 'leshy', heritageId: 'seaweed-leshy' } as Partial<BuildState>);
    expect(deriveSpeeds(swimmer, applied).swim, '"to your Speeds", on the applied database').toBe(25);
    expect(deriveSpeeds(swimmer, stripOn(applied, { speedBonusAllSpeeds: undefined })).swim, 'stripped back to land-only').toBe(20);
    const both = withFeats(['swashbucklers-speed', 'scouts-speed']);
    expect(deriveSpeeds(both, applied).land, 'highest of the two status bonuses, on the applied database').toBe((deriveSpeeds(build('fighter', 8), db).land ?? 0) + 10);
    expect(
      deriveSpeeds(both, stripOn({ ...applied, feats: { ...applied.feats, 'scouts-speed': { ...applied.feats['scouts-speed'], speedBonusType: undefined } } } as ContentDatabase, { speedBonusType: undefined })).land,
      'stripped back to the shape being corrected: 5 + 10 added together',
    ).toBe((deriveSpeeds(build('fighter', 8), db).land ?? 0) + 15);
  });
});

describe('flexible-spellcaster: the collection is one flat pool, not a per-rank list', () => {
  /* AoN archetype-99: "The number of spells in your spell collection each day equals the total number
   * of spell slots you get each day from your class spells", and "you must select at least one
   * 1st-level spell for your collection each time you prepare" is its only stated limit. */

  const RANK1 = ['negate-aroma', 'shillelagh', 'snowball', 'chilling-spray', 'personal-rain-cloud', 'scouring-sand', 'verdant-sprout'];
  const RANK2 = ['enhance-victuals', 'restoration', 'iron-gut', 'breath-of-drought', 'rime-slick', 'sea-surge'];
  /* A DRUID: the collection branch runs for a prepared caster without a spellbook. (A flexible wizard,
   * witch or magus still takes the book branch above it and gets no collection at all — a separate
   * defect, out of this finding, flagged as residue in the report rather than fixed here.) */
  const flexDruid = (level: number, spells: Record<number, string[]>): Character =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 'flex',
        level,
        classId: 'druid',
        subclassId: 'animal-order',
        ancestryId: 'human',
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: 'wis',
        featPicks: { '2:class:0': 'flexible-spellcaster-dedication' },
        spells,
      } as unknown as BuildState,
      db,
    );
  const collected = (ch: Character) => Object.values(mainCasting(ch)?.repertoire ?? {}).flat();
  const slotTotal = (ch: Character) =>
    Object.entries(mainCasting(ch)?.slots ?? {}).reduce((n, [rank, s]) => (Number(rank) >= 1 ? n + s.max : n), 0);

  // batch 037: flexible-spellcaster#collection-shape
  it('the pool is sized by the TOTAL slots, so six 1st-rank spells fit six slots', () => {
    /* The per-rank shape (WG's) capped rank 1 at that rank's two slots and dropped the other four
     * outright — four of the six spells a 6th-level flexible druid is entitled to collect. */
    const ch = flexDruid(6, { 1: RANK1.slice(0, 6) });
    expect(slotTotal(ch), "the archetype's capped table, 2 per rank").toBe(6);
    expect(mainCasting(ch)?.repertoire?.[1]).toEqual(RANK1.slice(0, 6));
    expect(collected(ch).length, 'one flat pool of six').toBe(6);
    expect(flexibleCollectionSize({ 1: 2, 2: 2, 3: 2 }), 'the sheet and the builder size it here').toBe(6);
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('…and the pool is a CAP: a seventh pick is not collected', () => {
    const ch = flexDruid(6, { 1: RANK1.slice(0, 7) });
    expect(collected(ch).length).toBe(slotTotal(ch));
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('the SLOTS stay per rank — only the collection is flat', () => {
    /* "you can cast any of the spells in your collection by using a spell slot of an appropriate
     * level": a flat pool is not a flat slot table, and flattening both would hand a 6th-level wizard
     * six 3rd-rank casts. */
    const ch = flexDruid(6, { 1: RANK1.slice(0, 6) });
    expect(Object.entries(mainCasting(ch)?.slots ?? {}).map(([r, s]) => [Number(r), s.max]).sort((a, b) => a[0] - b[0])).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('a crowded higher rank never crowds out the 1st-rank spell print requires', () => {
    /* "you must select at least one 1st-level spell for your collection each time you prepare" — the
     * pool fills from the lowest rank up, so the floor holds for any player who picked one. */
    const ch = flexDruid(6, { 1: [RANK1[0]], 2: RANK2 });
    expect(mainCasting(ch)?.repertoire?.[1]).toContain(RANK1[0]);
    expect(collected(ch).length).toBe(slotTotal(ch));
  });
});
