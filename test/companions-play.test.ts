import { describe, it, expect } from 'vitest';
import {
  emptyPlay,
  addPlayCompanion,
  removePlayCompanion,
  updatePlayCompanion,
  applyPlayState,
  applyCompanionDamage,
  applyCompanionHeal,
  setCompanionHp,
  setCompanionTempHp,
  buyCompanion,
  rest,
  type PlayState,
} from '../src/rules/play';
import { content, build } from './_content';

// Backs the Companions-tab "Add companion" feature: companions can be added / removed /
// configured in play and overlay the build's companions.
describe('in-play companion roster', () => {
  it('adds a companion with a fresh id', () => {
    const p = addPlayCompanion(emptyPlay(), { kind: 'animal', name: 'Rex', typeId: 'wolf', maturity: 'young' });
    expect(p.companions).toHaveLength(1);
    expect(p.companions![0]).toMatchObject({ kind: 'animal', typeId: 'wolf', name: 'Rex' });
    expect(p.companions![0].id).toBeTruthy();
  });

  it('removes a companion and drops its tracked conditions', () => {
    let p = addPlayCompanion(emptyPlay(), { kind: 'familiar', name: 'Bat', abilities: [] });
    const id = p.companions![0].id;
    p = { ...p, companionConditions: { [id]: [{ id: 'frightened', value: 1 }] } };
    p = removePlayCompanion(p, id);
    expect(p.companions).toHaveLength(0);
    expect(p.companionConditions![id]).toBeUndefined();
  });

  it('updates a companion in place (maturity)', () => {
    let p = addPlayCompanion(emptyPlay(), { kind: 'animal', name: '', typeId: 'wolf', maturity: 'young' });
    p = updatePlayCompanion(p, p.companions![0].id, { maturity: 'nimble' });
    expect(p.companions![0].maturity).toBe('nimble');
  });

  it('applyPlayState overlays in-play companions onto a character with none', () => {
    const ch = build('fighter', 3);
    const p: PlayState = addPlayCompanion(emptyPlay(), { kind: 'animal', name: 'Rex', typeId: 'wolf', maturity: 'mature' });
    const out = applyPlayState(ch, p, content());
    expect(out.companions).toHaveLength(1);
    expect(out.companions![0].name).toBe('Rex');
  });
});

describe('per-companion HP tracking (vehicles, siege weapons, creatures)', () => {
  const ID = 'cmp-0';

  it('tracks damage (current = max − damage), temp soaks first, and clamps', () => {
    let p = applyCompanionDamage(emptyPlay(), ID, 25, 40);
    expect(p.companionHp![ID].damage).toBe(25);
    p = setCompanionTempHp(p, ID, 10);
    p = applyCompanionDamage(p, ID, 6, 40); // 6 soaked by temp 10 → temp 4, no HP damage
    expect(p.companionHp![ID]).toEqual({ damage: 25, temp: 4 });
    p = applyCompanionHeal(p, ID, 100, 40); // over-heal clamps damage to 0
    expect(p.companionHp![ID].damage).toBe(0);
  });

  it('setCompanionHp sets current directly (stored as damage)', () => {
    const p = setCompanionHp(emptyPlay(), ID, 12, 40);
    expect(p.companionHp![ID].damage).toBe(28); // 40 − 12
  });

  it('removePlayCompanion drops the companion HP too', () => {
    let p = addPlayCompanion(emptyPlay(), { kind: 'vehicle', name: '', typeId: 'carriage' });
    const id = p.companions![0].id;
    p = applyCompanionDamage(p, id, 10, 40);
    p = removePlayCompanion(p, id);
    expect(p.companionHp![id]).toBeUndefined();
  });

  it('buyCompanion deducts coin when affordable and skips when not', () => {
    const cfg = { kind: 'vehicle' as const, name: '', typeId: 'carriage' };
    const rich = buyCompanion({ ...emptyPlay(), currency: { gp: 200 } }, cfg, { gp: 100 });
    expect(rich.currency).toEqual({ gp: 100 });
    expect(rich.companions).toHaveLength(1);
    const broke = buyCompanion({ ...emptyPlay(), currency: { gp: 10 } }, cfg, { gp: 100 });
    expect(broke.companions).toBeUndefined(); // can't afford → no change
  });

  it('a rest heals creature companions but NOT vehicles/siege weapons', () => {
    let p = emptyPlay();
    p = addPlayCompanion(p, { kind: 'animal', name: 'Rex', typeId: 'wolf' });
    p = addPlayCompanion(p, { kind: 'vehicle', name: '', typeId: 'carriage' });
    const [wolfId, carriageId] = p.companions!.map((c) => c.id);
    p = applyCompanionDamage(p, wolfId, 10, 30);
    p = applyCompanionDamage(p, carriageId, 10, 40);
    p = rest(p, { level: 1, conMod: 1 });
    expect(p.companionHp![wolfId].damage).toBe(0); // creature recovers overnight
    expect(p.companionHp![carriageId].damage).toBe(10); // vehicle needs Repair
  });
});
