import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { exportWg, importCharacter } from '../src/data/transfer';
import { CUSTOM_BACKGROUND_ID } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';

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

  it('imports repertoire signature-spell flags from WG’s id-keyed spells.list', () => {
    const obj = JSON.parse(wgBard());
    obj.character.spells = { slots: [], list: [{ spell_id: 55, rank: 1, source: 'bard', signature: true }], focus_point_current: 0, innate_casts: [] };
    obj.content.spells.normal = [{ id: 55, name: 'Soothe', rank: 1 }];
    const { saved } = importCharacter(JSON.stringify(obj), db);
    const soothe = Object.values(db.spells).find((s) => s.name === 'Soothe')!.id;
    expect(saved.build!.signatures[1]).toBe(soothe);
    // focus_point_current: 0 → the focus pool starts spent.
    expect((saved.character as any).focus?.current).toBe(0);
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

/** A "kitchen sink" WG v4 Cleric exercising every mapping added in the import overhaul:
 *  conditions, prepared-slot state, innate casts, lore skills, weapon/armor/spell proficiencies,
 *  worn armor, item charges + held wand spells, crafting formulas, banked monster parts,
 *  companions, favorites, custom modes, enabled sources, rituals, extra bio fields, and the
 *  unsupported-feature warnings (stamina, class archetype, custom operations). */
function wgKitchenSink() {
  return JSON.stringify({
    version: 4,
    character: {
      name: 'Everything Cleric',
      level: 5,
      experience: 250,
      hero_points: 3,
      hp_current: 20,
      hp_temp: 4,
      stamina_current: 5,
      details: {
        ancestry: { name: 'Human' },
        background: { name: 'Acolyte' },
        class: { name: 'Cleric' },
        class_archetype: { name: 'Elementalist' },
        image_url: 'https://example.com/portrait.png',
        conditions: [
          { name: 'Frightened', value: 2, for_object: false, for_creature: true, description: '' },
          { name: 'Prone', for_object: false, for_creature: true, description: '' },
          { name: 'Totally Fake Condition', for_object: false, for_creature: true, description: '' },
        ],
        info: {
          alignment: 'NG',
          beliefs: 'Kindness above all',
          faction: 'Firebrands',
          reputation: 12,
          organized_play_id: '123456-2001',
        },
      },
      inventory: {
        coins: { cp: 3, sp: 2, gp: 41, pp: 1 },
        monster_parts: { value: 12 },
        items: [
          { id: 'a', item: { name: 'Breastplate' }, is_formula: false, is_equipped: true, is_invested: false, is_implanted: false, container_contents: [] },
          { id: 'b', item: { name: 'Dagger' }, is_formula: false, is_equipped: true, is_invested: false, is_implanted: false, container_contents: [] },
          {
            id: 'c',
            item: { name: 'Weird Gizmo', level: 3, bulk: 'L', rarity: 'rare', description: 'Does gizmo things.', price: { gp: 30 } },
            is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [],
          },
          {
            id: 'd',
            item: {
              name: 'Magic Wand (1st-Rank Spell)',
              meta_data: { charges: { current: 1, max: 3 }, scroll_wand: { spell_id: 901, spell_name: 'Heal', spell_rank: 1 } },
            },
            is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [],
          },
          { id: 'e', item: { name: 'Healing Potion (Minor)' }, is_formula: true, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] },
        ],
      },
      spells: {
        slots: [],
        list: [],
        focus_point_current: 0,
        innate_casts: [{ spell_id: 903, rank: 0, tradition: 'divine', casts_max: 1, casts_current: 1 }],
      },
      meta_data: {
        favorites: [
          { type: 'spell', id: 901, name: 'Heal' },
          { type: 'feat', id: 77, name: 'Toughness' },
        ],
        custom_modes: [
          {
            id: 'm1',
            name: 'Blessed Ward',
            description: 'A shimmering ward.',
            effects: [
              { variable: 'AC', value: 1, type: 'status' },
              { variable: 'SKILL_ATHLETICS', value: 2, type: 'circumstance' },
              { variable: 'SOME_WEIRD_VAR', value: 3 },
            ],
          },
        ],
      },
      custom_operations: [{ id: 'op1', type: 'adjValue' }],
      options: { voluntary_flaws: true },
      variants: { free_archetype: true, automatic_bonus_progression: true },
      content_sources: { enabled: [1, 2] },
      companions: { list: [{ name: 'Wolf' }, { name: 'Ancient Red Dragon' }] },
    },
    content: {
      all_sources: [
        { id: 1, name: 'Player Core' },
        { id: 2, name: 'Rage of Elements' },
      ],
      attributes: { ATTRIBUTE_WIS: { value: 4 }, ATTRIBUTE_STR: { value: 1 } },
      proficiencies: {
        SKILL_RELIGION: { total: '+13', parts: { profValue: 4 } },
        SKILL_LORE___DEEP_EARTH: { total: '+7', parts: { profValue: 2 } },
        MARTIAL_WEAPONS: { total: '+11', parts: { profValue: 4 } },
        HEAVY_ARMOR: { total: '+7', parts: { profValue: 2 } },
        SPELL_ATTACK: { total: '+11', parts: { profValue: 4 } },
        SAVE_FORT: { total: '+11', parts: { profValue: 4 } },
      },
      feats_features: {
        classFeats: [],
        ancestryFeats: [],
        generalAndSkillFeats: [{ name: 'Toughness' }],
        otherFeats: [],
        classFeatures: [{ name: 'Cloistered Cleric' }],
        heritages: [],
      },
      languages: ['COMMON'],
      spells: {
        cantrips: [{ id: 900, name: 'Divine Lance', rank: 0 }],
        normal: [
          { id: 901, name: 'Heal', rank: 1 },
          { id: 902, name: 'Bless', rank: 1 },
        ],
        rituals: [{ id: 904, name: 'Atone', rank: 4 }],
      },
      spell_slots: [
        { rank: 1, source: 'cleric', spell_id: 901, exhausted: true, spell: { id: 901, name: 'Heal', rank: 1 } },
        { rank: 1, source: 'cleric', spell_id: 902, exhausted: false, spell: { id: 902, name: 'Bless', rank: 1 } },
      ],
      innate_spells: [{ spell: { id: 903, name: 'Detect Magic', rank: 0 }, rank: 0, tradition: 'DIVINE', casts_max: 1, casts_current: 1 }],
    },
  });
}

describe('Wanderer’s Guide import — kitchen sink (overhaul mappings)', () => {
  const db = content();
  const { saved, report, customItems, customModes } = importCharacter(wgKitchenSink(), db);
  const ch = saved.character as any;
  const all = report.resolved.join(' | ');
  const warns = report.warnings.join(' | ');

  it('imports vitals: xp, hero points, hp, temp hp', () => {
    expect(ch.xp).toBe(250);
    expect(ch.heroPoints).toBe(3);
    expect(ch.hitPoints.current).toBe(20);
    expect(ch.hitPoints.temp).toBe(4);
  });

  it('imports conditions with values and warns about unknown ones', () => {
    expect(ch.conditions).toEqual(expect.arrayContaining([{ id: 'frightened', value: 2 }, { id: 'prone' }]));
    expect(warns).toContain('Totally Fake Condition');
  });

  it('imports variant rules incl. ABP, and options', () => {
    expect(ch.variantRules?.freeArchetype).toBe(true);
    expect(ch.variantRules?.abp).toBe(true);
    expect(ch.options?.voluntaryFlaw).toBe(true);
  });

  it('marks imported armor as WORN (not held) so AC math sees it', () => {
    const breastplate = ch.inventory.find((i: any) => i.itemId === 'breastplate');
    expect(breastplate?.worn).toBe(true);
    const dagger = ch.inventory.find((i: any) => i.itemId === 'dagger');
    expect(dagger?.equipped).toBe(true);
    expect(dagger?.worn).toBeUndefined();
  });

  it('imports item charges and the spell held in a generic wand', () => {
    const heal = Object.values(db.spells).find((s) => s.name === 'Heal')!.id;
    const wand = (saved.build!.inventory as any[]).find((i) => i.heldSpell === heal);
    expect(wand).toBeTruthy();
    expect(wand.charges).toEqual({ current: 1, max: 3 });
  });

  it('synthesizes unknown gear as custom items and skips crafting formulas with a warning', () => {
    expect(customItems.map((i) => i.name)).toContain('Weird Gizmo');
    expect(warns).toMatch(/crafting formula/i);
  });

  it('imports banked monster parts', () => {
    expect(ch.monsterParts).toBe(12);
  });

  it('fills prepared slots by rank and keeps the cast (exhausted) state', () => {
    const heal = Object.values(db.spells).find((s) => s.name === 'Heal')!.id;
    const bless = Object.values(db.spells).find((s) => s.name === 'Bless')!.id;
    const prep = ch.spellcasting.find((e: any) => e.type === 'prepared');
    const rank1 = prep?.prepared?.[1] ?? [];
    expect(rank1[0]).toEqual({ spellId: heal, expended: true });
    expect(rank1[1]).toEqual({ spellId: bless, expended: false });
  });

  it('imports innate spells with their already-used casts, and initialPlay preserves them', () => {
    const dm = Object.values(db.spells).find((s) => s.name === 'Detect Magic')!.id;
    const innate = ch.spellcasting.find((e: any) => e.type === 'innate');
    expect(innate?.cantrips).toContain(dm);
    expect(innate?.innateUsed).toContain(dm);
    const play = initialPlay(ch, db);
    expect(play.innateUsed?.[`${innate.id}:${dm}`]).toBe(true);
  });

  it('imports rituals as override-added spells', () => {
    const atone = Object.values(db.spells).find((s) => s.name === 'Atone')!.id;
    expect(saved.build!.overrides?.addedSpells).toEqual(expect.arrayContaining([{ spellId: atone, rank: 4 }]));
  });

  it('imports lore skills and weapon/armor/spellcasting proficiencies', () => {
    expect(ch.proficiencies.skills['lore:deep earth']).toBe('trained');
    expect(ch.proficiencies.skills.religion).toBe('expert');
    expect(ch.proficiencies.attacks.martial).toBe('expert');
    expect(ch.proficiencies.defenses.heavy).toBe('trained');
    const prep = ch.spellcasting.find((e: any) => e.type === 'prepared');
    expect(prep?.proficiency).toBe('expert');
  });

  it('enables matched non-Core source books', () => {
    expect(ch.enabledSources).toContain('Pathfinder Rage of Elements');
    expect(ch.enabledSources).toContain('Pathfinder Player Core');
  });

  it('matches companions by name and reports unmatched ones', () => {
    const comp = (ch.companions ?? []).find((x: any) => x.name === 'Wolf');
    expect(comp?.kind).toBe('animal');
    expect(comp?.typeId).toBe('wolf');
    expect(warns).toContain('Ancient Red Dragon');
  });

  it('imports favorites as pinned descriptions', () => {
    const titles = (ch.pinnedDescs ?? []).map((p: any) => p.title);
    expect(titles).toEqual(expect.arrayContaining(['Heal', 'Toughness']));
  });

  it('converts WG custom modes to app modes (unmapped effects land in the note)', () => {
    expect(customModes).toHaveLength(1);
    const m = customModes[0];
    expect(m.name).toBe('Blessed Ward');
    expect(m.modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'ac', value: 1, type: 'status' }),
        expect.objectContaining({ target: 'skill', detail: 'athletics', value: 2, type: 'circumstance' }),
      ]),
    );
    expect(m.note).toContain('SOME_WEIRD_VAR');
  });

  it('preserves bio fields the app has no slot for on a note page', () => {
    const page = (ch.notes as any[]).find((p) => p.title === 'Imported from Wanderer’s Guide');
    expect(page?.content).toContain('Kindness above all');
    expect(page?.content).toContain('Firebrands');
    expect(page?.content).toContain('123456-2001');
  });

  it('imports the portrait url', () => {
    expect(ch.appearance?.portrait).toBe('https://example.com/portrait.png');
  });

  it('warns (rather than silently dropping) for stamina, class archetypes, and custom operations', () => {
    expect(warns).toMatch(/Stamina variant/i);
    expect(warns).toContain('Elementalist');
    expect(warns).toMatch(/custom operation/i);
  });

  it('round-trips conditions and focus points through the WG export', () => {
    const out = JSON.parse(exportWg(saved, db));
    const conds = out.character.details.conditions;
    expect(conds).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Frightened', value: 2 })]));
    expect(out.character.inventory.monster_parts?.value).toBe(12);
  });
});

