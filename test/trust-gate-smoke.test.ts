import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { classFeatureIdsOwned, deriveAc, deriveClassDc, deriveMaxHp, derivePerception, deriveSave } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * THE TRUST GATE, SMOKE-TESTED ON REAL CHARACTERS — docs/trust-gate.md §5.
 *
 * The gate deletes field paths out of the content database at load. Two things can go wrong with that
 * and neither is visible from a unit test of the gate itself:
 *
 *   · A THROW. A reader that indexes a field the gate removed dies inside `buildCharacter` — and
 *     `src/data/rebuild.ts:24-27` CATCHES it and keeps the stale derived sheet, so in the app the
 *     symptom is "my numbers stopped changing", days after the cause. That is why these builds call
 *     `buildCharacter` directly: the swallow is the app's safety net and would hide the defect here.
 *   · A CHASSIS OMISSION or a POLARITY MISTAKE. Classes, ancestries and backgrounds are all-on by
 *     construction (§2 step 3), so a gated character's HP, AC, saves, Perception, class DC and
 *     class-feature count must be EXACTLY the ungated ones. If the gate ever reached a chassis
 *     bucket, or ran with its condition inverted, these six numbers move on every character at once.
 *
 * Six classes because the subsystems that read the most content are the ones a stripped field is
 * most likely to break: a prepared caster, a martial with no subclass at all, a companion class, the
 * kineticist's elements, the alchemist's formulas, the summoner's eidolon. Three levels because a
 * level-12 build owns four times the class features a level-1 build does.
 */

const UNGATED = content();
const GATED = content({ trustGate: true });

/** The fixture build, exactly as test/batch03N-engine.test.ts shape it, but on a GIVEN database —
 *  both sides must be built by the same function or the comparison proves nothing about the gate. */
function mk(db: ContentDatabase, classId: string, level: number): Character {
  const cls = db.classes[classId];
  return buildCharacter({
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    // Mirror the app (changeClass): a fixed key only when the class has exactly one.
    keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
    subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
  }, db);
}

/** The six numbers that are chassis, and therefore identical on both sides. */
const chassis = (c: Character, db: ContentDatabase) => ({
  hp: deriveMaxHp(c, db),
  ac: deriveAc(c, db).value,
  fortitude: deriveSave(c, 'fortitude', db).modifier,
  reflex: deriveSave(c, 'reflex', db).modifier,
  will: deriveSave(c, 'will', db).modifier,
  perception: derivePerception(c, db).modifier,
  classDc: deriveClassDc(c).dc,
  classFeatures: classFeatureIdsOwned(c, db).size,
});

const SIX: [string, string][] = [
  ['wizard', 'a prepared caster'],
  ['fighter', 'a martial with no subclass'],
  ['druid', 'a companion class (animal order)'],
  ['kineticist', 'the elements'],
  ['alchemist', 'the formula book'],
  ['summoner', 'an eidolon'],
];

describe('trust gate — six characters still build, with the chassis untouched', () => {
  for (const [classId, why] of SIX) {
    for (const level of [1, 5, 12]) {
      it(`${classId} ${why} at level ${level}`, () => {
        let gated!: Character;
        expect(() => { gated = mk(GATED, classId, level); }, `a gated ${classId} must build without throwing`).not.toThrow();
        expect(chassis(gated, GATED), `${classId} lv${level}: the chassis is all-on, so nothing here may move`)
          .toEqual(chassis(mk(UNGATED, classId, level), UNGATED));
      });
    }
  }
});

describe('trust gate — the gate is actually on in this harness', () => {
  /*
   * Without this the whole file passes vacuously the day `content({ trustGate: true })` stops gating —
   * every assertion above is "the gated build equals the ungated build", which is trivially true when
   * nothing was gated. So: take a record the tracked ledger says is off, and prove the field is gone
   * from the gated database and still there in the ungated one.
   *
   * A dotless path, because a nested one (`choice.options[].grant.skills`) needs the walk the gate
   * itself owns, and this check exists to be independent of it.
   */
  it('a ledger path is missing from the gated database and present in the ungated one', () => {
    const ledger = JSON.parse(readFileSync('src/data/trust-ledger.json', 'utf8')) as { records: Record<string, string[]> };
    const cases = Object.entries(ledger.records)
      .flatMap(([key, paths]) => paths.filter((p) => !p.includes('.') && !p.includes('[')).map((p) => [key, p] as const))
      .filter(([key]) => {
        const [bucket, id] = key.split('/');
        return !!(UNGATED as unknown as Record<string, Record<string, unknown>>)[bucket]?.[id];
      });
    expect(cases.length, 'the ledger must name at least one plain field path').toBeGreaterThan(0);
    const rec = (db: ContentDatabase, key: string) => {
      const [bucket, id] = key.split('/');
      return (db as unknown as Record<string, Record<string, Record<string, unknown>>>)[bucket][id];
    };
    const stillOn = cases.filter(([key, path]) => rec(GATED, key)[path] !== undefined);
    expect(stillOn.slice(0, 5), `${stillOn.length} of ${cases.length} ledger paths are still live in the gated database`).toEqual([]);
    // …and the ungated side is untouched: the gate copies, it never mutates the source (§3).
    const [key, path] = cases[0];
    expect(rec(UNGATED, key)[path], `${key}.${path} must survive in the UNGATED database`).not.toBeUndefined();
  });
});
