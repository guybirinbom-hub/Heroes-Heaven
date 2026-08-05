import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

/**
 * Records that were broken DATA rather than missing engine — every field written here is one the
 * engine already reads, and the only reason nothing happened is that the value was absent.
 */
const db = content();

describe('rune damage payloads', () => {
  it('the four runes that carried none now do, in the shape flaming proves', () => {
    expect(db.runes['flaming'].damage).toBeTruthy(); // the precedent
    expect(db.runes['astral'].damage).toEqual({ dice: 1, die: 'd6', type: 'spirit' });
    expect(db.runes['astral-greater'].damage).toEqual({ dice: 1, die: 'd6', type: 'spirit' });
    expect(db.runes['impactful'].damage).toEqual({ dice: 1, die: 'd6', type: 'force' });
    expect(db.runes['impactful-greater'].damage).toEqual({ dice: 1, die: 'd6', type: 'force' });
  });
});

describe('the poppet fire weakness', () => {
  it('the ancestry carries it — it was missing entirely, so nothing could remove it', () => {
    expect(db.ancestries['poppet'].weaknesses).toEqual([{ type: 'fire', value: 'max(1,floor(@actor.level/3))' }]);
  });

  it('a poppet really takes it, resolved from the formula', () => {
    const ch = build('fighter', 9, { ancestryId: 'poppet' });
    const fire = deriveDefenses(ch, db).weaknesses.find((w) => w.type === 'fire');
    expect(fire?.value).toBe(3); // one-third of 9
  });

  it('Sealed Poppet removes it', () => {
    const ch = build('fighter', 9, { ancestryId: 'poppet', featPicks: { '1:ancestry': 'sealed-poppet' } });
    expect(deriveDefenses(ch, db).weaknesses.find((w) => w.type === 'fire')).toBeUndefined();
  });
});

describe('specific magic items that were filed as plain equipment', () => {
  const CASES: [string, string, 'weapon' | 'armor' | 'shield'][] = [
    ['greater-chainbreaker', 'pick', 'weapon'],
    ['greater-dragons-tongue', 'longspear', 'weapon'],
    ['greater-mitigation-mail', 'chain-mail', 'armor'],
    ['greater-reactive-mail', 'chain-mail', 'armor'],
  ];

  it('each is typed, and its statistics match the base item it names', () => {
    for (const [id, baseId, type] of CASES) {
      const it = db.items[id];
      const base = db.items[baseId];
      expect(it.itemType, id).toBe(type);
      if (type === 'weapon') expect(it.damage, `${id} vs ${baseId}`).toEqual(base.damage);
      else expect(it.acBonus, `${id} vs ${baseId}`).toBe(base.acBonus);
      expect(it.group).toBe(base.group);
    }
  });

  it('the shield carries the reinforced numbers its own text prints', () => {
    const s = db.items['greater-energized-shield'];
    expect(s.itemType).toBe('shield');
    expect([s.hardness, s.hp, s.brokenThreshold]).toEqual([8, 64, 32]);
  });

  it('none of them carries `runes` — those live on the inventory instance', () => {
    // Every read in derive is inv.runes. A rune on the item RECORD would be dead data, which is the
    // failure this whole audit exists to find; the player sets them in the item editor.
    for (const [id] of CASES) expect((db.items[id] as { runes?: unknown }).runes).toBeUndefined();
  });
});

describe('the five mythic callings the registry was missing', () => {
  const NEW = ['handlers-calling', 'hunters-calling', 'runelords-calling', 'sagas-calling', 'sages-calling'];

  it('each has a spend row and a regain row', () => {
    for (const id of NEW) {
      const rows = FEAT_SITUATIONAL[id];
      expect(rows, `${id} has no rows`).toBeDefined();
      expect(rows.some((r) => /spending a Mythic Point/.test(r.when))).toBe(true);
      expect(rows.some((r) => /regain 1 Mythic Point/.test(r.bonus))).toBe(true);
    }
  });

  it("Hunter's Calling covers Perception, because Seek is a Perception check", () => {
    expect(FEAT_SITUATIONAL['hunters-calling'][0].targets.some((t) => t.kind === 'perception')).toBe(true);
  });

  it('every calling in the corpus now has rows', () => {
    const callings = Object.entries(db.classFeatures)
      .filter(([, r]) => (r.traits ?? []).includes('calling'))
      .map(([id]) => id);
    expect(callings.filter((id) => !FEAT_SITUATIONAL[id])).toEqual([]);
  });
});
