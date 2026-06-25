import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { importCharacter } from '../src/data/transfer';

/**
 * Guards the Wanderer's Guide v4 import mappings that read WG's compiled `content` dump:
 * proficiency ranks (incl. skill increases), languages, TipTap notes, and precise dropped-feat
 * warnings. Built from a synthetic WG-shaped object so it doesn't depend on any external file.
 */
function wgFile() {
  return JSON.stringify({
    version: 4,
    character: {
      name: 'Test Fighter',
      level: 3,
      experience: 120,
      hero_points: 2,
      details: { ancestry: { name: 'Human' }, background: { name: 'Guard' }, class: { name: 'Fighter' } },
      inventory: { coins: { gp: 5 }, items: [] },
      notes: {
        pages: [
          {
            name: 'Backstory',
            icon: 'notebook',
            color: '#359fdf',
            contents: {
              type: 'doc',
              content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Origins' }] },
                { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Bold' }, { type: 'text', text: ' tale.' }] },
              ],
            },
          },
        ],
      },
    },
    content: {
      attributes: {
        ATTRIBUTE_STR: { value: 4 },
        ATTRIBUTE_DEX: { value: 2 },
        ATTRIBUTE_CON: { value: 2 },
        ATTRIBUTE_INT: { value: 0 },
        ATTRIBUTE_WIS: { value: 1 },
        ATTRIBUTE_CHA: { value: 0 },
      },
      proficiencies: {
        SKILL_ATHLETICS: { total: '+11', parts: { profValue: 4 } }, // expert (a skill increase)
        SKILL_INTIMIDATION: { total: '+6', parts: { profValue: 2 } }, // trained
        SAVE_FORT: { total: '+9', parts: { profValue: 4 } }, // expert
        PERCEPTION: { total: '+8', parts: { profValue: 4 } },
      },
      feats_features: {
        classFeats: [{ name: 'Sudden Charge' }, { name: 'A Totally Made-Up Feat' }],
        ancestryFeats: [],
        generalAndSkillFeats: [],
        otherFeats: [],
        heritages: [],
        classFeatures: [],
      },
      languages: ['COMMON', 'DRACONIC'],
      spells: { cantrips: [], normal: [] },
    },
  });
}

describe('Wanderer’s Guide v4 import', () => {
  const db = content();
  const { saved, report } = importCharacter(wgFile(), db);
  const ch = saved.character as any;

  it('resolves identity + ability scores', () => {
    expect(db.classes[ch.classId]?.name).toBe('Fighter');
    expect(db.ancestries[ch.ancestryId]?.name).toBe('Human');
    expect(ch.abilities.str).toBe(18);
  });

  it('imports skill/save proficiency RANKS (not just trained)', () => {
    expect(ch.proficiencies.skills.athletics).toBe('expert');
    expect(ch.proficiencies.skills.intimidation).toBe('trained');
    expect(ch.proficiencies.saves.fortitude).toBe('expert');
    expect(ch.proficiencies.perception).toBe('expert');
  });

  it('imports languages by name', () => {
    const names = (ch.languages as string[]).map((id) => db.languages[id]?.name);
    expect(names).toContain('Common');
    expect(names).toContain('Draconic');
  });

  it('imports notes, converting the TipTap doc to HTML', () => {
    expect(ch.notes).toHaveLength(1);
    expect(ch.notes[0].title).toBe('Backstory');
    expect(ch.notes[0].content).toContain('<h2>Origins</h2>');
    expect(ch.notes[0].content).toContain('<strong>Bold</strong>');
  });

  it('warns precisely about chosen feats missing from content', () => {
    const featWarn = report.warnings.find((w) => w.includes('re-add in the builder'));
    expect(featWarn).toContain('A Totally Made-Up Feat');
    expect(featWarn).not.toContain('Sudden Charge');
  });
});
