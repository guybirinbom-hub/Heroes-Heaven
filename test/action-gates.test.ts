import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { actionGate } from '../src/rules/actionGates';

describe('actionGate — resource-state detection', () => {
  const db = content();
  const rec = (id: string) => db.feats[id] ?? db.classFeatures[id];

  it('rage-trait feats gate on rage', () => {
    // animal-rage carries the `rage` trait → usable only while raging.
    expect(actionGate(rec('animal-rage'))).toBe('rage');
  });
  it('finisher-trait feats gate on panache', () => {
    expect(actionGate(rec('bleeding-finisher'))).toBe('panache');
  });
  it('a base finisher whose requirement is only in prose still gates on panache', () => {
    // Confident Finisher's feat traits are just ["swashbuckler"]; the requirement lives in prose.
    expect(actionGate(rec('confident-finisher'))).toBe('panache');
  });
  it('bravado actions are NOT gated (they GRANT panache)', () => {
    for (const id of ['leading-dance', 'vexing-tumble', 'distracting-toss']) {
      expect(actionGate(rec(id))).toBeNull();
    }
  });
  it('an ordinary action with no state requirement is ungated', () => {
    expect(actionGate(rec('sudden-charge'))).toBeNull();
    expect(actionGate({ traits: ['general'], description: 'You do a thing.' })).toBeNull();
  });
  it('handles a missing/empty record gracefully', () => {
    expect(actionGate(undefined)).toBeNull();
    expect(actionGate({})).toBeNull();
  });
});

describe('actionGate — ranger & psychic states', () => {
  const db = content();
  const rec = (id: string) => db.feats[id] ?? db.classFeatures[id];
  it('psyche-trait actions gate on unleashed psyche', () => {
    expect(actionGate(rec('psi-burst'))).toBe('unleash-psyche');
  });
  it('a ranger action referencing your prey gates on hunt-prey', () => {
    expect(actionGate(rec('hunted-shot'))).toBe('hunt-prey');
  });
  it('a ranger feat with no prey reference is ungated', () => {
    // Animal companion / generic ranger feats don't require prey.
    expect(actionGate({ traits: ['ranger'], description: 'You gain an animal companion.' })).toBeNull();
  });
});
