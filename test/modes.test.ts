import { describe, it, expect } from 'vitest';
import { modeNumberBonus, hasConditionalMode, modeModifiersFor, CATALOG_MODES, CATALOG_MODE_MAP, modeRelevant } from '../src/rules/modes';
import { deriveSave } from '../src/rules/derive';
import { toggleMode, type PlayState } from '../src/rules/play';
import type { ModeDef, ModeModifier } from '../src/rules/types';
import { build } from './_content';

const mode = (modifiers: ModeModifier[]): ModeDef => ({ id: 'm', name: 'Test', modifiers });

describe('mode modifiers', () => {
  it('an unconditional modifier folds into the matching stat only', () => {
    const modes = [mode([{ value: 2, type: 'circumstance', target: 'ac' }])];
    expect(modeNumberBonus(modes, { kind: 'ac' })).toBe(2);
    expect(modeNumberBonus(modes, { kind: 'save', detail: 'will' })).toBe(0);
  });

  it('a conditional modifier is excluded from the number but flagged + listed', () => {
    const modes = [mode([{ value: 1, type: 'status', target: 'save', detail: 'will', appliesWhen: 'when prone' }])];
    expect(modeNumberBonus(modes, { kind: 'save', detail: 'will' })).toBe(0);
    expect(hasConditionalMode(modes, { kind: 'save', detail: 'will' })).toBe(true);
    expect(modeModifiersFor(modes, { kind: 'save', detail: 'will' })).toHaveLength(1);
  });

  it('same-type bonuses do not stack (best wins); untyped sums', () => {
    const modes = [
      mode([
        { value: 1, type: 'status', target: 'attack' },
        { value: 2, type: 'status', target: 'attack' },
        { value: 1, type: 'untyped', target: 'attack' },
      ]),
    ];
    expect(modeNumberBonus(modes, { kind: 'attack' })).toBe(3); // best status (2) + untyped (1)
  });

  it('all-checks hits the checks the character rolls but not damage, AC, or imposed DCs', () => {
    const modes = [mode([{ value: 1, type: 'status', target: 'all-checks' }])];
    // Checks the character rolls (Heroism-style buff).
    expect(modeNumberBonus(modes, { kind: 'save', detail: 'reflex' })).toBe(1);
    expect(modeNumberBonus(modes, { kind: 'attack' })).toBe(1);
    expect(modeNumberBonus(modes, { kind: 'perception' })).toBe(1);
    expect(modeNumberBonus(modes, { kind: 'skill', detail: 'stealth' })).toBe(1);
    expect(modeNumberBonus(modes, { kind: 'spell-attack' })).toBe(1);
    // NOT damage, AC, or the DCs the character imposes — "all checks" ≠ DCs.
    expect(modeNumberBonus(modes, { kind: 'damage' })).toBe(0);
    expect(modeNumberBonus(modes, { kind: 'ac' })).toBe(0);
    expect(modeNumberBonus(modes, { kind: 'spell-dc' })).toBe(0);
    expect(modeNumberBonus(modes, { kind: 'class-dc' })).toBe(0);
  });

  it('save/skill detail matches specifically; empty detail = all of that kind', () => {
    expect(modeNumberBonus([mode([{ value: 1, type: 'status', target: 'save', detail: 'will' }])], { kind: 'save', detail: 'reflex' })).toBe(0);
    expect(modeNumberBonus([mode([{ value: 1, type: 'status', target: 'save' }])], { kind: 'save', detail: 'reflex' })).toBe(1);
  });

  it('deriveSave applies an active unconditional mode (and only to the matching save)', () => {
    const ch = build('fighter', 5);
    const willBase = deriveSave(ch, 'will').modifier;
    const refBase = deriveSave(ch, 'reflex').modifier;
    const withMode = { ...ch, activeModes: [mode([{ value: 2, type: 'status', target: 'save', detail: 'will' }])] };
    expect(deriveSave(withMode, 'will').modifier).toBe(willBase + 2);
    expect(deriveSave(withMode, 'reflex').modifier).toBe(refBase);
  });

  it('a conditional mode does NOT change the derived number', () => {
    const ch = build('fighter', 5);
    const willBase = deriveSave(ch, 'will').modifier;
    const withCond = { ...ch, activeModes: [mode([{ value: 2, type: 'status', target: 'save', detail: 'will', appliesWhen: 'when prone' }])] };
    expect(deriveSave(withCond, 'will').modifier).toBe(willBase);
  });
});

const byName = (name: string) => CATALOG_MODES.find((m) => m.name === name)!;
const emptyPlay: PlayState = {};

