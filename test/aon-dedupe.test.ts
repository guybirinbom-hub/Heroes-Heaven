import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { listValues, isDuplicateId } from '../src/data';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { emptyBuild } from '../src/rules/build';

const c = content();
const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * An earlier scrape re-added content the app already had under an `aon-` id, so pickers listed many
 * entries twice. Duplicates are HIDDEN FROM LISTS, not deleted — deleting would orphan saved
 * characters (they store raw ids) and would destroy the many `aon-` records that are the ONLY copy
 * of their content.
 */
describe('aon- duplicate suppression', () => {
  it('flags only aon- records that collide with a canonical twin', () => {
    const dupes = c.duplicateIds!;
    expect(dupes.size).toBeGreaterThan(0);
    for (const id of dupes) expect(id.startsWith('aon-'), id).toBe(true);
  });

  it('never hides an aon- record that is the ONLY copy of its content', () => {
    // e.g. 72 animal companions / 37 vehicles / 14 conditions exist solely as `aon-` records.
    for (const [mapName, map] of Object.entries(c) as [string, Record<string, { name?: string }>][]) {
      if (!map || typeof map !== 'object' || map instanceof Set) continue;
      const canonical = new Set<string>();
      for (const [id, rec] of Object.entries(map)) {
        if (rec?.name && !id.startsWith('aon-')) canonical.add(key(rec.name));
      }
      for (const [id, rec] of Object.entries(map)) {
        if (id.startsWith('aon-') && rec?.name && !canonical.has(key(rec.name))) {
          expect(isDuplicateId(c, id), `${mapName}/${id} is the sole copy and must stay visible`).toBe(false);
        }
      }
    }
  });

  it('leaves duplicates RESOLVABLE by id so saved characters do not break', () => {
    for (const id of c.duplicateIds!) {
      const found = c.items[id] ?? c.feats[id] ?? c.spells[id] ?? c.actions[id] ?? c.vehicles?.[id];
      expect(found, `${id} must still resolve`).toBeTruthy();
    }
  });

  it('listValues removes them from the lists the user reads', () => {
    for (const [name, map] of [
      ['items', c.items],
      ['feats', c.feats],
      ['spells', c.spells],
      ['actions', c.actions],
    ] as const) {
      const all = Object.values(map).length;
      const listed = listValues(c, map).length;
      expect(listed, name).toBeLessThan(all);
      expect(listValues(c, map).some((r) => c.duplicateIds!.has((r as { id: string }).id)), name).toBe(false);
    }
  });

  it('no name appears twice in a deduped list (the doubled-rows symptom)', () => {
    for (const [name, map] of [
      ['items', c.items],
      ['feats', c.feats],
      ['spells', c.spells],
    ] as const) {
      const seen = new Map<string, number>();
      for (const r of listValues(c, map) as { name: string }[]) seen.set(key(r.name), (seen.get(key(r.name)) ?? 0) + 1);
      // Some genuine same-name pairs exist (a feat and its archetype variant differ by level/traits),
      // so assert the count DROPPED sharply rather than demanding zero.
      const rawDupes = (() => {
        const m = new Map<string, number>();
        for (const r of Object.values(map) as { name: string }[]) m.set(key(r.name), (m.get(key(r.name)) ?? 0) + 1);
        return [...m.values()].filter((n) => n > 1).length;
      })();
      const nowDupes = [...seen.values()].filter((n) => n > 1).length;
      expect(nowDupes, `${name}: duplicate names should drop`).toBeLessThan(rawDupes);
    }
  });

  it('the feat picker never offers the same feat twice', () => {
    const build = { ...emptyBuild(), level: 20, classId: 'fighter', ancestryId: 'human' };
    const feats = eligibleFeatsForSlot(build, c, { level: 20, category: 'skill', idx: 0 });
    const names = feats.map((f) => key(f.name));
    // No aon- duplicate survives into the offered list.
    expect(feats.some((f) => c.duplicateIds!.has(f.id))).toBe(false);
    expect(names.length).toBe(new Set(names).size);
  });
});
