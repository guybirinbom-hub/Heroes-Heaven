/*
 * BATCH 036 — GATE-RED, group "experience-host-inventor-mods".
 *
 * hyper-boosters was the only line the EXPERIENCE gate printed as "recorded, NOT passed": verdict
 * UNSUPPORTED, reason "no class or subclass grants this feature at level 20". It was an INSTRUMENT
 * misread caused by this same batch — the printed prerequisite *"You must have the speed boosters
 * modification to select this modification"* became a real gate (src/rules/build.ts:2786 +
 * classFeatures/hyper-boosters.requiresModification), so route 4 of the host search
 * (`innovationModificationHost`, test/wg-experience.harness.test.tsx) could no longer seat the record
 * on its own: buildCharacter dropped the pick, `held.includes(id)` was false and the host returned
 * null. The teach seats one satisfying modification in the cheapest tier BELOW the record's own — in
 * `base`, so it is in BOTH builds and the differential still counts only what hyper-boosters adds.
 *
 * Why this file exists at all: scripts/wg-batch-gate.mjs:594 skips UNSUPPORTED records BEFORE every
 * parking check, so an UNSUPPORTED record never reaches `bad` and never fails the gate. The whole
 * delivery of three findings on this record went unjudged while the batch read green. A green run
 * would not have noticed the teach being deleted either — hence the mutation-proof half below.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const harness = readFileSync(join(CLI_ROOT, 'test/wg-experience.harness.test.tsx'), 'utf8');
/** Route 4's body, bracketed by the route that follows it — the same slicing the batch-035 tests use. */
const route4 = harness.slice(harness.indexOf('function innovationModificationHost'), harness.indexOf('function featChoiceHost'));

/** The armour-innovation inventor the host builds, with whatever modifications are named. */
const inventor = (mods: Record<string, string>) =>
  build('inventor', 20, {
    subclassId: 'armor-innovation',
    inventorArmorStats: 'power-suit',
    inventorModifications: mods,
  } as Partial<BuildState>);
const held = (mods: Record<string, string>) => Object.values(inventor(mods).inventor?.modifications ?? {});

