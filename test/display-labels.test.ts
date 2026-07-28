import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { traitLabel } from '../src/rules/glossary';
import { DEFAULT_RAIL_ORDER, RAIL_CARD_LABELS } from '../src/data/customization';

const c = content();

/** Values stored as slugs/keys must not reach the screen verbatim. */
describe('display labels for stored slugs', () => {
  it('formats the suffixed weapon-trait families the way PF2e writes them', () => {
    expect(traitLabel('thrown-10')).toBe('Thrown 10 ft.');
    expect(traitLabel('thrown-20')).toBe('Thrown 20 ft.');
    expect(traitLabel('deadly-d10')).toBe('Deadly d10');
    expect(traitLabel('fatal-d12')).toBe('Fatal d12');
    expect(traitLabel('two-hand-d12')).toBe('Two Hand d12');
    expect(traitLabel('versatile-s')).toBe('Versatile S');
    expect(traitLabel('versatile-p')).toBe('Versatile P');
  });

  it('title-cases plain traits and multiword slugs', () => {
    expect(traitLabel('magical')).toBe('Magical');
    expect(traitLabel('low-light-vision')).toBe('Low Light Vision');
    expect(traitLabel('finesse')).toBe('Finesse');
  });

  it('never leaves a hyphen or lowercase leading letter in a rendered trait', () => {
    const seen = new Set<string>();
    for (const it of Object.values(c.items)) for (const t of it.traits ?? []) seen.add(t);
    for (const t of seen) {
      const label = traitLabel(t);
      expect(label.includes('-'), `${t} -> ${label}`).toBe(false);
      expect(/^[a-z]/.test(label), `${t} -> ${label}`).toBe(false);
    }
  });

  it('every rail card has a human label (no raw key can render)', () => {
    for (const id of DEFAULT_RAIL_ORDER) {
      expect(RAIL_CARD_LABELS[id], `rail card "${id}" has no label`).toBeTruthy();
    }
  });
});
