import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { listValues, isDuplicateId, NEAR_DUPLICATE_IDS } from '../src/data';
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
  it('hides only an aon- collision or a grade-spelling twin — never anything else', () => {
    const dupes = c.duplicateIds!;
    expect(dupes.size).toBeGreaterThan(0);
    // A third mechanism joined the two aon- ones: "Greater Nail Bomb" and "Nail Bomb (Greater)" are
    // the same item under two spellings, so neither the exact-name rule nor the curated near-miss
    // list saw them and the shop listed 180 pairs twice. Those hidden ids are NOT aon-prefixed, so
    // the old blanket assertion is replaced by the guarantee that actually matters: an id is only
    // ever hidden when a visible record of the same thing exists to take its place.
    const GRADES = ['lesser', 'moderate', 'greater', 'major', 'minor', 'true', 'supreme'];
    // Indexed once — a scan per hidden id is 180 x 7,500 comparisons and times the test out.
    const visibleByName = new Map<string, string>();
    for (const [tid, t] of Object.entries(c.items)) {
      if (!dupes.has(tid) && t?.name) visibleByName.set(key(t.name), tid);
    }
    for (const id of dupes) {
      if (id.startsWith('aon-')) continue;
      const rec = c.items[id];
      expect(rec, `${id} hidden but not an item`).toBeTruthy();
      expect(GRADES.some((g) => rec.name.toLowerCase().startsWith(`${g} `)), `${id} is a "Grade Name" spelling`).toBe(true);
      // …and its "Name (Grade)" twin is visible. "Greater Nail Bomb" -> "Nail Bomb (Greater)".
      const twinName = rec.name.replace(/^(\w+)\s+(.*)$/, '$2 ($1)');
      expect(visibleByName.get(key(twinName)), `${id} has a visible twin`).toBeTruthy();
    }
  });

  it('never hides an aon- record that is the ONLY copy of its content', () => {
    // e.g. 72 animal companions / 37 vehicles / 14 conditions exist solely as `aon-` records.
    // NEAR_DUPLICATE_IDS is exempt: their twin's NAME is spelled differently, so an exact-name test
    // cannot see it. The next assertion is what keeps that exemption from being a blank cheque.
    for (const [mapName, map] of Object.entries(c) as [string, Record<string, { name?: string }>][]) {
      if (!map || typeof map !== 'object' || map instanceof Set) continue;
      const canonical = new Set<string>();
      for (const [id, rec] of Object.entries(map)) {
        if (rec?.name && !id.startsWith('aon-')) canonical.add(key(rec.name));
      }
      for (const [id, rec] of Object.entries(map)) {
        if (id.startsWith('aon-') && rec?.name && !canonical.has(key(rec.name)) && !NEAR_DUPLICATE_IDS.has(id)) {
          expect(isDuplicateId(c, id), `${mapName}/${id} is the sole copy and must stay visible`).toBe(false);
        }
      }
    }
  });

  it('every curated near-duplicate really does have a near twin', () => {
    const ed = (a: string, b: string): number => {
      if (Math.abs(a.length - b.length) > 2) return 9;
      let prev = [...Array(b.length + 1).keys()];
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
      return prev[b.length];
    };
    for (const id of NEAR_DUPLICATE_IDS) {
      let twin: string | undefined;
      for (const map of Object.values(c) as Record<string, { name?: string }>[]) {
        if (!map || typeof map !== 'object' || map instanceof Set || !map[id]?.name) continue;
        const mine = key(map[id].name!);
        for (const [cid, rec] of Object.entries(map)) {
          if (cid.startsWith('aon-') || !rec?.name) continue;
          if (ed(mine, key(rec.name)) > 0 && ed(mine, key(rec.name)) <= 2) twin = cid;
        }
      }
      expect(twin, `${id} is hidden but has no near twin — it may be the only copy of its content`).toBeTruthy();
    }
  });

  it('leaves duplicates RESOLVABLE by id so saved characters do not break', () => {
    for (const id of c.duplicateIds!) {
      const found =
        c.items[id] ?? c.feats[id] ?? c.spells[id] ?? c.actions[id] ?? c.vehicles?.[id] ?? c.backgrounds[id] ?? c.heritages[id] ?? c.deities?.[id];
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
