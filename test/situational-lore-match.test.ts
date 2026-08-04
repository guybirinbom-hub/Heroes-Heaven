import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { featSituationalFor, hasFeatSituational } from '../src/rules/situationalBonuses';

/**
 * A Lore star that can never match is a star nobody sees.
 *
 * Lore proficiency keys are `lore:<subject>` where the subject is TYPED BY THE PLAYER — "Warfare",
 * "warfare", "Guild". The matcher compared `t.detail === ref.skill` exactly, so:
 *   - the 17 entries written `lore:*` and the 3 written bare `lore` (both meaning "any Lore") could
 *     never equal a real key, and matched nothing at all;
 *   - a named entry authored `lore:games` missed a character whose key is `lore:Games`.
 *
 * Found by an adversary on the mythic-calling pass, while arguing about which shape Bookkeeper's
 * Calling should use.
 */
const SRC = readFileSync(new URL('../src/rules/situationalBonuses.ts', import.meta.url), 'utf8');

/** Registry ids that carry a lore-shaped skill target, read from the shipped source. */
function idsWithLoreTarget(): { id: string; detail: string }[] {
  const out: { id: string; detail: string }[] = [];
  for (const m of SRC.matchAll(/^ {0,2}["']?([a-z0-9-]+)["']?:\s*\[(.+)$/gm)) {
    for (const d of m[2].matchAll(/kind:\s*'skill',\s*detail:\s*'(lore[^']*)'/g)) out.push({ id: m[1], detail: d[1] });
  }
  return out;
}

describe('Lore situational targets actually match', () => {
  it('the registry really does carry wildcard Lore targets', () => {
    const wild = idsWithLoreTarget().filter((x) => x.detail === 'lore' || x.detail === 'lore:*');
    expect(wild.length).toBeGreaterThan(10); // 20 at the time of writing
  });

  it('a wildcard matches any Lore the player typed', () => {
    const wild = idsWithLoreTarget().find((x) => x.detail === 'lore' || x.detail === 'lore:*')!;
    for (const key of ['lore:Warfare', 'lore:warfare', 'lore:Guild', 'lore:underworld']) {
      expect(hasFeatSituational([wild.id], { kind: 'skill', skill: key }), `${wild.id} vs ${key}`).toBe(true);
    }
  });

  it('a wildcard does NOT match an ordinary skill', () => {
    const wild = idsWithLoreTarget().find((x) => x.detail === 'lore' || x.detail === 'lore:*')!;
    for (const key of ['athletics', 'stealth', 'diplomacy']) {
      expect(hasFeatSituational([wild.id], { kind: 'skill', skill: key })).toBe(false);
    }
  });

  it('a NAMED lore matches regardless of how the player capitalised it', () => {
    const named = idsWithLoreTarget().find((x) => x.detail.startsWith('lore:') && x.detail !== 'lore:*');
    if (!named) return;
    const subject = named.detail.slice(5);
    const upper = `lore:${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;
    expect(hasFeatSituational([named.id], { kind: 'skill', skill: named.detail })).toBe(true);
    expect(hasFeatSituational([named.id], { kind: 'skill', skill: upper }), `${named.id} vs ${upper}`).toBe(true);
  });

  it('a named lore still does not match a DIFFERENT lore', () => {
    const named = idsWithLoreTarget().find((x) => x.detail.startsWith('lore:') && x.detail !== 'lore:*');
    if (!named) return;
    expect(hasFeatSituational([named.id], { kind: 'skill', skill: 'lore:something-else-entirely' })).toBe(false);
  });

  it('the rows carry through to the display helper, not just the boolean', () => {
    const wild = idsWithLoreTarget().find((x) => x.detail === 'lore' || x.detail === 'lore:*')!;
    expect(featSituationalFor([wild.id], { kind: 'skill', skill: 'lore:Warfare' }).length).toBeGreaterThan(0);
  });
});
