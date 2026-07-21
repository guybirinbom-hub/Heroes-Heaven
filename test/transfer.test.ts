import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import type { SavedChar } from '../src/data/storage';
import { exportNative, exportWg, importCharacter } from '../src/data/transfer';
import { deriveBuildFromCharacter } from '../src/rules/build';
import { emptyPlay } from '../src/rules/play';
import { normalizeCharacter, normalizePlay } from '../src/rules/normalize';

const c = content();

function saved(name: string, classId = 'cleric', level = 5): SavedChar {
  return { id: 'rost-1', character: { ...build(classId, level), name }, archived: false };
}

describe('native Codex export/import (lossless)', () => {
  it('round-trips a character through exportNative → importCharacter', () => {
    const s = saved('Native Hero');
    const { saved: back, report } = importCharacter(exportNative(s), c);
    expect(report.source).toBe('Heroes Heaven');
    expect(report.lossless).toBe(true);
    expect(back.character.name).toBe('Native Hero');
    expect(back.character.level).toBe(5);
    expect(back.character.classId).toBe('cleric');
    expect(back.character.abilities).toEqual(s.character.abilities);
    expect(back.id).not.toBe(s.id); // a fresh roster id is assigned
  });

  it('losslessly round-trips a RICH character (spells, inventory, notes, build + play state)', () => {
    const dazeId = Object.values(c.spells).find((s) => s.name === 'Daze')!.id;
    const sootheId = Object.values(c.spells).find((s) => s.name === 'Soothe')!.id;
    const weaponId = Object.values(c.items).find((i) => i.itemType === 'weapon')!.id;
    const character = {
      ...build('bard', 6, {
        cantrips: [dazeId],
        spells: { 1: [sootheId] },
        inventory: [{ itemId: weaponId, quantity: 1, equipped: true, invested: false }],
      }),
      name: 'Round Trip',
      notes: [{ id: 'n1', title: 'Lore', content: '<p>A storied past.</p>' }],
    };
    const buildState = deriveBuildFromCharacter(character, c);
    const play = { ...emptyPlay(), damage: 7, heroPoints: 2, conditions: [{ id: 'frightened', value: 1 }] };
    const s: SavedChar = { id: 'rt-1', character, build: buildState, play, archived: false };

    const { saved: back, report } = importCharacter(exportNative(s), c);
    expect(report.lossless).toBe(true);
    // Everything comes back byte-for-byte (modulo the idempotent normalize + a fresh roster id).
    expect(back.character).toEqual(normalizeCharacter(character));
    expect(back.build).toEqual(buildState);
    expect(back.play).toEqual(normalizePlay(play));
    // spot-checks on the things people worry about losing:
    const casting = back.character.spellcasting.find((e) => e.type === 'spontaneous')!;
    expect([...(casting.cantrips ?? []), ...Object.values(casting.repertoire ?? {}).flat()]).toEqual(
      expect.arrayContaining([dazeId, sootheId]),
    );
    expect(back.character.inventory.some((i) => i.itemId === weaponId)).toBe(true);
    expect(back.character.notes?.[0]?.content).toContain('storied past');
    expect(back.play?.damage).toBe(7);
    expect(back.play?.conditions).toEqual([{ id: 'frightened', value: 1 }]);
  });
});

describe('Wanderer’s Guide export (spec-shaped v4)', () => {
  const file = JSON.parse(exportWg(saved('WG Out', 'fighter', 3), c));

  it('wraps as version 4 with a character + content block', () => {
    expect(file.version).toBe(4);
    expect(file.character).toBeTruthy();
    expect(file.content).toBeTruthy();
  });

  it('includes the required numeric vitals and a spec-shaped character', () => {
    const ch = file.character;
    for (const k of ['name', 'level', 'experience', 'hp_current', 'hp_temp', 'hero_points', 'stamina_current', 'resolve_current']) {
      expect(ch[k], k).toBeDefined();
    }
    expect(ch.operation_data).toEqual({ selections: {}, notes: {} });
    expect(ch.spells).toBeNull(); // can't map to WG integer spell IDs
    expect(ch.inventory.coins).toBeTruthy();
    expect(ch.content_sources).toEqual({ enabled: [1] });
  });

  it('fills the human-readable content snapshot faithfully', () => {
    expect(file.content.class).toBe(c.classes['fighter'].name);
    expect(file.content.level).toBe(3);
    expect(typeof file.content.max_hp).toBe('number');
    expect(typeof file.content.ac).toBe('number');
    expect(file.content.attributes.str).toBeDefined();
  });
});

