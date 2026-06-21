import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { DOMAIN_SPELLS } from '../src/rules/domains';

describe('feats with embedded choices', () => {
  const c = content();

  it('Domain Initiate carries a domains ChoiceSet', () => {
    expect(c.feats['domain-initiate']?.choice?.kind).toBe('domains');
  });

  it('every mapped domain spell exists in the imported spells', () => {
    for (const [dom, sp] of Object.entries(DOMAIN_SPELLS)) expect(c.spells[sp], `${dom} -> ${sp}`).toBeTruthy();
  });

  it('Domain Initiate (Fire) grants Fire Ray as a focus spell + a 1-point pool', () => {
    const ch = build('cleric', 1, {
      deityId: 'sarenrae',
      featPicks: { '1:class:0': 'domain-initiate' },
      featChoices: { '1:class:0': 'fire' },
    });
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    const ids = Object.values(focus?.repertoire ?? {}).flat();
    expect(ids).toContain('fire-ray');
    expect(ch.focus?.max).toBe(1);
    const fc = ch.feats.find((f) => f.featId === 'domain-initiate');
    expect(fc?.choice?.label).toBe('Fire');
  });

  it('a different domain grants a different focus spell', () => {
    const ch = build('cleric', 1, { featPicks: { '1:class:0': 'domain-initiate' }, featChoices: { '1:class:0': 'healing' } });
    const ids = Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat();
    expect(ids).toContain('healers-blessing');
  });
});
