import { describe, it, expect } from 'vitest';
import { content, build } from './_content';

/*
 * ⚠ These name the CURRENT printings (Figment, Revealing Light), not the legacy ones they used to.
 * Our corpus keeps superseded records so archive links resolve, and 48 grant routes were still pointing
 * at them — a Cloak of Elvenkind cast Ghost Sound rather than Figment. Repointed from each legacy AoN
 * page's own remaster_id pointer; scripts/superseded-grant-check.mjs keeps it that way.
 */

const c = content();

/**
 * SPELLS FROM INVESTED ITEMS AND LATE CLASS FEATURES.
 *
 * innateSpells was read from the heritage and feats only, and focusSpells never from a class feature.
 * So a Cloak of Elvenkind never let you cast Ghost Sound, and Hero's Defiance — a 19th-level champion
 * feature whose entire content is "you gain the Hero's Defiance devotion spell" — did nothing even at
 * 20th level.
 */
describe('spell grants from items and class features', () => {
  const withItem = (lvl: number, itemId: string, invested: boolean) =>
    build('fighter', lvl, { inventory: [{ instanceId: 'i1', itemId, quantity: 1, invested }] });

  it('an INVESTED item grants its innate spell', () => {
    expect(c.items['cloak-of-elvenkind']?.innateSpells?.[0]?.spellId).toBe('figment');
    expect(JSON.stringify(withItem(5, 'cloak-of-elvenkind', true))).toContain('figment');
  });

  it('the SAME item carried but not invested grants nothing', () => {
    expect(JSON.stringify(withItem(5, 'cloak-of-elvenkind', false))).not.toContain('figment');
  });

  it("Hero's Defiance arrives at 19th level, not before", () => {
    expect(c.classFeatures['heros-defiance']?.focusSpells).toContain('heros-defiance');
    expect(JSON.stringify(build('champion', 18, { subclassId: 'justice' }))).not.toContain('heros-defiance');
    expect(JSON.stringify(build('champion', 19, { subclassId: 'justice' }))).toContain('heros-defiance');
  });

  it('every item/class-feature spell grant resolves to a real spell', () => {
    const bad: string[] = [];
    for (const [id, i] of Object.entries(c.items)) for (const s of i.innateSpells ?? []) if (!c.spells[s.spellId]) bad.push(`${id} -> ${s.spellId}`);
    for (const [id, f] of Object.entries(c.classFeatures)) for (const s of f.focusSpells ?? []) if (!c.spells[s]) bad.push(`${id} -> ${s}`);
    expect(bad, `dangling spell grants: ${bad.slice(0, 6).join(', ')}`).toHaveLength(0);
  });
});
