import { describe, it, expect } from 'vitest';
import { setAlchemyItem, quickAlchemy, type PlayState } from '../src/rules/play';

const base = (): PlayState => ({}) as PlayState;

describe('alchemist prep + quick alchemy', () => {
  it('setAlchemyItem sets a quantity and clears it at 0', () => {
    let p = setAlchemyItem(base(), 'acid-flask', 3);
    expect(p.alchemyPrep?.['acid-flask']).toBe(3);
    p = setAlchemyItem(p, 'acid-flask', 0);
    expect(p.alchemyPrep?.['acid-flask']).toBeUndefined();
  });

  it('quickAlchemy spends one Versatile Vial and adds the item', () => {
    const p = quickAlchemy(base(), 'lesser-acid-flask', 2, 3); // 2 vials on hand, max 3
    expect(p.resources?.['versatile-vials']).toBe(1); // spent one
    expect(p.alchemyPrep?.['lesser-acid-flask']).toBe(1);
  });

  it('quickAlchemy is a no-op with 0 vials', () => {
    const start = base();
    const p = quickAlchemy(start, 'x', 0, 3);
    expect(p).toBe(start); // unchanged
    expect(p.alchemyPrep).toBeUndefined();
  });
});
