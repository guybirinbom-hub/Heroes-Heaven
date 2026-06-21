import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { lookupRef } from '../src/sheet/descref';

const c = content();

describe('description cross-reference resolution', () => {
  it('imported an actions content map and tagged descriptions with refs', () => {
    expect(Object.keys(c.actions).length).toBeGreaterThan(400);
    // Demoralize references the Frightened condition.
    const dem = c.actions['demoralize'];
    expect(dem?.descRefs?.some((r) => r.key === 'conditions')).toBe(true);
  });

  it('resolves a plain reference to its content node', () => {
    const node = lookupRef(c, { label: 'Fireball', key: 'spells' });
    expect(node?.title).toBe('Fireball');
    expect(node?.description.length).toBeGreaterThan(10);
  });

  it('strips a condition value label ("Frightened 2" → Frightened)', () => {
    const node = lookupRef(c, { label: 'Frightened 2', key: 'conditions' });
    expect(node?.title).toBe('Frightened');
  });

  it('resolves an action reference', () => {
    expect(lookupRef(c, { label: 'Strike', key: 'actions' })?.title).toBe('Strike');
    expect(lookupRef(c, { label: 'Seek', key: 'actions' })?.title).toBe('Seek');
  });

  it('falls back to a name match when the slug differs', () => {
    // "Frightened" resolves by name even though refs sometimes carry odd casing.
    expect(lookupRef(c, { label: 'frightened', key: 'conditions' })?.title).toBe('Frightened');
  });

  it('returns null for an unknown reference or bad key', () => {
    expect(lookupRef(c, { label: 'Definitely Not A Spell', key: 'spells' })).toBeNull();
    expect(lookupRef(c, { label: 'Fireball', key: 'nope' })).toBeNull();
  });

  it('resolved nodes carry their own refs, enabling recursion', () => {
    const dem = lookupRef(c, { label: 'Demoralize', key: 'actions' });
    expect(dem?.descRefs && dem.descRefs.length).toBeTruthy();
  });
});
