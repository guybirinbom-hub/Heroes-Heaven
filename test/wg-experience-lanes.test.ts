import { describe, expect, it } from 'vitest';
import {
  effectDelivery, effectOf, flattenAll, gateStatus, judgeDelivery, laneOfControl, lanesOfControl, laneOfSelect, matchSelects, verdictFor,
} from '../scripts/lib/wg-experience-lanes.mjs';

/**
 * The classifiers behind gate 9 (EXPERIENCE). Shapes are the REAL ones from work/wg/wg-data.sql,
 * quoted from the records that motivated the gate: Domain Initiate's second select shipped with
 * matching data and no picker, and every background's attribute pick hides inside an option's
 * singular `operation` key that the kind mapping never descends.
 */
const domainInitiateSelect = {
  type: 'select',
  data: {
    title: 'Select an Initial Domain Spell', modeType: 'FILTERED', optionType: 'SPELL', optionsPredefined: [],
    optionsFilters: { type: 'SPELL', level: { max: 1 }, traits: ['Domain'], traditions: [], spellData: { type: 'FOCUS', castingSource: 'CLERIC', rank: null } },
  },
};
const doctrineSelect = {
  type: 'select',
  data: { title: 'Select a Doctrine', modeType: 'FILTERED', optionType: 'ABILITY_BLOCK', optionsPredefined: [], optionsFilters: { type: 'ABILITY_BLOCK', level: {}, traits: ['Cleric Doctrine'], abilityBlockType: 'feat' } },
};
const acolyteAttribute = {
  type: 'select',
  data: {
    title: 'Select an Attribute', modeType: 'PREDEFINED', optionType: 'ADJ_VALUE',
    optionsPredefined: [
      { id: 'a', type: 'ADJ_VALUE', operation: { type: 'adjValue', data: { variable: 'ATTRIBUTE_INT', value: { value: 1 } } } },
      { id: 'b', type: 'ADJ_VALUE', operation: { type: 'adjValue', data: { variable: 'ATTRIBUTE_WIS', value: { value: 1 } } } },
    ],
    optionsFilters: { group: 'SKILL', value: { value: 'U' } },
  },
};
const divineFontSelect = {
  type: 'select',
  data: {
    title: 'Select Divine Font', modeType: 'PREDEFINED', optionType: 'CUSTOM',
    optionsPredefined: [
      { id: 'h', type: 'CUSTOM', title: 'Healing Font', description: '…', operations: [{ type: 'giveAbilityBlock', data: { type: 'feat', abilityBlockId: 34054 } }] },
      { id: 'x', type: 'CUSTOM', title: 'Harmful Font', description: '…', operations: [{ type: 'giveAbilityBlock', data: { type: 'feat', abilityBlockId: 34055 } }] },
    ],
  },
};

describe('their selects → lanes', () => {
  it('classifies the four canonical shapes', () => {
    expect(laneOfSelect(domainInitiateSelect).lane).toBe('spell');
    // A subclass pick is a feat select filtered by a family trait on their side; to the player it is a
    // named-thing pick (our "Doctrine" PopupSelect), not a feat slot.
    expect(laneOfSelect(doctrineSelect).lane).toBe('option');
    expect(laneOfSelect({ type: 'select', data: { title: 'Select a Class Feat', optionType: 'ABILITY_BLOCK', optionsFilters: { abilityBlockType: 'feat', traits: ['Cleric'] } } }).lane).toBe('feat');
    expect(laneOfSelect({ type: 'select', data: { title: 'Select a Dedication', optionType: 'ABILITY_BLOCK', optionsFilters: { abilityBlockType: 'feat' } } }).lane).toBe('feat');
    // The filter says SKILL but every predefined option adjusts an ATTRIBUTE_* variable — the options win.
    expect(laneOfSelect(acolyteAttribute).lane).toBe('attribute');
    expect(laneOfSelect(divineFontSelect).lane).toBe('option');
  });
  it('reads a cantrip pick and a language pick', () => {
    expect(laneOfSelect({ type: 'select', data: { title: 'Select a Cantrip', optionType: 'SPELL', optionsFilters: { spellData: { rank: 0 } } } }).lane).toBe('cantrip');
    expect(laneOfSelect({ type: 'select', data: { title: 'Select a Language', optionType: 'LANGUAGE' } }).lane).toBe('language');
    expect(laneOfSelect({ type: 'select', data: { title: 'Select a Domain', optionType: 'CUSTOM' } }).lane).toBe('domain');
  });
});

