import { describe, it, expect } from 'vitest';
import { content } from './_content';

describe('imported content integrity', () => {
  const db = content();

  it('has the full all-books import (ballpark counts)', () => {
    expect(Object.keys(db.classes).length).toBe(27);
    expect(Object.keys(db.ancestries).length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(db.backgrounds).length).toBeGreaterThanOrEqual(490);
    expect(Object.keys(db.feats).length).toBeGreaterThan(5000);
    expect(Object.keys(db.spells).length).toBeGreaterThan(1500);
    expect(Object.keys(db.items).length).toBeGreaterThan(5000);
    expect(Object.keys(db.deities).length).toBeGreaterThanOrEqual(400);
    expect(Object.keys(db.conditions).length).toBeGreaterThanOrEqual(40);
  });

  it('imported conditions with the valued ones flagged', () => {
    expect(db.conditions.frightened?.valued).toBe(true);
    expect(db.conditions.blinded?.valued).toBe(false);
    for (const id of ['clumsy', 'drained', 'enfeebled', 'sickened', 'slowed', 'stupefied', 'wounded', 'doomed', 'dying'])
      expect(db.conditions[id]?.valued, id).toBe(true);
  });

  it('every entry has an id and a name', () => {
    for (const cat of Object.values(db)) {
      for (const entry of Object.values(cat) as { id?: string; name?: string }[]) {
        expect(entry.id, JSON.stringify(entry).slice(0, 80)).toBeTruthy();
        expect(entry.name).toBeTruthy();
      }
    }
  });

  it('every item type is one the sheet/derive layer handles', () => {
    const allowed = new Set(['weapon', 'armor', 'shield', 'consumable', 'container', 'equipment', 'treasure']);
    for (const item of Object.values(db.items) as { itemType: string }[]) {
      expect(allowed.has(item.itemType), item.itemType).toBe(true);
    }
  });

  it('every spell rank is 0-10', () => {
    for (const sp of Object.values(db.spells) as { rank: number }[]) {
      expect(sp.rank).toBeGreaterThanOrEqual(0);
      expect(sp.rank).toBeLessThanOrEqual(10);
    }
  });

  it('imported the kineticist actions (Elemental Blast etc.) as features', () => {
    expect(db.classFeatures['elemental-blast']).toBeTruthy();
    expect(db.classFeatures['channel-elements']).toBeTruthy();
    expect(db.classFeatures['base-kinesis']).toBeTruthy();
  });

  it('caster classes carry a spellcasting config; non-casters do not', () => {
    const casters = ['bard', 'cleric', 'druid', 'witch', 'wizard', 'sorcerer', 'oracle', 'magus', 'summoner', 'psychic', 'animist'];
    for (const id of casters) expect(db.classes[id]?.spellcasting, id).toBeTruthy();
    for (const id of ['fighter', 'barbarian', 'rogue', 'kineticist', 'exemplar']) {
      expect(db.classes[id]?.spellcasting, id).toBeFalsy();
    }
  });
});
