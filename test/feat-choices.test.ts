import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { DOMAIN_SPELLS } from '../src/rules/domains';
import { featChoiceLabel } from '../src/rules/build';

describe('featChoiceLabel strips Foundry i18n key remnants', () => {
  it('repairs the shapes the importer left behind', () => {
    // Canny Acumen's dropdown read exactly this before the fix.
    expect(featChoiceLabel('Perception Label')).toBe('Perception');
    expect(featChoiceLabel('Saves Fortitude')).toBe('Fortitude');
    expect(featChoiceLabel('Saves Reflex')).toBe('Reflex');
    expect(featChoiceLabel('Saves Will')).toBe('Will');
    // Armor Proficiency / Champion Dedication.
    expect(featChoiceLabel('Light Short')).toBe('Light');
    expect(featChoiceLabel('Heavy Short')).toBe('Heavy');
    // Dragonblood feats.
    expect(featChoiceLabel('Yes Label')).toBe('Yes');
    expect(featChoiceLabel('No Label')).toBe('No');
  });

  it('leaves already-clean labels alone', () => {
    for (const ok of ['Arcana', 'Diplomacy', 'Stealth', 'Thievery', 'Society', 'Nature']) {
      expect(featChoiceLabel(ok)).toBe(ok);
    }
  });

  it('never blanks an unrecoverable label — a bare "Label" has no name to recover', () => {
    // ~28 options came through as just "Label". Stripping would leave an empty dropdown entry, which
    // is worse than the wrong word; these need a real data fix instead.
    expect(featChoiceLabel('Label')).toBe('Label');
    expect(featChoiceLabel('Short')).toBe('Short');
  });

  it('the real Canny Acumen options all render readably', () => {
    const opts = content().feats['canny-acumen']?.choice?.options ?? [];
    expect(opts.map((o) => featChoiceLabel(o.label))).toEqual(['Fortitude', 'Reflex', 'Will', 'Perception']);
  });
});

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