/** Deep Background variant → the app's custom background. */
describe('Wanderer’s Guide import — deep background', () => {
  const db = content();
  const file = JSON.stringify({
    version: 4,
    character: {
      name: 'Deep BG',
      level: 1,
      details: {
        ancestry: { name: 'Human' },
        class: { name: 'Fighter' },
        info: {
          deep_background: {
            name: 'Street Urchin',
            description: 'Grew up on the streets.',
            boost1: 'DEX',
            boost2: 'INT',
            lore_name: 'Underworld',
            prereq_skill: 'thievery',
          },
        },
      },
      inventory: { coins: {}, items: [] },
      variants: { deep_background: true },
    },
    content: {
      attributes: { ATTRIBUTE_STR: { value: 4 } },
      feats_features: { classFeats: [], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [] },
      spells: { cantrips: [], normal: [] },
      languages: [],
    },
  });

  it('maps WG deep_background to a custom background', () => {
    const { saved, report } = importCharacter(file, db);
    expect(saved.build!.backgroundId).toBe(CUSTOM_BACKGROUND_ID);
    expect(saved.build!.customBackground).toMatchObject({
      name: 'Street Urchin',
      boosts: ['dex', 'int'],
      trainedSkill: 'thievery',
      loreSubject: 'Underworld',
    });
    expect(report.warnings.join(' | ')).toMatch(/skill feat/i);
  });
});