describe('flattenAll keeps context and finds the hidden singular `operation`', () => {
  it('counts the ops inside predefined options', () => {
    const all = flattenAll(acolyteAttribute);
    const adj = all.filter((x) => x.op.type === 'adjValue');
    expect(adj).toHaveLength(2);
    expect(adj.every((x) => x.ctx.inOption)).toBe(true);
    expect(adj[0].ctx.selectTitle).toBe('Select an Attribute');
  });
  it('gates ops under a LEVEL conditional and reports feature gates as unknowable', () => {
    const cond = {
      type: 'conditional',
      data: {
        conditions: [{ name: 'LEVEL', operator: 'GREATER_THAN_OR_EQUALS', value: '11' }],
        trueOperations: [{ type: 'select', data: { title: 'Select Deity’s Favored Weapon', optionType: 'ADJ_VALUE', optionsFilters: { group: 'WEAPON', value: { value: 'E' } } } }],
        falseOperations: [{ type: 'adjValue', data: { variable: 'SAVE_FORT', value: { value: 'T' } } }],
      },
    };
    const all = flattenAll(cond);
    const sel = all.find((x) => x.op.type === 'select')!;
    expect(gateStatus(sel.ctx.gates, 20)).toBe('open');
    expect(gateStatus(sel.ctx.gates, 3)).toBe('level');
    const els = all.find((x) => x.op.type === 'adjValue')!;
    expect(gateStatus(els.ctx.gates, 20)).toBe('feature'); // an else-branch is reachable only when the test FAILS
    const featGate = flattenAll({
      type: 'conditional',
      data: { conditions: [{ name: 'FEAT_NAMES', operator: 'INCLUDES', value: 'Shield Block' }], trueOperations: [{ type: 'giveSpell', data: { spellId: 1 } }] },
    });
    expect(gateStatus(featGate[1].ctx.gates, 20)).toBe('feature');
  });
});

describe('our controls → lanes, and the matching', () => {
  it('classifies rendered controls', () => {
    expect(laneOfControl({ ctl: 'popup', title: 'Trained skill' })).toBe('skill');
    expect(laneOfControl({ ctl: 'popup', title: 'Attribute boost' })).toBe('attribute');
    expect(laneOfControl({ ctl: 'popup', title: 'Initial domain spell' })).toBe('spell');
    expect(laneOfControl({ ctl: 'slot', title: 'Class feat' })).toBe('feat');
    // A free-text Lore input IS the lore pick (WG: "Select a Lore"); any other free text stays 'text'.
    expect(laneOfControl({ ctl: 'text', title: 'Trained Lore' })).toBe('lore');
    expect(laneOfControl({ ctl: 'text', title: 'Kingdom role' })).toBe('text');
    expect(laneOfControl({ ctl: 'popup', title: 'Divine font' })).toBe('option');
  });
  it('a prompt naming two things answers for both lanes, primary first', () => {
    // A domain pick that mentions the spell it grants, and a spell pick that mentions the domain.
    const domainPick = { ctl: 'popup', title: 'Choose your domain (knowledge, secrecy, or truth) — you gain its domain spell' };
    expect(lanesOfControl(domainPick)).toContain('domain');
    expect(lanesOfControl(domainPick)).toContain('spell');
    const m1 = matchSelects([{ lane: 'domain', title: 'Select a Domain', gate: 'open', inOption: false }], [domainPick]);
    expect(m1.unmatched).toEqual([]);
    const m2 = matchSelects([{ lane: 'tradition', title: 'Select a Tradition', gate: 'open', inOption: false }], [{ ctl: 'popup', title: 'Wayfinder cantrip tradition' }]);
    expect(m2.unmatched).toEqual([]);
    // "Select a Feat" on a feat record is answered by a popup naming the two feats.
    const m3 = matchSelects([{ lane: 'feat', title: 'Select a Feat', gate: 'open', inOption: false }], [{ ctl: 'popup', title: 'Choose Combat Climber or Underwater Marauder' }]);
    expect(m3.unmatched).toEqual([]);
    expect(effectOf({ type: 'adjValue', data: { variable: 'BLACKLIST_ABILITY_BLOCKS', value: 'x' } })!.valueBearing).toBe(false);
  });
  it('matches specific lanes before generic ones and reports the leftovers', () => {
    const selects = [
      { ...laneOfSelect(divineFontSelect), gate: 'open', inOption: false },
      { ...laneOfSelect(domainInitiateSelect), gate: 'open', inOption: false },
    ];
    const controls = [{ ctl: 'popup', title: 'Initial domain spell' }, { ctl: 'popup', title: 'Divine font' }];
    const m = matchSelects(selects, controls.map((c) => ({ ...c, lane: laneOfControl(c) })));
    expect(m.unmatched).toEqual([]);
    expect(m.matched.find((x) => x.select.lane === 'spell')!.control.title).toBe('Initial domain spell');
  });
  it('the pre-fix Domain Initiate shape is MISSING-CONTROL; the fixed shape is OK', () => {
    const selects = [
      { lane: 'domain', title: 'Select a Domain', gate: 'open', inOption: false },
      { ...laneOfSelect(domainInitiateSelect), gate: 'open', inOption: false },
    ];
    const before = verdictFor({ supported: true, error: null, selects, controls: [{ ctl: 'popup', title: 'Domain' }], effects: [], sheetDiffCount: 3 });
    expect(before.verdict).toBe('MISSING-CONTROL');
    expect(before.unmatched[0].title).toBe('Select an Initial Domain Spell');
    const after = verdictFor({ supported: true, error: null, selects, controls: [{ ctl: 'popup', title: 'Domain' }, { ctl: 'popup', title: 'Initial domain spell' }], effects: [], sheetDiffCount: 3 });
    expect(after.verdict).toBe('OK');
  });
});

