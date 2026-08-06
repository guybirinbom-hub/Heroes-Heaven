import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';

/**
 * A heritage that opens ANOTHER ancestry's feat list.
 *
 * The ancestry-slot filter took your own ancestry's feats and, for a versatile heritage, the
 * heritage's own. Half-Elf's "you can select elf, half-elf, and human feats whenever you gain an
 * ancestry feat" had nowhere to be declared, so 42 human ancestry feats were unreachable.
 */
const db = content();

const mk = (ancestryId: string, heritageId: string): BuildState =>
  ({ ...emptyBuild(), classId: 'fighter', level: 5, ancestryId, heritageId, backgroundId: Object.keys(db.backgrounds)[0] }) as BuildState;

const ancestrySlotIds = (b: BuildState): string[] =>
  eligibleFeatsForSlot(b, db, { level: 5, category: 'ancestry', idx: 0 }).map((f) => f.id);

describe('half-elf opens the human list', () => {
  it('the record says so, and the field records only what ships', () => {
    const h = db.heritages['aon-half-elf'];
    expect(h.description).toMatch(/select elf, half-elf, and human feats/i);
    expect(h.extraAncestryFeatTraits).toEqual(['human']);
  });

  it('human ancestry feats become selectable, and elf ones still are', () => {
    const ids = ancestrySlotIds(mk('elf', 'aon-half-elf'));
    const human = ids.filter((id) => (db.feats[id].traits ?? []).includes('human'));
    const elf = ids.filter((id) => (db.feats[id].traits ?? []).includes('elf'));
    expect(human.length, 'human feats should now be reachable').toBeGreaterThan(10);
    expect(elf.length, 'and the elf half must not be lost').toBeGreaterThan(10);
  });

  it('a PLAIN elf heritage still gets no human feats', () => {
    const plain = Object.values(db.heritages).find((h) => h.ancestryId === 'elf' && h.id !== 'aon-half-elf' && !h.versatile);
    if (!plain) return;
    const ids = ancestrySlotIds(mk('elf', plain.id));
    expect(ids.filter((id) => (db.feats[id].traits ?? []).includes('human') && !(db.feats[id].traits ?? []).includes('elf'))).toEqual([]);
  });

  it('half-orc gets the same widening', () => {
    expect(db.heritages['aon-half-orc'].extraAncestryFeatTraits).toEqual(['human']);
    const ids = ancestrySlotIds(mk('orc', 'aon-half-orc'));
    expect(ids.filter((id) => (db.feats[id].traits ?? []).includes('human')).length).toBeGreaterThan(10);
  });
});

describe('what was deliberately NOT written', () => {
  it('half-elf and half-orc traits carry no feats, so they are not listed', () => {
    // The Remaster folded those lists into their parents. Writing the traits would widen the pool by
    // nothing while recording the gap as closed.
    for (const t of ['half-elf', 'half-orc', 'geniekin']) {
      const n = Object.values(db.feats).filter((f) => f.category === 'ancestry' && (f.traits ?? []).includes(t)).length;
      expect(n, `${t} unexpectedly has feats now — revisit the heritage backfill`).toBe(0);
    }
  });

  it('ardande gets nothing, because its own feats already arrive', () => {
    const h = db.heritages['ardande'];
    expect(h.description).toMatch(/ardande feats, geniekin feats/i);
    expect(h.extraAncestryFeatTraits).toBeUndefined();
    // Its own 23 feats come through the versatile lane.
    const ids = ancestrySlotIds(mk('elf', 'ardande'));
    expect(ids.filter((id) => (db.feats[id].traits ?? []).includes('ardande')).length).toBeGreaterThan(5);
  });
});
