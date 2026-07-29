import { describe, it, expect } from 'vitest';
import { content, build } from './_content';

const c = content();

/**
 * CLASS FEATURES THAT GRANT A FEAT.
 *
 * buildCharacter read `grantsFeats` from the heritage, taken feats and invested items — but never
 * from CLASS FEATURES. So Improved Familiar Attunement (a wizard thesis) never granted the Familiar
 * feat, and a wizard who chose it got no familiar at all; Cloistered Cleric never granted Domain
 * Initiate; the Shield Block feature never granted the Shield Block feat.
 */
describe('class-feature feat grants', () => {
  const featIds = (ch: { feats: { featId: string }[] }) => new Set(ch.feats.map((f) => f.featId));

  it('Improved Familiar Attunement grants the Familiar feat (a wizard got NO familiar before)', () => {
    expect(c.classFeatures['improved-familiar-attunement']?.grantsFeats).toContain('familiar');
    // A thesis is an EXTRA CHOICE, not a subclass — a wizard's subclass options are the schools.
    const wiz = build('wizard', 3, { extraChoices: { thesis: ['improved-familiar-attunement'] } });
    expect(featIds(wiz).has('familiar')).toBe(true);
  });

  it('Cloistered Cleric grants Domain Initiate', () => {
    expect(c.classFeatures['cloistered-cleric']?.grantsFeats).toContain('domain-initiate');
    const cleric = build('cleric', 3, { subclassId: 'cloistered-cleric' });
    expect(featIds(cleric).has('domain-initiate')).toBe(true);
  });

  it('every granted id resolves to a real feat', () => {
    const bad: string[] = [];
    for (const [id, f] of Object.entries(c.classFeatures)) {
      for (const g of f.grantsFeats ?? []) if (!c.feats[g]) bad.push(`${id} -> ${g}`);
    }
    expect(bad, `dangling class-feature grants: ${bad.slice(0, 6).join(', ')}`).toHaveLength(0);
  });

  it('a granted feat is marked as granted, not as a spent slot', () => {
    // A thesis is an EXTRA CHOICE, not a subclass — a wizard's subclass options are the schools.
    const wiz = build('wizard', 3, { extraChoices: { thesis: ['improved-familiar-attunement'] } });
    const fam = wiz.feats.find((f) => f.featId === 'familiar');
    expect(fam?.grantedBy).toBeTruthy();
  });
});
