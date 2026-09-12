import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * DESK #154 — the panache Speed bonus reaches EVERY Speed, is typed `status`, and scales.
 *
 * Owner, 2026-09-12: *"while panache is on, EVERY Speed gets the +10 status bonus in place of the +5;
 * back to +5 when panache ends."* Three records print one bonus:
 *
 *   classFeatures/stylish-combatant (class-feature-1007) — *"While you have panache, you gain a
 *     +5-foot status bonus to your Speeds."*
 *   classFeatures/vivacious-speed (class-feature-1017) — *"Increase the status bonus to your Speeds
 *     from stylish combatant to a +10-foot status bonus; this bonus increases by 5 feet at 7th, 11th,
 *     15th, and 19th levels. When you don't have panache, you still get half this status bonus to your
 *     Speed, rounded down to the nearest 5-foot increment."*
 *   feats/swashbucklers-speed (feat-6238) — *"a +5-foot status bonus to your Speeds; this increases to
 *     a +10-foot status bonus while you have panache."*
 *
 * The DATA is a spec the driver applies (work/.d154-rows-panache-speed.json), so every case below
 * applies that file's own rows to an in-memory copy of the database rather than asserting against the
 * shipped records. Applying a row writes the whole field, so this stays true the day the rows land —
 * the patched copy is then byte-identical to the shipped one — which is the patched-vs-shipped trap
 * batch 037's verifier found in the sibling speed test.
 *
 * The LADDER is written out as literal feet, not derived from the rows: what is being pinned is that
 * the spec plus the engine produce the printed numbers, and a table computed from the same formula the
 * row carries would agree with any formula at all.
 */
const db = content();
const SPEC = 'work/.d154-rows-panache-speed.json';

type Row = { category: string; id: string; field: string; value: unknown };
const specRows = (): Row[] =>
  (JSON.parse(readFileSync(SPEC, 'utf8')) as { findings: { backfillRows: Row[] }[] }).findings.flatMap((f) => f.backfillRows);

/** The database with the spec's rows applied — what the sheet looks like once the driver runs. */
const applied = (extra: Row[] = []): ContentDatabase => {
  const next = { ...db } as unknown as Record<string, Record<string, Record<string, unknown>>>;
  for (const r of [...specRows(), ...extra]) {
    next[r.category] = { ...next[r.category], [r.id]: { ...next[r.category][r.id], [r.field]: r.value } };
  }
  return next as unknown as ContentDatabase;
};

/** …and the same copy with one record's `whileActive` removed, which is the shape being corrected. */
const without = (dbIn: ContentDatabase, ids: [string, string][]): ContentDatabase => {
  const next = { ...dbIn } as unknown as Record<string, Record<string, Record<string, unknown>>>;
  for (const [category, id] of ids) {
    const { whileActive: _dropped, ...rest } = next[category][id];
    next[category] = { ...next[category], [id]: rest };
  }
  return next as unknown as ContentDatabase;
};

/**
 * A human (land 25) who also has a fly Speed, with the panache toggle in a stated position.
 * `chosenEffects.speeds` is the route deriveSpeeds already reads a granted non-land Speed through, and
 * `classResources.panache` is the toggle the Panache card on the vitals rail writes.
 */
const flyer = (
  classId: string,
  level: number,
  states: Record<string, number>,
  featIds: string[] = [],
): Character => {
  const base = build(classId, level, { ancestryId: 'human' } as Partial<BuildState>);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `d154:${i}` }))],
    chosenEffects: { ...(base.chosenEffects ?? {}), speeds: { fly: 25 } },
    classResources: { ...(base.classResources ?? {}), ...states },
  } as unknown as Character;
};
const OFF = { panache: 0 };
const ON = { panache: 1 };
const feet = (c: Character, d: ContentDatabase) => {
  const s = deriveSpeeds(c, d);
  return [s.land, s.fly];
};

describe('desk 154 — a class swashbuckler with panache', () => {
  // desk 154: panache-speed
  it('pays the printed ladder on land AND on a fly Speed, and drops back when panache ends', () => {
    /* Without panache the app is unchanged: Vivacious Speed's halved half, land only, from 3rd. With
     * panache the full bonus reaches both Speeds — and it REPLACES the halved one on land rather than
     * adding to it (35, not 40, at 3rd), because print gives one status bonus, not two. */
    const d = applied();
    const at = (level: number, states: Record<string, number>) => feet(flyer('swashbuckler', level, states), d);

    expect(at(1, OFF), 'L1 without panache — stylish combatant is panache-only').toEqual([25, 25]);
    expect(at(1, ON), 'L1 with panache — +5 status to every Speed').toEqual([30, 30]);

    expect(at(3, OFF), "L3 without panache — Vivacious Speed's halved half, land only").toEqual([30, 25]);
    expect(at(3, ON), 'L3 with panache — +10 status, replacing the +5 on land').toEqual([35, 35]);

    expect(at(7, OFF), 'L7 without panache — the halved half is still 5 ft').toEqual([30, 25]);
    expect(at(7, ON), 'L7 with panache — the ladder steps to +15').toEqual([40, 40]);

    expect(at(8, OFF), 'L8 without panache').toEqual([30, 25]);
    expect(at(8, ON), 'L8 with panache — no step until 11th').toEqual([40, 40]);
  });

  // desk 154: panache-speed
  it('the with-panache half is the NEW thing — stripped, every number falls back to today', () => {
    /* The shape being corrected, measured before this lane: panache moved nothing at any level and no
     * fly Speed ever moved. This case is what makes the one above an assertion about the clause rather
     * than about a human's Speed. */
    const bare = without(applied(), [
      ['classFeatures', 'stylish-combatant'],
      ['classFeatures', 'vivacious-speed'],
    ]);
    for (const level of [1, 3, 7, 8]) {
      expect(feet(flyer('swashbuckler', level, ON), bare), `L${level} with panache, clause stripped`).toEqual(
        feet(flyer('swashbuckler', level, OFF), bare),
      );
    }
    expect(feet(flyer('swashbuckler', 7, ON), bare), 'and it is the pre-desk-154 reading').toEqual([30, 25]);
  });

  // desk 154: panache-speed
  it('the halved half stays LAND-ONLY, which is the reading this desk chose', () => {
    /* class-feature-1017 says "half this status bonus to your Speed" — singular, where both of its
     * other clauses say "Speeds". The owner's note allows the plural only if it is the only honest
     * reading; it is not, so the shipped land-only carrier is left alone. If someone later adds
     * `speedBonusAllSpeeds` to that standing formula, this goes red and the choice gets re-made
     * deliberately instead of by accident. */
    expect(db.classFeatures['vivacious-speed']?.speedBonusAllSpeeds).toBeUndefined();
    expect(feet(flyer('swashbuckler', 19, OFF), applied()), 'L19 without panache: +15 on land, nothing on fly').toEqual([40, 25]);
  });
});