describe('Wanderer’s Guide round-trip keeps repeatable-feat takes', () => {
  it('a wizard with Armor Proficiency ×3 survives export → import (all three armors trained)', () => {
    // Wizard is untrained in every armor, so each of the three cascade takes is observable.
    const character = { ...build('wizard', 11, {
      featPicks: { '3:general:0': 'armor-proficiency', '7:general:0': 'armor-proficiency', '11:general:0': 'armor-proficiency' },
    }), name: 'Armored Wizard' };
    const wg = JSON.parse(exportWg({ id: 'w1', character, archived: false }, c));

    // The export carries all three takes (not collapsed to one).
    const apEntries = wg.content.feats_features.filter((f: { name: string }) => f.name === 'Armor Proficiency');
    expect(apEntries).toHaveLength(3);

    // Re-import: before the fix, the by-id de-dupe dropped takes 2 and 3, so only light was trained.
    const { saved: back } = importCharacter(JSON.stringify(wg), c);
    const def = back.character.proficiencies.defenses as Record<string, string>;
    expect([def.light, def.medium, def.heavy]).toEqual(['trained', 'trained', 'trained']);
    expect(back.character.feats.filter((f) => f.featId === 'armor-proficiency')).toHaveLength(3);
  });
});

describe('Wanderer’s Guide import (best-effort, name-matched)', () => {
  const ancName = c.ancestries['human'].name;
  const clsName = c.classes['cleric'].name;
  const bgName = c.backgrounds['acolyte'].name;

  const wgFile = {
    version: 4,
    character: {
      name: 'WG Cleric',
      level: 3,
      experience: 40,
      hp_current: 22,
      hp_temp: 0,
      hero_points: 2,
      inventory: { coins: { gp: 7, sp: 3 }, items: [] },
      details: {
        ancestry: { name: ancName },
        background: { name: bgName },
        class: { name: clsName },
        info: { appearance: 'Tall and sun-marked', alignment: 'NG' },
      },
      spells: null,
    },
    content: {
      attributes: { ATTRIBUTE_WIS: 4, ATTRIBUTE_CON: 2, ATTRIBUTE_STR: 0 },
      feats_features: [],
      proficiencies: { SKILL_RELIGION: { total: 99, rank: 'trained' } },
    },
  };

  it('maps ancestry/background/class by name and carries vitals + bio', () => {
    const { saved: s, report } = importCharacter(JSON.stringify(wgFile), c);
    expect(report.source).toBe('Wanderer’s Guide');
    expect(report.lossless).toBe(false);
    expect(s.character.ancestryId).toBe('human');
    expect(s.character.backgroundId).toBe('acolyte');
    expect(s.character.classId).toBe('cleric');
    expect(s.character.level).toBe(3);
    expect(s.character.name).toBe('WG Cleric');
    expect(s.character.xp).toBe(40);
    expect(s.character.heroPoints).toBe(2);
    expect(s.character.details.appearance).toBe('Tall and sun-marked');
    expect(s.character.currency.gp).toBe(7);
  });

  it('reverse-derives ability scores from the resolved modifiers (10 + 2·mod)', () => {
    const { saved: s } = importCharacter(JSON.stringify(wgFile), c);
    expect(s.character.abilities.wis).toBe(18); // +4
    expect(s.character.abilities.con).toBe(14); // +2
  });

  it('produces an editable build and a non-empty report', () => {
    const { saved: s, report } = importCharacter(JSON.stringify(wgFile), c);
    expect(s.build).toBeTruthy();
    expect(s.build?.classId).toBe('cleric');
    expect(report.resolved.length).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0); // always notes the by-name caveat
  });
});

describe('Wanderer’s Guide import — real v4 shapes (regression)', () => {
  // Real WG v4 exports store feats_features as an OBJECT of category arrays (not a flat array),
  // and skill proficiencies as { total: "+9" (string), parts: { profValue } } with NO rank field.
  const humanHeritage = Object.values(c.heritages).find((h) => h.ancestryId === 'human')!.name;
  const someFeat = Object.values(c.feats)[0]!.name;
  const wgV4 = {
    version: 4,
    character: {
      name: 'WG V4',
      level: 3,
      experience: 0,
      hp_current: 20,
      hp_temp: 0,
      hero_points: 1,
      inventory: { coins: {}, items: [] },
      details: {
        ancestry: { name: c.ancestries['human'].name },
        background: { name: c.backgrounds['acolyte'].name },
        class: { name: c.classes['cleric'].name },
      },
      spells: null,
    },
    content: {
      attributes: { ATTRIBUTE_WIS: { value: 4 } },
      feats_features: {
        heritages: [{ name: humanHeritage }],
        generalAndSkillFeats: [{ name: someFeat, level: 1 }],
        classFeatures: [],
      },
      proficiencies: { SKILL_ACROBATICS: { total: '+9', parts: { profValue: 2 } } },
    },
  };

  it('flattens object-shaped feats_features so heritage + feats are not dropped', () => {
    const { saved, report } = importCharacter(JSON.stringify(wgV4), c);
    expect(saved.character.heritageId).toBeTruthy();
    expect(report.resolved.some((r) => /feat.*matched/i.test(r))).toBe(true);
  });

  it('detects skill training from parts.profValue (string total, no rank field)', () => {
    const { report } = importCharacter(JSON.stringify(wgV4), c);
    expect(report.resolved.some((r) => /trained skill/i.test(r))).toBe(true);
  });

  it('treats profValue 0 as untrained (does not over-train from a high total)', () => {
    const file = {
      ...wgV4,
      content: { ...wgV4.content, proficiencies: { SKILL_ACROBATICS: { total: '+9', parts: { profValue: 0 } } } },
    };
    const { report } = importCharacter(JSON.stringify(file), c);
    expect(report.resolved.some((r) => /trained skill/i.test(r))).toBe(false);
  });
});