describe('batch 036 red-experience-host-inventor-mods — hyper-boosters is hostable again once its prerequisite is seated', () => {
  // batch 036: hyper-boosters#prerequisite
  it('hyper-boosters needs speed-boosters in a lower tier before a built inventor holds it at all', () => {
    /* Print (innovation-5, Hyper Boosters): *"You must have the speed boosters modification to select
     * this modification."* This is the exact check route 4 performs (`held.includes(id)`), run on the
     * two builds the host makes with and without the seat. */
    const rec = content().classFeatures['hyper-boosters'];
    expect(rec.requiresModification).toEqual(['speed-boosters']);
    // STUNTED — the seat removed, i.e. the build route 4 made before this batch's teach.
    expect(held({ breakthrough: 'hyper-boosters' })).not.toContain('hyper-boosters');
    // SHIPPED — the seat in place.
    expect(held({ initial: 'speed-boosters', breakthrough: 'hyper-boosters' })).toContain('hyper-boosters');
  });

  // batch 036: hyper-boosters#prerequisite
  it('the seat that makes hyper-boosters hostable is still in route 4, and lands in BOTH builds', () => {
    // mutation-proof — settle key: harness route 4 `innovationModificationHost` / seededModifications.
    /*
     * Delete the seat and NOTHING else in the suite fails: the record simply reads UNSUPPORTED again
     * and the gate records that without failing (wg-batch-gate.mjs:594 `continue`s past UNSUPPORTED
     * before any parking check). So the teach is guarded from the side that has no other guard —
     * the route body itself, sliced, plus the fall-through reason it would land on.
     */
    expect(route4).toContain('requiresModification');
    expect(route4).toContain('seededModifications');
    // The seat goes into `base`, which withoutBuild IS — not into withBuild alone.
    expect(route4).toContain('inventorModifications: seededModifications');
    expect(route4).toContain('{ ...seededModifications, [tier]: id }');
    // …and null from route 4 is exactly the reason the gate printed.
    expect(harness).toContain("reason: 'no class or subclass grants this feature at level 20'");
  });

  // batch 036: hyper-boosters#prerequisite
  it("seating speed-boosters in BOTH builds keeps hyper-boosters' differential to its own +5", () => {
    /* Print, innovation-1 Speed Boosters: *"You gain a +5-foot status bonus to your Speed"* (the +10 in
     * that entry is its Overdrive step, not its base) — ours stores hyper-boosters as the
     * +5 DELTA over speed-boosters (effect-backfill's own why-text), so a "without" build that lacked
     * the seat would credit hyper-boosters with speed-boosters' 5 feet too. */
    const db = content();
    const speed = (mods: Record<string, string>) => deriveSpeeds(inventor(mods), db).land;
    const withoutSeatOnly = speed({});
    const seatedWithout = speed({ initial: 'speed-boosters' });
    const seatedWith = speed({ initial: 'speed-boosters', breakthrough: 'hyper-boosters' });
    expect(seatedWithout - withoutSeatOnly).toBe(5); // speed-boosters' own half, present in both builds
    expect(seatedWith - seatedWithout).toBe(5); // …so only hyper-boosters' delta is attributed to it
  });

  // batch 036: hyper-boosters#prerequisite
  it('the hyper-boosters seat walks the whole requirement CHAIN — one link is not enough (verifier)', () => {
    // mutation-proof — settle key: harness route 4 `innovationModificationHost` / seededModifications.
    /*
     * FIXED-BY-ME. hyper-boosters needs one link (speed-boosters), so a one-link seat passed every
     * check above — but print stacks prerequisites, and the rows that carry them are landing this same
     * batch (work/.b036-rows-red-inventor-modification-rows.json). AoN innovation-2, verbatim: Miracle
     * Gears *"You must have the marvelous gears modification to select this modification."* and
     * Marvelous Gears *"You must have the wonder gears mod[ification]"*. Seat only marvelous-gears and
     * the seat is ITSELF refused by validPick, `held` misses miracle-gears and route 4 returns null —
     * a silent UNSUPPORTED, which wg-batch-gate.mjs:594 skips before every parking check.
     *
     * MEASURED, not assumed: with only marvelous-gears seated, miracle-gears is still HELD today —
     * validPick (build.ts:8513) judges the prerequisite against the RAW picks, so a pick that is itself
     * refused still satisfies the record above it (marvelous-gears is dropped, miracle-gears stands).
     * That is a real engine defect, reported as a CROSS-FILE GAP; it is also the only reason a one-link
     * seat happens to survive. The walk does not depend on it: it seats a build that is legal all the
     * way down, so route 4 keeps working when that gap is closed.
     *
     * The rows are not applied yet, so the executed half patches the two `requiresModification` fields
     * into a CONTENT COPY, never the shared cache.
     */
    const db = content();
    const patch = (id: string, requires: string[]) => ({ ...(db.classFeatures[id] as object), requiresModification: requires });
    const patched = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'miracle-gears': patch('miracle-gears', ['marvelous-gears']),
        'marvelous-gears': patch('marvelous-gears', ['wonder-gears']),
      },
    } as unknown as ContentDatabase;
    const cls = patched.classes.inventor;
    const constructInventor = (mods: Record<string, string>) =>
      Object.values(
        buildCharacter(
          {
            ...emptyBuild(),
            name: 't',
            level: 20,
            classId: 'inventor',
            ancestryId: Object.keys(patched.ancestries)[0],
            backgroundId: Object.keys(patched.backgrounds)[0],
            keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
            subclassId: 'construct-innovation',
            inventorModifications: mods,
          },
          patched,
        ).inventor?.modifications ?? {},
      );
    // STUNTED — a one-link seat: the seat ITSELF is refused, so the host would measure the record on a
    // build the player could not make (and, once validPick stops reading raw picks, on none at all).
    expect(constructInventor({ breakthrough: 'marvelous-gears', revolutionary: 'miracle-gears' })).not.toContain('marvelous-gears');
    // SHIPPED — the whole chain seated, each link a strictly cheaper tier than the last, all three held.
    expect(constructInventor({ initial: 'wonder-gears', breakthrough: 'marvelous-gears', revolutionary: 'miracle-gears' })).toEqual(
      expect.arrayContaining(['wonder-gears', 'marvelous-gears', 'miracle-gears']),
    );
    // …and route 4 walks it rather than seating one link and stopping.
    expect(route4).toContain('while (need?.requiresModification?.length)');
    expect(route4).toContain('ceiling = seat.tier');
  });
});
