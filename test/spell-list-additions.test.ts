import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * "Add Illusory Disguise, Illusory Object, and Illusory Scene to your spell list."
 *
 * The prepare/repertoire picker filtered strictly on `spell.traditions.includes(entry.tradition)`,
 * so a feat whose entire content is "you may now learn these" had nowhere to put them — the spells
 * simply never appeared in the picker.
 *
 * The lane widens the POOL only. You still spend a repertoire slot or a preparation on the spell,
 * which is exactly what Dragon Arcana prints: "you must still learn them or add them to your
 * repertoire as normal".
 */
const db = content();

describe('spell-list additions', () => {
  it('every added spell id resolves to a real, non-ritual spell', () => {
    for (const [id, f] of Object.entries(db.feats)) {
      for (const s of f.spellListAdditions?.spells ?? []) {
        expect(db.spells[s], `${id} adds "${s}", which is not a spell`).toBeDefined();
        expect(db.spells[s].ritual, `${id} adds a ritual`).toBeFalsy();
      }
    }
  });

  it('Fey Caller adds its three illusions to the character', () => {
    const ch = build('druid', 8, { featPicks: { '4:class': 'fey-caller' } });
    const added = ch.spellListAdditions?.['*'] ?? [];
    expect(added).toEqual(expect.arrayContaining(['illusory-disguise', 'illusory-object', 'illusory-scene']));
  });

  it('Dragon Arcana adds all ten draconic spells', () => {
    const ch = build('sorcerer', 12, { featPicks: { '12:class': 'dragon-arcana' } });
    expect(ch.spellListAdditions?.['*']).toHaveLength(10);
    expect(ch.spellListAdditions?.['*']).toContain('dragon-form');
  });

  it('the additions are genuinely OUTSIDE the entry tradition, or the lane would be pointless', () => {
    // Illusory Scene is not primal; if it ever became primal this test should say so rather than
    // quietly pass while the feat does nothing.
    expect(db.spells['illusory-scene'].traditions).not.toContain('primal');
  });

  it('a character without the feat gets nothing', () => {
    expect(build('druid', 8, {}).spellListAdditions).toBeUndefined();
  });

  it('two such feats merge rather than overwrite', () => {
    const ch = build('sorcerer', 12, { featPicks: { '12:class': 'dragon-arcana', '4:class': 'fey-caller' } });
    const added = ch.spellListAdditions?.['*'] ?? [];
    expect(added).toContain('dragon-form');
    expect(added).toContain('illusory-scene');
    expect(new Set(added).size).toBe(added.length); // deduped
  });
});
