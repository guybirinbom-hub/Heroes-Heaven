import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import { modeNumberBonus } from '../src/rules/modes';
import type { Character, ClassFeature, IwrEntry, ModeDef } from '../src/rules/types';

/**
 * Batch-033 RESUME — group "otherworldly-and-curse-rows" of the data-rows family.
 *
 * Two overlay rows, both whole-field re-emissions of an existing effect-backfill row:
 *   classFeatures/otherworldly-protection.resistances   (the wg-values SET-GAP, theirs=vitality)
 *   modes/curse-of-creeping-ashes-4.modifiers           (the row half of the instruments VALUES line)
 *
 * Every assertion reads the SHIPPED record through `content()` and then runs it through the real
 * derive on a BUILT character. Nothing here diffs a patched copy against the shipped one: each
 * assertion fails today for exactly one reason (the field still carries the value print contradicts)
 * and passes once the rows in
 * work/.b033-rows-resume-otherworldly-and-curse-rows-two-overlay-rows-values-otherworldly-protection-the-row-half-of-the-creeping-ashes-speed-line-.json
 * are applied by the driver.
 */
const db = () => content();
const cf = (id: string) => db().classFeatures[id] as (ClassFeature & Record<string, unknown>) | undefined;
const resistancesOf = (id: string) => ((cf(id)?.resistances ?? []) as IwrEntry[]);

/** A level-8 inventor whose armor innovation carries the modification: 3 + floor(8/2) = 7. */
const protectedInventor = (over: Record<string, unknown> = {}): Character =>
  build('inventor', 8, { subclassId: 'armor-innovation', inventorModifications: { initial: 'otherworldly-protection' }, ...over });

describe('otherworldly-protection swaps void for vitality when you have void healing', () => {
  // batch 033: otherworldly-protection#void-healing-swap
  it('gives a living inventor void resistance and a dhampir inventor vitality instead', () => {
    // innovation-1 (the REMASTER Armor innovation; our aonParentId still points at the legacy
    // innovation-5): "You gain resistance equal to 3 + half your level to void damage, or to vitality
    // damage if you have void healing (such as if you're a dhampir)." We rode the void branch alone
    // and carried the vitality half as PROSE on `condition`, so the number never swapped and
    // wg-values saw a SET-GAP (theirs=vitality). `whenVoidHealing` (src/rules/types.ts:527, gated at
    // src/rules/derive.ts:2726) is the branch this sentence needs and had no user until this row.
    const rs = resistancesOf('otherworldly-protection');
    expect(rs.find((r) => r.type === 'spirit')?.value).toBe('3+floor(@actor.level/2)'); // the harness half
    const voidEntry = rs.find((r) => r.type === 'void');
    const vitalityEntry = rs.find((r) => r.type === 'vitality');
    expect(voidEntry).toEqual({ type: 'void', value: '3+floor(@actor.level/2)', whenVoidHealing: false });
    expect(vitalityEntry).toEqual({ type: 'vitality', value: '3+floor(@actor.level/2)', whenVoidHealing: true });
    // The prose caveat is gone: the branch now says what the sentence said.
    expect(voidEntry?.condition).toBeUndefined();

    // A living inventor: void counted, vitality absent.
    const living = deriveDefenses(protectedInventor(), db());
    expect(living.resistances.find((r) => r.type === 'void')?.value).toBe(7);
    expect(living.resistances.some((r) => r.type === 'vitality')).toBe(false);

    // …and a dhampir, whose heritage carries void healing (`negativeHealing`, read at derive.ts:2688):
    // the other way round, with the spirit resistance print grants unconditionally on both.
    const dhampir = deriveDefenses(protectedInventor({ heritageId: 'dhampir' }), db());
    expect(dhampir.negativeHealing).toBe(true);
    expect(dhampir.resistances.find((r) => r.type === 'vitality')?.value).toBe(7);
    expect(dhampir.resistances.some((r) => r.type === 'void')).toBe(false);
    expect(dhampir.resistances.find((r) => r.type === 'spirit')?.value).toBe(7);
  });

  // batch 033: otherworldly-protection#sanctified-resistance
  it('keeps the sanctified branch, which reads the character own holy/unholy trait', () => {
    // innovation-1: "this resistance applies to unholy damage (if you are sanctified holy) or holy
    // damage (if you are sanctified unholy)". `whenCreatureTrait` is documented (types.ts:507) and
    // read (derive.ts:2720, hasCreatureTrait) as the CHARACTER's own trait, and a sanctified
    // character is exactly who holds it — build.ts:6289 pushes it from the deity's sanctification
    // answer, build.ts:6331-6347 from a Cleric/Champion Dedication option's grantsCreatureTraits,
    // which is the route print names. So no `whenSanctified` field is invented; these two entries
    // survive the whole-field re-emission byte-identical.
    const rs = resistancesOf('otherworldly-protection');
    expect(rs.find((r) => r.type === 'unholy')).toEqual({ type: 'unholy', value: '3+floor(@actor.level/2)', whenCreatureTrait: 'holy' });
    expect(rs.find((r) => r.type === 'holy')).toEqual({ type: 'holy', value: '3+floor(@actor.level/2)', whenCreatureTrait: 'unholy' });

    const unsanctified = deriveDefenses(protectedInventor(), db());
    expect(unsanctified.resistances.some((r) => r.type === 'unholy')).toBe(false);
    const holy: Character = { ...protectedInventor(), chosenCreatureTraits: [{ trait: 'holy', source: 'test deity' }] };
    expect(deriveDefenses(holy, db()).resistances.find((r) => r.type === 'unholy')?.value).toBe(7);
  });
});

