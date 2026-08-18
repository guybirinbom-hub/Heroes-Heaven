import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { findDuplicateIds, REMASTER_REPRINT_IDS } from '../src/data';

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

  it('never hides the half that holds the mechanics', () => {
    /*
     * The Impossible Magic import (2026-08-15) brought 49 reprints of Secrets of Magic items in as
     * new records. Where a reprint disagreed with the record it duplicates on level or on price, the
     * tempting generalisation is "hide the older edition" — and MEASURED on this database that hides
     * `healers-gel-greater`, `grim-sandglass-major` and `chromatic-robe-greater`, each of them the
     * only half carrying `heldSpells` / `passiveEffects` / `usage`, in favour of a hollow re-scrape
     * that models nothing. `derive.ts` reads `db.items[inv.itemId]`, never the twin's, so a shop row
     * whose record carries no mechanics is an item that does nothing for the character who buys it.
     *
     * `aon-` scrapes are a DIFFERENT rule's business and are excluded: seven of them hold a `uses`
     * their canonical twin lacks, which scripts/apply-grade-twin-mechanics.mjs exists to copy across.
     */
    const db = c();
    const hidden = findDuplicateIds(db);
    const MECHANICAL = ['passiveEffects', 'heldSpells', 'usage', 'frequency', 'counters', 'damage', 'uses', 'activationCost'] as const;
    const GRADES = ['lesser', 'moderate', 'greater', 'major', 'minor', 'true', 'supreme'];
    const gradeKey = (name: string) => {
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
    const groups = new Map<string, string[]>();
    for (const [id, rec] of Object.entries(db.items)) {
      if (id.startsWith('aon-') || !rec?.name) continue;
      const k = gradeKey(rec.name);
      if (!k) continue;
      const list = groups.get(k);
      if (list) list.push(id);
      else groups.set(k, [id]);
    }
    const emptied: string[] = [];
    for (const ids of groups.values()) {
      const gone = ids.filter((i) => hidden.has(i));
      const shown = ids.filter((i) => !hidden.has(i));
      if (gone.length !== 1 || shown.length !== 1) continue;
      const lost = MECHANICAL.filter((f) => db.items[gone[0]][f] != null && db.items[shown[0]][f] == null);
      if (lost.length) emptied.push(`${gone[0]} hidden, but ${shown[0]} lacks its ${lost.join(', ')}`);
    }
    expect(emptied).toEqual([]);

    // The curated reprints: each one must exist, be hidden, and be the hollow half of its pair.
    const twin: Record<string, string> = {
      'greater-healers-gel': 'healers-gel-moderate',
      'major-healers-gel': 'healers-gel-greater',
      'major-grim-sandglass': 'grim-sandglass-major',
      'trail-warding-tattoo': 'warding-tattoo-trail',
      'wave-warding-tattoo': 'warding-tattoo-wave',
      'fiend-warding-tattoo': 'warding-tattoo-fiend',
      'full-pack': 'cantrip-deck-full-pack',
    };
    expect([...REMASTER_REPRINT_IDS].sort()).toEqual(Object.keys(twin).sort());
    for (const [reprint, kept] of Object.entries(twin)) {
      expect(db.items[reprint], reprint).toBeTruthy();
      expect(hidden.has(reprint), `${reprint} hidden`).toBe(true);
      expect(hidden.has(kept), `${kept} visible`).toBe(false);
      expect(MECHANICAL.some((f) => db.items[kept][f] != null), `${kept} models something`).toBe(true);
    }
  });

  it('prices Chromatic Robe (Greater) at what its own AoN document prints', () => {
    /*
     * 65,000 gp, ten times AoN's 6,500. The archive's structured field is in COPPER — equipment-4053
     * -3738 carries `price: 650000` and `price_raw: "6,500 gp"`, and the live index returns the same
     * — and the family's base tier prints 950 gp, so 950 -> 6,500 is the ladder and 950 -> 65,000 is
     * not one. scripts/price-check.mjs never caught it because it compares BY NAME and no AoN
     * document is called "Chromatic Robe (Greater)"; that spelling is the app's own, recorded in
     * scripts/migration/build-map.mjs as a word-order match onto "Greater Chromatic Robe".
     *
     * The wrong price was also what kept the duplicate visible: the 2026-08-15 import re-imported the
     * same document as `greater-chromatic-robe`, and the rule above refuses to collapse a pair whose
     * prices disagree. Correcting the price is what lets it hide the re-import.
     */
    expect(c().items['chromatic-robe-greater']?.price).toEqual({ gp: 6500 });
    expect(findDuplicateIds(c()).has('greater-chromatic-robe')).toBe(true);
  });
});
