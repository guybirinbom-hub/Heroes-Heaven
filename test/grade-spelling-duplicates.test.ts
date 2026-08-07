import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { findDuplicateIds } from '../src/data';

/**
 * "Greater Nail Bomb" and "Nail Bomb (Greater)" are the same item under two spellings.
 *
 * Neither the exact-name dedupe nor the curated near-miss list caught them, because the names are
 * genuinely different strings — so the shop listed 180 item pairs twice, and a player searching "nail
 * bomb" got eight rows for four items. They are two importer generations of the same record: the
 * "Grade Name" half is the older scrape whose description still carries the AoN page furniture and
 * covers every grade at once.
 */
const c = () => content();

describe('grade-spelling duplicates', () => {
  it('hides the "Grade Name" spelling and keeps "Name (Grade)"', () => {
    const hidden = findDuplicateIds(c());
    for (const [scrape, clean] of [
      ['greater-nail-bomb', 'nail-bomb-greater'],
      ['major-aetheric-irritant', 'aetheric-irritant-major'],
      ['greater-pickled-demon-tongue', 'pickled-demon-tongue-greater'],
      ['lesser-defoliation-bomb', 'defoliation-bomb-lesser'],
    ]) {
      expect(c().items[scrape], scrape).toBeTruthy();
      expect(hidden.has(scrape), `${scrape} hidden`).toBe(true);
      expect(hidden.has(clean), `${clean} visible`).toBe(false);
    }
  });

  it('leaves no pair where both spellings are visible', () => {
    const db = c();
    const hidden = findDuplicateIds(db);
    const GRADES = ['lesser', 'moderate', 'greater', 'major', 'minor', 'true', 'supreme'];
    const key = (name: string) => {
      let s = name.toLowerCase().replace(/['’]/g, '').trim();
      let grade: string | null = null;
      const paren = /\s*\(([^)]+)\)\s*$/.exec(s);
      if (paren && GRADES.includes(paren[1].trim())) {
        grade = paren[1].trim();
        s = s.slice(0, paren.index);
      } else {
        const first = /^([a-z]+)\s+/.exec(s);
        if (first && GRADES.includes(first[1])) {
          grade = first[1];
          s = s.slice(first[0].length);
        }
      }
      return grade ? `${s.replace(/[^a-z0-9]+/g, ' ').trim()}|${grade}` : null;
    };
    const seen = new Map<string, string[]>();
    for (const [id, rec] of Object.entries(db.items)) {
      if (hidden.has(id) || !rec?.name) continue;
      const k = key(rec.name);
      if (!k) continue;
      const list = seen.get(k);
      if (list) list.push(id);
      else seen.set(k, [id]);
    }
    const stillDouble = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1 && new Set(ids.map((i) => db.items[i].name.toLowerCase())).size > 1)
      .map(([k, ids]) => `${k}: ${ids.join(',')}`);
    expect(stillDouble).toEqual([]);
  });

  it('never merges two GRADES of the same family', () => {
    // The grade is part of the key, so Lesser and Greater can never collapse into each other — the
    // failure the curated near-miss list exists to prevent.
    const hidden = findDuplicateIds(c());
    for (const id of ['nail-bomb-lesser', 'nail-bomb-moderate', 'nail-bomb-greater', 'nail-bomb-major']) {
      expect(c().items[id], id).toBeTruthy();
      expect(hidden.has(id), id).toBe(false);
    }
  });

  it('nothing the hidden half carried was lost', () => {
    // Seven scrapes held a passiveEffects their clean twin lacked; those were copied across before
    // the hide, or the fix would have silently deleted seven working resistances.
    const pairs: [string, unknown][] = [
      ['foxglove-token-major', [{ type: 'poison', value: 10 }]],
      ['clay-sphere-greater', [{ type: 'precision', value: 5 }]],
      ['polished-demon-horn-major', [{ type: 'unholy', value: 10 }]],
    ];
    for (const [id, res] of pairs) {
      expect(c().items[id]?.passiveEffects?.resistances, id).toEqual(res);
    }
    expect(c().items['sihedron-medallion-major']?.passiveEffects?.saves).toBe(2);
  });
});
