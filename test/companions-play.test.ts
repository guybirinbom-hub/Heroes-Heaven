import { describe, it, expect } from 'vitest';
import {
  emptyPlay,
  addPlayCompanion,
  removePlayCompanion,
  updatePlayCompanion,
  applyPlayState,
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
