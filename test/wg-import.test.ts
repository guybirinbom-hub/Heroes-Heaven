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

/** A Bard exercising the harder mappings: WG suffixes the subclass ("Maestro Muse"), lists focus +
 *  innate spells in their own blocks (dropped before), and names a feat with a "(…)" suffix. */
function wgBard() {
  return JSON.stringify({
    version: 4,
    character: {
      name: 'Bard Test',
      level: 5,
      details: { ancestry: { name: 'Elf' }, background: { name: 'Entertainer' }, class: { name: 'Bard' } },
      inventory: { coins: {}, items: [] },
    },
    content: {
      attributes: { ATTRIBUTE_CHA: { value: 4 }, ATTRIBUTE_DEX: { value: 3 } },
      feats_features: {
        classFeats: [{ name: 'Maestro Muse' }, { name: 'Lingering Composition' }],
        ancestryFeats: [],
        generalAndSkillFeats: [],
        otherFeats: [],
      },
      spells: { cantrips: [{ name: 'Daze', rank: 0 }], normal: [{ name: 'Soothe', rank: 1 }], rituals: [] },
      focus_spells: [{ name: 'Courageous Anthem', rank: 0 }],
      innate_spells: [{ spell: { name: 'Detect Magic', rank: 0 }, tradition: 'OCCULT', casts_max: 1 }],
      languages: ['COMMON'],
    },
  });
}

describe('Wanderer’s Guide import — subclass, focus/innate spells, extraChoices', () => {
  const db = content();

  it('detects a suffixed subclass ("Maestro Muse" → Maestro)', () => {
    const { saved, report } = importCharacter(wgBard(), db);
    const maestro = db.classes.bard.subclass!.options.find((o) => o.name === 'Maestro')!.id;
    expect(saved.build!.subclassId).toBe(maestro);
    expect(report.warnings.join(' | ')).not.toContain('Maestro Muse');
  });

  it('imports repertoire spells, focus spells, and innate spells into their entries', () => {
    const { saved } = importCharacter(wgBard(), db);
    const sc = (saved.character as any).spellcasting as any[];
    const ids = (e: any) => [...(e.cantrips ?? []), ...Object.values(e.repertoire ?? {}).flat()];
    const named = (e: any) => ids(e).map((id: string) => db.spells[id]?.name);

    const repertoire = sc.find((e) => e.type === 'spontaneous');
    expect(repertoire && named(repertoire)).toEqual(expect.arrayContaining(['Daze', 'Soothe']));

    const focus = sc.find((e) => e.type === 'focus');
    expect(focus && named(focus)).toContain('Courageous Anthem');
    expect((saved.character as any).focus?.max).toBeGreaterThanOrEqual(1);

    const innate = sc.find((e) => e.type === 'innate');
    expect(innate && named(innate)).toContain('Detect Magic');
  });

  it('imports a Kineticist element from WG’s "Kinetic Element (Wood)" feature', () => {
    const file = JSON.stringify({
      version: 4,
      character: {
        name: 'Kin', level: 5,
        details: { ancestry: { name: 'Leshy' }, background: { name: 'Laborer' }, class: { name: 'Kineticist' } },
        inventory: { coins: {}, items: [] },
      },
      content: {
        attributes: { ATTRIBUTE_CON: { value: 4 } },
        feats_features: { classFeats: [{ name: 'Kinetic Element (Wood)' }], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [] },
        spells: { cantrips: [], normal: [] },
        languages: [],
      },
    });
    const { saved, report } = importCharacter(file, db);
    expect(saved.build!.extraChoices.element).toContain('wood-gate');
    expect(report.warnings.join(' | ')).not.toContain('Kinetic Element');
  });
});