describe('their effects → NO-SHEET-EFFECT', () => {
  it('tells value-bearing effects from text-only and UI plumbing', () => {
    expect(effectOf({ type: 'adjValue', data: { variable: 'SAVE_FORT', value: { value: 'E' } } })!.valueBearing).toBe(true);
    expect(effectOf({ type: 'adjValue', data: { variable: 'PRIMARY_SHEET_TABS', value: 'spells' } })!.valueBearing).toBe(false);
    expect(effectOf({ type: 'addBonusToValue', data: { variable: 'SAVE_FORT', text: 'a success is a critical success' } })!.valueBearing).toBe(false);
    expect(effectOf({ type: 'createValue', data: { variable: 'SKILL_LORE_UNDEAD', type: 'prof', value: { value: 'T' } } })!.valueBearing).toBe(true);
    expect(effectOf({ type: 'injectText', data: { type: 'feat', id: 1, text: 'x' } })).toBeNull();
    expect(effectOf({ type: 'select', data: {} })).toBeNull();
  });
  it('a record whose open value-bearing effects move nothing on our sheet fails', () => {
    const effects = [{ type: 'adjValue', variable: 'SAVE_FORT', valueBearing: true, gate: 'open', inOption: false }];
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects, sheetDiffCount: 0 }).verdict).toBe('NO-SHEET-EFFECT');
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects, sheetDiffCount: 1 }).verdict).toBe('OK');
    // Gated or option-bound effects are reported, never failed on.
    const gated = [{ ...effects[0], gate: 'feature' }, { ...effects[0], inOption: true }];
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects: gated, sheetDiffCount: 0 }).verdict).toBe('OK');
    expect(verdictFor({ supported: false, error: null, selects: [], controls: [], effects, sheetDiffCount: 0 }).verdict).toBe('UNSUPPORTED');
    expect(verdictFor({ supported: true, error: 'boom', selects: [], controls: [], effects, sheetDiffCount: 0 }).verdict).toBe('HARNESS-ERROR');
  });
});

