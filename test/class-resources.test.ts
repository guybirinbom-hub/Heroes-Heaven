import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { CLASS_RESOURCES, resourceMax, resourceInitial, initialClassResources, resourcesForCharacter } from '../src/rules/classResources';
import { emptyPlay, setResource, toggleResource, rest } from '../src/rules/play';
import { abilityMod } from '../src/rules/derive';
import type { AbilityId } from '../src/rules/types';

const c = content();

describe('class resource definitions', () => {
  it('every counter resource has a non-negative max at level 1 and 20', () => {
    const mods: Record<AbilityId, number> = { str: 2, dex: 2, con: 2, int: 4, wis: 2, cha: 2 };
    for (const list of Object.values(CLASS_RESOURCES)) {
      for (const r of list) {
        if (r.kind !== 'counter') continue;
        expect(resourceMax(r, 1, mods), r.id).toBeGreaterThanOrEqual(0);
        expect(resourceMax(r, 20, mods), r.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('alchemist Versatile Vials = 2 + Int mod (Remaster, flat)', () => {
    const r = CLASS_RESOURCES.alchemist[0];
    expect(r.id).toBe('versatile-vials');
    const mods = { str: 0, dex: 0, con: 0, int: 4, wis: 0, cha: 0 } as Record<AbilityId, number>;
    expect(resourceMax(r, 5, mods)).toBe(6); // 2 + 4, level-independent
    expect(resourceMax(r, 1, mods)).toBe(6);
  });

  it('oracle Cursebound is a meter (starts at 0) with a level-stepped max 2/3/4', () => {
    const r = CLASS_RESOURCES.oracle[0];
    const z = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } as Record<AbilityId, number>;
    expect(resourceMax(r, 1, z)).toBe(2);
    expect(resourceMax(r, 11, z)).toBe(3);
    expect(resourceMax(r, 17, z)).toBe(4);
    expect(resourceInitial(r, 17, z)).toBe(0); // a meter starts empty
  });

  it('a toggle (barbarian Rage) starts at 0', () => {
    const r = CLASS_RESOURCES.barbarian[0];
    const z = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } as Record<AbilityId, number>;
    expect(resourceInitial(r, 5, z)).toBe(0);
  });
});

describe('buildCharacter populates classResources', () => {
  it('a built alchemist starts with a full Versatile Vials pool (2 + Int)', () => {
    const ch = build('alchemist', 5, { keyAbility: 'int', levelBoosts: ['int', 'con', 'dex', 'wis'] });
    const intMod = abilityMod(ch.abilities.int);
    expect(ch.classResources?.['versatile-vials']).toBe(2 + intMod);
  });
  it('a class with no signature resource gets an empty map', () => {
    const ch = build('fighter', 3, { keyAbility: 'str' });
    expect(ch.classResources).toEqual({});
  });
});

describe('class resources — archetype dedication parity', () => {
  it('a base barbarian has Rage; a fighter with Barbarian Dedication also gets it', () => {
    expect(resourcesForCharacter('barbarian', new Set()).map((r) => r.id)).toContain('rage');
    expect(resourcesForCharacter('fighter', new Set(['barbarian-dedication'])).map((r) => r.id)).toContain('rage');
  });

  it('a fighter with Swashbuckler Dedication gets Panache', () => {
    expect(resourcesForCharacter('fighter', new Set(['swashbuckler-dedication'])).map((r) => r.id)).toContain('panache');
  });

  it('a fighter with no relevant dedication has no class resources', () => {
    expect(resourcesForCharacter('fighter', new Set())).toEqual([]);
  });

  it('magus / psychic / alchemist / oracle dedications do NOT auto-grant their resource (not a clean RAW grant)', () => {
    const ids = resourcesForCharacter(
      'fighter',
      new Set(['magus-dedication', 'psychic-dedication', 'alchemist-dedication', 'oracle-dedication']),
    ).map((r) => r.id);
    expect(ids).not.toContain('arcane-cascade');
    expect(ids).not.toContain('unleash-psyche');
    expect(ids).not.toContain('versatile-vials');
    expect(ids).not.toContain('cursebound');
  });
});

describe('play-state resource helpers', () => {
  it('setResource clamps to [0, max]', () => {
    const p = { ...emptyPlay(), resources: {} };
    expect(setResource(p, 'infused-reagents', 99, 9).resources!['infused-reagents']).toBe(9);
    expect(setResource(p, 'infused-reagents', -3, 9).resources!['infused-reagents']).toBe(0);
  });
  it('toggleResource flips 0/1', () => {
    const on = toggleResource({ ...emptyPlay(), resources: {} }, 'rage');
    expect(on.resources!.rage).toBe(1);
    expect(toggleResource(on, 'rage').resources!.rage).toBe(0);
  });
  it('rest resets resources to the supplied initial values', () => {
    const spent = { ...emptyPlay(), resources: { 'infused-reagents': 0, rage: 1 } };
    const initial = initialClassResources('alchemist', 5, { str: 0, dex: 0, con: 0, int: 4, wis: 0, cha: 0 });
    expect(rest(spent, { level: 5, conMod: 0, initialResources: initial }).resources).toEqual(initial);
  });
});
