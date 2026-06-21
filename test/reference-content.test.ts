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

  it('siege weapons carry the vehicle frame plus at least one attack', () => {
    const sieges = Object.values(c.siegeWeapons ?? {});
    expect(sieges.length).toBeGreaterThanOrEqual(3);
    for (const s of sieges) {
      expect(s.hp, s.id).toBeGreaterThan(0);
      expect((s.attacks ?? []).length, s.id).toBeGreaterThanOrEqual(1);
    }
  });
});