describe('the chassis fallback — delivery judged on the built character', () => {
  const surface = {
    stars: { stealth: true, will: true },
    proficiencies: { perception: 'expert', classDc: 'trained', saves: { fortitude: 'expert', reflex: 'trained', will: 'expert' }, skills: { religion: 'trained' }, attacks: { simple: 'trained', unarmed: 'trained' }, defenses: { unarmored: 'trained' } },
    spellcasting: [{ id: 'cleric', type: 'prepared', tradition: 'divine', proficiency: 'legendary', cantripCap: 5, cantripsPrepared: true, slotRanks: 10 }],
    featNames: ['Domain Initiate'],
    featureNames: ['Cleric Spellcasting', 'Doctrine', 'Divine Font'],
    spellNames: ['Heal', 'Guidance'],
    languages: ['common'],
    traits: ['holy'],
  };
  const names = { block: new Map([['20077', 'Domain Initiate'], ['34054', 'Healing Font']]), spell: new Map([['4656', 'Heal'], ['1', 'Fireball']]), trait: new Map([['7', 'Holy'], ['8', 'Unholy']]) };
  it('reads critical specialization, resistances and lore skills off the surface', () => {
    const s = { ...surface, critSpec: 1, defenses: { resistances: [{ type: 'fire', value: 5 }] }, proficiencies: { ...surface.proficiencies, skills: { ...surface.proficiencies.skills, 'lore:games': 'trained' } }, stars: { ...surface.stars, 'lore:games': true } };
    expect(effectDelivery(eff('adjValue', { variable: 'WEAPON_CRITICAL_SPECIALIZATIONS', value: 'SWORD' }, 'WEAPON_CRITICAL_SPECIALIZATIONS'), s, names)).toBe('delivered');
    expect(effectDelivery(eff('adjValue', { variable: 'WEAPON_CRITICAL_SPECIALIZATIONS', value: 'SWORD' }, 'WEAPON_CRITICAL_SPECIALIZATIONS'), { ...s, critSpec: 0 }, names)).toBe('undelivered');
    expect(effectDelivery(eff('adjValue', { variable: 'RESISTANCES', value: 'FIRE 5' }, 'RESISTANCES'), s, names)).toBe('delivered');
    expect(effectDelivery(eff('adjValue', { variable: 'RESISTANCES', value: 'FIRE 5' }, 'RESISTANCES'), { ...s, defenses: { resistances: [] } }, names)).toBe('undelivered');
    expect(effectDelivery(eff('createValue', { variable: 'SKILL_LORE_GAMES', type: 'prof', value: { value: 'T' } }, 'SKILL_LORE_GAMES'), s, names)).toBe('delivered');
    expect(effectDelivery(eff('createValue', { variable: 'SKILL_LORE_LEGAL', type: 'prof', value: { value: 'T' } }, 'SKILL_LORE_LEGAL'), s, names)).toBe('undelivered');
    expect(effectDelivery(eff('addBonusToValue', { variable: 'SKILL_LORE_GAMES', value: 1 }, 'SKILL_LORE_GAMES'), s, names)).toBe('delivered');
  });
  it('reads a granted Speed off the derived speeds, whatever their shape', () => {
    const obj = { ...surface, speeds: { land: 25, swim: 20 } };
    expect(effectDelivery(eff('setValue', { variable: 'SPEED_SWIM', value: 20 }, 'SPEED_SWIM'), obj, names)).toBe('delivered');
    expect(effectDelivery(eff('setValue', { variable: 'SPEED_FLY', value: 20 }, 'SPEED_FLY'), obj, names)).toBe('undelivered');
    expect(effectDelivery(eff('adjValue', { variable: 'SPEED', value: 5 }, 'SPEED'), obj, names)).toBe('delivered');
    const arr = { ...surface, speeds: [{ type: 'land', value: 25 }, { type: 'climb', value: 15 }] };
    expect(effectDelivery(eff('setValue', { variable: 'SPEED_CLIMB', value: 15 }, 'SPEED_CLIMB'), arr, names)).toBe('delivered');
    expect(effectDelivery(eff('setValue', { variable: 'SPEED_SWIM', value: 15 }, 'SPEED_SWIM'), { ...surface, speeds: null }, names)).toBe('unchecked');
  });
  it('reads a conditional numeric bonus as a star on the stat row, and a trait by name', () => {
    expect(effectDelivery(eff('addBonusToValue', { variable: 'SKILL_STEALTH', value: 1, text: 'in dim light' }, 'SKILL_STEALTH'), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('addBonusToValue', { variable: 'SAVE_WILL', value: 1 }, 'SAVE_WILL'), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('addBonusToValue', { variable: 'SKILL_CRAFTING', value: 2 }, 'SKILL_CRAFTING'), surface, names)).toBe('undelivered');
    // A damage rider is a star on a Strike row (strikeDamage); a Starfinder-only skill has no row at all.
    expect(effectDelivery(eff('addBonusToValue', { variable: 'ATTACK_DAMAGE_BONUS', value: 2 }, 'ATTACK_DAMAGE_BONUS'), surface, names)).toBe('undelivered');
    expect(effectDelivery(eff('addBonusToValue', { variable: 'ATTACK_DAMAGE_BONUS', value: 2 }, 'ATTACK_DAMAGE_BONUS'), { ...surface, stars: { ...surface.stars, strikeDamage: true } }, names)).toBe('delivered');
    expect(effectDelivery(eff('addBonusToValue', { variable: 'SKILL_COMPUTERS', value: 1 }, 'SKILL_COMPUTERS'), surface, names)).toBe('unchecked');
    expect(effectDelivery(eff('giveTrait', { traitId: 7 }), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('giveTrait', { traitId: 8 }), surface, names)).toBe('undelivered');
  });
  const eff = (type, data, variable = null) => ({ type, variable, valueBearing: true, gate: 'open', inOption: false, data });

  it('reads proficiency letters against the character', () => {
    expect(effectDelivery(eff('adjValue', { variable: 'PERCEPTION', value: { value: 'E' } }, 'PERCEPTION'), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('adjValue', { variable: 'SAVE_REFLEX', value: { value: 'E' } }, 'SAVE_REFLEX'), surface, names)).toBe('undelivered');
    expect(effectDelivery(eff('adjValue', { variable: 'SKILL_RELIGION', value: { value: 'T' } }, 'SKILL_RELIGION'), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('adjValue', { variable: 'SPELL_DC', value: { value: 'M' } }, 'SPELL_DC'), surface, names)).toBe('delivered');
    // A numeric adjustment or an unmapped variable cannot be judged here — reported, never passed.
    expect(effectDelivery(eff('adjValue', { variable: 'ATTRIBUTE_WIS', value: { value: 1 } }, 'ATTRIBUTE_WIS'), surface, names)).toBe('unchecked');
    expect(effectDelivery(eff('setValue', { variable: 'MAX_HEALTH_CLASS_PER_LEVEL', value: 8 }, 'MAX_HEALTH_CLASS_PER_LEVEL'), surface, names)).toBe('unchecked');
  });
  it('sees casting sources, slots, granted blocks and spells', () => {
    expect(effectDelivery(eff('defineCastingSource', { value: 'CLERIC:::PREPARED-TRADITION:::DIVINE:::ATTRIBUTE_WIS' }, 'CASTING_SOURCES'), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('defineCastingSource', { value: 'X:::PREPARED-LIST:::ARCANE:::ATTRIBUTE_INT' }, 'CASTING_SOURCES'), { ...surface, spellcasting: [] }, names)).toBe('undelivered');
    expect(effectDelivery(eff('giveSpellSlot', { castingSource: 'CLERIC', slots: [] }), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('giveAbilityBlock', { type: 'feat', abilityBlockId: 20077 }), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('giveAbilityBlock', { type: 'feat', abilityBlockId: 34054 }), surface, names)).toBe('undelivered');
    expect(effectDelivery(eff('giveAbilityBlock', { type: 'feat', abilityBlockId: 99999 }), surface, names)).toBe('unchecked');
    expect(effectDelivery(eff('giveSpell', { spellId: 4656 }), surface, names)).toBe('delivered');
    expect(effectDelivery(eff('giveSpell', { spellId: 1 }), surface, names)).toBe('undelivered');
  });
  it('turns the buckets into a verdict only when the differential was empty', () => {
    const effects = [eff('defineCastingSource', { value: 'CLERIC:::PREPARED-TRADITION:::DIVINE:::ATTRIBUTE_WIS' }, 'CASTING_SOURCES'), eff('giveSpellSlot', { slots: [] })];
    const delivery = judgeDelivery(effects, surface, names);
    expect(delivery.delivered).toHaveLength(2);
    const ok = verdictFor({ supported: true, error: null, selects: [], controls: [], effects, sheetDiffCount: 0, delivery });
    expect(ok.verdict).toBe('OK');
    expect(ok.deliveredBy).toBe('surface');
    const bad = judgeDelivery([eff('adjValue', { variable: 'SAVE_REFLEX', value: { value: 'E' } }, 'SAVE_REFLEX')], surface, names);
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects: [effects[0]], sheetDiffCount: 0, delivery: bad }).verdict).toBe('NO-SHEET-EFFECT');
    const none = judgeDelivery([eff('setValue', { variable: 'MAX_HEALTH_CLASS_PER_LEVEL', value: 8 }, 'MAX_HEALTH_CLASS_PER_LEVEL')], surface, names);
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects: [effects[0]], sheetDiffCount: 0, delivery: none }).verdict).toBe('UNVERIFIED-EFFECT');
    // A non-empty differential never consults the fallback.
    expect(verdictFor({ supported: true, error: null, selects: [], controls: [], effects, sheetDiffCount: 4, delivery: bad }).verdict).toBe('OK');
  });
});
