import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import type { SavedChar } from '../src/data/storage';
import { exportNative, exportWg, importCharacter } from '../src/data/transfer';

const c = content();

function saved(name: string, classId = 'cleric', level = 5): SavedChar {
  return { id: 'rost-1', character: { ...build(classId, level), name }, archived: false };
}

describe('native Codex export/import (lossless)', () => {
  it('round-trips a character through exportNative → importCharacter', () => {
    const s = saved('Native Hero');
    const { saved: back, report } = importCharacter(exportNative(s), c);
    expect(report.source).toBe('Wanderer’s Codex');
    expect(report.lossless).toBe(true);
    expect(back.character.name).toBe('Native Hero');
    expect(back.character.level).toBe(5);
    expect(back.character.classId).toBe('cleric');
    expect(back.character.abilities).toEqual(s.character.abilities);
    expect(back.id).not.toBe(s.id); // a fresh roster id is assigned
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