describe('desk 154 — the archetype feat, and the limits of the lane', () => {
  // desk 154: panache-speed
  it("Swashbuckler's Speed on a non-swashbuckler: 30/30 without panache, 35/35 with", () => {
    /* feat-6238 prints no scaling, so the with-panache value is a flat +10 — and the same `status` type
     * as its own +5, so the fighter gains 5 more feet on toggling, not 10 more. */
    const d = applied();
    const fighter = (states: Record<string, number>) =>
      feet(flyer('fighter', 8, states, ['swashbuckler-dedication', 'swashbucklers-speed']), d);
    expect(fighter(OFF), 'the always-on +5 batch 037 authored').toEqual([30, 30]);
    expect(fighter(ON), 'the +10 replaces it').toEqual([35, 35]);
  });

  // desk 154: panache-speed
  it('a state gate is a STATE gate — a raging barbarian gets nothing, and neither does panache elsewhere', () => {
    /* Two ways the clause could leak: onto a character who owns no panache record, and off the wrong
     * toggle. `activeStateGrants` asks `classResources[state] > 0` for the clause's own state, so a
     * swashbuckler whose rage is on and whose panache is off must read the without-panache numbers. */
    const d = applied();
    expect(feet(flyer('barbarian', 8, ON), d), 'a barbarian owns none of the three records').toEqual(
      feet(flyer('barbarian', 8, OFF), d),
    );
    expect(feet(flyer('swashbuckler', 7, { panache: 0, rage: 1 }), d), 'rage is not panache').toEqual([30, 25]);
  });

  // desk 154: panache-speed
  it('two status bonuses to Speed still take the HIGHEST — the panache one does not stack', () => {
    /* Scout's Speed (feat-6398) prints "+10-foot status bonus to your Speed" — land only, and typed
     * STATUS, which is what makes this case status-vs-status rather than two different types stacking
     * (adversarially confirmed: feats/scouts-speed carries speedBonusType "status" and no
     * speedBonusAllSpeeds). At 7th a swashbuckler's panache bonus is +15, so print gives 40 feet of land Speed, not
     * the 50 an untyped sum would. The fly Speed takes only the plural carrier's 15. */
    const d = applied();
    expect(feet(flyer('swashbuckler', 7, ON, ['scouts-speed']), d)).toEqual([40, 40]);
    expect(feet(flyer('swashbuckler', 3, ON, ['scouts-speed']), d), 'equal bonuses are still one bonus').toEqual([35, 35]);
  });
});

describe('desk 154 — the lane is reachable by the trust gate', () => {
  // desk 154: panache-speed
  it('the whole clause is ONE strippable field, and it is in the strippable universe', () => {
    /* This lane is field-driven, not an id-keyed engine lane: nothing in src/rules names these three
     * record ids, so it is gated by the DATA gate (`whileActive`, kinds ["conditional"], already listed
     * in scripts/data/trust-fields.json) rather than by engineLaneOff(). Adding it to
     * scripts/data/trust-lanes.json would make scripts/trust-lanes-check.mjs go red on a stale entry —
     * that guard dies on an id nobody reads as a lane key. So the gate's promise here is: strip the one
     * field and the lane applies NOTHING. */
    const universe = JSON.parse(readFileSync('scripts/data/trust-fields.json', 'utf8')) as { paths?: { path: string }[] };
    const paths = new Set((universe.paths ?? []).map((p) => p.path));
    expect(paths.has('whileActive'), 'the container the gate strips').toBe(true);

    const d = applied();
    const dark = without(d, [
      ['classFeatures', 'stylish-combatant'],
      ['classFeatures', 'vivacious-speed'],
      ['feats', 'swashbucklers-speed'],
    ]);
    expect(feet(flyer('swashbuckler', 8, ON), dark), 'class half goes quiet').toEqual([30, 25]);
    expect(
      feet(flyer('fighter', 8, ON, ['swashbuckler-dedication', 'swashbucklers-speed']), dark),
      'archetype half goes quiet, keeping its own always-on +5 (a separate field, separately gated)',
    ).toEqual([30, 30]);
  });
});