describe('WG interop — variants, options, runes, containers (real-format fixes)', () => {
  const fighter = c.classes['fighter'].name;
  const wgChar = (over: Record<string, unknown>) => ({
    version: 4,
    character: {
      name: 'WG Fix',
      level: 5,
      experience: 0,
      hp_current: 30,
      hp_temp: 0,
      hero_points: 1,
      inventory: { coins: {}, items: [] },
      details: { class: { name: fighter } },
      spells: null,
      ...over,
    },
    content: {},
  });

  it('exports Codex variant rules + options under WG names', () => {
    const s: SavedChar = {
      id: 'r',
      character: { ...build('fighter', 5, { variantRules: { freeArchetype: true, proficiencyWithoutLevel: true }, options: { ignoreBulk: true } }), name: 'V' },
      archived: false,
    };
    const file = JSON.parse(exportWg(s, c));
    expect(file.character.variants.free_archetype).toBe(true);
    expect(file.character.variants.proficiency_without_level).toBe(true);
    expect(file.character.options.ignore_bulk_limit).toBe(true);
    expect(file.character.options.auto_detect_prerequisites).toBe(true);
  });

  it('imports WG variants + options back into the Codex build', () => {
    const { saved } = importCharacter(
      JSON.stringify(wgChar({ variants: { free_archetype: true, gradual_attribute_boosts: true }, options: { ignore_bulk_limit: true, voluntary_flaws: true } })),
      c,
    );
    expect(saved.build?.variantRules?.freeArchetype).toBe(true);
    expect(saved.build?.variantRules?.gradualBoosts).toBe(true);
    expect(saved.build?.options?.ignoreBulk).toBe(true);
    expect(saved.build?.options?.voluntaryFlaw).toBe(true);
  });

  it('imports object-shaped property runes (WG runes.property is {name,id}, not a string)', () => {
    const weapon = Object.values(c.items).find((i) => i.itemType === 'weapon')!;
    const propRune = Object.values(c.runes).find((r) => r.kind === 'property' && r.slot === 'weapon')!;
    const { saved } = importCharacter(
      JSON.stringify(
        wgChar({
          inventory: {
            coins: {},
            items: [{ is_equipped: true, is_invested: false, item: { name: weapon.name, meta_data: { runes: { potency: 1, striking: 1, property: [{ name: propRune.name, id: 1 }] } } } }],
          },
        }),
      ),
      c,
    );
    const inv = saved.build?.inventory?.find((it) => it.itemId === weapon.id);
    expect(inv).toBeTruthy();
    const runes = inv!.runes as { potency?: number; striking?: string; property?: string[] };
    expect(runes.potency).toBe(1);
    expect(runes.striking).toBe('striking');
    expect(runes.property?.length).toBeGreaterThan(0); // the property rune is no longer dropped
  });

  it('flattens container_contents so stowed items are not dropped on import', () => {
    const container = Object.values(c.items).find((i) => i.itemType === 'container')!;
    const stowed = Object.values(c.items).find((i) => i.itemType === 'consumable' || i.itemType === 'equipment')!;
    const { saved } = importCharacter(
      JSON.stringify(
        wgChar({
          inventory: {
            coins: {},
            items: [
              {
                is_equipped: false,
                is_invested: false,
                item: { name: container.name, meta_data: {} },
                container_contents: [{ is_equipped: false, is_invested: false, item: { name: stowed.name, meta_data: { quantity: 2 } } }],
              },
            ],
          },
        }),
      ),
      c,
    );
    expect(saved.build?.inventory?.some((it) => it.itemId === stowed.id)).toBe(true);
  });
});

describe('import error handling', () => {
  it('rejects non-JSON', () => {
    expect(() => importCharacter('not json', c)).toThrow();
  });
  it('rejects an unknown shape', () => {
    expect(() => importCharacter('{"hello":1}', c)).toThrow(/Unrecognized/);
  });
  it('rejects a non-v4 Wanderer’s Guide version', () => {
    expect(() => importCharacter('{"version":3,"character":{}}', c)).toThrow(/version 3/);
  });
});
