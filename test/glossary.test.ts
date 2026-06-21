import { describe, it, expect } from 'vitest';
import { senseDesc, languageDesc } from '../src/rules/glossary';
import { content } from './_content';

describe('glossary: senses & languages are always describable (so the term is clickable)', () => {
  it('every imported language returns a non-empty description', () => {
    for (const lang of Object.values(content().languages)) {
      const desc = languageDesc(lang.id);
      expect(desc, lang.id).toBeTruthy();
      expect(desc.length, lang.id).toBeGreaterThan(10);
    }
  });

  it('the named Remaster languages get their specific blurb, not the generic fallback', () => {
    expect(languageDesc('sakvroth')).toMatch(/drow|Darklands/i);
    expect(languageDesc('fey')).toMatch(/First World|Sylvan/i);
    expect(languageDesc('ysoki')).toMatch(/ratfolk/i);
  });

  it('an unknown language still gets a generic (clickable) description', () => {
    const desc = languageDesc('madeuptongue');
    expect(desc).toMatch(/Madeuptongue/);
    expect(desc).toMatch(/language/i);
  });

  it('known senses get their specific blurb', () => {
    expect(senseDesc('darkvision')).toMatch(/darkness/i);
    expect(senseDesc('bloodsense')).toMatch(/blood/i);
    expect(senseDesc('magicsense')).toMatch(/magic/i);
    expect(senseDesc('wavesense')).toMatch(/water/i);
  });

  it('an unknown sense still gets a generic (clickable) description', () => {
    const desc = senseDesc('quantumsense');
    expect(desc).toMatch(/Quantumsense/);
    expect(desc).toMatch(/sense/i);
  });
});
