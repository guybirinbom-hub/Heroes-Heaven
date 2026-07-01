import { describe, it, expect } from 'vitest';
import { deriveAnimalCompanion } from '../src/rules/companions';
import { toggleCompanionMode, type PlayState } from '../src/rules/play';
import { content } from './_content';
import type { CompanionConfig, ModeDef } from '../src/rules/types';

const c = content();
const cfg: CompanionConfig = { id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'mature' };
const wolf = c.animalCompanions.wolf;
const mode = (modifiers: ModeDef['modifiers']): ModeDef => ({ id: 'm', name: 'Test', modifiers });
const derive = (modes: ModeDef[] = []) => deriveAnimalCompanion(cfg, wolf, 8, c, [], false, modes);

describe('companion modes affect the stat block', () => {
  const base = derive();

  it('an AC mode raises the companion AC', () => {
    expect(derive([mode([{ value: 1, type: 'status', target: 'ac' }])]).ac).toBe(base.ac + 1);
  });

  it('a save mode applies by save NAME (reflex), not by ability — the others are untouched', () => {
    const b = derive([mode([{ value: 2, type: 'status', target: 'save', detail: 'reflex' }])]);
    expect(b.saves.reflex.modifier).toBe(base.saves.reflex.modifier + 2);
    expect(b.saves.fortitude.modifier).toBe(base.saves.fortitude.modifier);
    expect(b.saves.will.modifier).toBe(base.saves.will.modifier);
  });

  it('an attack mode raises the companion attack bonus', () => {
    expect(derive([mode([{ value: 1, type: 'circumstance', target: 'attack' }])]).attacks[0].attack).toBe(base.attacks[0].attack + 1);
  });

  it('an all-checks mode (e.g. Heroism) hits attack/saves/perception but NOT AC', () => {
    const b = derive([mode([{ value: 1, type: 'status', target: 'all-checks' }])]);
    expect(b.attacks[0].attack).toBe(base.attacks[0].attack + 1);
    expect(b.saves.reflex.modifier).toBe(base.saves.reflex.modifier + 1);
    expect(b.perception.modifier).toBe(base.perception.modifier + 1);
    expect(b.ac).toBe(base.ac);
  });

  it('a conditional mode (appliesWhen) does NOT change the number', () => {
    const b = derive([mode([{ value: 2, type: 'status', target: 'ac', appliesWhen: 'while hidden' }])]);
    expect(b.ac).toBe(base.ac);
  });
});

describe('toggleCompanionMode', () => {
  it('adds then removes a mode id under the companion key', () => {
    let play = {} as PlayState;
    play = toggleCompanionMode(play, 'cmp-0', 'm', {});
    expect(play.companionModes?.['cmp-0']).toEqual(['m']);
    play = toggleCompanionMode(play, 'cmp-0', 'm', {});
    expect(play.companionModes?.['cmp-0']).toEqual([]);
  });

  it('keeps companions independent', () => {
    let play = {} as PlayState;
    play = toggleCompanionMode(play, 'cmp-0', 'm', {});
    play = toggleCompanionMode(play, 'cmp-1', 'n', {});
    expect(play.companionModes?.['cmp-0']).toEqual(['m']);
    expect(play.companionModes?.['cmp-1']).toEqual(['n']);
  });
});
