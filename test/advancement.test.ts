import { describe, it, expect } from 'vitest';
import { build, content, prof } from './_content';
import { CLASS_ADVANCEMENT, advancementRows } from '../src/rules/advancement';
import { explainStat } from '../src/rules/explain';
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

/*
 * Subclass advancement tables come in two shapes and the key spells out which:
 *   `<subclassId>`           REPLACES the class table  (warpriest, battle-creed)
 *   `<classId>-<subclassId>` SUPPLEMENTS the class table (necromancer-reaper)
 *
 * Choosing wrong is silent. The Reaper's two rows (martial expert@11, medium expert@13) were filed
 * under a bare `reaper` key, which replaced the whole necromancer table — so a level-3 reaper had no
 * Will expert, a level-7 one no expert spellcasting, and nothing anywhere said so. These tests fail
 * on the SHAPE of that mistake rather than on the one instance of it.
 */
describe('CLASS_ADVANCEMENT key convention', () => {
  const db = content();
  const classIds = new Set(Object.keys(db.classes));
  const subclassOwners = new Map<string, string[]>();
  for (const [classId, cls] of Object.entries(db.classes))
    for (const o of cls.subclass?.options ?? [])
      subclassOwners.set(o.id as string, [...(subclassOwners.get(o.id as string) ?? []), classId]);

  const tracksOf = (key: string) => new Set(CLASS_ADVANCEMENT[key].map((e) => e.track));
  // A key is a supplement when it splits into a real class id and one of THAT class's subclass ids.
  const supplementParent = (key: string) => {
    for (let i = key.indexOf('-'); i > 0; i = key.indexOf('-', i + 1)) {
      const [classId, subclassId] = [key.slice(0, i), key.slice(i + 1)];
      if (classIds.has(classId) && (subclassOwners.get(subclassId) ?? []).includes(classId)) return classId;
    }
    return null;
  };

  it('every key is a class id, a subclass id, or <classId>-<subclassId>', () => {
    // An orphan key is a typo: it is never looked up, so its rows silently never apply.
    const orphans = Object.keys(CLASS_ADVANCEMENT).filter(
      (k) => !classIds.has(k) && !subclassOwners.has(k) && !supplementParent(k),
    );
    expect(orphans, 'keys matching no class, subclass or class-subclass pair').toEqual([]);
  });

  it('no subclass id collides with a class id', () => {
    // Such a subclass would pick up the unrelated class's table through the bare-key lookup.
    const collisions = [...subclassOwners.keys()].filter((s) => classIds.has(s));
    expect(collisions).toEqual([]);
  });

  it('a bare subclass key is a COMPLETE table, never a partial one', () => {
    for (const key of Object.keys(CLASS_ADVANCEMENT)) {
      const owners = subclassOwners.get(key);
      if (classIds.has(key) || !owners) continue; // class table or supplement key — not this rule
      for (const classId of owners) {
        if (!CLASS_ADVANCEMENT[classId]) continue;
        // It may re-rank or deliberately cap a track (battle-creed caps casting at expert), but it
        // must still SPEAK to every track the class advances — silence there means "dropped".
        const dropped = [...tracksOf(classId)].filter((t) => !tracksOf(key).has(t));
        expect(
          dropped,
          `CLASS_ADVANCEMENT['${key}'] replaces the whole '${classId}' table but never advances ${dropped.join(', ')}. ` +
            `If these are extra rows rather than a full doctrine ladder, key them '${classId}-${key}' so they SUPPLEMENT it.`,
        ).toEqual([]);
      }
    }
  });

  it('a supplement key only ever adds rows to its class table', () => {
    for (const key of Object.keys(CLASS_ADVANCEMENT)) {
      const classId = supplementParent(key);
      if (!classId || classIds.has(key) || subclassOwners.has(key)) continue;
      const subclassId = key.slice(classId.length + 1);
      const merged = advancementRows(classId, subclassId);
      for (const e of CLASS_ADVANCEMENT[classId]) expect(merged, `${key} must keep every ${classId} row`).toContain(e);
      for (const e of CLASS_ADVANCEMENT[key]) expect(merged, `${key} must add its own rows`).toContain(e);
    }
  });
});

describe('Reaper necromancer keeps the whole necromancer ladder', () => {
  const db = content();
  const at = (level: number) => build('necromancer', level, { subclassId: 'reaper' });

  // Every base necromancer milestone, which a bare `reaper` key deleted outright.
  it.each([
    [3, 'will', 'expert'],
    [5, 'reflex', 'expert'],
    [7, 'spellcasting', 'expert'],
    [7, 'perception', 'expert'],
    [11, 'fortitude', 'master'],
    [11, 'unarmed', 'expert'],
    [11, 'simple', 'expert'],
    [13, 'unarmored', 'expert'],
    [13, 'light', 'expert'],
    [15, 'spellcasting', 'master'],
    [17, 'fortitude', 'legendary'],
    [19, 'spellcasting', 'legendary'],
  ])('L%i: %s is %s', (level, track, rank) => {
    expect(prof(at(level as number), track as string)).toBe(rank);
  });

  it("adds Reaper's Edge on top: martial expert@11, medium expert@13", () => {
    expect(prof(at(10), 'martial')).toBe('trained');
    expect(prof(at(11), 'martial')).toBe('expert');
    expect(prof(at(12), 'medium')).toBe('trained');
    expect(prof(at(13), 'medium')).toBe('expert');
    // …and the other subclass, which has no table of its own, gets neither.
    expect(prof(build('necromancer', 13, { subclassId: 'puppeteer' }), 'martial')).toBe('untrained');
    expect(prof(build('necromancer', 13, { subclassId: 'puppeteer' }), 'medium')).toBe('untrained');
  });

  it('the AC breakdown explains where expert medium armour came from', () => {
    // explain.ts had its own copy of the table lookup that ignored supplement keys, so the AC total
    // said expert while the "why" panel under it was blank.
    const c = build('necromancer', 13, {
      subclassId: 'reaper',
      inventory: [{ itemId: 'breastplate', quantity: 1, worn: true }],
    } as never);
    const ac = explainStat(c, db, { kind: 'ac' });
    expect(ac.rank).toBe('expert');
    expect(ac.timeline?.map((t) => `${t.level}:${t.rank}`)).toContain('13:expert');
  });
});
