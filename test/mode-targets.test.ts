import { describe, it, expect } from 'vitest';
import { modeTargetOptions, parseTargetKey, targetKey, modeNumberBonus, modeTargetLabel } from '../src/rules/modes';
import { ABILITIES, SAVES, SKILLS, type ModeDef } from '../src/rules/types';

const mode = (...modifiers: ModeDef['modifiers']): ModeDef[] => [{ id: 'm', name: 'M', modifiers }];

describe('mode targets: the flat, searchable list', () => {
  it('lists every save, skill and attribute as its own entry', () => {
    const opts = modeTargetOptions();
    const values = new Set(opts.map((o) => o.value));
    for (const s of SAVES) expect(values.has(`save:${s}`), s).toBe(true);
    for (const s of SKILLS) expect(values.has(`skill:${s}`), s).toBe(true);
    for (const a of ABILITIES) expect(values.has(`ability:${a}`), a).toBe(true);
  });

  it('offers the numeric stats that used to have no target at all', () => {
    const values = new Set(modeTargetOptions().map((o) => o.value));
    for (const v of ['speed', 'max-hp', 'initiative']) expect(values.has(v), v).toBe(true);
  });

  it('keeps the blanket "all saves" / "all skills" entries alongside the specific ones', () => {
    const values = new Set(modeTargetOptions().map((o) => o.value));
    expect(values.has('save')).toBe(true);
    expect(values.has('skill')).toBe(true);
  });

  it("appends this character's own Lore subjects", () => {
    const opts = modeTargetOptions(['lore:warfare']);
    const lore = opts.find((o) => o.value === 'skill:lore:warfare');
    expect(lore?.label).toBe('Warfare Lore');
  });

  it('every option round-trips through its key', () => {
    for (const o of modeTargetOptions(['lore:warfare'])) {
      const { kind, detail } = parseTargetKey(o.value);
      expect(kind, o.value).toBe(o.kind);
      expect(detail, o.value).toBe(o.detail);
      expect(targetKey(kind, detail)).toBe(o.value);
    }
  });

  it('splits a Lore key on the FIRST colon only', () => {
    expect(parseTargetKey('skill:lore:warfare')).toEqual({ kind: 'skill', detail: 'lore:warfare' });
  });

  it('every option has a unique value', () => {
    const values = modeTargetOptions(['lore:warfare']).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('mode targets: matching', () => {
  it('an attribute modifier applies only to that attribute', () => {
    const m = mode({ value: 2, type: 'status', target: 'ability', detail: 'str' });
    expect(modeNumberBonus(m, { kind: 'ability', detail: 'str' })).toBe(2);
    expect(modeNumberBonus(m, { kind: 'ability', detail: 'dex' })).toBe(0);
  });

  it('"all checks" does NOT sweep up the new non-check targets', () => {
    // Speed, max HP and an attribute modifier are not d20 rolls, so a blanket check bonus must miss
    // them — otherwise Heroism would quietly add +1 to everyone's Speed and hit points.
    const m = mode({ value: 1, type: 'status', target: 'all-checks' });
    expect(modeNumberBonus(m, { kind: 'speed' })).toBe(0);
    expect(modeNumberBonus(m, { kind: 'max-hp' })).toBe(0);
    expect(modeNumberBonus(m, { kind: 'ability', detail: 'str' })).toBe(0);
    // …but initiative IS a check the character rolls.
    expect(modeNumberBonus(m, { kind: 'perception' })).toBe(1);
  });

  it('speed / max-hp / initiative each match only themselves', () => {
    const m = mode(
      { value: 10, type: 'status', target: 'speed' },
      { value: 5, type: 'status', target: 'max-hp' },
      { value: 2, type: 'circumstance', target: 'initiative' },
    );
    expect(modeNumberBonus(m, { kind: 'speed' })).toBe(10);
    expect(modeNumberBonus(m, { kind: 'max-hp' })).toBe(5);
    expect(modeNumberBonus(m, { kind: 'initiative' })).toBe(2);
    expect(modeNumberBonus(m, { kind: 'ac' })).toBe(0);
  });

  it('a conditional modifier still changes no number', () => {
    const m = mode({ value: 10, type: 'status', target: 'speed', appliesWhen: 'while raging' });
    expect(modeNumberBonus(m, { kind: 'speed' })).toBe(0);
  });

  it('labels an attribute target by name, not by its three-letter code', () => {
    expect(modeTargetLabel({ value: 2, type: 'status', target: 'ability', detail: 'cha' })).toBe('Charisma modifier');
    expect(modeTargetLabel({ value: 5, type: 'status', target: 'max-hp' })).toBe('maximum HP');
  });
});
