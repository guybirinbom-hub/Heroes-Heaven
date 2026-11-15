import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RAIL_ORDER, RAIL_CARD_LABELS, SHEET_TABS } from '../src/data/customization';
import {
  BOXES,
  PRESET_A,
  PC_PAGES,
  boxesIn,
  boxesFromLegacy,
  layoutChangeNotes,
  layoutSource,
  pageFromLegacyTab,
  pagesHiddenFromLegacy,
  storedTabFromPage,
  type BoxId,
} from '../src/data/sheetBoxes';
import type { Customization } from '../src/rules/types';

/*
 * The old-to-new mapping of saved Customize settings (docs/redesign/boxes.md, "Saved settings"). Players
 * saved railOrder / railHidden by the 12 frozen rail card keys and hiddenTabs / defaultTab by tab name;
 * the redesigned sheet must read every one of them without a silent change, and write nothing on load.
 */

const placedA = () => [...boxesIn(PRESET_A.col1), ...boxesIn(PRESET_A.col2)];

describe('sheet boxes — the box list covers today’s sheet', () => {
  it('every rail card the rail actually renders feeds at least one box', () => {
    // Read from the rail's source, so a new card added there without a box fails here.
    const src = readFileSync(join(__dirname, '../src/sheet/VitalsRail.tsx'), 'utf8');
    const rendered = [...src.matchAll(/^\s*cards\.(\w+)\s*=/gm)].map((m) => m[1]);
    expect(rendered.length).toBeGreaterThanOrEqual(12);
    for (const key of rendered) {
      expect(DEFAULT_RAIL_ORDER, `rail card "${key}" is not in DEFAULT_RAIL_ORDER`).toContain(key);
      expect(BOXES.some((b) => b.from === key), `rail card "${key}" feeds no box`).toBe(true);
    }
    for (const key of DEFAULT_RAIL_ORDER) {
      expect(BOXES.some((b) => b.from === key), `rail card "${key}" feeds no box`).toBe(true);
      expect(RAIL_CARD_LABELS[key], `rail card "${key}" has no label`).toBeTruthy();
    }
  });

  it('the boxes the grey options left out are in the list', () => {
    const ids = BOXES.map((b) => b.id);
    for (const id of ['dcs', 'reactions', 'initiative', 'archetypeDcs', 'specialStats', 'panache', 'champion', 'mythic', 'iwr'] as BoxId[]) {
      expect(ids).toContain(id);
    }
  });

  it('layout A places every box exactly once; skills and attributes head column 2', () => {
    const placed = placedA();
    expect([...placed].sort()).toEqual(BOXES.map((b) => b.id).sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(boxesIn(PRESET_A.col2).slice(0, 2)).toEqual(['attributes', 'skills']);
  });

  it('Guy’s always-in-view boxes come first in column 1, conditions before the class boxes', () => {
    const col1 = boxesIn(PRESET_A.col1);
    const at = (id: BoxId) => col1.indexOf(id);
    for (const id of ['hp', 'ac', 'shield', 'perception', 'heroPoints', 'saves', 'speed', 'senses', 'conditions'] as BoxId[]) {
      expect(at(id), id).toBeGreaterThanOrEqual(0);
      expect(at(id), `${id} before panache`).toBeLessThan(at('panache'));
    }
  });

  it('the measured fit depends on three side-by-side pairs', () => {
    expect(PRESET_A.col1).toContainEqual(['perception', 'heroPoints']);
    expect(PRESET_A.col1).toContainEqual(['initiative', 'reactions']);
    expect(PRESET_A.col1).toContainEqual(['speed', 'senses']);
  });

  it('box ids and labels are unique', () => {
    expect(new Set(BOXES.map((b) => b.id)).size).toBe(BOXES.length);
    expect(new Set(BOXES.map((b) => b.label)).size).toBe(BOXES.length);
  });
});

describe('sheet boxes — saved rail settings', () => {
  it('no saved settings: exactly layout A, Languages hidden by default', () => {
    expect(boxesFromLegacy({})).toEqual({ col1: PRESET_A.col1, col2: PRESET_A.col2, hidden: ['languages'] });
  });

  it('hiding the hp card hides Hit points, Armor Class, the shield and the DC box', () => {
    expect([...boxesFromLegacy({ railHidden: ['hp'] }).hidden].sort()).toEqual(['ac', 'dcs', 'hp', 'languages', 'shield']);
  });

  it('hiding the movement card hides hero points, initiative, speed, senses and reactions', () => {
    expect([...boxesFromLegacy({ railHidden: ['movement'] }).hidden].sort()).toEqual(
      ['heroPoints', 'initiative', 'languages', 'reactions', 'senses', 'speed'].sort(),
    );
  });

  it('hiding saves hides Perception and the saving throws; hiding defenses hides the resistances box', () => {
    expect([...boxesFromLegacy({ railHidden: ['saves'] }).hidden].sort()).toEqual(['languages', 'perception', 'saves']);
    expect([...boxesFromLegacy({ railHidden: ['defenses'] }).hidden].sort()).toEqual(['iwr', 'languages']);
    expect([...boxesFromLegacy({ railHidden: ['multiclassDc', 'conditions'] }).hidden].sort()).toEqual(['archetypeDcs', 'conditions', 'languages']);
  });

  it('skills and attributes came from the Main tab, which could not be hidden', () => {
    const r = boxesFromLegacy({ railHidden: [...DEFAULT_RAIL_ORDER] });
    expect(r.hidden).not.toContain('skills');
    expect(r.hidden).not.toContain('attributes');
    // Every rail-fed box is hidden, and each keeps its place for when it is shown again.
    expect(r.hidden.length).toBe(BOXES.filter((b) => b.from !== 'main').length);
    expect(r.col1).toEqual(PRESET_A.col1);
  });

  it('a saved order never moves Conditions or the always-in-view boxes', () => {
    // The Customize editor writes the whole 12-key list on any move; one moved card must not re-sort A.
    for (const railOrder of [['mythic'], ['languages'], ['hp', 'hp', ...DEFAULT_RAIL_ORDER], [...DEFAULT_RAIL_ORDER].reverse()]) {
      const r = boxesFromLegacy({ railOrder });
      expect(r.col1, JSON.stringify(railOrder)).toEqual(PRESET_A.col1);
      expect(r.col2).toEqual(PRESET_A.col2);
    }
  });

  it('the one-time notice tells a player whose own order was not kept', () => {
    const notes = layoutChangeNotes({ railOrder: ['mythic'], railHidden: ['languages'] });
    expect(notes.map((n) => n.kind)).toEqual(['order']);
    expect(notes[0].text).toMatch(/order/);
    // A saved order equal to the default (duplicates and unknown keys aside) was no real reordering.
    expect(layoutChangeNotes({ railOrder: [...DEFAULT_RAIL_ORDER], railHidden: ['languages'] })).toEqual([]);
    expect(layoutChangeNotes({ railOrder: ['no-such-card', ...DEFAULT_RAIL_ORDER], railHidden: ['languages'] })).toEqual([]);
    expect(layoutChangeNotes({ railOrder: ['hp', 'hp', ...DEFAULT_RAIL_ORDER], railHidden: ['languages'] })).toEqual([]);
  });

  it('the notice tells everyone who saw Languages on the rail that it moved, and nobody who hid it', () => {
    expect(layoutChangeNotes({}).map((n) => n.kind)).toEqual(['languages']);
    expect(layoutChangeNotes({})[0].text).toMatch(/Languages/);
    expect(layoutChangeNotes({ railHidden: [] }).map((n) => n.kind)).toEqual(['languages']);
    expect(layoutChangeNotes({ railHidden: ['languages'] })).toEqual([]);
  });

  it('with the Details page hidden, Languages stay shown in the column and the notice says nothing about them', () => {
    const c: Customization = { hiddenTabs: ['Details'], railHidden: [] };
    expect(boxesFromLegacy(c).hidden).not.toContain('languages');
    expect(layoutChangeNotes(c)).toEqual([]);
    // Hidden on the rail too: hidden everywhere, as the player chose.
    expect(boxesFromLegacy({ hiddenTabs: ['Details'], railHidden: ['languages'] }).hidden).toContain('languages');
  });

  it('never changes the saved settings it reads', () => {
    const c: Customization = { railOrder: ['mythic', 'hp'], railHidden: ['saves'], hiddenTabs: ['Notes'], defaultTab: 'Main' };
    const before = JSON.stringify(c);
    const r = boxesFromLegacy(c);
    layoutChangeNotes(c);
    pageFromLegacyTab(c.defaultTab);
    pagesHiddenFromLegacy(c.hiddenTabs);
    expect(JSON.stringify(c)).toBe(before);
    // Nor the preset it was given.
    const pair = PRESET_A.col1.findIndex(Array.isArray);
    (r.col1[pair] as BoxId[])[0] = 'hp';
    expect(PRESET_A.col1[pair]).toEqual(['perception', 'heroPoints']);
  });
});

describe('sheet boxes — a device layout never undoes a character’s own choices', () => {
  it('the character’s own settings win over the device default', () => {
    expect(layoutSource({ pcLayout: {} }, { railHidden: ['mythic'] })).toBe('character-rail');
    // A saved order alone is not used by layout A, so it must not shut out the device layout.
    expect(layoutSource({ pcLayout: {} }, { railOrder: ['mythic'] })).toBe('device-layout');
    expect(layoutSource({ pcLayout: {} }, { railHidden: [] })).toBe('character-rail');
    expect(layoutSource({ pcLayout: {} }, { pcLayout: {}, railHidden: ['mythic'] })).toBe('character-layout');
    expect(layoutSource({ pcLayout: {} }, {})).toBe('device-layout');
    expect(layoutSource({ pcLayout: {} }, null)).toBe('device-layout');
    expect(layoutSource({}, {})).toBe('device-rail');
  });
});

describe('sheet boxes — saved tab settings', () => {
  it('Main becomes Actions; every other tab keeps its name', () => {
    expect(pageFromLegacyTab('Main')).toBe('Actions');
    for (const t of SHEET_TABS.filter((x) => x !== 'Main')) expect(pageFromLegacyTab(t)).toBe(t);
    expect(pageFromLegacyTab(undefined)).toBeUndefined();
    expect(pageFromLegacyTab('Gone tab')).toBeUndefined();
  });

  it('every old tab has a page', () => {
    for (const t of SHEET_TABS) expect(PC_PAGES).toContain(pageFromLegacyTab(t));
  });

  it('the Actions page is stored as Main, so the phone’s opening page never changes', () => {
    expect(storedTabFromPage('Actions')).toBe('Main');
    for (const p of PC_PAGES) expect(pageFromLegacyTab(storedTabFromPage(p))).toBe(p);
    for (const t of SHEET_TABS) expect(storedTabFromPage(pageFromLegacyTab(t)!)).toBe(t);
  });

  it('hidden tabs stay hidden; Main and Actions can never be hidden', () => {
    expect(pagesHiddenFromLegacy(['Notes', 'Companions'])).toEqual(['Notes', 'Companions']);
    expect(pagesHiddenFromLegacy(['Main', 'Actions', 'Spells'])).toEqual(['Spells']);
    expect(pagesHiddenFromLegacy(undefined)).toEqual([]);
  });
});