describe('curse-of-creeping-ashes cursebound 4 takes all your Speeds, not only the walking one', () => {
  const curse = () => (db() as unknown as { modes: Record<string, ModeDef> }).modes['curse-of-creeping-ashes-4'];

  // batch 033: curse-of-creeping-ashes#speed-penalty
  it('drops a built oracle fly Speed by 10 as well as their land Speed', () => {
    // mystery-20, Cursebound 4: "You take a -10-foot status penalty to all your Speeds as your limbs
    // begin to crumble like ash." The shipped speed modifier carried no `detail`, and modeMatches
    // (src/rules/modes.ts:135) defaults a detail-less speed modifier to 'land' — the mode editor's
    // plain "+10 to Speed" means the Speed you walk at — so print's other four movement types had no
    // carrier. `detail: 'all'` is what modes.ts:135 and the deriveSpeeds movement loop
    // (src/rules/derive.ts:5246) were built to read.
    const mode = curse();
    expect(mode.modifiers.some((m) => m.target === 'attack' && m.value === -2)).toBe(true); // the harness half
    expect(mode.modifiers).toContainEqual({ value: -10, type: 'status', target: 'speed', detail: 'all' });
    expect(modeNumberBonus([mode], { kind: 'speed', detail: 'fly' })).toBe(-10);
    expect(modeNumberBonus([mode], { kind: 'speed', detail: 'land' })).toBe(-10);

    // A BUILT oracle with a fly Speed (granted the way any flight toggle grants one — a mode's
    // `speeds` block, derive.ts:5168) and the SHIPPED cursebound-4 mode active beside it.
    const base = build('oracle', 6);
    const flight: ModeDef = { id: 'test-flight', name: 'Flight', speeds: { fly: 30 }, modifiers: [] };
    const before = deriveSpeeds({ ...base, activeModes: [flight] } as Character, db());
    expect(before.fly).toBe(30); // the harness half: there is a fly Speed to reduce
    const land = before.land ?? 0;
    expect(land).toBeGreaterThan(10);

    const cursed = deriveSpeeds({ ...base, activeModes: [flight, mode] } as Character, db());
    expect(cursed.fly).toBe(20);
    expect(cursed.land).toBe(land - 10);
  });
});
