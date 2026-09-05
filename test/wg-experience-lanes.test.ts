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

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * BATCH 25 — WHAT THE COMPARERS WERE TAUGHT, AND WHAT THEY WERE TOLD TO STOP ASKING.
 *
 * Four batch-25 findings were instrument defects, not data gaps: the comparer could not see a carrier
 * we ship. Each is a WIDENING, and a widening is exactly the change that silently narrows again when
 * someone tidies a field list — so the four are pinned here by RUNNING the comparers, not by reading
 * their source. The two remaining rows are SETTLES, and `--raw` proves the settle is what quiets them:
 * without it the comparer still finds the difference, so the registry is doing the silencing and the
 * comparer is not broken.
 */
const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

describe('batch 25 — the comparers read the carriers we actually ship', () => {
  it('wg-diff credits a choiceResistance picker and an innate-spell grant', () => {
    // `--out` is ROOT-relative; its own scratch file, so a test run cannot clobber the gate's.
    const out = 'work/.wg-diff-lanes-test.json';
    runScript('wg-diff.mjs', ['--out', out]);
    const diff = JSON.parse(readFileSync(join(CLI_ROOT, out), 'utf8'));
    rmSync(join(CLI_ROOT, out), { force: true });
    const theyOnly = new Map<string, string[]>(diff.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
    // Deep Fetchling: "You gain cold or negative resistance … chosen when you gain this heritage" is
    // asked through `choiceResistance`, which was filed under `defense` alone.
    expect(theyOnly.get('deep-fetchling')).toBeUndefined();
    // Forge-Blessed Dwarf: the innate divine spell rides inside an effectChoices option's
    // `grant.innateSpells`, and the spell attack / DC that comes with it is delivered centrally at
    // src/rules/build.ts:7113 rather than per record.
    expect(theyOnly.get('forge-blessed-dwarf')).toBeUndefined();
    // …and the differ still reports: a widening that silenced the whole list would pass every check
    // above while hiding every real gap.
    expect(diff.theyOnly.length).toBeGreaterThan(100);
  }, 120_000);

  it('wg-values resolves a heritage land Speed through the ancestry chassis', () => {
    // Spindly Anadi prints "Your Speed increases from 25 to 30 feet"; ours is `landSpeedBonus: 5` on
    // the anadi chassis's 25, theirs is an absolute `setValue SPEED = 30`.
    const out = runScript('wg-values.mjs', ['--ids', 'spindly-anadi', '--verbose']);
    expect(out).toMatch(/compared 1 records with at least one comparable value; 1 agree/);
    expect(out).toMatch(/^0 records with at least one value to adjudicate/m);
  }, 60_000);

  it('wg-identity reads void healing and the resistance picker, and settles only the tradition gate', () => {
    const ids = 'dhampir,deep-fetchling,rite-of-invocation,cataphract-fleshwarp';
    const out = runScript('wg-identity.mjs', ['--ids', ids]);
    // dhampir: their named "Void Healing" block against our boolean `negativeHealing`.
    // deep-fetchling: their cold/void select against our `choiceResistance.options`.
    expect(out).not.toContain('--- dhampir');
    expect(out).not.toContain('--- deep-fetchling');
    // rite-of-invocation: their two option titles are a TRADITION GATE and the cantrip pick is the
    // nested FILTERED SPELL select — settled in SETTLED_IDENTITIES.
    expect(out).not.toContain('--- rite-of-invocation');
    /*
     * …and cataphract-fleshwarp is quiet BECAUSE OF DATA, not a settle. Its `grants` bucket was once
     * settled on the reading that their two feats are opposite branches of one conditional — true, but
     * the Armor Assist string in that bucket is a feat print says the character gets (*"…you instead
     * become trained in Athletics … and gain the Armor Assist skill feat"*) and ours granted nowhere,
     * so the settle was withdrawn. Batch 25 then moved both feats onto the branch itself
     * (`effectChoices[].options[].grant.grantsFeats`, read by `addOptionGrants` here and by the
     * granted-feat pass in build.ts), which is why the record no longer reports — and must not.
     */
    expect(out).not.toContain('--- cataphract-fleshwarp');
    expect(out).toMatch(/^0 records where a named thing/m);
    // …and with the registry bypassed only the SETTLED record comes back (rite-of-invocation), so the
    // three taught carriers pass on their own merits and the settle quiets exactly one.
    const raw = runScript('wg-identity.mjs', ['--ids', ids, '--raw']);
    expect(raw).toContain('--- rite-of-invocation');
    expect(raw).toMatch(/^1 records where a named thing/m);
    expect(raw).toContain('--- rite-of-invocation');
    expect(raw).not.toContain('--- dhampir');
    expect(raw).not.toContain('--- deep-fetchling');
  }, 60_000);
});

describe('batch 26 — the instruments read the carriers we actually ship', () => {
  const eff = (type: string, data: Record<string, unknown>, variable: string | null = null) =>
    ({ type, variable, valueBearing: true, gate: 'open', inOption: false, data });
  /* A host with NOTHING on it — which is what the harness builds for a record whose pick is unanswered. */
  const bare = { stars: {}, proficiencies: {}, spellcasting: [] as { proficiency: string }[], featNames: [], featureNames: [], spellNames: [], languages: [], traits: [] };
  const names = { block: new Map(), spell: new Map(), trait: new Map() };

  it('credits the innate spell attack/DC pair to a record that GRANTS an innate spell', () => {
    /*
     * Spellhorn Kobold: *"…You can Cast this Spell as an arcane innate spell at will … You are trained
     * in the spell attack modifier and spell DC statistics"*, which their side writes as
     * `adjValue SPELL_ATTACK/SPELL_DC = T`. Ours never writes it per record — the innate entry the
     * cantrip creates carries the proficiency centrally (Player Core p.298, trained, expert at 12th;
     * src/rules/build.ts:7219-7244) — so the entry exists only once the pick is ANSWERED, and the
     * harness builds every host with its controls empty. The GRANT is the predicate, not the host.
     */
    const attackT = eff('adjValue', { variable: 'SPELL_ATTACK', value: { value: 'T' } }, 'SPELL_ATTACK');
    expect(effectDelivery(attackT, bare, names)).toBe('unchecked');
    expect(effectDelivery(attackT, { ...bare, grantsInnateSpell: true }, names)).toBe('delivered');
    // …and a rank ABOVE the engine-wide innate floor is not evidence — that floor only reaches trained.
    const dcE = eff('adjValue', { variable: 'SPELL_DC', value: { value: 'E' } }, 'SPELL_DC');
    expect(effectDelivery(dcE, { ...bare, grantsInnateSpell: true }, names)).toBe('unchecked');
    // …and a host that DOES have a casting entry is still judged on that entry's real proficiency, so a
    // record granting an innate spell to an untrained caster keeps reporting.
    const untrained = { ...bare, grantsInnateSpell: true, spellcasting: [{ proficiency: 'untrained' }] };
    expect(effectDelivery(attackT, untrained, names)).toBe('undelivered');
  });

  it('wg-diff credits an alternate-attribute package and a general-feat slot', () => {
    const out = 'work/.wg-diff-b026-test.json';
    runScript('wg-diff.mjs', ['--out', out]);
    const diff = JSON.parse(readFileSync(join(CLI_ROOT, out), 'utf8')) as Record<string, { id: string; missing?: string[]; ourKinds: string[] }[]>;
    rmSync(join(CLI_ROOT, out), { force: true });
    const rowOf = (id: string) => [...diff.theyOnly, ...diff.weOnly, ...diff.agree].find((r) => r.id === id);
    /*
     * MIGHTYFALL KOBOLD — *"You gain 10 Hit Points from your ancestry instead of 6. Instead of the
     * normal attribute boosts and flaws, you can choose to gain a boost to Strength, a boost to
     * Charisma, and a flaw in Intelligence."* Both halves live inside `alternateAttributes`, one level
     * below the top-level field names the kind map reads, so the record reported missing=[hp,attribute]
     * while heritageAdjustedAncestryAttributes (build.ts:663) and resolvedAncestryHp (build.ts:685)
     * both read it. (WHETHER the 10 is unconditional is a values question, adjudicated on the record.)
     */
    expect(diff.theyOnly.find((r) => r.id === 'mightyfall-kobold')).toBeUndefined();
    expect(rowOf('mightyfall-kobold')?.ourKinds).toEqual(expect.arrayContaining(['attribute', 'hp']));
    /*
     * VERSATILE HUMAN — *"Select a general feat of your choice for which you meet the prerequisites."*
     * A slot is a selection: `grantsGeneralFeat` opens the picker at src/builder/shared.tsx:2694-2707
     * and injects the answer as a level-1 general feat at src/rules/build.ts:4411-4420, but only
     * `choice`/`effectChoices` counted as asking.
     */
    expect(diff.theyOnly.find((r) => r.id === 'versatile-human')).toBeUndefined();
    expect(rowOf('versatile-human')?.ourKinds).toContain('choice');
  }, 120_000);

  it('wg-values keeps the SIGN of a Speed adjustment on both sides', () => {
    /*
     * Seaweed Leshy: *"However, your land Speed is reduced by 5 feet (to 20 feet for most seaweed
     * leshies)"* — their `adjValue SPEED = -5`. Stripping the sign rendered the penalty as a bonus
     * ("theirs=5"), so the record was adjudicated against the opposite mechanic. The disagreement row
     * itself clears once our penalty is authored, so what is pinned here is the SIGN, not the row.
     */
    const seaweed = runScript('wg-values.mjs', ['--ids', 'seaweed-leshy', '--verbose']);
    expect(seaweed).not.toMatch(/speed\|land\s+theirs=5\b/);
    if (/speed\|land/.test(seaweed)) expect(seaweed).toMatch(/speed\|land\s+theirs=-5\b/);
    /*
     * …and the mirror `Math.abs` on OUR side went with it, so the corpus's other negative Speed still
     * agrees: Zombie Dedication's *"reduce all your Speeds by 5"* is `speedAdjust: {key:'all', add:-5}`
     * against their -5. A one-sided re-abs on either side turns this record red.
     */
    const zombie = runScript('wg-values.mjs', ['--ids', 'zombie-dedication', '--verbose']);
    expect(zombie).toContain('ok    zombie-dedication');
    expect(zombie).toMatch(/^0 records with at least one value to adjudicate/m);
  }, 60_000);

  it('wg-values resolves a conditional Speed STAR through the ancestry chassis', () => {
    /*
     * Dog Kholo: *"If you have both hands free, you can increase your Speed to 30 feet as you run on
     * all fours"* — theirs is `addBonusToValue SPEED = 5` with the trigger parked in the op's text;
     * ours is a situationalBonuses star whose `bonus` states the printed TOTAL ("Speed becomes 30
     * feet") against the kholo 25-foot chassis. With only the total asserted the record read
     * `DIFFERENT theirs=5 ours=30` the moment its star was authored — the instrument turning red
     * BECAUSE the gap had been fixed. Same both-forms rule the unconditional `landSpeedBonus` chassis
     * lane already follows, and bounded to a magnitude at or above the chassis so a star that states a
     * delta ("+10 feet circumstance", 129 of the registry's 130 speed stars) is compared as itself.
     */
    const dog = runScript('wg-values.mjs', ['--ids', 'dog-kholo', '--verbose']);
    expect(dog).toContain('ok    dog-kholo');
    expect(dog).toMatch(/^0 records with at least one value to adjudicate/m);
  }, 60_000);

  it('wg-identity reads an unarmedTraits rider as their pre-modified unarmed item', () => {
    const ids = 'warrior-jotunborn,mightyfall-kobold,dragonscaled-kobold';
    const out = runScript('wg-identity.mjs', ['--ids', ids]);
    expect(out).not.toContain('--- warrior-jotunborn');
    expect(out).not.toContain('--- mightyfall-kobold');
    expect(out).not.toContain('--- dragonscaled-kobold');
    expect(out).toMatch(/^0 records where a named thing/m);
    /*
     * With the registry bypassed only the two SETTLED records come back, so warrior-jotunborn passes on
     * its own carrier: their `giveItem` names item 18256 "Warrior Jotunborn Fist" for *"The damage die
     * for your fist increases to 1d6"*; ours is the `unarmedTraits` rider on the fist the character
     * already has (derive.ts:4503 folds heritage records into the rider sources). Handing over a second
     * fist would give the character two — and the same shape had been hand-settled eight times before
     * it was taught.
     */
    const raw = runScript('wg-identity.mjs', ['--ids', ids, '--raw']);
    expect(raw).not.toContain('--- warrior-jotunborn');
    expect(raw).toContain('--- mightyfall-kobold');       // option LABELS only; see SETTLED_IDENTITIES
    expect(raw).toContain('--- dragonscaled-kobold');
  }, 60_000);
});

describe('batch 27 — the instruments read the carriers we actually ship', () => {
  /*
   * LOREKEEPER SHISK. Print: *"You become trained in one Lore skill and one other Intelligence- or
   * Wisdom-based skill of your choice."* Ours renders ONE control, a skill picker over the eight
   * Int/Wis skills — an exact set-match with their eight predefined SKILL_* options. It laned [lore]
   * because the prompt says "lorekeeping" and names a Lore inside a parenthetical, so the matcher spent
   * it on their "Select a Lore" and the report blamed the wrong control. The absent LORE control is the
   * real gap and is settled under lorekeeper-shisk#lore.
   */
  const lorekeeperPicker = {
    ctl: 'popup',
    title: 'Choose the Intelligence- or Wisdom-based skill your lorekeeping trains (you also gain a Lore skill of your choice, tracked separately; both become expert at 5th level)',
    options: 8,
  };
  it('lanes a skill picker by its primary subject, not by a parenthetical or a substring', () => {
    expect(laneOfControl(lorekeeperPicker)).toBe('skill');
    expect(lanesOfControl(lorekeeperPicker)).not.toContain('lore');
    // A parenthetical is not the subject…
    expect(laneOfControl({ ctl: 'popup', title: 'Trained skill (a Lore counts)' })).toBe('skill');
    // …and "lore" inside a longer word is not a Lore pick, while the bare word still is.
    expect(laneOfControl({ ctl: 'popup', title: 'Your lorekeeping skill' })).toBe('skill');
    expect(laneOfControl({ ctl: 'popup', title: 'Heritage Lore' })).toBe('lore');
    expect(laneOfControl({ ctl: 'text', title: 'Lore subject' })).toBe('lore');
    // …and the two documented exceptions still hold: a feat slot beats "skill", and "Initial domain
    // spell" picks the SPELL though it names the domain first (why ordering by first mention is wrong).
    expect(laneOfControl({ ctl: 'popup', title: 'Bonus skill feat' })).toBe('feat');
    expect(laneOfControl({ ctl: 'popup', title: 'Initial domain spell' })).toBe('spell');
  });
  it('their Lore select is the one left unanswered, and it names the Lore', () => {
    const selects = [
      { lane: 'lore', title: 'Select a Lore', gate: 'open', inOption: false },
      { lane: 'skill', title: 'Select a Skill', gate: 'open', inOption: false },
    ];
    const { matched, unmatched } = matchSelects(selects, [{ ...lorekeeperPicker, lane: laneOfControl(lorekeeperPicker) }]);
    expect(matched.map((m) => m.select.title)).toEqual(['Select a Skill']);
    expect(unmatched.map((s) => s.title)).toEqual(['Select a Lore']);
  });

  it('wg-diff resolves injectSelectOption to the owning record and ignores a value-less annotation', () => {
    const out = 'work/.wg-diff-b027-test.json';
    runScript('wg-diff.mjs', ['--out', out]);
    const diff = JSON.parse(readFileSync(join(CLI_ROOT, out), 'utf8')) as Record<string, { id: string; missing?: string[] }[]>;
    rmSync(join(CLI_ROOT, out), { force: true });
    const theyOnly = new Map(diff.theyOnly.map((r) => [r.id, r.missing ?? []]));
    /*
     * THE FOUR SURKI — their heritage rows own no `select` at all. Each emits `injectSelectOption`
     * whose payload names opId 39f5996f-…, the id of the "Select an Evolution" select on their ability
     * block 28165 «Grand Metamorphosis». Print puts the question there too (feat-5393, Feat 9: *"You
     * gain one of the evolutions from your surki heritage"*), and so do we —
     * feats['grand-metamorphosis'].choice, flag 'surkiEvolution'. Scoring the injection as a
     * heritage-level `choice` demanded a picker print does not ask the heritage for.
     */
    for (const id of ['lantern-surki', 'hardshell-surki', 'elytron-surki', 'breaker-surki']) {
      expect(theyOnly.get(id) ?? []).not.toContain('choice');
    }
    /*
     * FISHSEEKER SHOONY — their two ops are `addBonusToValue SKILL_ACROBATICS` and
     * `addBonusToValue SAVE_REFLEX` carrying only `variable` and `text`, NO `value`: the Grab an Edge
     * sentence pinned to two display surfaces. Print trains no skill; ours carries both printed clauses
     * as `degreeShifts` on saves:['reflex'] + actions:['grab-an-edge'], which is kind `conditional`.
     */
    expect(theyOnly.get('fishseeker-shoony')).toBeUndefined();
    /*
     * …AND THE ALLOWANCE IS GATED ON US ACTUALLY MODELLING THE RULE. Rewriting the value-less
     * `addBonusToValue` to kind `conditional` inside `kindOfTheirOp` was tried and reverted: `missing`
     * drops `conditional` whenever `gatesOnlyWhatWeHave`, and that predicate is VACUOUSLY TRUE on a row
     * carrying no `conditional` op at all, so these four bare feats — not one of which holds a single
     * mechanical field on our side — went straight from THEY-ONLY into AGREE with `ourKinds: []`. Each
     * keeps the display surface its note is pinned to, because that gap is real.
     */
    expect(theyOnly.get('murksight')).toContain('perception');
    expect(theyOnly.get('greenwatcher')).toContain('save');
    expect(theyOnly.get('insistent-command')).toContain('skill');
    expect(theyOnly.get('assured-runic-crafter')).toContain('skill');
    /* Icy Apotheosis writes *"You automatically succeed against effects that have the cold trait"* on
     * all three saves as value-less notes; we model only the cold immunity, so `save` still reports. */
    expect(theyOnly.get('icy-apotheosis')).toContain('save');
    /* …and a kind our SKILL lane already answers is not stolen by the allowance: Half-Truths' prose op
     * (*"attempt to make a Request … using Deception instead of Diplomacy"*) is `skillSubstitutions`,
     * and Officer's Medical Training's is `skillAbilitySwap` — both SKILL, not conditional. */
    expect(theyOnly.get('half-truths')).toBeUndefined();
    expect(theyOnly.get('officers-medical-training')).toBeUndefined();
    // …and the differ still reports: a widening that silenced the list would pass every check above.
    expect(diff.theyOnly.length).toBeGreaterThan(100);
  }, 120_000);

  it('wg-values reads a weakness carried by an effectChoices option', () => {
    /*
     * TSUKUMOGAMI POPPET — *"If your body is primarily metal, you're instead weak to electricity; if
     * it's primarily ceramic, you're instead weak to cold."* Both live on
     * `effectChoices[0].options[].grant.weaknesses` and reach the sheet through chosenEffects. The set
     * comparison read `weaknesses` / `passiveEffects.weaknesses` / `grant.passive.weaknesses` but not
     * `grant.weaknesses`, and reported "theirs=electricity,cold ours=(nothing)".
     */
    const out = runScript('wg-values.mjs', ['--ids', 'tsukumogami-poppet', '--verbose']);
    expect(out).not.toMatch(/SET-GAP\s+set\|weaknesses/);
  }, 60_000);

  it('wg-identity sweeps the pinned feat-pick table keyed by a heritage id', () => {
    /*
     * STEADFAST TANUKI — *"You gain your choice of Everyday Form or Teakettle Form as a bonus ancestry
     * feat."* Ours is `featPickGrants.ts: 'steadfast-tanuki'` with ids ['everyday-form','teakettle-form'],
     * read as FEAT_PICK_GRANTS[build.heritageId]; theirs is a two-option select whose labels are those
     * feats' names. The registry fed our `grants` bucket only, so the options bucket read "ours=(nothing)".
     */
    const out = runScript('wg-identity.mjs', ['--ids', 'steadfast-tanuki']);
    expect(out).not.toContain('--- steadfast-tanuki');
    expect(out).toMatch(/^0 records where a named thing/m);
  }, 60_000);
});
