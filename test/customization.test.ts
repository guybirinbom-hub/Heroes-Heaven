import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUSTOMIZATION,
  effectiveCustomization,
  withCustomizationField,
  isCustomizationEmpty,
  densityStyleId,
  stripAppearanceAxes,
} from '../src/data/customization';
import type { Customization } from '../src/rules/types';

describe('customization — effective merge', () => {
  it('layers baseline < global default < per-character override', () => {
    const global: Customization = { compactActions: false, accentColor: '#111111' };
    const override: Customization = { accentColor: '#ff0000' };
    const eff = effectiveCustomization(global, override);
    expect(eff.accentColor).toBe('#ff0000'); // override wins
    expect(eff.compactActions).toBe(false); // from global
    expect(eff.showLevelChip).toBe(true); // from baseline default
  });

  it('a null/empty override just yields the global default', () => {
    const global: Customization = { density: 'compact' };
    expect(effectiveCustomization(global, null)).toEqual({ ...DEFAULT_CUSTOMIZATION, density: 'compact' });
    expect(effectiveCustomization(global, {})).toEqual({ ...DEFAULT_CUSTOMIZATION, density: 'compact' });
  });

  it('array fields are replaced, not merged', () => {
    const global: Customization = { railHidden: ['hp', 'saves'] };
    const eff = effectiveCustomization(global, { railHidden: ['languages'] });
    expect(eff.railHidden).toEqual(['languages']);
  });
});

describe('customization — override editing', () => {
  it('withCustomizationField sets a value and removes it when undefined', () => {
    let o = withCustomizationField(undefined, 'accentColor', '#abcdef');
    expect(o.accentColor).toBe('#abcdef');
    o = withCustomizationField(o, 'density', 'cozy');
    expect(o).toEqual({ accentColor: '#abcdef', density: 'cozy' });
    o = withCustomizationField(o, 'accentColor', undefined);
    expect(o.accentColor).toBeUndefined();
    expect('accentColor' in o).toBe(false);
  });

  it('isCustomizationEmpty treats only undefined / {} as empty; an explicit empty array is a real override', () => {
    expect(isCustomizationEmpty(undefined)).toBe(true);
    expect(isCustomizationEmpty({})).toBe(true);
    // An explicit empty array ("hide nothing") overrides a non-empty global default → NOT empty.
    expect(isCustomizationEmpty({ railHidden: [] })).toBe(false);
    expect(isCustomizationEmpty({ compactActions: false })).toBe(false);
    expect(isCustomizationEmpty({ railHidden: ['hp'] })).toBe(false);
  });
});

describe('customization — density mapping', () => {
  it('maps the 3-way density to existing style ids (or null to follow the app style)', () => {
    expect(densityStyleId(undefined)).toBeNull();
    expect(densityStyleId('comfortable')).toBe('modern');
    expect(densityStyleId('compact')).toBe('compact');
    expect(densityStyleId('cozy')).toBe('cozy');
  });
});

describe('customization — make-global-default / reset semantics', () => {
  // Make-global-default splits the effective look: appearance axes go to the DEVICE (theme-manager/zoom),
  // and only the SHEET options are stored in the global customization blob. setGlobalCustomization enforces
  // this by stripping the axes; stripAppearanceAxes is that guard.
  it('stripAppearanceAxes drops the device-level appearance axes but keeps the sheet options', () => {
    const eff: Customization = {
      themeId: 'ember', styleId: 'compact', fontId: 'slab', zoom: 1.2, accentColor: '#ff0000',
      compactActions: false, hiddenTabs: ['Spells'], showSaveDCs: true,
    };
    const global = stripAppearanceAxes(eff);
    expect(global.themeId).toBeUndefined();
    expect(global.styleId).toBeUndefined();
    expect(global.fontId).toBeUndefined();
    expect(global.zoom).toBeUndefined();
    expect(global.accentColor).toBeUndefined();
    // sheet options survive
    expect(global.compactActions).toBe(false);
    expect(global.hiddenTabs).toEqual(['Spells']);
    expect(global.showSaveDCs).toBe(true);
  });

  it('a promoted sheet-option default is adopted by uncustomized characters but not by customized ones', () => {
    // Promote character A's compactActions=false into the global default (axis-free sheet option).
    const newGlobal = stripAppearanceAxes(effectiveCustomization({ compactActions: true }, { compactActions: false }));
    expect(newGlobal.compactActions).toBe(false);
    expect(effectiveCustomization(newGlobal, {}).compactActions).toBe(false); // uncustomized follows
    expect(effectiveCustomization(newGlobal, { compactActions: true }).compactActions).toBe(true); // customized keeps its own
  });

  it('reset clears a character\'s override so it follows the global default again', () => {
    const global: Customization = { accentColor: '#123456' };
    const before = effectiveCustomization(global, { accentColor: '#ffffff' });
    expect(before.accentColor).toBe('#ffffff');
    const afterReset = effectiveCustomization(global, undefined); // reset → override undefined
    expect(afterReset.accentColor).toBe('#123456');
  });
});
