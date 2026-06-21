import { describe, it, expect } from 'vitest';
import { build, content, prof } from './_content';
import { CLASS_ADVANCEMENT } from '../src/rules/advancement';
import { PROFICIENCY_RANKS } from '../src/rules/types';

// Dedicated coverage for the level-1..20 proficiency engine (advancement.ts) — previously the most
// bug-prone, least-tested file (missing bard Will / magus Reflex bumps shipped green). This drives
// buildCharacter parametrically and asserts every declared milestone is actually reached.
const rankIdx = (r: string | undefined) => (r ? PROFICIENCY_RANKS.indexOf(r) : -1);

describe('CLASS_ADVANCEMENT engine', () => {
  const db = content();
  // Real, buildable classes that have an advancement table (subclass-keyed tables are exercised elsewhere).
  const classes = Object.keys(db.classes).filter((id) => CLASS_ADVANCEMENT[id]);

  it('covers (at least) all 27 base classes', () => {
    expect(classes.length).toBeGreaterThanOrEqual(27);
  });

  for (const classId of classes) {
    it(`${classId}: every advancement milestone is reached by its level`, () => {
      // Use a subclass that does NOT override the advancement table (e.g. cleric → cloistered-cleric,
      // not battle-creed), so the base class table under test is the one actually applied.
      const sub = (db.classes[classId].subclass?.options ?? []).map((o) => o.id as string).find((id) => !CLASS_ADVANCEMENT[id]) ?? null;
      // Build once at 20 (all milestones apply) and once at each milestone's own level.
      const top = build(classId, 20, { subclassId: sub });
      for (const e of CLASS_ADVANCEMENT[classId]) {
        const at20 = prof(top, e.track);
        // Spellcasting milestones only apply if the class actually has a non-focus caster entry;
        // weapon-group milestones only if the group proficiency exists. Skip if genuinely absent.
        if (at20 === undefined) {
          if (e.track === 'spellcasting' && !top.spellcasting.some((s) => s.type !== 'focus')) continue;
          if (['bomb', 'firearm', 'crossbow'].includes(e.track)) continue;
          throw new Error(`${classId}: track '${e.track}' has no value on the built character`);
        }
        expect(rankIdx(at20)).toBeGreaterThanOrEqual(rankIdx(e.rank));
        // And the milestone is present exactly at its stated level (not earlier-missing/later).
        const atLevel = prof(build(classId, e.level, { subclassId: sub }), e.track);
        expect(rankIdx(atLevel)).toBeGreaterThanOrEqual(rankIdx(e.rank));
      }
    });
  }

  it('milestone levels and ranks are well-formed (1..20, valid rank)', () => {
    for (const [classId, table] of Object.entries(CLASS_ADVANCEMENT)) {
      for (const e of table) {
        expect(e.level, `${classId}`).toBeGreaterThanOrEqual(1);
        expect(e.level, `${classId}`).toBeLessThanOrEqual(20);
        expect(PROFICIENCY_RANKS, `${classId}:${e.track}`).toContain(e.rank);
      }
    }
  });
});
