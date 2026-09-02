// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applySheetOverlay, clearSheetOverlay, getAppearance, hasSheetOverlay, initTheme, setTheme } from '../src/theme/theme-manager';
import { bundleSettingsChanged } from '../src/data/cloudSync';
import { saveCustomizationUpdated, saveSettingsUpdated } from '../src/data/syncBus';
import type { CloudBundle } from '../src/data/storage';

/**
 * Owner (2026-09-02): "changing things in Customize is super laggy, I choose things and it reverts back
 * immediately." Two halves: (1) every cloud-sync adopt — including the echo of this device's own push a
 * few seconds after each edit — reloaded prefs/customization and re-ran initTheme(), which repainted the
 * device-global appearance over the open sheet's per-character overlay; (2) that overlay was a one-off
 * DOM write, so any global repaint erased it.
 */
const html = () => document.documentElement.dataset.theme;

describe('the open sheet keeps its per-character look through a global repaint', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSheetOverlay();
    setTheme('midnight');
  });

  it('a sync-driven initTheme() no longer wipes the sheet overlay; clearing it restores the device theme', () => {
    expect(getAppearance().themeId).toBe('midnight');
    applySheetOverlay({ themeId: 'parchment' });
    expect(hasSheetOverlay()).toBe(true);
    const overlaid = html();
    initTheme(); // what cloudSync.adopt() ran on every pull/push
    expect(html()).toBe(overlaid);
    clearSheetOverlay();
    expect(hasSheetOverlay()).toBe(false);
    expect(html()).not.toBe(overlaid);
  });
});

describe('a no-op sync does not reload settings at all', () => {
  const bundle = (over: Partial<CloudBundle>): CloudBundle =>
    ({ roster: [], charUpdated: {}, homebrew: {} as CloudBundle['homebrew'], homebrewSources: {}, modes: {}, ...over }) as CloudBundle;

  beforeEach(() => localStorage.clear());

  it('unchanged stamps → nothing to reload; a newer stamp on either axis → reload', () => {
    saveSettingsUpdated(1000);
    saveCustomizationUpdated(2000);
    expect(bundleSettingsChanged(bundle({ settingsUpdated: 1000, customizationUpdated: 2000 }))).toBe(false);
    expect(bundleSettingsChanged(bundle({ settingsUpdated: 1001, customizationUpdated: 2000 }))).toBe(true);
    expect(bundleSettingsChanged(bundle({ settingsUpdated: 1000, customizationUpdated: 2001 }))).toBe(true);
  });
});
