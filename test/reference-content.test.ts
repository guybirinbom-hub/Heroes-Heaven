import { describe, it, expect } from 'vitest';
import { content } from './_content';

const c = content();

describe('curated reference content (services / vehicles / siege weapons)', () => {
  it('services are imported with level + price + description', () => {
    const services = Object.values(c.services ?? {});
    expect(services.length).toBeGreaterThanOrEqual(10);
    for (const s of services) {
      expect(s.name, s.id).toBeTruthy();
      expect(s.description, s.id).toBeTruthy();
      expect(typeof s.level, s.id).toBe('number');
    }
  });

  it('vehicles carry a defensive statblock frame (AC/HP/Hardness)', () => {
    const vehicles = Object.values(c.vehicles ?? {});
    expect(vehicles.length).toBeGreaterThanOrEqual(5);
    for (const v of vehicles) {
      expect(v.ac, v.id).toBeGreaterThan(0);
      expect(v.hp, v.id).toBeGreaterThan(0);
      expect(v.hardness, v.id).toBeGreaterThanOrEqual(0);
    }
  });

  // The source prints NO defensive block for PORTABLE siege weapons — a ram is a carried object
  // rated by Bulk, with no AC/HP/Hardness/Space of its own — nor for the Light Mortar, whose
  // defensive stats live in the Inventor innovation that grants it. Those records ship without a
  // frame rather than with invented numbers, so they're listed here explicitly: the test still
  // demands real HP from every OTHER siege weapon, and fails if this set drifts either way.
  const NO_DEFENSIVE_FRAME = new Set([
    'adamantine-drilling-ram', 'arcane-ram', 'battering-ram-covered', 'blasting-ram',
    'blob-paste-propulsor', 'door-ram', 'drilling-ram', 'light-mortar', 'teekdoon',
  ]);

  it('siege weapons carry the vehicle frame plus at least one attack', () => {
    const sieges = Object.values(c.siegeWeapons ?? {});
    expect(sieges.length).toBeGreaterThanOrEqual(3);
    for (const s of sieges) {
      if (NO_DEFENSIVE_FRAME.has(s.id)) expect(s.hp, s.id).toBeUndefined();
      else expect(s.hp, s.id).toBeGreaterThan(0);
      expect((s.attacks ?? []).length, s.id).toBeGreaterThanOrEqual(1);
    }
    for (const id of NO_DEFENSIVE_FRAME) expect(c.siegeWeapons?.[id], id).toBeTruthy();
  });

  it('siege weapons cover the Archives of Nethys corpus, not just the 5 hand-authored ones', () => {
    const sieges = Object.values(c.siegeWeapons ?? {});
    expect(sieges.length).toBeGreaterThanOrEqual(62);
    // A sample across all four contributing books — the gap this data closed.
    for (const id of ['teekdoon', 'hwacha', 'volley-gun', 'fists-of-divinity', 'cyclonic-cannon', 'bolt-emitter']) {
      expect(c.siegeWeapons?.[id], id).toBeTruthy();
    }
    // Level + price stay usable: the Add-companion picker sorts by level and buys with the price.
    for (const s of sieges) {
      expect(typeof s.level, s.id).toBe('number');
      if (s.price !== undefined) expect(s.price, s.id).toMatch(/\d/);
    }
    // Every imported record is attributable (the 5 hand-authored ones predate source tracking).
    const HAND_AUTHORED = new Set(['ballista', 'catapult', 'trebuchet', 'ram', 'cannon']);
    for (const s of sieges) if (!HAND_AUTHORED.has(s.id)) expect(s.source?.book, s.id).toBeTruthy();
  });

  it('the High Seas / PF#216 content gaps are closed', () => {
    for (const id of ['aquatic-elf', 'benthic-athamaru', 'camouflage-tripkee', 'cecaelia-merfolk']) {
      const h = c.heritages[id];
      expect(h, id).toBeTruthy();
      expect(c.ancestries[h.ancestryId ?? ''], id).toBeTruthy(); // the owning ancestry resolves
      expect(h.description, id).toBeTruthy();
    }
    expect(c.deities['surveyors-of-the-deep']?.domains?.length).toBeGreaterThan(0);
    expect(c.languages['iblydosi']?.name).toBe('Iblydosi');
    // Archetype reference entries whose Dedication feats already ship — links to them now resolve.
    for (const id of ['jalmeri-heavenseeker', 'bright-lion']) {
      expect((c as unknown as { archetype?: Record<string, { name: string }> }).archetype?.[id], id).toBeTruthy();
      expect(c.feats[`${id}-dedication`], id).toBeTruthy();
    }
  });
});
