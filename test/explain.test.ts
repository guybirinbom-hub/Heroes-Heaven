import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import { deriveAc, deriveSave, derivePerception, abilityMod } from '../src/rules/derive';

const c = content();

describe('explainStat (stat breakdown)', () => {
  const ch = build('fighter', 5);

  it('save breakdown total matches deriveSave and lists proficiency + ability', () => {
    const b = explainStat(ch, c, { kind: 'save', save: 'reflex' });
    expect(b.totalText).toBe(`+${deriveSave(ch, 'reflex').modifier}`.replace('+-', '-'));
    expect(b.parts.some((p) => p.label.startsWith('Proficiency'))).toBe(true);
    expect(b.roll).toBeTruthy();
  });

  it('AC breakdown total matches deriveAc and starts from a base of 10', () => {
    const b = explainStat(ch, c, { kind: 'ac' });
    expect(b.totalText).toBe(String(deriveAc(ch, c).value));
    expect(b.parts[0]).toMatchObject({ label: 'Base', value: 10 });
  });

  it('perception breakdown matches and exposes skill actions (Seek, …)', () => {
    const b = explainStat(ch, c, { kind: 'perception' });
    expect(b.totalText).toBe(`${derivePerception(ch).modifier >= 0 ? '+' : ''}${derivePerception(ch).modifier}`);
    expect(b.skill).toBe('perception');
  });

  it('ability breakdown headlines the score and notes the modifier', () => {
    const b = explainStat(ch, c, { kind: 'ability', ability: 'str' });
    expect(b.totalText).toBe(String(ch.abilities.str));
    expect(b.subtitle).toBe(`Modifier ${abilityMod(ch.abilities.str) >= 0 ? '+' : ''}${abilityMod(ch.abilities.str)}`);
  });

  it('a skill ref carries the skill key so the panel can show its actions', () => {
    const b = explainStat(ch, c, { kind: 'skill', skill: 'athletics' });
    expect(b.skill).toBe('athletics');
    expect(b.roll).toBeTruthy();
  });
});