describe('predefined modes catalog', () => {
  it('includes every requested class/ancestry mode', () => {
    const wanted = [
      'Crafter in the Vault', 'Custodian of Groves and Gardens', 'Echo of Lost Moments', 'Impostor in Hidden Places',
      'Lurker in Devouring Dark', 'Monarch of the Fey Courts', 'Reveler in Lost Glee', 'Stalker in Darkened Boughs',
      'Steward of Stone and Fire', 'Vanguard of Roaring Waters', 'Witness to Ancient Battles',
      'Rage', 'Rage (legacy)', 'Rotting Rage', 'Wooden Rage',
      'Courageous Anthem', 'Rallying Anthem', 'Song of Strength', 'Triple Time',
      'Cursebound One', 'Cursebound Two', 'Cursebound Three', 'Cursebound Four',
      'Photon-Attuned', 'Graviton-Attuned', 'Perfectly-Attuned', 'Photon Attunement', 'Graviton Attunement',
      'Overdrive', 'Critical Overdrive', 'Panache', 'Panache (legacy)', 'Arcane Cascade', 'Mountain Stance', 'Unleash Psyche',
      'Animal Shape', 'Hybrid Shape', 'Size of the Ancients', 'Rivener State',
      'Spirit Trance', 'Sentinel Form', 'Daydream Trance',
    ];
    for (const name of wanted) {
      expect(CATALOG_MODES.some((m) => m.name === name), name).toBe(true);
    }
  });

  it('every catalog entry is predefined with a unique id', () => {
    const ids = new Set<string>();
    for (const m of CATALOG_MODES) {
      expect(m.predefined, m.name).toBe(true);
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
    }
  });

  it('mutually exclusive families share an exclusiveGroup', () => {
    expect(byName('Courageous Anthem').exclusiveGroup).toBe('bard-composition');
    expect(byName('Triple Time').exclusiveGroup).toBe('bard-composition');
    expect(byName('Rage').exclusiveGroup).toBe('barbarian-rage');
    expect(byName('Cursebound One').exclusiveGroup).toBe('oracle-cursebound');
    expect(byName('Photon-Attuned').exclusiveGroup).toBe('solarian-attunement');
  });
});

describe('modeRelevant — class/ancestry gating', () => {
  it('class-gated modes show only for that class', () => {
    expect(modeRelevant(byName('Courageous Anthem'), 'bard', 'human')).toBe(true);
    expect(modeRelevant(byName('Courageous Anthem'), 'cleric', 'human')).toBe(false);
    expect(modeRelevant(byName('Rage'), 'barbarian', null)).toBe(true);
    expect(modeRelevant(byName('Rage'), 'wizard', null)).toBe(false);
  });

  it('ungated general modes are relevant to everyone', () => {
    expect(modeRelevant(byName('Raise a Shield'), 'wizard', 'gnome')).toBe(true);
    expect(modeRelevant(byName('Bless'), null, null)).toBe(true);
  });

  it('ancestry-gated modes show only for that ancestry', () => {
    expect(modeRelevant(byName('Animal Shape'), 'fighter', 'werecreature')).toBe(true);
    expect(modeRelevant(byName('Animal Shape'), 'fighter', 'human')).toBe(false);
  });

  it('archetype modes are gated to the dedication feat that grants them', () => {
    const spirit = byName('Spirit Trance');
    expect(spirit.feats).toEqual(['rivethun-invoker-dedication']);
    // hidden for a character without the dedication...
    expect(modeRelevant(spirit, 'cleric', 'human')).toBe(false);
    expect(modeRelevant(spirit, 'cleric', 'human', new Set())).toBe(false);
    // ...shown for one who has it
    expect(modeRelevant(spirit, 'cleric', 'human', new Set(['rivethun-invoker-dedication']))).toBe(true);
    expect(modeRelevant(byName('Sentinel Form'), 'fighter', null, new Set(['starlit-sentinel-dedication']))).toBe(true);
    expect(modeRelevant(byName('Daydream Trance'), 'wizard', null, new Set(['sleepwalker-dedication']))).toBe(true);
  });

  it('the non-official "Fighting Defensively" mode is gone', () => {
    expect(CATALOG_MODES.some((m) => m.name === 'Fighting Defensively')).toBe(false);
  });
});

describe('toggleMode — mutual exclusivity', () => {
  it('activating a mode in an exclusive group deactivates the previous one', () => {
    let p = toggleMode(emptyPlay, 'cat-inspire-courage', CATALOG_MODE_MAP);
    expect(p.activeModes).toContain('cat-inspire-courage');
    p = toggleMode(p, 'cat-triple-time', CATALOG_MODE_MAP);
    expect(p.activeModes).toContain('cat-triple-time');
    expect(p.activeModes).not.toContain('cat-inspire-courage');
    expect(p.activeModes).toHaveLength(1);
  });

  it('modes in different groups coexist', () => {
    let p = toggleMode(emptyPlay, 'cat-triple-time', CATALOG_MODE_MAP);
    p = toggleMode(p, 'cat-rage', CATALOG_MODE_MAP);
    p = toggleMode(p, 'cat-raise-shield', CATALOG_MODE_MAP);
    expect(p.activeModes).toEqual(['cat-triple-time', 'cat-rage', 'cat-raise-shield']);
  });

  it('toggling an active mode off just removes it', () => {
    let p = toggleMode(emptyPlay, 'cat-rage', CATALOG_MODE_MAP);
    p = toggleMode(p, 'cat-rage', CATALOG_MODE_MAP);
    expect(p.activeModes).toEqual([]);
  });
});
